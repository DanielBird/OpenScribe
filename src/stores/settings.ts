import { defineStore } from 'pinia';
import { computed, ref, shallowRef, watch, type Ref } from 'vue';
import { randomAuthorName, type ChatAuthor } from '../domain/chat';
import { checkFile, type FileCheck } from '../domain/filecheck';
import { languageName, type LanguageHint, type LlmProviderId } from '../domain/transcript';
import { z } from '../lib/zod';
import { probeDuration } from '../media/probeDuration';
import { getTranscriptionProvider, verifyLlmKey } from '../providers/index';
import {
  isKnownModel,
  isProjectModel,
  LLM_MODELS,
  PROJECT_MODELS,
  projectProviderOf,
} from '../providers/llm/models';
import type { KeyCheckResult } from '../providers/transcription/types';
import { readJson, removeKey, writeJson } from '../storage/local';
import * as secrets from '../storage/secrets';
import { KEY_PROVIDERS, type KeyProvider } from '../storage/secrets';

export type { KeyProvider };

export interface KeyCheckState {
  status: 'idle' | 'checking' | 'done';
  result: KeyCheckResult | null;
}

type KeyVerifier = (apiKey: string, signal: AbortSignal) => Promise<KeyCheckResult>;

const PREFS_KEY = 'prefs';

/** Persisted preferences. Each field falls back on its own, so one bad value doesn't reset the rest. */
const PrefsSchema = z.object({
  /** `'auto'` or a language code; the store falls back to Auto for one the provider doesn't offer. */
  languageHint: z.string().catch('auto'),
  zeroRetention: z.boolean().catch(false),
  /** The provider and model of the last translation, offered first next time. */
  translationProvider: z.enum(['claude', 'gemini']).catch('claude'),
  translationModel: z.string().optional().catch(undefined),
  /** "Don't show again" on the translation data notice. */
  hideTranslationNotice: z.boolean().catch(false),
  /** Scroll the transcript to the turn being played. */
  followPlayback: z.boolean().catch(true),
  /** The model for project work (DECISIONS.md D23). */
  projectModel: z.string().optional().catch(undefined),
  /** The name saved with your chats (D29); empty for the one made up for this browser. */
  userName: z.string().catch(''),
});
type Prefs = z.infer<typeof PrefsSchema>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function loadPrefs(): Prefs {
  return PrefsSchema.parse(readJson('local', PREFS_KEY, {}, isRecord));
}

/** Merges into the stored object, so prefs saved elsewhere survive. */
function savePrefs(prefs: Partial<Prefs>): void {
  writeJson('local', PREFS_KEY, { ...readJson('local', PREFS_KEY, {}, isRecord), ...prefs });
}

const CHAT_AUTHOR_KEY = 'chatAuthor';

/** Who this browser is in saved chats (D29): an id, not a person, and the name made up for it. */
const ChatAuthorSchema = z.object({ id: z.string().min(1), generatedName: z.string().min(1) });
type ChatAuthorIdentity = z.infer<typeof ChatAuthorSchema>;

/** This browser's chat identity, made and saved the first time it's needed. */
function loadChatAuthor(): ChatAuthorIdentity {
  const stored = ChatAuthorSchema.safeParse(readJson<unknown>('local', CHAT_AUTHOR_KEY, null));
  if (stored.success) return stored.data;
  const made = { id: crypto.randomUUID(), generatedName: randomAuthorName(Math.random) };
  writeJson('local', CHAT_AUTHOR_KEY, made);
  return made;
}

function perProvider<T>(make: (p: KeyProvider) => T): Record<KeyProvider, T> {
  return { elevenlabs: make('elevenlabs'), claude: make('claude'), gemini: make('gemini') };
}

const CHECK_FAILED: KeyCheckResult = {
  ok: false,
  message: "The key couldn't be checked. Try again.",
};

export const useSettingsStore = defineStore('settings', () => {
  const transcription = getTranscriptionProvider();
  const limits = transcription.limits;

  // Providers whose keys can be tested.
  const verifiers: Partial<Record<KeyProvider, KeyVerifier>> = {
    claude: (key, signal) => verifyLlmKey('claude', key, signal),
    gemini: (key, signal) => verifyLlmKey('gemini', key, signal),
  };
  if (transcription.verifyKey) verifiers.elevenlabs = transcription.verifyKey;

  // --- API keys (DECISIONS.md D3) ---------------------------------------------------------------

  const elevenLabsKey = ref(secrets.loadKey('elevenlabs'));
  const claudeKey = ref(secrets.loadKey('claude'));
  const geminiKey = ref(secrets.loadKey('gemini'));
  const keyRefs: Record<KeyProvider, Ref<string>> = {
    elevenlabs: elevenLabsKey,
    claude: claudeKey,
    gemini: geminiKey,
  };
  // One setting for all keys. On if any key is already remembered; the rest then join it, so every
  // stored key is in the same place.
  const rememberKeys = ref(KEY_PROVIDERS.some((p) => secrets.isRemembered(p)));
  for (const p of KEY_PROVIDERS) secrets.saveKey(p, keyRefs[p].value, rememberKeys.value);
  const keyChecks = ref(perProvider<KeyCheckState>(() => ({ status: 'idle', result: null })));
  const checkControllers: Partial<Record<KeyProvider, AbortController>> = {};

  function resetKeyCheck(p: KeyProvider): void {
    checkControllers[p]?.abort();
    delete checkControllers[p];
    keyChecks.value[p] = { status: 'idle', result: null };
  }

  // Every change is saved at once, including plain assignments such as `settings.elevenLabsKey = …`.
  // A check result belongs to the key it tested, so editing the key clears it.
  for (const p of KEY_PROVIDERS) {
    watch(
      keyRefs[p],
      (value) => {
        secrets.saveKey(p, value, rememberKeys.value);
        resetKeyCheck(p);
      },
      { flush: 'sync' },
    );
  }

  function keyFor(p: KeyProvider): string {
    return keyRefs[p].value;
  }

  function setKey(p: KeyProvider, value: string): void {
    keyRefs[p].value = value;
  }

  /** Moves every key between localStorage and sessionStorage immediately. */
  function setRememberKeys(on: boolean): void {
    rememberKeys.value = on;
    for (const p of KEY_PROVIDERS) secrets.saveKey(p, keyRefs[p].value, on);
  }

  function forgetAllKeys(): void {
    rememberKeys.value = false;
    for (const p of KEY_PROVIDERS) {
      keyRefs[p].value = '';
      secrets.forgetKey(p);
    }
  }

  /** Where each key is kept: `local` (remembered on this computer), `session` (this tab) or `null`. */
  const keyLocations = computed(() =>
    perProvider((p): 'local' | 'session' | null =>
      keyRefs[p].value.trim() === '' ? null : rememberKeys.value ? 'local' : 'session',
    ),
  );

  function canTestKey(p: KeyProvider): boolean {
    return verifiers[p] !== undefined;
  }

  async function testKey(p: KeyProvider): Promise<void> {
    const verify = verifiers[p];
    if (!verify) return;
    resetKeyCheck(p);
    const controller = new AbortController();
    checkControllers[p] = controller;
    keyChecks.value[p] = { status: 'checking', result: null };
    let result: KeyCheckResult;
    try {
      result = await verify(keyRefs[p].value, controller.signal);
    } catch {
      // verifyKey rejects only when aborted; anything else is unexpected.
      result = CHECK_FAILED;
    }
    if (controller.signal.aborted) return; // the key changed or a newer check started
    delete checkControllers[p];
    keyChecks.value[p] = { status: 'done', result };
  }

  // --- Options ------------------------------------------------------------------------------------

  /** What can be chosen besides Auto-detect, A–Z by name (DECISIONS.md D37). */
  const languages = transcription.languages
    .map((code) => ({ code, label: languageName(code) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en'));

  const prefs = loadPrefs();
  const languageHint = ref<LanguageHint>(
    transcription.languages.includes(prefs.languageHint) ? prefs.languageHint : 'auto',
  );
  const zeroRetention = ref(prefs.zeroRetention);
  watch(
    [languageHint, zeroRetention],
    ([hint, zeroRet]) => savePrefs({ languageHint: hint, zeroRetention: zeroRet }),
    { flush: 'sync' },
  );

  // --- Translation choices -----------------------------------------------------------------------

  const translationProvider = ref<LlmProviderId>(prefs.translationProvider);
  /** Always one of the provider's models: an unknown or outdated saved model falls back to the default. */
  const translationModel = ref<string>(
    prefs.translationModel && isKnownModel(prefs.translationProvider, prefs.translationModel)
      ? prefs.translationModel
      : LLM_MODELS[prefs.translationProvider].default,
  );
  const hideTranslationNotice = ref(prefs.hideTranslationNotice);
  watch(
    [translationProvider, translationModel],
    ([provider, model]) => savePrefs({ translationProvider: provider, translationModel: model }),
    { flush: 'sync' },
  );
  watch(hideTranslationNotice, (hide) => savePrefs({ hideTranslationNotice: hide }), {
    flush: 'sync',
  });

  // --- Project model (Project mode) --------------------------------------------------------------

  /** Always one of `PROJECT_MODELS`: a missing, unknown or outdated saved model falls back to the default. */
  const projectModel = ref<string>(
    prefs.projectModel && isProjectModel(prefs.projectModel)
      ? prefs.projectModel
      : PROJECT_MODELS.default,
  );
  watch(projectModel, (model) => savePrefs({ projectModel: model }), { flush: 'sync' });
  /** Whose key the pipeline and the summaries use (DECISIONS.md D26). */
  const projectProvider = computed<LlmProviderId>(() => projectProviderOf(projectModel.value));

  // --- Chat author (D29) --------------------------------------------------------------------------

  const userName = ref(prefs.userName);
  watch(userName, (name) => savePrefs({ userName: name }), { flush: 'sync' });
  const chatIdentity = shallowRef(loadChatAuthor());
  /** The name made up for this browser, used while **Your name** is empty. */
  const generatedName = computed(() => chatIdentity.value.generatedName);
  /** Who saves this browser's chats: its id, and **Your name** or else the made-up one. */
  const chatAuthor = computed<ChatAuthor>(() => ({
    id: chatIdentity.value.id,
    name: userName.value.trim() || chatIdentity.value.generatedName,
  }));

  // --- Playback -----------------------------------------------------------------------------------

  const followPlayback = ref(prefs.followPlayback);
  watch(followPlayback, (follow) => savePrefs({ followPlayback: follow }), { flush: 'sync' });

  /** Deletes the saved preferences and goes back to the defaults. */
  function resetPrefs(): void {
    const defaults = PrefsSchema.parse({});
    languageHint.value = defaults.languageHint;
    zeroRetention.value = defaults.zeroRetention;
    translationProvider.value = defaults.translationProvider;
    translationModel.value = LLM_MODELS[defaults.translationProvider].default;
    hideTranslationNotice.value = defaults.hideTranslationNotice;
    followPlayback.value = defaults.followPlayback;
    projectModel.value = PROJECT_MODELS.default;
    userName.value = defaults.userName;
    // The watchers above have just saved the defaults (flush: 'sync'); remove them instead.
    removeKey('local', PREFS_KEY);
    // A new chat identity: chats saved before read as someone else's (D29).
    removeKey('local', CHAT_AUTHOR_KEY);
    chatIdentity.value = loadChatAuthor();
  }

  /** Per run, not persisted. `null` = Auto. An entry that isn't a number is stored as `NaN`. */
  const numSpeakers = ref<number | null>(null);

  // --- Recording ----------------------------------------------------------------------------------

  const file = shallowRef<File | null>(null);
  const fileDurationSec = ref<number | null>(null);
  const fileProbing = ref(false);
  let probeSeq = 0;
  let probeController: AbortController | null = null;

  function cancelProbe(): void {
    probeSeq++;
    probeController?.abort();
    probeController = null;
  }

  /** Selects a file and reads its duration. A newer selection cancels this probe and wins. */
  async function setFile(next: File): Promise<void> {
    cancelProbe();
    const seq = probeSeq;
    const controller = new AbortController();
    probeController = controller;
    file.value = next;
    fileDurationSec.value = null;
    fileProbing.value = true;

    const duration = await probeDuration(next, undefined, controller.signal);
    if (seq !== probeSeq) return;
    probeController = null;
    fileDurationSec.value = duration;
    fileProbing.value = false;
  }

  function clearFile(): void {
    cancelProbe();
    file.value = null;
    fileDurationSec.value = null;
    fileProbing.value = false;
  }

  /** `null` while there is no file or its duration is still being read. */
  const fileCheck = computed<FileCheck | null>(() => {
    const f = file.value;
    if (!f || fileProbing.value) return null;
    return checkFile(
      { name: f.name, size: f.size, type: f.type, durationSec: fileDurationSec.value },
      limits,
    );
  });

  // --- Readiness ----------------------------------------------------------------------------------

  const speakersValid = computed(() => {
    const n = numSpeakers.value;
    return n === null || (Number.isInteger(n) && n >= 1 && n <= limits.maxSpeakers);
  });

  /** Why Next is disabled, in the order of the form. Empty when ready. */
  const missingRequirements = computed(() => {
    const missing: string[] = [];
    if (!file.value) missing.push('Choose a recording.');
    else if (fileProbing.value) missing.push('Wait while the recording is checked.');
    else if (!fileCheck.value?.ok) {
      missing.push('Choose a recording that meets the limits shown above.');
    }
    if (elevenLabsKey.value.trim() === '') missing.push('Add your ElevenLabs API key in Settings.');
    if (!speakersValid.value) {
      missing.push(`Number of speakers must be a whole number from 1 to ${limits.maxSpeakers}.`);
    }
    return missing;
  });

  const isReady = computed(() => missingRequirements.value.length === 0);

  return {
    elevenLabsKey,
    claudeKey,
    geminiKey,
    rememberKeys,
    keyLocations,
    keyChecks,
    languages,
    languageHint,
    numSpeakers,
    zeroRetention,
    translationProvider,
    translationModel,
    hideTranslationNotice,
    followPlayback,
    projectModel,
    projectProvider,
    userName,
    generatedName,
    chatAuthor,
    file,
    fileDurationSec,
    fileProbing,
    fileCheck,
    missingRequirements,
    isReady,
    keyFor,
    setKey,
    setRememberKeys,
    forgetAllKeys,
    resetPrefs,
    canTestKey,
    testKey,
    setFile,
    clearFile,
  };
});

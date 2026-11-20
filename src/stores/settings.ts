import { defineStore } from 'pinia';
import { computed, ref, shallowRef, watch, type Ref } from 'vue';
import { randomAuthorName, type ChatAuthor } from '../domain/chat';
import { checkFile, type FileCheck } from '../domain/filecheck';
import { cardLabel } from '../domain/gpuCard';
import { languageName, type LanguageHint, type LlmProviderId } from '../domain/transcript';
import {
  agentBudgetLimits,
  BUDGET_LEVELS,
  type AgentBudgetLimits,
  type BudgetLevel,
} from '../features/agent/limits';
import { z } from '../lib/zod';
import { probeDuration } from '../media/probeDuration';
import { getLocalSttBridge, getTranscriptionProvider, verifyLlmKey } from '../providers/index';
import type { GpuDevice } from '../providers/transcription/local/bridge';
import type { GpuChoice, TranscriptionProviderId } from '../providers/transcription/types';
import {
  AGENT_EFFORTS,
  DEFAULT_AGENT_EFFORT,
  isKnownModel,
  isProjectModel,
  LLM_MODELS,
  PROJECT_MODELS,
  projectProviderOf,
} from '../providers/llm/models';
import type { AgentEffort } from '../providers/llm/types';
import type { KeyCheckResult } from '../providers/transcription/types';
import { readJson, removeKey, writeJson } from '../storage/local';
import * as secrets from '../storage/secrets';
import { KEY_PROVIDERS, type KeyProvider } from '../storage/secrets';
import { useSpeechPackStore } from './speechPack';

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
  /** Auto-detect was replaced by English for This computer, so ElevenLabs gives it back (D56). */
  languageAutoReplaced: z.boolean().catch(false),
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
  /** The chat's effort and budgets per question (D48). */
  agentEffort: z.enum(AGENT_EFFORTS).catch(DEFAULT_AGENT_EFFORT),
  agentToolBudget: z.enum(BUDGET_LEVELS).catch('medium'),
  agentReadingBudget: z.enum(BUDGET_LEVELS).catch('medium'),
  /** The name saved with your chats (D29); empty for the one made up for this browser. */
  userName: z.string().catch(''),
  /**
   * Where the desktop app transcribes, as chosen on Setup (DECISIONS.md D53, Phase 36). Used only while the speech
   * models are ready; the web build always uses ElevenLabs.
   */
  transcriptionEngine: z.enum(['elevenlabs', 'local']).catch('elevenlabs'),
  /** Drop fillers and doubled words from a local transcript (the maintainer, 2026-11-15). No UI yet. */
  localTextCleanUp: z.boolean().catch(true),
  /**
   * Where the speech models run in the desktop app (Phase 37, decision 3): the processor, or a graphics card by its
   * name and which of the cards with that name it is. Kept while the card is gone, so it comes back with it.
   */
  localDevice: z
    .union([
      z.literal('cpu'),
      z.object({ name: z.string().min(1), nth: z.number().int().nonnegative() }),
    ])
    .catch('cpu'),
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

/** One choice in Settings' **Run on** group: the processor, or a graphics card. */
export interface DeviceOption {
  id: string;
  label: string;
  choice: 'cpu' | GpuChoice;
}

const PROCESSOR_OPTION: DeviceOption = { id: 'cpu', label: 'Processor', choice: 'cpu' };

/**
 * The processor, then each card in ggml's order. `nth` counts the earlier cards with the same name, and only a repeated
 * name gets a number in its label (`cardLabel`), so two identical cards can be told apart.
 */
function deviceOptionsFor(devices: readonly GpuDevice[]): DeviceOption[] {
  const seen = new Map<string, number>();
  const cards = devices.map((device, index): DeviceOption => {
    const nth = seen.get(device.name) ?? 0;
    seen.set(device.name, nth + 1);
    return {
      id: `gpu-${index}`,
      label: cardLabel({ name: device.name, nth }),
      choice: { name: device.name, nth },
    };
  });
  return [PROCESSOR_OPTION, ...cards];
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
  const prefs = loadPrefs();
  const speechPack = useSpeechPackStore();
  /** Whether This computer was the saved choice at start: fixed, so a click while Rust checks doesn't move Setup. */
  const startedLocal = prefs.transcriptionEngine === 'local';
  /**
   * Whether Setup offers This computer: the desktop app, with the speech models ready (Phase 36, decision 2). Until
   * Rust first answers, the saved choice is trusted, so Setup doesn't open with ElevenLabs' layout (audit BUG-6).
   */
  const localAvailable = computed(
    () => __DESKTOP__ && (speechPack.checked ? speechPack.status?.state === 'ready' : startedLocal),
  );
  /** The engine chosen on Setup, kept while the models are gone, so downloading them again brings it back. */
  const preferredEngine = ref<TranscriptionProviderId>(prefs.transcriptionEngine);
  watch(preferredEngine, (engine) => savePrefs({ transcriptionEngine: engine }), { flush: 'sync' });
  /** The engine that transcribes: ElevenLabs unless This computer is chosen and can run (decision 3). */
  const transcriptionEngine = computed<TranscriptionProviderId>(() =>
    localAvailable.value && preferredEngine.value === 'local' ? 'local' : 'elevenlabs',
  );
  function setTranscriptionEngine(engine: TranscriptionProviderId): void {
    preferredEngine.value = engine;
  }
  /** This computer is trusted but not yet confirmed: Next waits for Rust's answer. */
  const engineChecking = computed(
    () => __DESKTOP__ && !speechPack.checked && transcriptionEngine.value === 'local',
  );
  const localTextCleanUp = ref(prefs.localTextCleanUp);

  // --- Where the models run (Phase 37) ------------------------------------------------------------

  /** The saved choice, sent with every run on this computer: Rust uses the processor when the card is gone. */
  const localDevice = ref<'cpu' | GpuChoice>(prefs.localDevice);
  watch(localDevice, (device) => savePrefs({ localDevice: device }), { flush: 'sync' });
  /**
   * Saves a choice in **Run on**. Settings calls it on `click` as well as `change`, since a click on the radio already
   * checked (**Processor**, while the saved card is gone) fires no `change` (audit GPU-4). The same choice again is a
   * no-op, so the second event writes nothing.
   */
  function setLocalDevice(choice: 'cpu' | GpuChoice): void {
    const saved = localDevice.value;
    if (
      choice === 'cpu'
        ? saved === 'cpu'
        : saved !== 'cpu' && saved.name === choice.name && saved.nth === choice.nth
    )
      return;
    localDevice.value = choice === 'cpu' ? 'cpu' : { name: choice.name, nth: choice.nth };
  }
  /** The graphics cards Rust last listed. Empty until Settings asks, and without a card or Vulkan. */
  const gpuDevices = shallowRef<GpuDevice[]>([]);
  let listing: Promise<void> | null = null;
  /** Asks Rust for the cards (Settings, when the models are ready). Nothing asks at launch (decision 2). */
  function refreshDevices(): Promise<void> {
    if (!__DESKTOP__) return Promise.resolve();
    const bridge = getLocalSttBridge();
    if (!bridge) return Promise.resolve();
    listing ??= bridge
      .devices()
      .then((devices) => {
        gpuDevices.value = devices;
      })
      .catch((cause: unknown) => {
        gpuDevices.value = [];
        console.warn('DeScribe: the graphics cards could not be listed', cause);
      })
      .finally(() => {
        listing = null;
      });
    return listing;
  }
  const deviceOptions = computed(() => deviceOptionsFor(gpuDevices.value));
  /** The option checked in Settings: the saved card if it's listed, else the processor (decision 4). */
  const checkedDevice = computed<DeviceOption>(() => {
    const saved = localDevice.value;
    if (saved === 'cpu') return PROCESSOR_OPTION;
    return (
      deviceOptions.value.find(
        (o) => o.choice !== 'cpu' && o.choice.name === saved.name && o.choice.nth === saved.nth,
      ) ?? PROCESSOR_OPTION
    );
  });
  const transcription = computed(() => getTranscriptionProvider(transcriptionEngine.value));
  const limits = computed(() => transcription.value.limits);
  /** Whether transcribing needs the ElevenLabs key. */
  const keyRequired = computed(() => transcription.value.needsKey);

  // Providers whose keys can be tested. The ElevenLabs key is tested whichever engine transcribes.
  const verifiers: Partial<Record<KeyProvider, KeyVerifier>> = {
    claude: (key, signal) => verifyLlmKey('claude', key, signal),
    gemini: (key, signal) => verifyLlmKey('gemini', key, signal),
  };
  const elevenLabs = getTranscriptionProvider('elevenlabs');
  if (elevenLabs.verifyKey) verifiers.elevenlabs = elevenLabs.verifyKey;

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
  const languages = computed(() =>
    transcription.value.languages
      .map((code) => ({ code, label: languageName(code) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'en')),
  );

  const languageHint = ref<LanguageHint>(
    transcription.value.languages.includes(prefs.languageHint) ? prefs.languageHint : 'auto',
  );
  // When the engine changes, the language follows it (D37, Phase 36). One it doesn't offer becomes Auto-detect, or
  // English for an engine that can't report what it detected (this computer), which Setup then asks for. Auto-detect
  // replaced that way comes back with an engine that can, unless the language was changed in between. That is saved,
  // so it survives a restart (audit BUG-5). While Rust checks the models at start, the engine is the saved one, so a
  // language only this computer offers isn't dropped first (audit BUG-6).
  const autoReplaced = ref(prefs.languageAutoReplaced);
  watch(autoReplaced, (replaced) => savePrefs({ languageAutoReplaced: replaced }), {
    flush: 'sync',
  });
  let settingHint = false;
  function setHint(hint: LanguageHint): void {
    settingHint = true;
    languageHint.value = hint;
    settingHint = false;
    if (hint === 'auto') autoReplaced.value = false;
  }
  watch(
    transcription,
    (provider) => {
      const hint = languageHint.value;
      const offered = hint === 'auto' || provider.languages.includes(hint);
      if (provider.supports.autoDetect) {
        if (!offered || autoReplaced.value) setHint('auto');
        return;
      }
      if (hint !== 'auto' && offered) return;
      setHint(provider.languages.includes('en') ? 'en' : (provider.languages[0] ?? 'auto'));
      autoReplaced.value = hint === 'auto';
    },
    { flush: 'sync', immediate: true },
  );
  watch(
    languageHint,
    () => {
      if (!settingHint) autoReplaced.value = false;
    },
    { flush: 'sync' },
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

  // --- Chat settings (D48) ------------------------------------------------------------------------

  const agentEffort = ref<AgentEffort>(prefs.agentEffort);
  const agentToolBudget = ref<BudgetLevel>(prefs.agentToolBudget);
  const agentReadingBudget = ref<BudgetLevel>(prefs.agentReadingBudget);
  watch(
    [agentEffort, agentToolBudget, agentReadingBudget],
    ([effort, tools, reading]) =>
      savePrefs({ agentEffort: effort, agentToolBudget: tools, agentReadingBudget: reading }),
    { flush: 'sync' },
  );
  /** What a question may use, from the two budget levels. */
  const agentLimits = computed<AgentBudgetLimits>(() =>
    agentBudgetLimits(agentToolBudget.value, agentReadingBudget.value),
  );

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
    autoReplaced.value = defaults.languageAutoReplaced;
    zeroRetention.value = defaults.zeroRetention;
    translationProvider.value = defaults.translationProvider;
    translationModel.value = LLM_MODELS[defaults.translationProvider].default;
    hideTranslationNotice.value = defaults.hideTranslationNotice;
    followPlayback.value = defaults.followPlayback;
    projectModel.value = PROJECT_MODELS.default;
    agentEffort.value = defaults.agentEffort;
    agentToolBudget.value = defaults.agentToolBudget;
    agentReadingBudget.value = defaults.agentReadingBudget;
    userName.value = defaults.userName;
    preferredEngine.value = defaults.transcriptionEngine;
    localTextCleanUp.value = defaults.localTextCleanUp;
    localDevice.value = defaults.localDevice;
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
      limits.value,
    );
  });

  // --- Readiness ----------------------------------------------------------------------------------

  const speakersValid = computed(() => {
    const n = numSpeakers.value;
    if (!transcription.value.supports.numSpeakers) return true; // not asked for (Phase 33)
    return n === null || (Number.isInteger(n) && n >= 1 && n <= limits.value.maxSpeakers);
  });

  /** Why Next is disabled, in the order of the form. Empty when ready. */
  const missingRequirements = computed(() => {
    const missing: string[] = [];
    if (!file.value) missing.push('Choose a recording.');
    else if (fileProbing.value) missing.push('Wait while the recording is checked.');
    else if (!fileCheck.value?.ok) {
      missing.push('Choose a recording that meets the limits shown above.');
    }
    if (engineChecking.value) missing.push('Wait while the speech models are checked.');
    else if (keyRequired.value && elevenLabsKey.value.trim() === '') {
      missing.push('Add your ElevenLabs API key in Settings.');
    }
    if (!speakersValid.value) {
      missing.push(
        `Number of speakers must be a whole number from 1 to ${limits.value.maxSpeakers}.`,
      );
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
    transcriptionEngine,
    localAvailable,
    setTranscriptionEngine,
    transcription,
    limits,
    localTextCleanUp,
    localDevice,
    setLocalDevice,
    gpuDevices,
    refreshDevices,
    deviceOptions,
    checkedDevice,
    keyRequired,
    languageHint,
    numSpeakers,
    zeroRetention,
    translationProvider,
    translationModel,
    hideTranslationNotice,
    followPlayback,
    projectModel,
    projectProvider,
    agentEffort,
    agentToolBudget,
    agentReadingBudget,
    agentLimits,
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

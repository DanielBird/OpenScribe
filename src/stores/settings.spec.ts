import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTranscriptionProviderForTests } from '../providers/index';
import { createElevenLabsProvider } from '../providers/transcription/elevenlabs/provider';
import type { KeyCheckResult } from '../providers/transcription/types';
import { useSettingsStore } from './settings';

const mocks = vi.hoisted(() => ({
  probeDuration:
    vi.fn<(file: File, timeoutMs?: number, signal?: AbortSignal) => Promise<number | null>>(),
  verifyKey: vi.fn<(apiKey: string, signal?: AbortSignal) => Promise<KeyCheckResult>>(),
}));

vi.mock('../media/probeDuration', () => ({ probeDuration: mocks.probeDuration }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const wav = (name = 'interview.wav', size?: number) => {
  const file = new File(['RIFF'], name, { type: 'audio/wav' });
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
  return file;
};

const localKey = (p: string) => localStorage.getItem(`describe.v1.key.${p}`);
const sessionKey = (p: string) => sessionStorage.getItem(`describe.v1.key.${p}`);
const storedPrefs = () =>
  JSON.parse(localStorage.getItem('describe.v1.prefs') ?? 'null') as unknown;

/** A store with a valid key and a probed 5 s file: ready unless a test breaks one piece. */
async function readyStore() {
  const settings = useSettingsStore();
  settings.elevenLabsKey = 'test-key';
  mocks.probeDuration.mockResolvedValueOnce(5);
  await settings.setFile(wav());
  return settings;
}

describe('settings store', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mocks.probeDuration.mockReset();
    mocks.verifyKey.mockReset();
    setTranscriptionProviderForTests({ ...createElevenLabsProvider(), verifyKey: mocks.verifyKey });
    setActivePinia(createPinia());
  });

  afterEach(() => {
    setTranscriptionProviderForTests(null);
    vi.restoreAllMocks();
  });

  describe('API keys', () => {
    it('loads the keys on init; remember is off when no key is in localStorage', () => {
      sessionStorage.setItem('describe.v1.key.claude', '"session-key"');
      const settings = useSettingsStore();
      expect(settings.claudeKey).toBe('session-key');
      expect(settings.elevenLabsKey).toBe('');
      expect(settings.rememberKeys).toBe(false);
      expect(sessionKey('claude')).toBe('"session-key"');
    });

    it('turns remember on when any key is in localStorage, and moves the others there', () => {
      localStorage.setItem('describe.v1.key.elevenlabs', '"remembered-key"');
      sessionStorage.setItem('describe.v1.key.claude', '"session-key"');
      const settings = useSettingsStore();
      expect(settings.elevenLabsKey).toBe('remembered-key');
      expect(settings.claudeKey).toBe('session-key');
      expect(settings.geminiKey).toBe('');
      expect(settings.rememberKeys).toBe(true);
      expect(localKey('claude')).toBe('"session-key"');
      expect(sessionKey('claude')).toBeNull();
      expect(localKey('gemini')).toBeNull();
    });

    it('saves a typed key to sessionStorage immediately, including plain assignments', () => {
      const settings = useSettingsStore();
      settings.setKey('elevenlabs', 'test-key');
      expect(sessionKey('elevenlabs')).toBe('"test-key"');
      settings.geminiKey = 'test-key-2';
      expect(sessionKey('gemini')).toBe('"test-key-2"');
      expect(settings.keyFor('gemini')).toBe('test-key-2');
    });

    it('moves every key to localStorage when remember is ticked, and back when unticked', () => {
      const settings = useSettingsStore();
      settings.setKey('elevenlabs', 'test-key');
      settings.setKey('gemini', 'test-key-g');
      settings.setRememberKeys(true);
      expect(settings.rememberKeys).toBe(true);
      expect(localKey('elevenlabs')).toBe('"test-key"');
      expect(localKey('gemini')).toBe('"test-key-g"');
      expect(sessionKey('elevenlabs')).toBeNull();
      expect(sessionKey('gemini')).toBeNull();

      settings.setKey('elevenlabs', 'test-key-2'); // edits keep going to the remembered place
      expect(localKey('elevenlabs')).toBe('"test-key-2"');

      settings.setRememberKeys(false);
      expect(localKey('elevenlabs')).toBeNull();
      expect(localKey('gemini')).toBeNull();
      expect(sessionKey('elevenlabs')).toBe('"test-key-2"');
      expect(sessionKey('gemini')).toBe('"test-key-g"');
    });

    it('remembers a key typed after ticking remember', () => {
      const settings = useSettingsStore();
      settings.setRememberKeys(true);
      settings.setKey('claude', 'test-key');
      expect(localKey('claude')).toBe('"test-key"');
    });

    it('deletes a key from both storages when its field is cleared', () => {
      const settings = useSettingsStore();
      settings.setRememberKeys(true);
      settings.setKey('elevenlabs', 'test-key');
      settings.setKey('elevenlabs', '');
      expect(localKey('elevenlabs')).toBeNull();
      expect(sessionKey('elevenlabs')).toBeNull();
      expect(settings.rememberKeys).toBe(true);
    });

    it('reports where each key is kept', () => {
      const settings = useSettingsStore();
      expect(settings.keyLocations).toEqual({ elevenlabs: null, claude: null, gemini: null });
      settings.setKey('elevenlabs', 'test-key');
      settings.setKey('claude', '   ');
      expect(settings.keyLocations).toEqual({ elevenlabs: 'session', claude: null, gemini: null });
      settings.setRememberKeys(true);
      settings.setKey('gemini', 'test-key');
      expect(settings.keyLocations).toEqual({
        elevenlabs: 'local',
        claude: null,
        gemini: 'local',
      });
    });

    it('forgetAllKeys clears every key from both storages and unticks remember', () => {
      const settings = useSettingsStore();
      settings.setKey('elevenlabs', 'test-key');
      settings.setRememberKeys(true);
      settings.setKey('claude', 'test-key');
      settings.setKey('gemini', 'test-key');
      settings.forgetAllKeys();
      expect(settings.rememberKeys).toBe(false);
      for (const p of ['elevenlabs', 'claude', 'gemini'] as const) {
        expect(settings.keyFor(p)).toBe('');
        expect(localKey(p)).toBeNull();
        expect(sessionKey(p)).toBeNull();
      }
      expect(settings.keyLocations).toEqual({ elevenlabs: null, claude: null, gemini: null });
    });
  });

  describe('Test key', () => {
    it('is available for every provider', () => {
      const settings = useSettingsStore();
      expect(settings.canTestKey('elevenlabs')).toBe(true);
      expect(settings.canTestKey('claude')).toBe(true);
      expect(settings.canTestKey('gemini')).toBe(true);
    });

    it('goes from checking to done with the result', async () => {
      const settings = useSettingsStore();
      settings.elevenLabsKey = 'test-key';
      const answer = deferred<KeyCheckResult>();
      mocks.verifyKey.mockReturnValueOnce(answer.promise);

      const running = settings.testKey('elevenlabs');
      expect(settings.keyChecks.elevenlabs).toEqual({ status: 'checking', result: null });
      expect(mocks.verifyKey).toHaveBeenCalledWith('test-key', expect.any(AbortSignal));

      answer.resolve({ ok: true, message: 'The key works.' });
      await running;
      expect(settings.keyChecks.elevenlabs).toEqual({
        status: 'done',
        result: { ok: true, message: 'The key works.' },
      });
    });

    it('aborts the check and drops its result when the key changes', async () => {
      const settings = useSettingsStore();
      settings.elevenLabsKey = 'test-key';
      const answer = deferred<KeyCheckResult>();
      mocks.verifyKey.mockReturnValueOnce(answer.promise);

      const running = settings.testKey('elevenlabs');
      const signal = mocks.verifyKey.mock.calls[0]?.[1];
      settings.elevenLabsKey = 'test-key-2';
      expect(signal?.aborted).toBe(true);
      expect(settings.keyChecks.elevenlabs).toEqual({ status: 'idle', result: null });

      answer.resolve({ ok: true, message: 'stale' });
      await running;
      expect(settings.keyChecks.elevenlabs).toEqual({ status: 'idle', result: null });
    });

    it('clears a finished result when the key changes', async () => {
      const settings = useSettingsStore();
      settings.elevenLabsKey = 'test-key';
      mocks.verifyKey.mockResolvedValueOnce({ ok: false, message: 'Unknown key.' });
      await settings.testKey('elevenlabs');
      expect(settings.keyChecks.elevenlabs.status).toBe('done');
      settings.elevenLabsKey = 'test-key-2';
      expect(settings.keyChecks.elevenlabs).toEqual({ status: 'idle', result: null });
    });

    it('lets a newer check replace a running one', async () => {
      const settings = useSettingsStore();
      settings.elevenLabsKey = 'test-key';
      const first = deferred<KeyCheckResult>();
      mocks.verifyKey.mockReturnValueOnce(first.promise);
      mocks.verifyKey.mockResolvedValueOnce({ ok: true, message: 'second' });

      const running = settings.testKey('elevenlabs');
      await settings.testKey('elevenlabs');
      first.resolve({ ok: false, message: 'first' });
      await running;
      expect(settings.keyChecks.elevenlabs.result).toEqual({ ok: true, message: 'second' });
    });

    it('shows a generic failure if the verifier throws unexpectedly', async () => {
      const settings = useSettingsStore();
      settings.elevenLabsKey = 'test-key';
      mocks.verifyKey.mockRejectedValueOnce(new Error('boom'));
      await settings.testKey('elevenlabs');
      expect(settings.keyChecks.elevenlabs.result).toEqual({
        ok: false,
        message: "The key couldn't be checked. Try again.",
      });
    });

    it('does nothing for a provider without a verifier', async () => {
      const { verifyKey: _none, ...withoutCheck } = createElevenLabsProvider();
      setTranscriptionProviderForTests(withoutCheck);
      const settings = useSettingsStore();
      settings.elevenLabsKey = 'test-key';
      expect(settings.canTestKey('elevenlabs')).toBe(false);
      await settings.testKey('elevenlabs');
      expect(settings.keyChecks.elevenlabs).toEqual({ status: 'idle', result: null });
    });
  });

  describe('prefs', () => {
    it('saves language and zero retention, and loads them in a new store', () => {
      const settings = useSettingsStore();
      expect(settings.languageHint).toBe('auto');
      expect(settings.zeroRetention).toBe(false);
      settings.languageHint = 'de';
      settings.zeroRetention = true;
      settings.numSpeakers = 2;
      expect(storedPrefs()).toEqual({ languageHint: 'de', zeroRetention: true });

      setActivePinia(createPinia());
      const reloaded = useSettingsStore();
      expect(reloaded.languageHint).toBe('de');
      expect(reloaded.zeroRetention).toBe(true);
      expect(reloaded.numSpeakers).toBeNull(); // per run
      expect(reloaded.file).toBeNull();
    });

    it('falls back field by field when stored prefs are invalid', () => {
      localStorage.setItem(
        'describe.v1.prefs',
        JSON.stringify({ languageHint: 'xx', zeroRetention: true }),
      );
      const settings = useSettingsStore();
      expect(settings.languageHint).toBe('auto');
      expect(settings.zeroRetention).toBe(true);
    });

    it('keeps a saved language the provider offers, and falls back to Auto for another', () => {
      localStorage.setItem('describe.v1.prefs', JSON.stringify({ languageHint: 'es' }));
      expect(useSettingsStore().languageHint).toBe('es');

      localStorage.setItem('describe.v1.prefs', JSON.stringify({ languageHint: 'yue' }));
      setActivePinia(createPinia());
      expect(useSettingsStore().languageHint).toBe('auto');
    });

    it('lists the languages to choose from, A–Z by name', () => {
      const { languages } = useSettingsStore();
      expect(languages).toHaveLength(36);
      expect(languages).toContainEqual({ code: 'ja', label: 'Japanese' });
      expect(languages.map((l) => l.label).slice(0, 3)).toEqual([
        'Belarusian',
        'Bosnian',
        'Bulgarian',
      ]);
    });

    it('falls back to defaults when stored prefs are not an object', () => {
      localStorage.setItem('describe.v1.prefs', '[1, 2]');
      const settings = useSettingsStore();
      expect(settings.languageHint).toBe('auto');
      expect(settings.zeroRetention).toBe(false);
    });

    it('keeps prefs fields that belong to other features when saving', () => {
      localStorage.setItem('describe.v1.prefs', JSON.stringify({ laterFeature: 1 }));
      const settings = useSettingsStore();
      settings.languageHint = 'fr';
      expect(storedPrefs()).toEqual({
        laterFeature: 1,
        languageHint: 'fr',
        zeroRetention: false,
      });
    });

    it('defaults the translation choice to Claude with its default model, notice shown', () => {
      const settings = useSettingsStore();
      expect(settings.translationProvider).toBe('claude');
      expect(settings.translationModel).toBe('claude-opus-5-5');
      expect(settings.hideTranslationNotice).toBe(false);
      expect(storedPrefs()).toBeNull(); // nothing written until something changes
    });

    it('saves the translation choice and the notice flag, and loads them in a new store', () => {
      const settings = useSettingsStore();
      settings.languageHint = 'de';
      settings.translationProvider = 'gemini';
      settings.translationModel = 'gemini-3.5-flash-lite';
      settings.hideTranslationNotice = true;
      expect(storedPrefs()).toEqual({
        languageHint: 'de',
        zeroRetention: false,
        translationProvider: 'gemini',
        translationModel: 'gemini-3.5-flash-lite',
        hideTranslationNotice: true,
      });

      setActivePinia(createPinia());
      const reloaded = useSettingsStore();
      expect(reloaded.translationProvider).toBe('gemini');
      expect(reloaded.translationModel).toBe('gemini-3.5-flash-lite');
      expect(reloaded.hideTranslationNotice).toBe(true);
      expect(reloaded.languageHint).toBe('de');
    });

    it.each([
      ['an unknown model', { translationProvider: 'gemini', translationModel: 'gemini-1.0' }],
      [
        "another provider's model",
        { translationProvider: 'gemini', translationModel: 'claude-opus-5-5' },
      ],
    ])("falls back to the provider's default model for %s", (_, stored) => {
      localStorage.setItem('describe.v1.prefs', JSON.stringify(stored));
      expect(useSettingsStore().translationModel).toBe('gemini-3.8-flash');
    });

    it('follows playback by default and saves the choice', () => {
      const settings = useSettingsStore();
      expect(settings.followPlayback).toBe(true);
      settings.followPlayback = false;
      expect(storedPrefs()).toMatchObject({ followPlayback: false });

      setActivePinia(createPinia());
      expect(useSettingsStore().followPlayback).toBe(false);
    });

    it('follows playback when the stored value is invalid', () => {
      localStorage.setItem('describe.v1.prefs', JSON.stringify({ followPlayback: 'no' }));
      expect(useSettingsStore().followPlayback).toBe(true);
    });

    it('defaults the project model to Sonnet 5.5, and saves and loads Opus 5.5', () => {
      const settings = useSettingsStore();
      expect(settings.projectModel).toBe('claude-sonnet-5-5');
      settings.projectModel = 'claude-opus-5-5';
      expect(storedPrefs()).toMatchObject({ projectModel: 'claude-opus-5-5' });

      setActivePinia(createPinia());
      expect(useSettingsStore().projectModel).toBe('claude-opus-5-5');
    });

    it.each([
      ['an unknown model', { projectModel: 'claude-haiku-5-5' }],
      ['a translation-only model', { projectModel: 'gemini-3.6-flash' }],
      ['a value that is not a string', { projectModel: 5 }],
    ])('falls back to the default project model for %s', (_, stored) => {
      localStorage.setItem('describe.v1.prefs', JSON.stringify(stored));
      expect(useSettingsStore().projectModel).toBe('claude-sonnet-5-5');
    });

    it('keeps a Gemini project model, and its provider follows the model', () => {
      localStorage.setItem('describe.v1.prefs', JSON.stringify({ projectModel: 'gemini-4-argon' }));
      const settings = useSettingsStore();
      expect(settings.projectModel).toBe('gemini-4-argon');
      expect(settings.projectProvider).toBe('gemini');
      settings.projectModel = 'claude-opus-5-5';
      expect(settings.projectProvider).toBe('claude');
    });

    it('defaults the chat settings to medium, and saves and loads them (D48)', () => {
      const settings = useSettingsStore();
      expect([settings.agentEffort, settings.agentToolBudget, settings.agentReadingBudget]).toEqual(
        ['medium', 'medium', 'medium'],
      );
      expect(settings.agentLimits).toMatchObject({ toolCalls: 30, transcriptTokens: 250_000 });

      settings.agentEffort = 'high';
      settings.agentToolBudget = 'low';
      settings.agentReadingBudget = 'high';
      expect(storedPrefs()).toMatchObject({
        agentEffort: 'high',
        agentToolBudget: 'low',
        agentReadingBudget: 'high',
      });
      expect(settings.agentLimits).toEqual({
        toolCalls: 15,
        transcriptTokens: 500_000,
        summaryTokens: 150_000,
        maxIterations: 20,
      });

      setActivePinia(createPinia());
      const reloaded = useSettingsStore();
      expect(reloaded.agentEffort).toBe('high');
      expect(reloaded.agentToolBudget).toBe('low');
      expect(reloaded.agentReadingBudget).toBe('high');
    });

    it('falls back to medium for a chat setting it does not know', () => {
      localStorage.setItem(
        'describe.v1.prefs',
        JSON.stringify({ agentEffort: 'max', agentToolBudget: 5, agentReadingBudget: null }),
      );
      const settings = useSettingsStore();
      expect(settings.agentEffort).toBe('medium');
      expect(settings.agentToolBudget).toBe('medium');
      expect(settings.agentReadingBudget).toBe('medium');
    });

    it('falls back to Claude for an unknown provider', () => {
      localStorage.setItem(
        'describe.v1.prefs',
        JSON.stringify({ translationProvider: 'gpt', hideTranslationNotice: 'yes' }),
      );
      const settings = useSettingsStore();
      expect(settings.translationProvider).toBe('claude');
      expect(settings.translationModel).toBe('claude-opus-5-5');
      expect(settings.hideTranslationNotice).toBe(false);
    });

    it('resetPrefs goes back to the defaults and deletes the stored prefs, keeping keys', () => {
      const settings = useSettingsStore();
      settings.setRememberKeys(true);
      settings.setKey('elevenlabs', 'test-key');
      settings.languageHint = 'de';
      settings.zeroRetention = true;
      settings.translationProvider = 'gemini';
      settings.translationModel = 'gemini-3.6-flash';
      settings.hideTranslationNotice = true;
      settings.followPlayback = false;
      settings.projectModel = 'claude-opus-5-5';
      settings.agentEffort = 'high';
      settings.agentToolBudget = 'high';
      settings.agentReadingBudget = 'low';

      settings.resetPrefs();
      expect(settings.languageHint).toBe('auto');
      expect(settings.zeroRetention).toBe(false);
      expect(settings.translationProvider).toBe('claude');
      expect(settings.translationModel).toBe('claude-opus-5-5');
      expect(settings.hideTranslationNotice).toBe(false);
      expect(settings.followPlayback).toBe(true);
      expect(settings.projectModel).toBe('claude-sonnet-5-5');
      expect(settings.agentEffort).toBe('medium');
      expect(settings.agentToolBudget).toBe('medium');
      expect(settings.agentReadingBudget).toBe('medium');
      expect(storedPrefs()).toBeNull();
      expect(localKey('elevenlabs')).toBe('"test-key"');
    });
  });

  describe('chat author', () => {
    const storedAuthor = () =>
      JSON.parse(localStorage.getItem('describe.v1.chatAuthor') ?? 'null') as {
        id: string;
        generatedName: string;
      } | null;

    it('makes up a name and an id for this browser once, and keeps them', () => {
      const settings = useSettingsStore();
      const author = settings.chatAuthor;
      expect(author.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
      expect(author.name).toBe(settings.generatedName);
      expect(storedAuthor()).toEqual({ id: author.id, generatedName: author.name });

      setActivePinia(createPinia());
      expect(useSettingsStore().chatAuthor).toEqual(author);
    });

    it('uses Your name, trimmed, when there is one, and saves it', () => {
      const settings = useSettingsStore();
      const { id } = settings.chatAuthor;
      settings.userName = '  Dana ';
      expect(settings.chatAuthor).toEqual({ id, name: 'Dana' });
      expect(storedPrefs()).toMatchObject({ userName: '  Dana ' });
      settings.userName = ' ';
      expect(settings.chatAuthor.name).toBe(settings.generatedName);
    });

    it('starts afresh after resetPrefs: no name, and a new id', () => {
      const settings = useSettingsStore();
      const before = settings.chatAuthor.id;
      settings.userName = 'Dana';
      settings.resetPrefs();
      expect(settings.userName).toBe('');
      expect(settings.chatAuthor.id).not.toBe(before);
      expect(storedAuthor()?.id).toBe(settings.chatAuthor.id);
    });

    it('replaces a stored identity that is damaged', () => {
      localStorage.setItem('describe.v1.chatAuthor', JSON.stringify({ id: '' }));
      expect(useSettingsStore().chatAuthor.id).not.toBe('');
    });
  });

  describe('file', () => {
    it('probes the duration and checks the file', async () => {
      const settings = useSettingsStore();
      const probe = deferred<number | null>();
      mocks.probeDuration.mockReturnValueOnce(probe.promise);
      const file = wav();

      const selecting = settings.setFile(file);
      expect(settings.file).toBe(file);
      expect(settings.fileProbing).toBe(true);
      expect(settings.fileCheck).toBeNull();
      expect(mocks.probeDuration).toHaveBeenCalledWith(file, undefined, expect.any(AbortSignal));

      probe.resolve(65);
      await selecting;
      expect(settings.fileProbing).toBe(false);
      expect(settings.fileDurationSec).toBe(65);
      expect(settings.fileCheck).toEqual({ ok: true, errors: [], warnings: [] });
    });

    it('lets a newer selection win over a slower, older probe', async () => {
      const settings = useSettingsStore();
      const first = deferred<number | null>();
      const second = deferred<number | null>();
      mocks.probeDuration.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const older = wav('older.wav');
      const newer = wav('newer.wav');

      const selectingOlder = settings.setFile(older);
      const olderSignal = mocks.probeDuration.mock.calls[0]?.[2];
      const selectingNewer = settings.setFile(newer);
      expect(olderSignal?.aborted).toBe(true);

      second.resolve(12);
      await selectingNewer;
      first.resolve(99_999); // too long, but stale: must be ignored
      await selectingOlder;

      expect(settings.file).toBe(newer);
      expect(settings.fileDurationSec).toBe(12);
      expect(settings.fileProbing).toBe(false);
      expect(settings.fileCheck?.ok).toBe(true);
    });

    it('clearFile cancels a running probe and resets the selection', async () => {
      const settings = useSettingsStore();
      const probe = deferred<number | null>();
      mocks.probeDuration.mockReturnValueOnce(probe.promise);

      const selecting = settings.setFile(wav());
      const signal = mocks.probeDuration.mock.calls[0]?.[2];
      settings.clearFile();
      expect(signal?.aborted).toBe(true);
      probe.resolve(5);
      await selecting;

      expect(settings.file).toBeNull();
      expect(settings.fileDurationSec).toBeNull();
      expect(settings.fileProbing).toBe(false);
      expect(settings.fileCheck).toBeNull();
    });

    it('accepts a file whose duration could not be read, with a warning', async () => {
      const settings = useSettingsStore();
      settings.elevenLabsKey = 'test-key';
      mocks.probeDuration.mockResolvedValueOnce(null);
      await settings.setFile(wav());
      expect(settings.fileCheck?.ok).toBe(true);
      expect(settings.fileCheck?.warnings).toHaveLength(1);
      expect(settings.isReady).toBe(true);
    });
  });

  describe('isReady and missingRequirements', () => {
    it('lists every missing piece for an empty form', () => {
      const settings = useSettingsStore();
      expect(settings.isReady).toBe(false);
      expect(settings.missingRequirements).toEqual([
        'Choose a recording.',
        'Add your ElevenLabs API key in Settings.',
      ]);
    });

    it('is ready with a key and a valid file', async () => {
      const settings = await readyStore();
      expect(settings.missingRequirements).toEqual([]);
      expect(settings.isReady).toBe(true);
    });

    it('needs a non-blank ElevenLabs key', async () => {
      const settings = await readyStore();
      settings.elevenLabsKey = '   ';
      expect(settings.isReady).toBe(false);
      expect(settings.missingRequirements).toEqual(['Add your ElevenLabs API key in Settings.']);
    });

    it('does not need the translation keys', async () => {
      const settings = await readyStore();
      expect(settings.claudeKey).toBe('');
      expect(settings.geminiKey).toBe('');
      expect(settings.isReady).toBe(true);
    });

    it('waits while the file is being checked', () => {
      const settings = useSettingsStore();
      settings.elevenLabsKey = 'test-key';
      mocks.probeDuration.mockReturnValueOnce(new Promise(() => {}));
      void settings.setFile(wav());
      expect(settings.isReady).toBe(false);
      expect(settings.missingRequirements).toEqual(['Wait while the recording is checked.']);
    });

    it('rejects a 4 GB file', async () => {
      const settings = useSettingsStore();
      settings.elevenLabsKey = 'test-key';
      mocks.probeDuration.mockResolvedValueOnce(600);
      await settings.setFile(wav('huge.wav', 4 * 1024 ** 3));
      expect(settings.fileCheck?.ok).toBe(false);
      expect(settings.fileCheck?.errors[0]).toMatch(/too large \(4\.0 GB\)/);
      expect(settings.isReady).toBe(false);
      expect(settings.missingRequirements).toEqual([
        'Choose a recording that meets the limits shown above.',
      ]);
    });

    it('rejects a recording longer than 10 hours', async () => {
      const settings = useSettingsStore();
      settings.elevenLabsKey = 'test-key';
      mocks.probeDuration.mockResolvedValueOnce(10 * 3600 + 1);
      await settings.setFile(wav());
      expect(settings.isReady).toBe(false);
    });

    it.each([0, 33, 2.5, -1, Number.NaN])('rejects %s speakers', async (n) => {
      const settings = await readyStore();
      settings.numSpeakers = n;
      expect(settings.isReady).toBe(false);
      expect(settings.missingRequirements).toEqual([
        'Number of speakers must be a whole number from 1 to 32.',
      ]);
    });

    it.each([null, 1, 2, 32])('accepts %s speakers', async (n) => {
      const settings = await readyStore();
      settings.numSpeakers = n;
      expect(settings.isReady).toBe(true);
    });
  });
});

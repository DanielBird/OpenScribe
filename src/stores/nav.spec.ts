import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { TRANSCRIPT_SCHEMA_VERSION, type TranscriptDoc } from '../domain/transcript';
import { useJobStore } from './job';
import { useNavStore } from './nav';
import { useSettingsStore } from './settings';
import { useTranscriptStore } from './transcript';

function emptyDoc(): TranscriptDoc {
  return {
    schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
    id: 'doc-1',
    createdAt: '2026-10-13T00:00:00.000Z',
    source: {
      fileName: 'a.wav',
      fileSize: 1,
      mimeType: 'audio/wav',
      lastModified: 0,
      durationSec: null,
    },
    request: {
      provider: 'elevenlabs',
      model: 'scribe_v2',
      languageHint: 'auto',
      numSpeakers: null,
      zeroRetention: false,
      keyterms: [],
    },
    result: {
      providerTranscriptId: null,
      languageCode: 'eng',
      languageProbability: null,
      audioDurationSec: null,
    },
    speakers: [],
    turns: [],
    translations: {},
  };
}

describe('nav store', () => {
  beforeEach(() => {
    // The settings store reads saved keys and prefs on creation.
    localStorage.clear();
    sessionStorage.clear();
    setActivePinia(createPinia());
  });

  it('starts on setup, which can always be entered', () => {
    const nav = useNavStore();
    expect(nav.step).toBe('setup');
    expect(nav.canEnter('setup')).toBe(true);
  });

  it('opens glossary at any time, even without a key or a recording', () => {
    const nav = useNavStore();
    expect(useSettingsStore().isReady).toBe(false);
    expect(nav.canEnter('glossary')).toBe(true);
    expect(nav.goTo('glossary')).toBe(true);
    expect(nav.step).toBe('glossary');
  });

  it('opens output once a job has started', () => {
    const nav = useNavStore();
    const job = useJobStore();
    expect(nav.canEnter('output')).toBe(false);

    job.status = 'uploading';
    expect(nav.canEnter('output')).toBe(true);
  });

  it('opens output when a transcript exists', () => {
    const nav = useNavStore();
    const transcript = useTranscriptStore();
    transcript.doc = emptyDoc();
    expect(nav.canEnter('output')).toBe(true);
  });

  it('goTo refuses locked steps and moves to open ones', () => {
    const nav = useNavStore();
    expect(nav.goTo('output')).toBe(false);
    expect(nav.step).toBe('setup');

    useJobStore().status = 'processing';
    expect(nav.goTo('output')).toBe(true);
    expect(nav.step).toBe('output');

    expect(nav.goTo('setup')).toBe(true);
    expect(nav.step).toBe('setup');
  });

  describe('modes', () => {
    it('starts on Home', () => {
      expect(useNavStore().mode).toBe('home');
    });

    it('goTo moves into Transcribe from any mode, unless the step is locked', () => {
      const nav = useNavStore();
      expect(nav.goTo('output')).toBe(false);
      expect(nav.mode).toBe('home');

      expect(nav.goTo('glossary')).toBe(true);
      expect(nav.mode).toBe('transcribe');

      nav.enter('project');
      expect(nav.goTo('glossary')).toBe(true);
      expect(nav.mode).toBe('transcribe');
    });

    it('goHome keeps the step, and Transcribe returns to it', () => {
      const nav = useNavStore();
      nav.goTo('glossary');
      nav.goHome();
      expect(nav.mode).toBe('home');
      expect(nav.step).toBe('glossary');

      nav.enter('transcribe');
      expect(nav.mode).toBe('transcribe');
      expect(nav.step).toBe('glossary');
    });

    it('Transcribe opens Setup when the step left can no longer be entered', () => {
      const nav = useNavStore();
      const job = useJobStore();
      job.status = 'processing';
      nav.goTo('output');
      nav.goHome();
      job.status = 'idle';

      nav.enter('transcribe');
      expect(nav.step).toBe('setup');
    });

    it('resetStep goes back to Setup without leaving the mode', () => {
      const nav = useNavStore();
      nav.goTo('glossary');
      nav.goHome();
      nav.resetStep();
      expect(nav.mode).toBe('home');
      expect(nav.step).toBe('setup');
    });

    it('Settings returns to the mode it was opened from, and Transcribe keeps its step', () => {
      const nav = useNavStore();
      nav.openSettings();
      expect(nav.mode).toBe('settings');
      nav.leaveSettings();
      expect(nav.mode).toBe('home');

      expect(nav.goTo('glossary')).toBe(true);
      nav.openSettings();
      nav.openSettings(); // opening it again doesn't make Settings its own way back
      nav.leaveSettings();
      expect([nav.mode, nav.step]).toEqual(['transcribe', 'glossary']);

      nav.enter('project');
      nav.openSettings();
      nav.leaveSettings();
      expect(nav.mode).toBe('project');
    });

    it('leaving Settings opens Setup when the step left can no longer be entered', () => {
      const nav = useNavStore();
      useTranscriptStore().doc = emptyDoc();
      expect(nav.goTo('output')).toBe(true);
      nav.openSettings();
      useTranscriptStore().doc = null;
      nav.leaveSettings();
      expect([nav.mode, nav.step]).toEqual(['transcribe', 'setup']);
    });
  });
});

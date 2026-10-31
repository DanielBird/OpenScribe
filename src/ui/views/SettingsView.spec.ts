import 'fake-indexeddb/auto';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as idb from '../../storage/idb';
import { useGlossaryStore } from '../../stores/glossary';
import { useNavStore } from '../../stores/nav';
import { useSettingsStore } from '../../stores/settings';
import { useTranscriptStore } from '../../stores/transcript';
import { makeDoc } from '../../testing/transcriptDoc';
import SettingsView from './SettingsView.vue';

describe('SettingsView', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await idb.clearLastTranscript();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  function mountView() {
    wrapper = mount(SettingsView, { attachTo: document.body });
    return wrapper;
  }

  const buttonNamed = (name: string) => wrapper!.findAll('button').find((b) => b.text() === name);
  const byLabel = (text: string) => {
    const label = wrapper!.findAll('label').find((l) => l.text() === text);
    return wrapper!.get<HTMLInputElement>(`#${label?.attributes('for')}`);
  };

  it('shows the sections in order: API keys, chats, saved data, about', () => {
    mountView();
    expect(wrapper!.findAll('.band > h2').map((h) => h.text())).toEqual([
      'API keys',
      'Chats',
      'Saved data',
      'About',
    ]);
    expect(wrapper!.findAll('label').map((l) => l.text())).toEqual([
      'ElevenLabs API key',
      'Claude (Anthropic) API key',
      'Gemini (Google) API key',
      'Remember keys on this computer',
      'Your name',
    ]);
  });

  it('saves Your name, with the name made up for this browser shown until then', async () => {
    mountView();
    const settings = useSettingsStore();
    const input = byLabel('Your name');
    expect(input.element.value).toBe('');
    expect(input.attributes('placeholder')).toBe(settings.generatedName);
    expect(wrapper!.get(`#${input.attributes('aria-describedby')}`).text()).toBe(
      'Colleagues see it on the chats you save in a project.',
    );
    await input.setValue('Dana');
    expect(settings.chatAuthor.name).toBe('Dana');
  });

  it('gives every input a label', () => {
    mountView();
    for (const input of wrapper!.findAll('input')) {
      expect(wrapper!.find(`label[for="${input.attributes('id')}"]`).exists()).toBe(true);
    }
  });

  describe('Remember keys on this computer', () => {
    const rememberBox = () => byLabel('Remember keys on this computer');

    it('is one checkbox for all keys, with the shared-computer warning', () => {
      mountView();
      expect(wrapper!.findAll('input[type="checkbox"]')).toHaveLength(1);
      const help = wrapper!.get(`#${rememberBox().attributes('aria-describedby')}`);
      expect(help.text()).toContain('Leave unticked on shared computers.');
    });

    it('moves every key to localStorage when ticked, and back when unticked', async () => {
      mountView();
      const settings = useSettingsStore();
      settings.setKey('elevenlabs', 'test-key');
      settings.setKey('claude', 'test-key-c');
      await rememberBox().setValue(true);
      expect(settings.rememberKeys).toBe(true);
      expect(localStorage.getItem('describe.v1.key.elevenlabs')).toBe('"test-key"');
      expect(localStorage.getItem('describe.v1.key.claude')).toBe('"test-key-c"');

      await rememberBox().setValue(false);
      expect(localStorage.getItem('describe.v1.key.elevenlabs')).toBeNull();
      expect(sessionStorage.getItem('describe.v1.key.claude')).toBe('"test-key-c"');
    });

    it('is ticked on mount when a key is remembered', () => {
      localStorage.setItem('describe.v1.key.gemini', '"saved-key"');
      mountView();
      expect(rememberBox().element.checked).toBe(true);
    });
  });

  describe('Forget all keys', () => {
    it('is shown only while a key is saved', async () => {
      mountView();
      expect(buttonNamed('Forget all keys')).toBeUndefined();
      useSettingsStore().setKey('gemini', 'test-key');
      await flushPromises();
      expect(buttonNamed('Forget all keys')).toBeDefined();
    });

    it('clears every key, moves focus to the first key field and announces it', async () => {
      const settings = useSettingsStore();
      settings.setKey('elevenlabs', 'test-key');
      settings.setRememberKeys(true);
      settings.setKey('claude', 'test-key');
      mountView();
      await buttonNamed('Forget all keys')!.trigger('click');
      await flushPromises();
      expect(settings.elevenLabsKey).toBe('');
      expect(settings.claudeKey).toBe('');
      expect(localStorage.getItem('describe.v1.key.claude')).toBeNull();
      expect(document.activeElement).toBe(byLabel('ElevenLabs API key').element);
      expect(wrapper!.get('[aria-live="polite"]').text()).toBe('Keys forgotten.');
      expect(buttonNamed('Forget all keys')).toBeUndefined();
    });
  });

  describe('Clear saved data', () => {
    async function withSavedData() {
      useGlossaryStore().addFromText('Oticon');
      await useTranscriptStore().setDoc(makeDoc());
      useSettingsStore().setKey('elevenlabs', 'test-key');
    }

    const confirmDialog = () => wrapper!.get<HTMLDialogElement>('dialog');

    it('asks first, with focus on Cancel, and keeps everything on Cancel', async () => {
      await withSavedData();
      mountView();
      const trigger = buttonNamed('Clear saved data…')!;
      trigger.element.focus();
      await trigger.trigger('click');
      await flushPromises();
      expect(confirmDialog().element.open).toBe(true);
      expect(confirmDialog().text()).toContain('Clear saved data?');
      expect(confirmDialog().text()).toContain(
        "Your API keys stay, and so do the project's files.",
      );
      expect(document.activeElement?.textContent?.trim()).toBe('Cancel');

      await confirmDialog()
        .findAll('button')
        .find((b) => b.text() === 'Cancel')!
        .trigger('click');
      await flushPromises();
      expect(useGlossaryStore().terms).toEqual(['Oticon']);
      expect(useTranscriptStore().doc).not.toBeNull();
      expect(document.activeElement).toBe(trigger.element);
    });

    it('clears the data on confirm and announces it, keeping the keys', async () => {
      await withSavedData();
      mountView();
      await buttonNamed('Clear saved data…')!.trigger('click');
      await flushPromises();
      await confirmDialog()
        .findAll('button')
        .find((b) => b.text() === 'Clear')!
        .trigger('click');
      // Deleting the saved transcript takes a few IndexedDB ticks.
      await vi.waitFor(() =>
        expect(wrapper!.get('[aria-live="polite"]').text()).toBe('Saved data cleared.'),
      );
      expect(useGlossaryStore().terms).toEqual([]);
      expect(useTranscriptStore().doc).toBeNull();
      expect(useSettingsStore().elevenLabsKey).toBe('test-key');
    });
  });

  describe('About', () => {
    it('states where data goes, for Transcribe and Analyse, and what stays in this browser', () => {
      mountView();
      const text = wrapper!.text();
      expect(text).toContain(
        'DeScribe primarily runs in your browser but makes calls to public APIs',
      );
      expect(text).toContain(
        'Your recording and glossary are sent to ElevenLabs for transcription.',
      );
      expect(text).toContain('the transcript text and glossary (not the audio) are sent');
      expect(text).toContain('its text and the project brief are sent');
      expect(text).toContain('your question, the brief, the summaries and the transcript passages');
      expect(text).toContain(
        'Chats are saved in the project folder, where everyone who can open it can read them.',
      );
      expect(text).toContain("a copy of the project's transcript text");
    });

    it('says where to create each key, and links to each provider’s privacy and terms pages', () => {
      mountView();
      const text = wrapper!.text();
      expect(text).toContain('with Speech-to-Text access.');
      expect(text).toContain('Claude or Gemini, to translate and analyse');
      // The keys band has no help of its own: it's in About.
      const keysBand = wrapper!.findAll('.band')[0]!;
      expect(keysBand.findAll('a')).toHaveLength(0);

      const links = wrapper!.findAll('a');
      expect(links.map((a) => a.attributes('href'))).toEqual([
        'https://elevenlabs.io/app/settings/api-keys',
        'https://console.anthropic.com',
        'https://aistudio.google.com',
        'https://elevenlabs.io/privacy-policy',
        'https://elevenlabs.io/terms-of-use',
        'https://www.anthropic.com/legal/privacy',
        'https://www.anthropic.com/legal/commercial-terms',
        'https://policies.google.com/privacy',
        'https://ai.google.dev/gemini-api/terms',
      ]);
      for (const a of links) {
        expect(a.attributes('target')).toBe('_blank');
        expect(a.attributes('rel')).toBe('noopener noreferrer');
      }
    });

    it('shows the version and build date', () => {
      mountView();
      expect(wrapper!.text()).toMatch(/v\d+\.\d+\.\d+ · built \d{4}-\d{2}-\d{2}/);
    });

    it('shows DeScribe’s licence and the npm packages’ notices under Licences, only once opened', async () => {
      mountView();
      expect(wrapper!.get('.licences summary').text()).toBe('Licences');
      expect(wrapper!.find('.licences pre').exists()).toBe(false);

      const text = await openLicences();
      expect(text).toMatch(/^MIT License\n\nCopyright \(c\) \d{4} /);
      expect(text).toContain('DeScribe includes the open-source software below.');
      expect(text).toContain('@anthropic-ai/sdk');
      expect(text).not.toContain('The DeScribe Windows app also includes');
    });
  });

  async function openLicences(): Promise<string> {
    const details = wrapper!.get<HTMLDetailsElement>('.licences');
    details.element.open = true;
    await details.trigger('toggle');
    return wrapper!.get('.licences pre').element.textContent ?? '';
  }

  it('Back returns to the mode Settings was opened from', async () => {
    const nav = useNavStore();
    nav.enter('project');
    nav.openSettings();
    mountView();
    await buttonNamed('Back')!.trigger('click');
    expect(nav.mode).toBe('project');
  });

  // Vitest exposes Vite's defines as globals, so the desktop build's texts can be checked here (D35).
  describe('in the desktop app', () => {
    beforeEach(() => vi.stubGlobal('__DESKTOP__', true));
    afterEach(() => vi.unstubAllGlobals());

    it('says the app runs on this computer and keeps its data in its own storage', () => {
      mountView();
      const text = wrapper!.text();
      expect(text).toContain('DeScribe runs on this computer and calls public APIs to use LLMs.');
      expect(text).toContain('On this computer');
      expect(text).toContain("transcript text are saved in DeScribe's own storage.");
      expect(text).not.toContain('browser');
    });

    it('drops the warning about web pages opened from files, which only applies to the HTML file', () => {
      mountView();
      const help = wrapper!.get(
        `#${byLabel('Remember keys on this computer').attributes('aria-describedby')}`,
      );
      expect(help.text()).toBe('Leave unticked on shared computers.');
    });

    it('asks to clear the saved data from this app', async () => {
      mountView();
      await buttonNamed('Clear saved data…')!.trigger('click');
      await flushPromises();
      expect(wrapper!.get('dialog').text()).toContain('the link to your project from this app.');
    });

    it('adds the Rust crates’ notices to the licences', async () => {
      mountView();
      const text = await openLicences();
      expect(text).toContain('DeScribe includes the open-source software below.');
      expect(text).toContain('The DeScribe Windows app also includes');
      expect(text).toContain('Microsoft Edge WebView2 SDK loader');
    });
  });
});

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useJobStore } from '../../stores/job';
import { useNavStore } from '../../stores/nav';
import { useSettingsStore } from '../../stores/settings';
import { useTranscriptStore } from '../../stores/transcript';
import { makeDoc } from '../../testing/transcriptDoc';
import GlossaryEditor from '../components/GlossaryEditor.vue';
import GlossaryView from './GlossaryView.vue';

vi.mock('../../storage/idb', () => ({
  saveLastTranscript: vi.fn(() => Promise.resolve(true)),
  loadLastTranscript: vi.fn(() => Promise.resolve(null)),
}));

/** Makes Setup complete (key and file), so Glossary can be entered and Run is allowed. */
function makeReady() {
  const settings = useSettingsStore();
  settings.elevenLabsKey = 'test-key';
  settings.file = new File(['x'], 'a.wav', { type: 'audio/wav' });
  return settings;
}

describe('GlossaryView', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    // The settings and glossary stores read storage on creation.
    localStorage.clear();
    sessionStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.restoreAllMocks();
  });

  const button = (name: string) =>
    wrapper!.findAll('[data-testid="step-footer"] button').find((b) => b.text().includes(name))!;

  it('keeps the hidden h1 that takes focus on step change, and shows the editor', () => {
    wrapper = mount(GlossaryView);
    const h1 = wrapper.get('h1');
    expect(h1.text()).toBe('Glossary');
    expect(h1.classes()).toContain('visually-hidden');
    expect(h1.attributes('tabindex')).toBe('-1');
    expect(wrapper.get('section').attributes('aria-labelledby')).toBe(h1.attributes('id'));
    expect(wrapper.findComponent(GlossaryEditor).exists()).toBe(true);
  });

  it('Back returns to Setup', async () => {
    makeReady();
    const nav = useNavStore();
    nav.goTo('glossary');
    wrapper = mount(GlossaryView);
    await button('Back').trigger('click');
    expect(nav.step).toBe('setup');
  });

  it('disables Run and lists the reasons while Setup is incomplete', () => {
    wrapper = mount(GlossaryView);
    const run = button('Run');
    expect(run.attributes('disabled')).toBeDefined();
    const missing = wrapper.get(`#${run.attributes('aria-describedby')}`);
    expect(missing.findAll('li').map((li) => li.text())).toEqual([
      'Choose a recording.',
      'Add your ElevenLabs API key in Settings.',
    ]);
  });

  it('Run starts the job first, then moves to Output', async () => {
    makeReady();
    const nav = useNavStore();
    nav.goTo('glossary');
    const job = useJobStore();
    // Like the real start(), this leaves `idle` before its first await.
    const start = vi.spyOn(job, 'start').mockImplementation(() => {
      job.status = 'uploading';
      return Promise.resolve();
    });
    const goTo = vi.spyOn(nav, 'goTo');

    wrapper = mount(GlossaryView);
    const run = button('Run');
    expect(run.attributes('disabled')).toBeUndefined();
    expect(run.attributes('aria-describedby')).toBeUndefined();
    await run.trigger('click');

    expect(start).toHaveBeenCalledOnce();
    expect(goTo).toHaveBeenCalledWith('output');
    expect(start.mock.invocationCallOrder[0]).toBeLessThan(goTo.mock.invocationCallOrder[0]!);
    expect(nav.step).toBe('output');
  });

  describe('with a last transcript', () => {
    /** Run asks first; the stub starts like the real start() would. */
    async function clickRun() {
      makeReady();
      await useTranscriptStore().setDoc(makeDoc());
      useNavStore().goTo('glossary');
      const job = useJobStore();
      const start = vi.spyOn(job, 'start').mockImplementation(() => {
        job.status = 'uploading';
        return Promise.resolve();
      });
      wrapper = mount(GlossaryView, { attachTo: document.body });
      await button('Run').trigger('click');
      await flushPromises();
      // The editor has its own dialog (Clear all); the view's comes last.
      const dialog = wrapper.findAll('dialog').at(-1)!;
      return { start, dialog };
    }

    afterEach(() => {
      useTranscriptStore().$dispose();
    });

    it('asks before replacing it, and Cancel keeps it', async () => {
      const { start, dialog } = await clickRun();
      expect(dialog.attributes('open')).toBeDefined();
      expect(dialog.get('h2').text()).toBe('Start a new transcription?');
      expect(dialog.get('p').text()).toBe('This replaces your last transcript ("interview.mp3").');

      await dialog
        .findAll('button')
        .find((b) => b.text() === 'Cancel')!
        .trigger('click');
      await flushPromises();
      expect(start).not.toHaveBeenCalled();
      expect(useNavStore().step).toBe('glossary');
    });

    it('starts the run, then moves to Output, once confirmed', async () => {
      const { start, dialog } = await clickRun();
      const goTo = vi.spyOn(useNavStore(), 'goTo');
      await dialog
        .findAll('button')
        .find((b) => b.text() === 'Run')!
        .trigger('click');
      await flushPromises();
      expect(start).toHaveBeenCalledOnce();
      expect(start.mock.invocationCallOrder[0]).toBeLessThan(goTo.mock.invocationCallOrder[0]!);
      expect(useNavStore().step).toBe('output');
    });
  });

  it('disables Run while a transcription is running, and says why', () => {
    makeReady();
    useJobStore().status = 'processing';
    wrapper = mount(GlossaryView);
    const run = button('Run');
    expect(run.attributes('disabled')).toBeDefined();
    const missing = wrapper.get(`#${run.attributes('aria-describedby')}`);
    expect(missing.text()).toBe('A transcription is already running.');
  });
});

import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNavStore } from '../../stores/nav';
import { useSettingsStore } from '../../stores/settings';
import SetupView from './SetupView.vue';

const probeDuration = vi.hoisted(() => vi.fn<() => Promise<number | null>>());
vi.mock('../../media/probeDuration', () => ({ probeDuration }));

describe('SetupView', () => {
  let wrapper: ReturnType<typeof mount> | null = null;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    probeDuration.mockReset();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  const nextButton = () => wrapper!.findAll('button').find((b) => b.text().startsWith('Next'))!;
  const speakersInput = () => wrapper!.get<HTMLInputElement>('input[type="number"]');
  const byLabel = (text: string) => {
    const label = wrapper!.findAll('label').find((l) => l.text() === text);
    return wrapper!.get(`#${label?.attributes('for')}`);
  };

  it('shows the recording, the key band while the key is missing, and the options', () => {
    wrapper = mount(SetupView);
    expect(wrapper.findAll('h2').map((h) => h.text())).toEqual(['Recording', 'API key', 'Options']);
    expect(wrapper.findAll('label').map((l) => l.text())).toEqual([
      'Language',
      'Number of speakers',
      'Zero retention',
    ]);
  });

  describe('API key', () => {
    const openSettings = () => wrapper!.findAll('button').find((b) => b.text() === 'Open Settings');

    it('opens Settings from Setup while the ElevenLabs key is missing', async () => {
      wrapper = mount(SetupView);
      const nav = useNavStore();
      nav.enter('transcribe');
      await openSettings()!.trigger('click');
      expect(nav.mode).toBe('settings');
      nav.leaveSettings();
      expect([nav.mode, nav.step]).toEqual(['transcribe', 'setup']);
    });

    it('is gone once the key is entered', async () => {
      wrapper = mount(SetupView);
      useSettingsStore().setKey('elevenlabs', 'test-key');
      await flushPromises();
      expect(openSettings()).toBeUndefined();
      expect(wrapper.findAll('h2').map((h) => h.text())).toEqual(['Recording', 'Options']);
    });
  });

  it('starts with Options closed and toggles it', async () => {
    wrapper = mount(SetupView);
    const button = wrapper.findAll('h2 button').find((b) => b.text() === 'Options')!;
    const panel = wrapper.get<HTMLElement>(`#${button.attributes('aria-controls')}`);
    expect(button.attributes('aria-expanded')).toBe('false');
    expect(panel.element.style.display).toBe('none');
    await button.trigger('click');
    expect(button.attributes('aria-expanded')).toBe('true');
    expect(panel.element.style.display).toBe('');
    await button.trigger('click');
    expect(button.attributes('aria-expanded')).toBe('false');
  });

  it('gives every input and select a label', () => {
    wrapper = mount(SetupView);
    const controls = wrapper.findAll('input:not([type="file"]), select');
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      const id = control.attributes('id');
      expect(id, control.html()).toBeTruthy();
      expect(wrapper.find(`label[for="${id}"]`).exists(), control.html()).toBe(true);
    }
  });

  it('keeps Next disabled and lists what is missing until the form is ready', async () => {
    wrapper = mount(SetupView);
    const settings = useSettingsStore();
    expect(nextButton().attributes('disabled')).toBeDefined();
    const missingId = nextButton().attributes('aria-describedby');
    expect(
      wrapper
        .get(`#${missingId}`)
        .findAll('li')
        .map((li) => li.text()),
    ).toEqual(['Choose a recording.', 'Add your ElevenLabs API key in Settings.']);

    settings.elevenLabsKey = 'test-key';
    probeDuration.mockResolvedValueOnce(5);
    await settings.setFile(new File(['RIFF'], 'a.wav', { type: 'audio/wav' }));
    await flushPromises();
    expect(nextButton().attributes('disabled')).toBeUndefined();
    expect(nextButton().attributes('aria-describedby')).toBeUndefined();

    await nextButton().trigger('click');
    expect(useNavStore().step).toBe('glossary');
  });

  it('parses the number of speakers: empty is Auto, digits are a number', async () => {
    wrapper = mount(SetupView);
    const settings = useSettingsStore();
    await speakersInput().setValue('2');
    expect(settings.numSpeakers).toBe(2);
    await speakersInput().setValue('');
    expect(settings.numSpeakers).toBeNull();
    await speakersInput().setValue('40');
    expect(settings.numSpeakers).toBe(40);
    expect(wrapper.text()).toContain('Number of speakers must be a whole number from 1 to 32.');
  });

  it('binds language and zero retention to the saved prefs', async () => {
    wrapper = mount(SetupView);
    await byLabel('Language').setValue('fr');
    const toggle = byLabel('Zero retention');
    expect(toggle.attributes('aria-checked')).toBe('false');
    await toggle.trigger('click');
    expect(toggle.attributes('aria-checked')).toBe('true');
    expect(JSON.parse(localStorage.getItem('describe.v1.prefs') ?? '{}')).toEqual({
      languageHint: 'fr',
      zeroRetention: true,
    });
  });
});

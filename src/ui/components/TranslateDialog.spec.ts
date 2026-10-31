import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../../providers/errors';
import { useSettingsStore } from '../../stores/settings';
import { useTranslationStore } from '../../stores/translation';
import ApiKeyField from './ApiKeyField.vue';
import TranslateDialog from './TranslateDialog.vue';

vi.mock('../../storage/idb', () => ({
  saveLastTranscript: vi.fn(() => Promise.resolve(true)),
  loadLastTranscript: vi.fn(() => Promise.resolve(null)),
}));

describe('TranslateDialog', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  async function open(replaces = false) {
    wrapper = mount(TranslateDialog, {
      props: { open: false, replaces },
      attachTo: document.body,
    });
    await wrapper.setProps({ open: true });
    await flushPromises();
    return wrapper;
  }

  const dialog = () => wrapper!.get('dialog');
  const radio = (label: string) =>
    wrapper!
      .findAll('label')
      .find((l) => l.text() === label)!
      .get<HTMLInputElement>('input');
  const modelSelect = () => wrapper!.get<HTMLSelectElement>('select');
  const confirm = () =>
    wrapper!.findAll('button').find((b) => ['Translate', 'Re-translate'].includes(b.text()))!;
  const keyField = () => wrapper!.findComponent(ApiKeyField);

  it('opens with the last provider and model, Claude by default', async () => {
    useSettingsStore().claudeKey = 'test-key';
    await open();
    expect(dialog().element.open).toBe(true);
    expect(dialog().get('h2').text()).toBe('Translate to English');
    expect(radio('Claude').element.checked).toBe(true);
    expect(modelSelect().element.value).toBe('claude-opus-5-5');
    expect(
      modelSelect()
        .findAll('option')
        .map((o) => o.text()),
    ).toEqual(['Claude Opus 5.5 (best quality)', 'Claude Sonnet 5.5 (faster, cheaper)']);
    expect(wrapper!.get(`label[for="${modelSelect().attributes('id')}"]`).text()).toBe('Model');
    expect(confirm().text()).toBe('Translate');
    expect(keyField().exists()).toBe(false); // the key is there
  });

  it('switches the models with the provider and emits the choice', async () => {
    const settings = useSettingsStore();
    settings.claudeKey = 'test-key';
    settings.geminiKey = 'test-key';
    await open();

    await radio('Gemini').setValue(true);
    expect(modelSelect().element.value).toBe('gemini-3.8-flash');
    await modelSelect().setValue('gemini-3.5-flash-lite');
    await confirm().trigger('click');
    expect(wrapper!.emitted('translate')).toEqual([['gemini', 'gemini-3.5-flash-lite']]);
  });

  it('starts with the model last used for that provider', async () => {
    const settings = useSettingsStore();
    settings.geminiKey = 'test-key';
    settings.translationProvider = 'gemini';
    settings.translationModel = 'gemini-3.6-flash';
    await open();
    expect(radio('Gemini').element.checked).toBe(true);
    expect(modelSelect().element.value).toBe('gemini-3.6-flash');
  });

  it('asks for a missing key in place and keeps the field while it is typed', async () => {
    await open();
    expect(keyField().props()).toMatchObject({
      provider: 'claude',
      label: 'Claude (Anthropic) API key',
    });
    expect(confirm().attributes('disabled')).toBeDefined();

    await keyField().get('input.key-input').setValue('t');
    expect(useSettingsStore().claudeKey).toBe('t');
    expect(keyField().exists()).toBe(true);
    expect(confirm().attributes('disabled')).toBeUndefined();

    await radio('Gemini').setValue(true);
    expect(keyField().props('label')).toBe('Gemini (Google) API key');
    expect(confirm().attributes('disabled')).toBeDefined();
  });

  it('shows the key after the key was rejected', async () => {
    useSettingsStore().claudeKey = 'wrong-key';
    const translation = useTranslationStore();
    translation.error = new ProviderError('auth', 'Bad key.');
    translation.target = { docId: 'd', providerId: 'claude', model: 'claude-opus-5-5' };
    await open();
    expect(keyField().exists()).toBe(true);
  });

  it('shows the data notice until "Don\'t show again" is used', async () => {
    useSettingsStore().claudeKey = 'test-key';
    await open();
    expect(dialog().text()).toContain(
      'Only the transcript text goes to Anthropic (Claude), not the audio.',
    );
    await radio('Gemini').setValue(true);
    expect(dialog().text()).toContain('goes to Google (Gemini)');
    await radio('Claude').setValue(true);

    const dontShow = wrapper!
      .findAll('label')
      .find((l) => l.text() === "Don't show again")!
      .get('input');
    await dontShow.setValue(true);
    expect(useSettingsStore().hideTranslationNotice).toBe(false); // only once confirmed
    await confirm().trigger('click');
    expect(useSettingsStore().hideTranslationNotice).toBe(true);
    await flushPromises();
    expect(dialog().text()).not.toContain('Only the transcript text');
  });

  it('says that it replaces an existing translation', async () => {
    useSettingsStore().claudeKey = 'test-key';
    await open(true);
    expect(dialog().text()).toContain('This replaces the English translation.');
    expect(confirm().text()).toBe('Re-translate');
  });

  it('emits cancel', async () => {
    await open();
    await wrapper!
      .findAll('button')
      .find((b) => b.text() === 'Cancel')!
      .trigger('click');
    expect(wrapper!.emitted('cancel')).toHaveLength(1);
    expect(wrapper!.emitted('translate')).toBeUndefined();
  });
});

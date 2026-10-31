import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '../../stores/settings';
import ApiKeyField from './ApiKeyField.vue';
import SummariseDialog from './SummariseDialog.vue';

describe('SummariseDialog', () => {
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

  async function open(translates = false) {
    wrapper = mount(SummariseDialog, {
      props: {
        open: false,
        title: 'Summarise all',
        message: 'Summarise 12 sessions, about 18 hours, with Sonnet 5.5?',
        confirmLabel: 'Summarise',
        translates,
      },
      attachTo: document.body,
    });
    await wrapper.setProps({ open: true });
    await flushPromises();
    return wrapper;
  }

  const confirm = () => wrapper!.findAll('button').find((b) => b.text() === 'Summarise')!;

  it('asks first, and confirms', async () => {
    useSettingsStore().claudeKey = 'test-key';
    await open();
    expect(wrapper!.get('h2').text()).toBe('Summarise all');
    expect(wrapper!.text()).toContain('Summarise 12 sessions, about 18 hours, with Sonnet 5.5?');
    expect(wrapper!.findComponent(ApiKeyField).exists()).toBe(false);
    await confirm().trigger('click');
    expect(wrapper!.emitted('confirm')).toHaveLength(1);
  });

  it('asks for the Claude key when it is missing, and says where the text goes', async () => {
    await open(true);
    expect(wrapper!.findComponent(ApiKeyField).props('provider')).toBe('claude');
    expect(wrapper!.text()).toContain(
      'The transcript text is sent to Anthropic to translate and summarise.',
    );
    expect(confirm().attributes('disabled')).toBeDefined();

    await wrapper!.get('input').setValue('test-key');
    expect(confirm().attributes('disabled')).toBeUndefined();
    // The field stays while the key is typed.
    expect(wrapper!.findComponent(ApiKeyField).exists()).toBe(true);
  });

  it('with a Gemini model, asks for the Gemini key and says the text goes to Google', async () => {
    const settings = useSettingsStore();
    settings.claudeKey = 'test-key';
    settings.projectModel = 'gemini-4-argon';
    await open();
    expect(wrapper!.findComponent(ApiKeyField).props()).toMatchObject({
      provider: 'gemini',
      label: 'Gemini (Google) API key',
    });
    expect(wrapper!.text()).toContain('The transcript text is sent to Google to summarise.');
    expect(confirm().attributes('disabled')).toBeDefined();
    await wrapper!.get('input').setValue('test-key-gemini');
    expect(confirm().attributes('disabled')).toBeUndefined();
  });

  it('cancels', async () => {
    await open();
    await wrapper!
      .findAll('button')
      .find((b) => b.text() === 'Cancel')!
      .trigger('click');
    expect(wrapper!.emitted('cancel')).toHaveLength(1);
  });
});

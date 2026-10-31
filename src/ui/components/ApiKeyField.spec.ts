import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTranscriptionProviderForTests } from '../../providers/index';
import { createElevenLabsProvider } from '../../providers/transcription/elevenlabs/provider';
import type { KeyCheckResult } from '../../providers/transcription/types';
import { useSettingsStore, type KeyProvider } from '../../stores/settings';
import ApiKeyField from './ApiKeyField.vue';

const verifyKey = vi.fn<(apiKey: string, signal?: AbortSignal) => Promise<KeyCheckResult>>();

describe('ApiKeyField', () => {
  let wrapper: ReturnType<typeof mount> | null = null;

  function mountField(provider: KeyProvider = 'elevenlabs', required = false, verifiable = true) {
    wrapper = mount(ApiKeyField, {
      props: { provider, label: 'ElevenLabs API key', required, verifiable },
      slots: { help: 'Get a key from ElevenLabs.' },
    });
    return wrapper;
  }

  const keyInput = () => wrapper!.get<HTMLInputElement>('input.key-input');
  const button = (name: string) => wrapper!.findAll('button').find((b) => b.text() === name);

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    verifyKey.mockReset();
    setTranscriptionProviderForTests({ ...createElevenLabsProvider(), verifyKey });
    setActivePinia(createPinia());
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    setTranscriptionProviderForTests(null);
  });

  it('labels the input and links the help text', () => {
    mountField('elevenlabs', true);
    const label = wrapper!.get('label');
    expect(label.text()).toBe('ElevenLabs API key (required)');
    expect(label.attributes('for')).toBe(keyInput().attributes('id'));
    expect(keyInput().attributes('required')).toBeDefined();
    const helpId = keyInput().attributes('aria-describedby');
    expect(wrapper!.get(`#${helpId}`).text()).toBe('Get a key from ElevenLabs.');
    // Remembering is one setting for all keys, on Settings.
    expect(wrapper!.find('input[type="checkbox"]').exists()).toBe(false);
  });

  it('hides the key by default and shows it with the toggle', async () => {
    mountField();
    const toggle = button('Show key')!;
    expect(keyInput().attributes('type')).toBe('password');
    expect(toggle.attributes('aria-pressed')).toBe('false');
    expect(toggle.attributes('aria-controls')).toBe(keyInput().attributes('id'));

    await toggle.trigger('click');
    expect(keyInput().attributes('type')).toBe('text');
    expect(toggle.attributes('aria-pressed')).toBe('true');

    await toggle.trigger('click');
    expect(keyInput().attributes('type')).toBe('password');
  });

  it('saves what is typed to the store and sessionStorage', async () => {
    mountField();
    await keyInput().setValue('test-key');
    expect(useSettingsStore().elevenLabsKey).toBe('test-key');
    expect(sessionStorage.getItem('describe.v1.key.elevenlabs')).toBe('"test-key"');
    expect(localStorage.getItem('describe.v1.key.elevenlabs')).toBeNull();
  });

  it('saves to localStorage when keys are remembered', async () => {
    useSettingsStore().setRememberKeys(true);
    mountField();
    await keyInput().setValue('test-key');
    expect(localStorage.getItem('describe.v1.key.elevenlabs')).toBe('"test-key"');
    expect(sessionStorage.getItem('describe.v1.key.elevenlabs')).toBeNull();
  });

  it('shows a remembered key on mount', () => {
    localStorage.setItem('describe.v1.key.elevenlabs', '"saved-key"');
    mountField();
    expect(keyInput().element.value).toBe('saved-key');
  });

  it('verifies the key and announces the result', async () => {
    mountField();
    const test = () => button('Verify key')!;
    expect(test().attributes('disabled')).toBeDefined(); // no key yet

    await keyInput().setValue('test-key');
    verifyKey.mockResolvedValueOnce({ ok: true, message: 'The key works.' });
    await test().trigger('click');
    await flushPromises();
    const status = wrapper!.get('[role="status"]');
    expect(status.text()).toBe('✓ The key works.');
    expect(status.get('[data-testid="key-check"]').classes()).toContain('check-ok');

    verifyKey.mockResolvedValueOnce({ ok: false, message: 'Unknown key.' });
    await test().trigger('click');
    await flushPromises();
    expect(wrapper!.get('[role="status"]').text()).toBe('✗ Unknown key.');
  });

  it('shows the checking state and disables Verify key while it runs', async () => {
    mountField();
    await keyInput().setValue('test-key');
    verifyKey.mockReturnValueOnce(new Promise(() => {}));
    await button('Verify key')!.trigger('click');
    expect(wrapper!.get('[role="status"]').text()).toBe('Checking the key…');
    expect(button('Verify key')!.attributes('disabled')).toBeDefined();
  });

  it.each(['claude', 'gemini'] as const)('offers Verify key for %s', (provider) => {
    mountField(provider);
    expect(button('Verify key')).toBeDefined();
  });

  it.each(['elevenlabs', 'claude', 'gemini'] as const)(
    'has no Verify key for %s unless asked (only Settings asks)',
    (provider) => {
      mountField(provider, false, false);
      expect(button('Verify key')).toBeUndefined();
      expect(wrapper!.find('[role="status"]').exists()).toBe(false);
    },
  );
});

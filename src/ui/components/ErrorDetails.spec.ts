import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProviderError } from '../../providers/errors';
import { FolderError } from '../../storage/folder';
import { useSettingsStore } from '../../stores/settings';
import ErrorDetails from './ErrorDetails.vue';

const show = (error: unknown) => mount(ErrorDetails, { props: { error } });

describe('ErrorDetails', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setActivePinia(createPinia());
  });

  it('shows the version, kind, status and detail, closed', () => {
    const wrapper = show(
      new ProviderError('validation', "Claude couldn't process the request.", {
        status: 400,
        detail: 'invalid_request_error: max_tokens is too large',
      }),
    );
    expect(wrapper.get('details').attributes('open')).toBeUndefined();
    expect(wrapper.get('summary').text()).toBe('Technical details');
    expect(wrapper.get('pre').text()).toBe(
      `DeScribe v${__APP_VERSION__} · validation · HTTP 400\n` +
        'invalid_request_error: max_tokens is too large',
    );
  });

  it('shows nothing for an error with no status or detail', () => {
    expect(show(new ProviderError('aborted', 'Cancelled.')).html()).toBe('<!--v-if-->');
    expect(show(new FolderError('permission', 'No access.')).html()).toBe('<!--v-if-->');
    expect(show(null).html()).toBe('<!--v-if-->');
  });

  it('never shows a saved key', () => {
    const settings = useSettingsStore();
    settings.claudeKey = 'test-key-claude-0123';
    settings.geminiKey = 'test-key-gemini-4567';
    const wrapper = show(
      new ProviderError('unknown', 'Something went wrong. Try again.', {
        detail: 'sent test-key-claude-0123 and test-key-gemini-4567',
      }),
    );
    expect(wrapper.get('pre').text()).toContain('sent [redacted] and [redacted]');
    expect(wrapper.get('pre').text()).not.toContain('test-key');
  });
});

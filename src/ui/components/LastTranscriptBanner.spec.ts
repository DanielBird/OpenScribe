import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDateTime } from '../../domain/transcript';
import { useJobStore } from '../../stores/job';
import { useNavStore } from '../../stores/nav';
import { useTranscriptStore } from '../../stores/transcript';
import { makeDoc } from '../../testing/transcriptDoc';
import LastTranscriptBanner from './LastTranscriptBanner.vue';

vi.mock('../../storage/idb', () => ({
  saveLastTranscript: vi.fn(() => Promise.resolve(true)),
  loadLastTranscript: vi.fn(() => Promise.resolve(null)),
}));

describe('LastTranscriptBanner', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    useTranscriptStore().$dispose();
  });

  it('renders nothing without a transcript', () => {
    const wrapper = mount(LastTranscriptBanner);
    expect(wrapper.find('.last-transcript').exists()).toBe(false);
  });

  it('names the last transcript and opens it on Output', async () => {
    await useTranscriptStore().setDoc(makeDoc());
    const wrapper = mount(LastTranscriptBanner);
    expect(wrapper.get('p').text()).toBe(
      `Last transcript: interview.mp3 · ${formatDateTime('2026-10-13T12:05:00.000Z')}`,
    );
    await wrapper.get('button').trigger('click');
    expect(useNavStore().step).toBe('output');
  });

  it('clears a failed run, so Output shows the transcript', async () => {
    await useTranscriptStore().setDoc(makeDoc());
    const job = useJobStore();
    job.status = 'error';
    const wrapper = mount(LastTranscriptBanner);
    await wrapper.get('button').trigger('click');
    expect(job.status).toBe('idle');
    expect(useNavStore().step).toBe('output');
  });

  it('is hidden while a run is active', async () => {
    await useTranscriptStore().setDoc(makeDoc());
    useJobStore().status = 'uploading';
    const wrapper = mount(LastTranscriptBanner);
    expect(wrapper.find('.last-transcript').exists()).toBe(false);
  });
});

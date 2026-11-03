import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError, type ProviderErrorKind } from '../../providers/errors';
import { useJobStore, type JobStatus as JobStatusValue } from '../../stores/job';
import JobStatus from './JobStatus.vue';

describe('JobStatus', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  const buttons = () => wrapper!.findAll('button').map((b) => b.text());
  const status = () => wrapper!.get('[role="status"]').text();

  function mountIn(state: {
    status: JobStatusValue;
    progress?: { loaded: number; total: number };
    elapsedSec?: number;
  }) {
    const job = useJobStore();
    job.status = state.status;
    if (state.progress) job.progress = state.progress;
    if (state.elapsedSec !== undefined) job.elapsedSec = state.elapsedSec;
    wrapper = mount(JobStatus);
    return job;
  }

  it('shows upload progress, announcing only the phase', () => {
    mountIn({ status: 'uploading', progress: { loaded: 220_200_960, total: 492_830_720 } });
    expect(status()).toBe('Uploading');
    expect(wrapper!.get('.text').text()).toBe('Uploading 44% (210.0 MB of 470.0 MB)');
    const bar = wrapper!.get('progress');
    expect(bar.attributes('aria-label')).toBe('Upload progress');
    expect(bar.attributes('value')).toBe('220200960');
    expect(bar.attributes('max')).toBe('492830720');
    expect(buttons()).toEqual(['Cancel']);
  });

  it('shows the elapsed time while transcribing, outside the live region', () => {
    mountIn({ status: 'processing', elapsedSec: 72 });
    expect(status()).toBe('Transcribing…');
    expect(wrapper!.get('[role="timer"]').text()).toBe('00:01:12');
    expect(wrapper!.text()).toContain('Keep this tab open.');
    expect(wrapper!.find('progress').exists()).toBe(false);
    expect(buttons()).toEqual(['Cancel']);
  });

  it('Cancel cancels the job', async () => {
    const job = mountIn({ status: 'processing' });
    const cancel = vi.spyOn(job, 'cancel').mockImplementation(() => {});
    await wrapper!.get('button').trigger('click');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each<[ProviderErrorKind, boolean]>([
    ['auth', false],
    ['validation', false],
    ['quota', true],
    ['rate_limit', true],
    ['server', true],
    ['network', true],
    ['bad_output', true],
    ['unknown', true],
  ])('a %s error offers Try again: %s', (kind, retry) => {
    mountIn({ status: 'error' });
    useJobStore().error = new ProviderError(kind, `The ${kind} message.`);
    return wrapper!.vm.$nextTick().then(() => {
      expect(status()).toBe(`The ${kind} message.`);
      expect(wrapper!.find('svg').exists()).toBe(true);
      expect(buttons()).toEqual(retry ? ['Try again'] : []);
    });
  });

  it('keeps the technical details under the error, out of the announcement', async () => {
    mountIn({ status: 'error' });
    useJobStore().error = new ProviderError('auth', 'ElevenLabs rejected the API key.', {
      status: 401,
      detail: 'invalid_api_key: Invalid API key (request r-7)',
    });
    await wrapper!.vm.$nextTick();
    expect(status()).toBe('ElevenLabs rejected the API key.');
    expect(wrapper!.get('details summary').text()).toBe('Technical details');
    expect(wrapper!.get('details pre').text()).toContain('auth · HTTP 401\ninvalid_api_key');
  });

  it('Try again and Start again retry the run', async () => {
    const job = mountIn({ status: 'error' });
    job.error = new ProviderError('rate_limit', 'Busy.');
    const retry = vi.spyOn(job, 'retry').mockResolvedValue();
    await wrapper!.vm.$nextTick();
    await wrapper!.get('button').trigger('click');

    job.status = 'cancelled';
    await wrapper!.vm.$nextTick();
    expect(status()).toBe('Transcription cancelled.');
    expect(buttons()).toEqual(['Start again']);
    await wrapper!.get('button').trigger('click');
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it('keeps one live region across status changes, so changes are announced', async () => {
    const job = mountIn({ status: 'uploading', progress: { loaded: 0, total: 10 } });
    const region = wrapper!.get('[role="status"]').element;
    job.status = 'processing';
    await wrapper!.vm.$nextTick();
    expect(wrapper!.get('[role="status"]').element).toBe(region);
    expect(status()).toBe('Transcribing…');
  });
});

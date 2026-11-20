import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError, type ProviderErrorKind } from '../../providers/errors';
import { useJobStore, type JobStatus as JobStatusValue } from '../../stores/job';
import { useNavStore } from '../../stores/nav';
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

  describe('on this computer (Phase 36)', () => {
    function mountLocal(progress: { doneSec: number; totalSec: number | null } | null) {
      const job = useJobStore();
      job.runEngine = 'local';
      job.localProgress = progress;
      return mountIn({ status: 'processing', elapsedSec: 5 });
    }

    it('says it is preparing until the first seconds are done, with no bar', () => {
      mountLocal(null);
      expect(status()).toBe('Preparing…');
      expect(wrapper!.find('progress').exists()).toBe(false);
      expect(wrapper!.text()).toContain('Keep DeScribe open. You can use other apps.');
      expect(wrapper!.text()).not.toContain('Keep this tab open.');
    });

    it('shows the audio done out of the total on a bar, outside the live region', async () => {
      const job = mountLocal(null);
      const region = wrapper!.get('[role="status"]').element;
      job.localProgress = { doneSec: 750, totalSec: 3490 };
      await wrapper!.vm.$nextTick();
      expect(status()).toBe('Transcribing…');
      expect(wrapper!.get('[role="status"]').element).toBe(region);
      const bar = wrapper!.get('progress');
      expect(bar.attributes('aria-label')).toBe('Transcription progress');
      expect(bar.attributes('value')).toBe('750');
      expect(bar.attributes('max')).toBe('3490');
      expect(wrapper!.get('.audio').text()).toBe('00:12:30 of 00:58:10');
      job.localProgress = { doneSec: 800, totalSec: 3490 };
      await wrapper!.vm.$nextTick();
      expect(status()).toBe('Transcribing…');
      expect(wrapper!.get('.audio').text()).toBe('00:13:20 of 00:58:10');
    });

    it('shows the seconds done alone when the total is unknown', () => {
      mountLocal({ doneSec: 61, totalSec: null });
      expect(wrapper!.get('.audio').text()).toBe('00:01:01');
      expect(wrapper!.get('progress').attributes('value')).toBeUndefined();
    });
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

  it('offers Settings for a failure fixed there, without Try again (Phase 36)', async () => {
    const job = mountIn({ status: 'error' });
    job.error = new ProviderError(
      'validation',
      "The speech models aren't on this computer any more.",
      {
        fixIn: 'settings',
      },
    );
    await wrapper!.vm.$nextTick();
    expect(buttons()).toEqual(['Open Settings']);
    await wrapper!.get('button').trigger('click');
    expect(useNavStore().mode).toBe('settings');
  });

  describe('a failure on a graphics card (Phase 37)', () => {
    const gpuFailure = () =>
      new ProviderError(
        'server',
        'The graphics card (AMD Radeon 740M Graphics) stopped while transcribing.',
        { retryOn: 'processor', detail: 'gpu: ErrorDeviceLost' },
      );

    afterEach(() => vi.unstubAllGlobals());

    it('names the card and offers Try again and Try on the processor', async () => {
      vi.stubGlobal('__DESKTOP__', true);
      const job = mountIn({ status: 'error' });
      job.error = gpuFailure();
      const retry = vi.spyOn(job, 'retry').mockResolvedValue();
      const onProcessor = vi.spyOn(job, 'retryOnProcessor').mockResolvedValue();
      await wrapper!.vm.$nextTick();
      expect(status()).toBe(
        'The graphics card (AMD Radeon 740M Graphics) stopped while transcribing.',
      );
      expect(buttons()).toEqual(['Try again', 'Try on the processor']);
      await wrapper!.findAll('button')[1]!.trigger('click');
      expect(onProcessor).toHaveBeenCalledOnce();
      expect(retry).not.toHaveBeenCalled();
    });

    it('offers only Try again for any other failure, and in the web build', async () => {
      const job = mountIn({ status: 'error' });
      job.error = gpuFailure();
      await wrapper!.vm.$nextTick();
      expect(buttons()).toEqual(['Try again']);
      wrapper!.unmount();
      vi.stubGlobal('__DESKTOP__', true);
      wrapper = mount(JobStatus);
      job.error = new ProviderError('server', 'Transcribing on this computer stopped.');
      await wrapper.vm.$nextTick();
      expect(buttons()).toEqual(['Try again']);
    });
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

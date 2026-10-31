import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../../providers/errors';
import { FOLDER_MESSAGES, FolderError } from '../../storage/folder';
import { usePipelineStore, type PipelineFailure, type PipelineJob } from '../../stores/pipeline';
import { useProjectStore } from '../../stores/project';
import { useSettingsStore } from '../../stores/settings';
import PipelineStatus from './PipelineStatus.vue';

const job = (patch: Partial<PipelineJob> = {}): PipelineJob => ({
  sessionId: 'doc-1',
  title: 'P07 interview.m4a',
  kind: 'add',
  steps: ['save', 'translate', 'summarise'],
  current: 'translate',
  progress: { batch: 3, totalBatches: 12 },
  status: 'running',
  ...patch,
});

const failure = (patch: Partial<PipelineFailure> = {}): PipelineFailure => ({
  sessionId: 'doc-1',
  title: 'P07 interview.m4a',
  kind: 'add',
  steps: ['save', 'summarise'],
  step: 'summarise',
  error: new ProviderError('server', 'Claude is busy. Try again.'),
  reconnect: false,
  partial: null,
  ...patch,
});

describe('PipelineStatus', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setActivePinia(createPinia());
    useSettingsStore().claudeKey = 'test-key';
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.restoreAllMocks();
  });

  function withState(current: PipelineJob | null, failed: PipelineFailure | null = null) {
    const pipeline = usePipelineStore();
    vi.spyOn(pipeline, 'jobFor').mockReturnValue(current);
    vi.spyOn(pipeline, 'failureFor').mockReturnValue(failed);
    return pipeline;
  }

  const mountFor = (props: Record<string, unknown> = { sessionId: 'doc-1' }) =>
    mount(PipelineStatus, { props, attachTo: document.body });

  it('says which step runs, with the batches while translating, and Cancel', async () => {
    const pipeline = withState(job());
    const cancel = vi.spyOn(pipeline, 'cancel').mockImplementation(() => undefined);
    wrapper = mountFor();
    expect(wrapper.get('.status-line').text()).toBe(
      'Adding to project · translating, batch 3 of 12',
    );
    const bar = wrapper.get('progress');
    expect(bar.attributes('value')).toBe('2');
    expect(bar.attributes('max')).toBe('12');
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Cancel')!
      .trigger('click');
    expect(cancel).toHaveBeenCalled();
  });

  it.each([
    [job({ current: 'save', progress: null }), 'Adding to project · saving…'],
    [job({ current: 'summarise', progress: null }), 'Adding to project · summarising…'],
    [job({ kind: 'summarise', current: 'summarise', progress: null }), 'Summarising…'],
    [job({ status: 'queued', current: null, progress: null }), 'Waiting to add to the project'],
  ])('shows %#', (state, text) => {
    withState(state);
    wrapper = mountFor();
    expect(wrapper.get('.status-line').text()).toBe(text);
    expect(wrapper.find('progress').exists()).toBe(false);
  });

  it('shows a failure with Resume', async () => {
    const pipeline = withState(null, failure());
    const resume = vi.spyOn(pipeline, 'resume').mockResolvedValue(undefined);
    wrapper = mountFor();
    expect(wrapper.get('[role="alert"]').text()).toBe('Claude is busy. Try again.');
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(resume).toHaveBeenCalledWith('doc-1');
  });

  it('asks for the key before Resume when it is missing', async () => {
    useSettingsStore().claudeKey = '';
    const pipeline = withState(null, failure());
    const resume = vi.spyOn(pipeline, 'resume').mockResolvedValue(undefined);
    wrapper = mountFor();
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(resume).not.toHaveBeenCalled();
    expect(wrapper.emitted('needKey')).toHaveLength(1);
  });

  it('offers Reconnect when access to the folder ended, then resumes', async () => {
    const pipeline = withState(
      null,
      failure({
        error: new FolderError('permission', FOLDER_MESSAGES.permission),
        reconnect: true,
        step: 'save',
      }),
    );
    const reconnect = vi.spyOn(useProjectStore(), 'reconnect').mockResolvedValue(true);
    const resume = vi.spyOn(pipeline, 'resume').mockResolvedValue(undefined);
    wrapper = mountFor();
    expect(wrapper.get('[role="alert"]').text()).toBe(FOLDER_MESSAGES.permission);
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(reconnect).toHaveBeenCalled();
    expect(resume).toHaveBeenCalledWith('doc-1');
  });

  it('leaves failures to the summary pane when asked to', () => {
    withState(null, failure());
    wrapper = mountFor({ sessionId: 'doc-1', showFailure: false });
    expect(wrapper.find('.pipeline-status').exists()).toBe(false);
  });
});

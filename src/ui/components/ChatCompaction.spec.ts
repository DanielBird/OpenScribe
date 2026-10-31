import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { parseAnswer } from '../../features/agent/answer';
import { ProviderError } from '../../providers/errors';
import { NO_USAGE } from '../../providers/llm/types';
import type { ChatCompactionMessage } from '../../stores/chat';
import { makeAgentCorpus } from '../../testing/agentCorpus';
import ChatCompaction from './ChatCompaction.vue';

const corpus = makeAgentCorpus();
const SUMMARY =
  'Mary charges them by the bed.\n<quote ref="s1/t2">I put them on the charger by the bed</quote>';

const message = (patch: Partial<ChatCompactionMessage> = {}): ChatCompactionMessage => ({
  role: 'compaction',
  id: 'c1',
  summary: SUMMARY,
  blocks: parseAnswer(SUMMARY, corpus),
  focus: '',
  usage: NO_USAGE,
  costUsd: 0.12,
  status: 'done',
  error: null,
  ...patch,
});

const show = (m: ChatCompactionMessage) => mount(ChatCompaction, { props: { message: m, corpus } });

describe('ChatCompaction', () => {
  it('is a divider whose summary, with its quotes and cost, opens under it', () => {
    const wrapper = show(message());
    const details = wrapper.get('details');
    expect(details.attributes('open')).toBeUndefined();
    expect(wrapper.get('summary').text()).toBe('Earlier messages summarised');
    expect(wrapper.get('.summary').text()).toContain('Mary charges them by the bed.');
    expect(wrapper.find('.summary .quote-card').exists()).toBe(true);
    expect(wrapper.get('.summary').text()).toContain('≈ $0.12');
    expect(wrapper.attributes('aria-busy')).toBe('false');
  });

  it('says it is compacting while it runs', () => {
    const wrapper = show(message({ status: 'running', summary: '', blocks: [], costUsd: null }));
    expect(wrapper.text()).toBe('Compacting…');
    expect(wrapper.attributes('aria-busy')).toBe('true');
    expect(wrapper.find('details').exists()).toBe(false);
  });

  it('shows an error with Try again', async () => {
    const wrapper = show(
      message({
        status: 'error',
        summary: '',
        blocks: [],
        error: new ProviderError('server', 'The service is busy.'),
      }),
    );
    expect(wrapper.get('.error p').text()).toBe('The service is busy.');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
  });
});

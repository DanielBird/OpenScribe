import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseAnswer } from '../../features/agent/answer';
import { ProviderError } from '../../providers/errors';
import { NO_USAGE } from '../../providers/llm/types';
import type { ChatAssistantMessage } from '../../stores/chat';
import { makeAgentCorpus } from '../../testing/agentCorpus';
import ChatMessage from './ChatMessage.vue';

const corpus = makeAgentCorpus();
const ANSWER = 'Mary charges them by the bed.';

const answer = (patch: Partial<ChatAssistantMessage> = {}): ChatAssistantMessage => ({
  role: 'assistant',
  id: 'a1',
  text: ANSWER,
  blocks: parseAnswer(ANSWER, corpus),
  activity: [],
  usage: NO_USAGE,
  costUsd: null,
  status: 'done',
  error: null,
  ...patch,
});

const show = (message: ChatAssistantMessage) => mount(ChatMessage, { props: { message, corpus } });

describe('ChatMessage', () => {
  // The error's technical details read the saved keys, to keep them out.
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('shows a question as plain text', () => {
    const wrapper = mount(ChatMessage, {
      props: { message: { role: 'user', id: 'q1', text: 'Where do they charge it?' }, corpus },
    });
    expect(wrapper.get('.question').text()).toBe('Where do they charge it?');
  });

  it('shows an answer, and says when it was stopped', () => {
    expect(show(answer()).text()).toContain(ANSWER);
    expect(
      show(answer({ status: 'stopped' }))
        .get('.status')
        .text(),
    ).toBe('Stopped');
  });

  it('shows an error with Try again and its technical details', async () => {
    const wrapper = show(
      answer({
        text: '',
        blocks: [],
        status: 'error',
        error: new ProviderError(
          'rate_limit',
          'Too many requests. Wait a minute, then try again.',
          {
            status: 429,
            detail:
              'rate_limit_error: Number of request tokens has exceeded your per-minute rate limit',
          },
        ),
      }),
    );
    expect(wrapper.get('.error p').text()).toBe(
      'Too many requests. Wait a minute, then try again.',
    );
    expect(wrapper.get('.error details pre').text()).toContain(
      'rate_limit · HTTP 429\nrate_limit_error: Number of request tokens',
    );
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
  });
});

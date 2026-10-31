import { describe, expect, it } from 'vitest';
import { ProviderError } from '../../providers/errors';
import { createClaudeAgent } from '../../providers/llm/claudeAgent';
import { createGeminiAgent } from '../../providers/llm/geminiAgent';
import type { AgentConversation, AgentProvider } from '../../providers/llm/types';
import {
  agentMessage,
  scriptedFetch,
  textBlock,
  thinkingBlock,
  toolUseBlock,
  type ScriptedReply,
} from '../../testing/agent';
import { makeAgentCorpus } from '../../testing/agentCorpus';
import { geminiTurn, scriptedGeminiFetch, textPart } from '../../testing/geminiAgent';
import { askProject } from './ask';
import {
  COMPACT_MESSAGES,
  COMPACTED_LEAD,
  compactChat,
  compactedHistory,
  compactPrompt,
} from './compact';
import { TOOL_BUDGET_REACHED } from './tools';

const corpus = makeAgentCorpus();
const CONTEXT = 'Sessions (3): …';
const SUMMARY = 'You asked who charges at night: Mary, by the bed (s1).';

type Body = Record<string, unknown>;
type Message = { role: string; content: unknown };

function claude(replies: readonly ScriptedReply[]) {
  const scripted = scriptedFetch(replies);
  const provider = createClaudeAgent({
    apiKey: 'test-key',
    model: 'claude-sonnet-5-5',
    fetch: scripted.fetch,
    maxRetries: 0,
  });
  return { provider, ...scripted };
}

const ask = (provider: AgentProvider, conversation: AgentConversation | null, question: string) =>
  askProject({
    provider,
    corpus,
    context: CONTEXT,
    conversation,
    question,
    signal: new AbortController().signal,
    onEvent: () => {},
  });

const compact = (provider: AgentProvider, conversation: AgentConversation, focus = '') =>
  compactChat({
    provider,
    corpus,
    context: CONTEXT,
    conversation,
    focus,
    signal: new AbortController().signal,
    onEvent: () => {},
  });

const messagesOf = (body: Body) => body.messages as Message[];

describe('compactPrompt', () => {
  it('adds what to keep, when there is something', () => {
    expect(compactPrompt('')).toBe(compactPrompt('  '));
    expect(compactPrompt('the charging quotes')).toBe(
      `${compactPrompt('')}\n\nThe researcher asked you to keep this in particular: the charging quotes`,
    );
  });
});

describe('compactedHistory', () => {
  it('puts the summary first, as the answer to the lead', () => {
    expect(compactedHistory(SUMMARY, [{ question: 'Who?', answer: 'Mary.' }])).toEqual([
      { question: COMPACTED_LEAD, answer: SUMMARY },
      { question: 'Who?', answer: 'Mary.' },
    ]);
  });
});

describe('compactChat', () => {
  it('asks for the summary on the same prefix, then goes on from the summary alone (Claude)', async () => {
    const { provider, requests } = claude([
      { message: agentMessage([thinkingBlock('sig-1'), textBlock('Mary, by the bed.')]) },
      { message: agentMessage([thinkingBlock('sig-2'), textBlock(` ${SUMMARY}\n`)]) },
      { message: agentMessage([textBlock('Her husband.')]) },
    ]);
    const first = await ask(provider, null, 'Who charges at night?');
    const result = await compact(provider, first.conversation, 'the charging quotes');

    expect(result.summary).toBe(SUMMARY);
    const [asked, summarised] = requests.map((r) => r.body);
    // The cached prefix holds: nothing before the messages changes, and neither does what would drop their cache.
    for (const key of ['model', 'system', 'tools', 'thinking', 'output_config', 'cache_control']) {
      expect(summarised![key]).toEqual(asked![key]);
    }
    expect(summarised).not.toHaveProperty('tool_choice');
    // The conversation as it was, its thinking included, then the prompt.
    const sent = messagesOf(summarised!);
    expect(sent).toHaveLength(3);
    expect(sent[0]).toEqual(messagesOf(asked!)[0]);
    expect(sent[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'thinking', signature: 'sig-1' }, { type: 'text' }],
    });
    expect(sent[2]).toEqual({ role: 'user', content: compactPrompt('the charging quotes') });

    await ask(provider, result.conversation, 'Who helps?');
    expect(messagesOf(requests[2]!.body)).toEqual([
      { role: 'user', content: COMPACTED_LEAD },
      { role: 'assistant', content: [{ type: 'text', text: SUMMARY }] },
      { role: 'user', content: 'Who helps?' },
    ]);
    expect(requests[2]!.body.system).toEqual(asked!.system);
    expect(requests[2]!.body.tools).toEqual(asked!.tools);
  });

  it('answers a tool call with the budget reply, then takes the summary', async () => {
    const { provider, requests } = claude([
      { message: agentMessage([textBlock('Mary.')]) },
      { message: agentMessage([toolUseBlock('tu_1', 'search_transcripts', { query: 'bed' })]) },
      { message: agentMessage([textBlock(SUMMARY)]) },
    ]);
    const first = await ask(provider, null, 'Who?');
    const result = await compact(provider, first.conversation);

    expect(result.summary).toBe(SUMMARY);
    const results = messagesOf(requests[2]!.body).at(-1)!.content as { content: string }[];
    expect(results[0]!.content).toBe(TOOL_BUDGET_REACHED);
  });

  it('throws when there is no summary, or it stopped at a limit', async () => {
    const { provider } = claude([
      { message: agentMessage([textBlock('Mary.')]) },
      { message: agentMessage([textBlock('  ')]) },
      { message: agentMessage([textBlock('Half a summ')], { stop_reason: 'max_tokens' }) },
    ]);
    const first = await ask(provider, null, 'Who?');

    for (const _ of [1, 2]) {
      const error = await compact(provider, first.conversation).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({ kind: 'bad_output', userMessage: COMPACT_MESSAGES.noSummary });
    }
  });

  it('goes on from the summary alone with Gemini, its turns still alternating', async () => {
    const { fetch, requests } = scriptedGeminiFetch([
      { response: geminiTurn([textPart('Mary, by the bed.', 'sig-a')]) },
      { response: geminiTurn([textPart(SUMMARY)]) },
      { response: geminiTurn([textPart('Her husband.')]) },
    ]);
    const provider = createGeminiAgent({
      apiKey: 'test-key',
      model: 'gemini-3.8-flash',
      fetch,
      maxRetries: 0,
    });
    const first = await ask(provider, null, 'Who charges at night?');
    const result = await compact(provider, first.conversation);
    await ask(provider, result.conversation, 'Who helps?');

    const [asked, summarised, after] = requests.map((r) => r.body);
    for (const key of ['systemInstruction', 'tools', 'generationConfig']) {
      expect(summarised![key]).toEqual(asked![key]);
    }
    expect(summarised).not.toHaveProperty('toolConfig');
    expect((summarised!.contents as unknown[]).at(-1)).toEqual({
      role: 'user',
      parts: [{ text: compactPrompt('') }],
    });
    expect(after!.contents).toEqual([
      { role: 'user', parts: [{ text: COMPACTED_LEAD }] },
      { role: 'model', parts: [{ text: SUMMARY }] },
      { role: 'user', parts: [{ text: 'Who helps?' }] },
    ]);
  });
});

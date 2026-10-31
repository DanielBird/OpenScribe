import { describe, expect, it } from 'vitest';
import {
  CHAT_TITLE_MAX,
  chatBaseName,
  chatFileName,
  chatTitle,
  classifyChatFile,
  historyOf,
  parseChatCommand,
  randomAuthorName,
  type ChatFileAnswer,
  type ChatFileMessage,
} from './chat';

const question = (text: string): ChatFileMessage => ({
  role: 'user',
  id: `q-${text}`,
  at: '2026-10-27T14:02:00.000Z',
  text,
});

const answer = (text: string, status: ChatFileAnswer['status'] = 'done'): ChatFileMessage => ({
  role: 'assistant',
  id: `a-${text}`,
  at: '2026-10-27T14:03:00.000Z',
  text,
  status,
  activity: [],
  costUsd: null,
  model: 'claude-sonnet-5-5',
});

const compaction = (summary: string): ChatFileMessage => ({
  role: 'compaction',
  id: `c-${summary}`,
  at: '2026-10-27T14:04:00.000Z',
  summary,
  focus: '',
  costUsd: null,
  model: 'claude-sonnet-5-5',
});

describe('chatBaseName', () => {
  it('is the UTC start time, then the first 8 characters of the id', () => {
    expect(chatBaseName('2026-10-27T14:02:31.120Z', '3f9a1c2e-7b1d-4c3a-9e0f-1234567890ab')).toBe(
      '2026-10-27-1402--3f9a1c2e',
    );
  });

  it('falls back to "chat" for a date it cannot read', () => {
    expect(chatBaseName('yesterday', 'abc')).toBe('chat--abc');
  });

  it('has no dots, so the classifier finds the kind after it', () => {
    const name = chatFileName(chatBaseName('2026-10-27T14:02:31.120Z', 'a.b.c.d.e'));
    expect(classifyChatFile(name)).toEqual({ base: '2026-10-27-1402--abcde', conflictCopy: false });
  });
});

describe('classifyChatFile', () => {
  it('reads a chat file and its base', () => {
    expect(classifyChatFile('2026-10-27-1402--3f9a1c2e.chat.json')).toEqual({
      base: '2026-10-27-1402--3f9a1c2e',
      conflictCopy: false,
    });
  });

  it.each(['x.chat-LAPTOP-123.json', 'x.chat - Copy.json', 'x.chat-Aristotle.v2.json'])(
    'marks %j as a conflict copy',
    (name) => {
      expect(classifyChatFile(name)).toEqual({ base: 'x', conflictCopy: true });
    },
  );

  it.each([
    'x.chat.json.crswap',
    'x.chat.json.txt',
    'x.json',
    'x.transcript.json',
    '.chat.json',
    'notes.txt',
  ])('ignores %j', (name) => {
    expect(classifyChatFile(name)).toBeNull();
  });
});

describe('chatTitle', () => {
  it('puts the question on one line', () => {
    expect(chatTitle('  Quotes about\n charging\tat night? ')).toBe(
      'Quotes about charging at night?',
    );
  });

  it(`cuts a long question at ${CHAT_TITLE_MAX} characters with an ellipsis`, () => {
    const title = chatTitle('word '.repeat(40));
    expect([...title]).toHaveLength(CHAT_TITLE_MAX);
    expect(title.endsWith('word…')).toBe(true);
  });

  it('keeps a question of exactly the limit whole', () => {
    const text = 'a'.repeat(CHAT_TITLE_MAX);
    expect(chatTitle(text)).toBe(text);
  });
});

describe('historyOf', () => {
  it('pairs each question with an answer that finished', () => {
    expect(
      historyOf([question('one'), answer('1'), question('two'), answer('2', 'limit')]),
    ).toEqual({
      summary: null,
      exchanges: [
        { question: 'one', answer: '1' },
        { question: 'two', answer: '2' },
      ],
    });
  });

  it('leaves out a stopped answer with its question', () => {
    expect(
      historyOf([question('one'), answer('1', 'stopped'), question('two'), answer('2')]).exchanges,
    ).toEqual([{ question: 'two', answer: '2' }]);
  });

  it('leaves out a question without an answer', () => {
    expect(historyOf([question('one'), question('two'), answer('2')]).exchanges).toEqual([
      { question: 'two', answer: '2' },
    ]);
  });

  it('starts from the latest compaction, with the exchanges after it', () => {
    expect(
      historyOf([
        question('one'),
        answer('1'),
        compaction('first'),
        question('two'),
        answer('2'),
        compaction('second'),
        question('three'),
        answer('3'),
      ]),
    ).toEqual({ summary: 'second', exchanges: [{ question: 'three', answer: '3' }] });
  });

  it('has no exchanges right after a compaction', () => {
    expect(historyOf([question('one'), answer('1'), compaction('all')])).toEqual({
      summary: 'all',
      exchanges: [],
    });
  });
});

describe('parseChatCommand', () => {
  it('reads /compact, with or without what to keep', () => {
    expect(parseChatCommand('/compact')).toEqual({ kind: 'compact', focus: '' });
    expect(parseChatCommand('  /COMPACT  ')).toEqual({ kind: 'compact', focus: '' });
    expect(parseChatCommand('/compact keep the charging quotes ')).toEqual({
      kind: 'compact',
      focus: 'keep the charging quotes',
    });
    expect(parseChatCommand('/compact\nthe German sessions')).toEqual({
      kind: 'compact',
      focus: 'the German sessions',
    });
  });

  it('treats anything else as a question', () => {
    expect(parseChatCommand('/compactly')).toBeNull();
    expect(parseChatCommand('compact')).toBeNull();
    expect(parseChatCommand('Please /compact')).toBeNull();
    expect(parseChatCommand('/help')).toBeNull();
  });
});

describe('randomAuthorName', () => {
  it('is an adjective and an animal', () => {
    expect(randomAuthorName(() => 0)).toBe('Amber Badger');
    expect(randomAuthorName(() => 0.9999)).toBe('Witty Wren');
  });

  it('stays in the lists whatever the random source returns', () => {
    expect(randomAuthorName(() => 1)).toBe('Witty Wren');
    expect(randomAuthorName(() => -1)).toBe('Amber Badger');
  });
});

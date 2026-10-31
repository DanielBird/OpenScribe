import { describe, expect, it } from 'vitest';
import { makeCorpus } from '../../testing/corpus';
import { normalizeForMatch } from './normalize';
import { parseQuery, type Query } from './query';
import {
  prepareCorpus,
  search,
  SNIPPET_CONTEXT_WORDS,
  type SearchField,
  type SearchOptions,
  type SearchResult,
} from './search';
import { toSessionText, type SessionText } from './sessionText';

function session(
  sessionId: string,
  languageCode: string,
  recordedAt: number,
  turns: [text: string, en?: string][],
): SessionText {
  return {
    sessionId,
    recordingName: `${sessionId}.m4a`,
    recordedAt,
    durationSec: 60,
    languageCode,
    speakers: [
      { id: 'speaker_0', label: 'Interviewer' },
      { id: 'speaker_1', label: 'Anna' },
    ],
    turns: turns.map(([text, en], i) => ({
      id: `t${i + 1}`,
      speakerId: `speaker_${i % 2}`,
      start: i * 10,
      text,
      en: en ?? null,
    })),
    transcriptHash: '0',
  };
}

const EN = session('en1', 'eng', 3000, [
  ['I just put them on the charger by the bed, like my phone.'],
  ['At night I charge them. Every night.'],
  ["The doctor's advice was useful."],
  ['My phone is on the charger too.'],
]);
const DE = session('de1', 'deu', 2000, [
  [
    'Ich lege das Hörgerät nachts auf das Ladegerät neben dem Bett.',
    'At night I put the hearing aid on the charger next to the bed.',
  ],
  ['Morgens nehme ich es wieder.', 'In the morning I take it again.'],
]);
const DE_UNTRANSLATED = session('de2', 'deu', 1000, [
  ['Das Ladegerät steht in der Küche.'],
  ['Nachts lade ich es auf.'],
]);

const CORPUS = prepareCorpus([EN, DE, DE_UNTRANSLATED]);

function q(input: string): Query {
  const result = parseQuery(input);
  if (result.kind === 'error') throw new Error(result.message);
  return result;
}

function run(input: string, options: Partial<SearchOptions> = {}): SearchResult {
  return search(CORPUS, q(input), { field: 'both', maxHitsPerSession: 50, ...options });
}

/** `sessionId/turnId:field` for every listed hit, in order. */
function refs(result: SearchResult): string[] {
  return result.sessions.flatMap((s) => s.hits.map((h) => `${s.sessionId}/${h.turnId}:${h.field}`));
}

function marked(snippet: string, marks: [number, number][]): string[] {
  return marks.map(([start, end]) => snippet.slice(start, end));
}

describe('search: query semantics', () => {
  it('needs every word (AND)', () => {
    expect(refs(run('charger phone'))).toEqual(['en1/t1:english', 'en1/t4:english']);
  });

  it('accepts either side of OR', () => {
    expect(refs(run('night OR morning', { field: 'english' }))).toEqual([
      'de1/t1:english',
      'de1/t2:english',
      'en1/t2:english',
    ]);
  });

  it('matches a phrase only as consecutive words', () => {
    expect(refs(run('"charger by the bed"'))).toEqual(['en1/t1:english']);
    expect(refs(run('"the bed charger"')).length).toBe(0);
  });

  it('matches a prefix at the start of a word only', () => {
    expect(refs(run('charg*', { field: 'english' }))).toEqual([
      'en1/t1:english',
      'en1/t2:english',
      'en1/t4:english',
      'de1/t1:english',
    ]);
    expect(refs(run('harg*')).length).toBe(0);
  });

  it('matches whole words, not parts of words', () => {
    expect(refs(run('charge'))).toEqual(['en1/t2:english']);
    expect(refs(run('nigh')).length).toBe(0);
  });

  it('leaves out turns with an excluded word or phrase', () => {
    expect(refs(run('charger -phone'))).toEqual(['de1/t1:english']);
    expect(refs(run('charger -"phone is"'))).toEqual(['en1/t1:english', 'de1/t1:english']);
  });

  it('ignores case, accents and punctuation', () => {
    expect(refs(run('HORGERAT', { field: 'original' }))).toEqual(['de1/t1:original']);
    expect(refs(run('"bed like my"'))).toEqual(['en1/t1:english']);
  });

  it('finds a word before an apostrophe', () => {
    expect(refs(run('doctor'))).toEqual(['en1/t3:english']);
    expect(refs(run("doctor's"))).toEqual(['en1/t3:english']);
  });
});

describe('search: fields', () => {
  it('searches the English text: translations and English sessions', () => {
    expect(refs(run('ladegerat', { field: 'english' }))).toEqual([]);
    expect(refs(run('night', { field: 'english' }))).toEqual(['en1/t2:english', 'de1/t1:english']);
  });

  it('searches the original text', () => {
    expect(refs(run('ladegerat', { field: 'original' }))).toEqual([
      'de1/t1:original',
      'de2/t1:original',
    ]);
    expect(refs(run('night', { field: 'original' }))).toEqual(['en1/t2:original']);
  });

  it('searches both, reporting a turn once and preferring the English hit', () => {
    // One hit each, so the newest session comes first.
    expect(refs(run('nachts OR night'))).toEqual([
      'en1/t2:english',
      'de1/t1:english',
      'de2/t2:original',
    ]);
  });

  it('falls back to the original text when there is no translation', () => {
    expect(refs(run('kuche'))).toEqual(['de2/t1:original']);
  });

  it('applies the whole query to one text at a time', () => {
    // "charger" is only in the English text and "Bett" only in the German one.
    expect(refs(run('charger bett')).length).toBe(0);
  });

  it.each<[SearchField, string]>([
    ['english', 'english'],
    ['original', 'original'],
    ['both', 'english'],
  ])('reports a hit in an English session with field %s as %s', (field, reported) => {
    expect(refs(run('doctor', { field }))).toEqual([`en1/t3:${reported}`]);
  });
});

describe('search: sessions, order and paging', () => {
  it('searches only the given sessions', () => {
    expect(refs(run('ladegerat', { sessionIds: ['de2'] }))).toEqual(['de2/t1:original']);
    expect(refs(run('ladegerat', { sessionIds: [] }))).toEqual([]);
  });

  it('orders sessions by hit count, then newest first', () => {
    expect(run('charg*').sessions.map((s) => s.sessionId)).toEqual(['en1', 'de1']);
    // One hit each: de1 (recorded at 2000) is newer than de2 (1000).
    expect(run('ladegerat').sessions.map((s) => s.sessionId)).toEqual(['de1', 'de2']);
  });

  it('orders sessions with the same hit count and date by id', () => {
    const corpus = prepareCorpus([
      session('b', 'eng', 5, [['charger']]),
      session('a', 'eng', 5, [['charger']]),
    ]);
    const result = search(corpus, q('charger'), { field: 'both', maxHitsPerSession: 5 });
    expect(result.sessions.map((s) => s.sessionId)).toEqual(['a', 'b']);
  });

  it('counts every hit but lists at most maxHitsPerSession', () => {
    const result = run('charg*', { maxHitsPerSession: 2 });
    expect(result.totalHits).toBe(4);
    expect(result.sessions[0]).toMatchObject({ sessionId: 'en1', hitCount: 3 });
    expect(result.sessions[0]?.hits.map((h) => h.turnId)).toEqual(['t1', 't2']);
    expect(run('charg*', { maxHitsPerSession: 0 }).sessions[0]?.hits).toEqual([]);
  });

  it('pages by sessions', () => {
    const first = run('charg*', { limit: 1 });
    expect(first).toMatchObject({ totalHits: 4, totalSessions: 2, nextOffset: 1 });
    expect(first.sessions.map((s) => s.sessionId)).toEqual(['en1']);

    const second = run('charg*', { offset: 1, limit: 1 });
    expect(second).toMatchObject({ totalHits: 4, totalSessions: 2, nextOffset: null });
    expect(second.sessions.map((s) => s.sessionId)).toEqual(['de1']);

    expect(run('charg*', { offset: 5, limit: 1 })).toMatchObject({
      sessions: [],
      nextOffset: null,
    });
    expect(run('charg*').nextOffset).toBeNull();
  });

  it('gives each hit its turn, time and speaker', () => {
    expect(run('kuche').sessions[0]?.hits[0]).toMatchObject({
      turnId: 't1',
      start: 0,
      speakerId: 'speaker_0',
    });
    expect(run('nachts', { field: 'original' }).sessions[1]?.hits[0]).toMatchObject({
      turnId: 't2',
      start: 10,
      speakerId: 'speaker_1',
    });
  });

  it('returns nothing for an empty corpus', () => {
    expect(
      search(prepareCorpus([]), q('charger'), { field: 'both', maxHitsPerSession: 5 }),
    ).toEqual({
      totalHits: 0,
      totalSessions: 0,
      sessions: [],
      nextOffset: null,
    });
  });

  it('prepares each session once', () => {
    expect(prepareCorpus([EN]).sessions[0]).toBe(prepareCorpus([DE, EN]).sessions[1]);
  });
});

describe('search: snippets', () => {
  it('shows a short turn whole, from the text that matched, with every match marked', () => {
    const hit = run('charger phone').sessions[0]?.hits[0];
    expect(hit?.snippet).toBe('I just put them on the charger by the bed, like my phone.');
    expect(marked(hit?.snippet ?? '', hit?.marks ?? [])).toEqual(['charger', 'phone']);

    const translated = run('charger', { field: 'english' }).sessions[1]?.hits[0];
    expect(translated?.snippet).toBe(
      'At night I put the hearing aid on the charger next to the bed.',
    );
  });

  it('marks the words as written in the turn', () => {
    const hit = run('horgerat ladegerat', { field: 'original' }).sessions[0]?.hits[0];
    expect(marked(hit?.snippet ?? '', hit?.marks ?? [])).toEqual(['Hörgerät', 'Ladegerät']);
  });

  it('marks the whole word for a prefix, and a whole phrase', () => {
    const prefix = run('charg*').sessions[0]?.hits[1];
    expect(marked(prefix?.snippet ?? '', prefix?.marks ?? [])).toEqual(['charge']);
    const phrase = run('"by the bed"').sessions[0]?.hits[0];
    expect(marked(phrase?.snippet ?? '', phrase?.marks ?? [])).toEqual(['by the bed']);
  });

  it('merges overlapping matches into one mark', () => {
    const hit = run('"by the" "the bed"').sessions[0]?.hits[0];
    expect(marked(hit?.snippet ?? '', hit?.marks ?? [])).toEqual(['by the bed']);
  });

  it('cuts a long turn at word boundaries around the first match', () => {
    const before = Array.from({ length: 30 }, (_, i) => `b${i}`).join(' ');
    const after = Array.from({ length: 30 }, (_, i) => `a${i}`).join(', ');
    const text = `${before} the charger, ${after}.`;
    const corpus = prepareCorpus([session('long', 'eng', 1, [[text]])]);
    const hit = search(corpus, q('charger'), { field: 'both', maxHitsPerSession: 1 }).sessions[0]
      ?.hits[0];

    const snippet = hit?.snippet ?? '';
    expect(snippet.startsWith('…b19 b20')).toBe(true);
    expect(snippet.endsWith('a10, a11…')).toBe(true);
    // 12 words either side of the match, and the match.
    expect(normalizeForMatch(snippet).match(/[a-z0-9]+/g)).toHaveLength(
      2 * SNIPPET_CONTEXT_WORDS + 1,
    );
    expect(marked(snippet, hit?.marks ?? [])).toEqual(['charger']);
    // Where its words are in the whole turn.
    const { snippetStart = 0, snippetEnd = 0 } = hit ?? {};
    expect(`…${text.slice(snippetStart, snippetEnd)}…`).toBe(snippet);
  });

  it('keeps the start and end of a turn when the snippet reaches them', () => {
    const corpus = prepareCorpus([session('q', 'eng', 1, [['“Charger?” she asked. “Yes!”']])]);
    const hit = search(corpus, q('charger'), { field: 'both', maxHitsPerSession: 1 }).sessions[0]
      ?.hits[0];
    expect(hit?.snippet).toBe('“Charger?” she asked. “Yes!”');
    expect(marked(hit?.snippet ?? '', hit?.marks ?? [])).toEqual(['Charger']);
  });

  it('gives the whole turn with every match marked, also beyond the snippet', () => {
    const after = Array.from({ length: 30 }, (_, i) => `a${i}`).join(' ');
    const text = `The charger, ${after}, and the charger again.`;
    const corpus = prepareCorpus([session('long', 'eng', 1, [[text]])]);
    const hit = search(corpus, q('charger'), { field: 'both', maxHitsPerSession: 1 }).sessions[0]
      ?.hits[0];
    expect(marked(hit?.snippet ?? '', hit?.marks ?? [])).toEqual(['charger']);
    expect(hit?.turnText).toBe(text);
    expect(marked(hit?.turnText ?? '', hit?.turnMarks ?? [])).toEqual(['charger', 'charger']);
  });

  it('gives the text that matched as the whole turn: the translation for an English hit', () => {
    const translated = run('charger', { field: 'english' }).sessions[1]?.hits[0];
    expect(translated?.turnText).toBe(
      'At night I put the hearing aid on the charger next to the bed.',
    );
    const original = run('ladegerat', { field: 'original' }).sessions[0]?.hits[0];
    expect(original?.turnText).toBe(
      'Ich lege das Hörgerät nachts auf das Ladegerät neben dem Bett.',
    );
    // A short turn's snippet is already the whole of it.
    const short = run('charger phone').sessions[0]?.hits[0];
    expect(short?.snippet).toBe(short?.turnText);
    expect(short?.marks).toEqual(short?.turnMarks);
    expect([short?.snippetStart, short?.snippetEnd]).toEqual([0, short?.turnText.length]);
  });
});

describe('search: scripts written without spaces', () => {
  const JA = session('ja1', 'jpn', 1, [
    ['毎晩、ベッドの横で充電します。', 'I charge them by the bed every night.'],
    ['朝は充電器から外します。'],
  ]);
  const TH = session('th1', 'tha', 2, [['ฉันชาร์จมันข้างเตียงทุกคืน']]);
  const corpus = prepareCorpus([JA, TH]);
  const find = (input: string) =>
    search(corpus, q(input), { field: 'original', maxHitsPerSession: 50 });

  it('finds one word inside a sentence, and marks just that word', () => {
    expect(refs(find('充電'))).toEqual(['ja1/t1:original']);
    const hit = find('充電').sessions[0]?.hits[0];
    expect(marked(hit?.snippet ?? '', hit?.marks ?? [])).toEqual(['充電']);

    expect(refs(find('เตียง'))).toEqual(['th1/t1:original']);
    const thai = find('เตียง').sessions[0]?.hits[0];
    expect(marked(thai?.snippet ?? '', thai?.marks ?? [])).toEqual(['เตียง']);
  });

  it('matches a compound word only as itself, and a phrase typed without spaces', () => {
    expect(refs(find('充電器'))).toEqual(['ja1/t2:original']);
    expect(refs(find('"ベッドの横"'))).toEqual(['ja1/t1:original']);
    expect(refs(find('ベッドの横'))).toEqual(['ja1/t1:original']);
  });
});

describe('search: the generated corpus', () => {
  const { docs, planted } = makeCorpus({ hours: 40, seed: 7 });
  const corpus = prepareCorpus(docs.map(toSessionText));
  const phrases = [...new Set(planted.map((p) => normalizeForMatch(p.phrase)))];

  it.each(phrases)('finds every planted "%s" at its turn, time and field', (phrase) => {
    const expected = planted
      .filter((p) => normalizeForMatch(p.phrase) === phrase)
      .map((p) => `${p.sessionId}/${p.turnId}:${p.field}@${p.start}`)
      .sort();
    const result = search(corpus, q(`"${phrase}"`), { field: 'both', maxHitsPerSession: 10 });
    const found = result.sessions
      .flatMap((s) => s.hits.map((h) => `${s.sessionId}/${h.turnId}:${h.field}@${h.start}`))
      .sort();
    expect(found).toEqual(expected);
    expect(result.totalHits).toBe(expected.length);
  });

  it.each(['Hörgerät', 'horgerat', 'HÖRGERÄT'])(
    'finds the planted Hörgerät typed as %s',
    (input) => {
      const result = search(corpus, q(input), { field: 'original', maxHitsPerSession: 10 });
      const expected = planted.find((p) => p.phrase.includes('Hörgerät'));
      expect(refs(result)).toEqual([`${expected?.sessionId}/${expected?.turnId}:original`]);
    },
  );
});

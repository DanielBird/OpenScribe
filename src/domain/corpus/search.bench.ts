// @vitest-environment node
// `npm run bench`: keyword search over a generated 300-hour corpus. The budget is 200 ms per query
// (DECISIONS.md T12); the numbers are recorded in docs/TESTING.md (Performance).
import { test } from 'vitest';
import { makeCorpus } from '../../testing/corpus';
import { parseQuery, type Query } from './query';
import { prepareCorpus, search } from './search';
import { toSessionText } from './sessionText';

const HOURS = 300;
const TIMEOUT_MS = 300_000;

const { docs } = makeCorpus({ hours: HOURS, seed: 20261019 });
const texts = docs.map(toSessionText);
const corpus = prepareCorpus(texts);

const QUERIES: Record<string, string> = {
  word: 'battery',
  prefix: 'charg*',
  phrase: '"charger by the bed"',
  or: 'night OR evening',
  exclusion: 'battery -app',
  'PROJECTS.md example': 'charg* night OR evening',
  // For information: a hit in most turns, so the most hits to count and sort.
  'common word': 'the',
};

function parsed(input: string): Query {
  const query = parseQuery(input);
  if (query.kind === 'error') throw new Error(query.message);
  return query;
}

test(`search ${HOURS} hours, both fields`, { timeout: TIMEOUT_MS }, async ({ bench }) => {
  await bench.compare(
    ...Object.entries(QUERIES).map(([name, input]) => {
      const query = parsed(input);
      return bench(`${name}: ${input}`, () => {
        search(corpus, query, { field: 'both', maxHitsPerSession: 5 });
      });
    }),
  );
});

test(`prepare ${HOURS} hours`, { timeout: TIMEOUT_MS }, async ({ bench }) => {
  await bench.compare(
    bench('toSessionText', () => {
      docs.map(toSessionText);
    }),
    // Copies, so the per-session memo in prepareCorpus doesn't apply.
    bench('prepareCorpus', () => {
      prepareCorpus(texts.map((text) => ({ ...text })));
    }),
    { iterations: 5, time: 0, warmupIterations: 1 },
  );
});

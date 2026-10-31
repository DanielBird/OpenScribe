import type { Page, TestInfo } from '@playwright/test';
import { makeCorpus } from '../../src/testing/corpus';
import { projectFiles } from '../../src/testing/projectSeed';
import { enterProject, expect, openHome, openSearch, test, useProjectFolder } from './helpers';

// A 300-hour project in the browser (Phase 14), the same corpus as `npm run bench` but with word timings, so the
// files have realistic sizes (~200 MB). Run with `npm run test:perf`. It times the first load (nothing cached), a
// load from the text cache, and keyword queries in the chat pane's Search (asserted under 200 ms, DECISIONS T12).
//
// The fake folder mirrors its files into the page before each timed load (permission `prompt`, so the load starts
// at the Reconnect click), so the times are the app's: reading, checking and caching, not moving files into the page.

const ROOT = 'Hearing at home';
const SEARCH_BUDGET_MS = 200;
const QUERIES = [
  'battery',
  'charg*',
  '"charger by the bed"',
  'night OR evening',
  'battery -app',
  'charg* night OR evening',
  'the',
];

interface Metrics {
  sessions: number;
  turns: number;
  megabytes: number;
  firstLoadMs: number;
  cachedLoadMs: number;
  queries: { query: string; ms: number; hits: string }[];
}

/** Clicks `button` and resolves the ms until `count` sessions are listed and painted. */
function timeLoad(page: Page, button: string, count: number): Promise<number> {
  return page.evaluate(
    async ({ name, n }) => {
      const afterPaint = () =>
        new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
      const target = [...document.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === name,
      );
      if (!target) throw new Error(`No button ${name}`);
      const start = performance.now();
      target.click();
      while (document.querySelectorAll('li.session').length < n) await afterPaint();
      return performance.now() - start;
    },
    { name: button, n: count },
  );
}

/** Types a query and presses Enter (which searches at once); the ms from Enter to the results painted. */
function timeQuery(page: Page, query: string): Promise<{ ms: number; hits: string }> {
  return page.evaluate(async (q) => {
    const afterPaint = () =>
      new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
    const box = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    box.value = q;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await afterPaint();
    const start = performance.now();
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await afterPaint();
    const ms = performance.now() - start;
    const status = document.querySelector('.session-search [role="status"]')?.textContent ?? '';
    return { ms, hits: status.trim() };
  }, query);
}

const round = (ms: number) => Math.round(ms);

function report(testInfo: TestInfo, m: Metrics) {
  const lines = [
    `300-hour project: ${m.sessions} sessions, ${m.turns} turns, ${m.megabytes} MB of transcript files`,
    `  first load (nothing cached)  ${m.firstLoadMs} ms`,
    `  load from the cache          ${m.cachedLoadMs} ms`,
    ...m.queries.map(
      (q) =>
        `  search ${q.query.padEnd(26)} ${String(q.ms).padStart(4)} ms   (${q.hits}; budget ${SEARCH_BUDGET_MS})`,
    ),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
  testInfo.annotations.push({ type: 'perf', description: lines.join('\n') });
}

test.describe.configure({ mode: 'serial' });

test('a 300-hour project loads, caches and searches within budget', async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  const { docs } = makeCorpus({ hours: 300, seed: 20261019, withWords: true });
  const files = projectFiles(docs);
  const megabytes = Math.round(
    Object.values(files).reduce((sum, text) => sum + Buffer.byteLength(text), 0) / 1e6,
  );
  const folder = await useProjectFolder(page, { [ROOT]: files }, { permission: 'prompt' });

  // The first load starts at Open project; after a reload (access asked for again) the second starts at Reconnect.
  await openHome(page);
  await enterProject(page);
  await folder.mirrored();
  const firstLoadMs = await timeLoad(page, 'Open project…', docs.length);

  await folder.setPermission('prompt');
  await page.reload();
  await enterProject(page);
  await expect(page.getByRole('button', { name: /^Reconnect/ })).toBeVisible();
  await folder.mirrored();
  const cachedLoadMs = await timeLoad(page, 'Reconnect “Hearing at home 2026”', docs.length);

  await openSearch(page);
  const queries: Metrics['queries'] = [];
  for (const query of QUERIES) {
    const { ms, hits } = await timeQuery(page, query);
    queries.push({ query, ms: round(ms), hits });
  }

  const m: Metrics = {
    sessions: docs.length,
    turns: docs.reduce((n, d) => n + d.turns.length, 0),
    megabytes,
    firstLoadMs: round(firstLoadMs),
    cachedLoadMs: round(cachedLoadMs),
    queries,
  };
  report(testInfo, m);
  expect(m.sessions).toBeGreaterThan(140);
  for (const q of m.queries) expect(q.ms, q.query).toBeLessThan(SEARCH_BUDGET_MS);
});

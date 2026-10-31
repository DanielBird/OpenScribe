import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page, TestInfo } from '@playwright/test';
import { expect, goToGlossary, mockElevenLabs, openApp, reloadApp, run, test } from './helpers';

// Performance on a 3-hour, 4-speaker transcript (Phase 8; Edit text in Phase 9). Run with
// `npm run test:perf`, which generates fixtures/large/large-3h.json first. Targets: render and Edit
// text on < 1 s, rename and edit keystrokes < 100 ms, export < 5 s, asserted at normal speed. The same
// run at 4× CPU throttling (a slow laptop) is reported only.

const LARGE_FIXTURE = fileURLToPath(new URL('../../fixtures/large/large-3h.json', import.meta.url));
const TARGETS = { renderMs: 1000, renameMs: 100, editOnMs: 1000, editMs: 100, exportMs: 5000 };

interface Metrics {
  turns: number;
  /** From the transcription response arriving to the transcript painted. */
  renderAfterRunMs: number;
  /** After a reload: from the page starting to load to the "Last transcript" banner (load + check). */
  startupMs: number;
  /** From clicking Open on that banner to the transcript painted. */
  renderOnOpenMs: number;
  scroll: { frames: number; p95Ms: number; maxMs: number; over50Ms: number };
  rename: { meanMs: number; maxMs: number; allMs: number[] };
  /** From clicking Edit text to every turn painted as a text box. */
  editOnMs: number;
  edit: { meanMs: number; maxMs: number; allMs: number[] };
  exportMs: number;
  autosave: { putMs: number; getMs: number };
}

/** Times kept in the page: the response's arrival, the banner, and the first paint of the turn list. */
function installProbes(page: Page) {
  return page.addInitScript(() => {
    const perf: Record<string, number> = {};
    (window as unknown as { __perf: Record<string, number> }).__perf = perf;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args) {
      this.addEventListener('load', () => (perf.responseAt = performance.now()));
      return send.apply(this, args);
    };
    // The time after the next paint: a timeout queued from requestAnimationFrame runs after it.
    const afterPaint = (name: string) =>
      requestAnimationFrame(() => setTimeout(() => (perf[name] = performance.now())));
    new MutationObserver(() => {
      if (perf.bannerAt === undefined && document.querySelector('.last-transcript')) {
        perf.bannerAt = performance.now();
      }
      if (perf.listPainted === undefined && document.querySelector('ol.turn-list')) {
        perf.listPainted = -1; // pending
        afterPaint('listPainted');
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

const probe = (page: Page, name: string) =>
  page
    .waitForFunction(
      (n) => {
        const value = (window as unknown as { __perf: Record<string, number> }).__perf[n];
        return value !== undefined && value >= 0 ? value : null;
      },
      name,
      { timeout: 120_000 },
    )
    .then((handle) => handle.jsonValue() as Promise<number>);

const round = (ms: number) => Math.round(ms);

async function measure(page: Page): Promise<Metrics> {
  const body = readFileSync(LARGE_FIXTURE, 'utf8');
  await installProbes(page);
  await mockElevenLabs(page, async () => ({ status: 200, body }));

  // 1. Transcribe: the response arrives, the doc is built and saved, and the list is painted.
  await openApp(page);
  await goToGlossary(page);
  await run(page);
  const renderAfterRunMs = (await probe(page, 'listPainted')) - (await probe(page, 'responseAt'));
  const turns = await page.locator('li.turn').count();

  // 2. Scroll through the whole transcript, one step per frame.
  const scroll = await page.evaluate(async () => {
    window.scrollTo(0, 0);
    const deltas: number[] = [];
    const bottom = document.documentElement.scrollHeight - window.innerHeight;
    await new Promise<void>((resolve) => {
      let last = performance.now();
      const step = (now: number) => {
        deltas.push(now - last);
        last = now;
        if (window.scrollY >= bottom - 1) return resolve();
        window.scrollBy(0, 600);
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    deltas.shift();
    const sorted = [...deltas].sort((a, b) => a - b);
    return {
      frames: deltas.length,
      p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      maxMs: sorted.at(-1) ?? 0,
      over50Ms: deltas.filter((d) => d > 50).length,
    };
  });

  // 3. Rename Speaker 1, one keystroke at a time: input event → every turn relabelled and painted.
  const renameTimes = await page.evaluate(async () => {
    const input = document.querySelector<HTMLInputElement>('input[placeholder="Speaker 1"]')!;
    const afterPaint = () =>
      new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
    // Focus is its own event in real typing, so its re-render isn't counted as a keystroke.
    input.focus();
    await afterPaint();
    const times: number[] = [];
    // A realistic long name: once it is the longest name, each keystroke widens the speaker column.
    const full = 'Interviewer, Dr. Schmidt';
    for (let n = 1; n <= full.length; n++) {
      const name = full.slice(0, n);
      input.value = name;
      const start = performance.now();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await afterPaint();
      times.push(performance.now() - start);
    }
    return times;
  });
  await expect(
    page.locator('li.turn .speaker', { hasText: 'Interviewer, Dr. Schmidt' }).last(),
  ).toBeVisible();

  // 4. Edit text: from the click to every turn's text box painted.
  const editOnMs = await page.evaluate(async () => {
    const afterPaint = () =>
      new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
    const button = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Edit text',
    )!;
    const turns = document.querySelectorAll('li.turn').length;
    const start = performance.now();
    button.click();
    await afterPaint();
    while (document.querySelectorAll('li.turn textarea').length < turns) await afterPaint();
    return performance.now() - start;
  });

  // 5. Correct a turn in the middle, one keystroke at a time: input event → saved to the store and
  //    painted. The text gets longer than a line, so the box grows and the turns below it move.
  const editTimes = await page.evaluate(async () => {
    const boxes = document.querySelectorAll<HTMLTextAreaElement>('li.turn textarea');
    const box = boxes[Math.floor(boxes.length / 2)]!;
    const afterPaint = () =>
      new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
    // Focus is its own event in real typing, so its re-render isn't counted as a keystroke.
    box.focus();
    await afterPaint();
    const before = box.value;
    const times: number[] = [];
    const typed = ' — checked against the recording by Dr. Schmidt.';
    for (let n = 1; n <= typed.length; n++) {
      box.value = before + typed.slice(0, n);
      const start = performance.now();
      box.dispatchEvent(new Event('input', { bubbles: true }));
      await afterPaint();
      times.push(performance.now() - start);
    }
    return times;
  });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(
    page.locator('li.turn p.text', { hasText: 'checked against the recording by Dr. Schmidt.' }),
  ).toHaveCount(1);

  // 6. Export the .docx.
  const exportStart = Date.now();
  const downloading = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Download .docx' }).click();
  await downloading;
  const exportMs = Date.now() - exportStart;

  // 7. Autosave: write the saved doc again (what each save does) and read it back.
  const autosave = await page.evaluate(
    () =>
      new Promise<{ putMs: number; getMs: number }>((resolve, reject) => {
        const open = indexedDB.open('describe-v1');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const key = 'describe.v1.lastTranscript';
          const getStart = performance.now();
          const get = db.transaction('keyval').objectStore('keyval').get(key);
          get.onerror = () => reject(get.error);
          get.onsuccess = () => {
            const getMs = performance.now() - getStart;
            const putStart = performance.now();
            const tx = db.transaction('keyval', 'readwrite');
            tx.objectStore('keyval').put(get.result, key);
            tx.onerror = () => reject(tx.error);
            tx.oncomplete = () => {
              db.close();
              resolve({ putMs: performance.now() - putStart, getMs });
            };
          };
        };
      }),
  );

  // 8. Reload: the saved transcript is loaded and checked, then opened from the Setup banner.
  await reloadApp(page);
  const startupMs = await probe(page, 'bannerAt');
  const renderOnOpenMs = await page.evaluate(async () => {
    const perf = (window as unknown as { __perf: Record<string, number> }).__perf;
    const open = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Open')!;
    const start = performance.now();
    open.click();
    while (!(perf.listPainted && perf.listPainted > 0)) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return perf.listPainted - start;
  });

  return {
    turns,
    renderAfterRunMs: round(renderAfterRunMs),
    startupMs: round(startupMs),
    renderOnOpenMs: round(renderOnOpenMs),
    scroll: {
      frames: scroll.frames,
      p95Ms: round(scroll.p95Ms),
      maxMs: round(scroll.maxMs),
      over50Ms: scroll.over50Ms,
    },
    rename: {
      meanMs: round(renameTimes.reduce((a, b) => a + b, 0) / renameTimes.length),
      maxMs: round(Math.max(...renameTimes)),
      allMs: renameTimes.map(round),
    },
    editOnMs: round(editOnMs),
    edit: {
      meanMs: round(editTimes.reduce((a, b) => a + b, 0) / editTimes.length),
      maxMs: round(Math.max(...editTimes)),
      allMs: editTimes.map(round),
    },
    exportMs,
    autosave: { putMs: round(autosave.putMs), getMs: round(autosave.getMs) },
  };
}

function report(testInfo: TestInfo, label: string, m: Metrics) {
  const lines = [
    `${label}: ${m.turns} turns`,
    `  render after transcription  ${m.renderAfterRunMs} ms   (target < ${TARGETS.renderMs})`,
    `  startup to banner           ${m.startupMs} ms`,
    `  render on Open              ${m.renderOnOpenMs} ms   (target < ${TARGETS.renderMs})`,
    `  scroll                      ${m.scroll.frames} frames, p95 ${m.scroll.p95Ms} ms, max ${m.scroll.maxMs} ms, ${m.scroll.over50Ms} over 50 ms`,
    `  rename (per keystroke)      mean ${m.rename.meanMs} ms, max ${m.rename.maxMs} ms   (target < ${TARGETS.renameMs}; ${m.rename.allMs.join(', ')})`,
    `  edit text on                ${m.editOnMs} ms   (target < ${TARGETS.editOnMs})`,
    `  edit (per keystroke)        mean ${m.edit.meanMs} ms, max ${m.edit.maxMs} ms   (target < ${TARGETS.editMs}; ${m.edit.allMs.join(', ')})`,
    `  export .docx                ${m.exportMs} ms   (target < ${TARGETS.exportMs})`,
    `  autosave                    put ${m.autosave.putMs} ms, get ${m.autosave.getMs} ms`,
  ];
  // The numbers are the point of this spec, so they go to the terminal as well as the report.
  process.stdout.write(`${lines.join('\n')}\n`);
  testInfo.annotations.push({ type: 'perf', description: lines.join('\n') });
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  if (!existsSync(LARGE_FIXTURE)) {
    throw new Error(
      'fixtures/large/large-3h.json is missing. Run: node scripts/make-large-fixture.mjs',
    );
  }
});

test('a 3-hour transcript meets the targets', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const m = await measure(page);
  report(testInfo, '1× CPU', m);
  expect(m.turns).toBeGreaterThan(2000);
  expect(m.renderAfterRunMs).toBeLessThan(TARGETS.renderMs);
  expect(m.renderOnOpenMs).toBeLessThan(TARGETS.renderMs);
  expect(m.rename.maxMs).toBeLessThan(TARGETS.renameMs);
  expect(m.editOnMs).toBeLessThan(TARGETS.editOnMs);
  expect(m.edit.maxMs).toBeLessThan(TARGETS.editMs);
  expect(m.exportMs).toBeLessThan(TARGETS.exportMs);
});

test('a 3-hour transcript on a 4× slower CPU (reported only)', async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  report(testInfo, '4× CPU throttling', await measure(page));
});

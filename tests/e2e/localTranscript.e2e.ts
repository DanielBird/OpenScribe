import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import JSZip from 'jszip';
import { projectFiles } from '../../src/testing/projectSeed';
import {
  enterProject,
  expect,
  goToGlossary,
  mockElevenLabs,
  ok,
  openApp,
  openHome,
  reloadApp,
  run,
  test,
  useProjectFolder,
} from './helpers';
import { germanSession } from './sessionDocs';

// A transcript made on the computer (provider 'local', DECISIONS.md D52) opens in the HTML file: on Output, in the
// export and in a project folder. The web build never transcribes locally, so these transcripts are seeded.

const LOCAL = { provider: 'local', model: 'nvidia-parakeet-nemotron-1' } as const;

/** Rewrites the saved transcript's engine to `LOCAL`, as a desktop build would have saved it. */
const makeSavedTranscriptLocal = (page: Page) =>
  page.evaluate(
    (engine) =>
      new Promise<boolean>((resolve) => {
        const open = indexedDB.open('describe-v1');
        open.onerror = () => resolve(false);
        open.onsuccess = () => {
          const db = open.result;
          const store = db.transaction('keyval', 'readwrite').objectStore('keyval');
          const key = 'describe.v1.lastTranscript';
          const get = store.get(key);
          get.onsuccess = () => {
            const doc = get.result as { request: Record<string, unknown> } | undefined;
            if (!doc) return resolve(false);
            doc.request = { ...doc.request, ...engine, zeroRetention: false, keyterms: [] };
            const put = store.put(doc, key);
            put.onsuccess = () => {
              db.close();
              resolve(true);
            };
            put.onerror = () => resolve(false);
          };
          get.onerror = () => resolve(false);
        };
      }),
    LOCAL,
  );

test('a transcript made on this computer opens on Output and exports with its engine', async ({
  page,
}, testInfo) => {
  await mockElevenLabs(page, () => ok(0, 'three-speakers-en'));
  await openApp(page);
  await goToGlossary(page);
  await run(page);
  await expect(page.locator('li.turn').first()).toBeVisible();
  await expect.poll(() => makeSavedTranscriptLocal(page)).toBe(true);

  await reloadApp(page);
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Output' })).toBeFocused();
  await expect(page.locator('li.turn').first()).toContainText(
    'Thanks for joining the review today.',
  );

  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx' }).click();
  const path = testInfo.outputPath((await downloading).suggestedFilename());
  await (await downloading).saveAs(path);
  const xml = await (
    await JSZip.loadAsync(readFileSync(path))
  )
    .file('word/document.xml')!
    .async('string');
  expect(xml).toContain('On this computer (nvidia-parakeet-nemotron-1)');
  expect(xml).toContain('Thanks for joining the review today.');
});

test('a project session made on this computer is read, not reported as unreadable', async ({
  page,
}) => {
  const doc = germanSession(7);
  const local = { ...doc, request: { ...doc.request, ...LOCAL } };
  await useProjectFolder(page, { 'Hearing at home': projectFiles([local]) });
  await openHome(page);
  await enterProject(page);
  await page.getByRole('button', { name: 'Open project…' }).click();
  await expect(page.getByRole('heading', { name: /^Sessions/ })).toBeVisible();

  await expect(page.locator('li.session')).toHaveCount(1);
  await expect(page.locator('li.session')).toContainText('P07 Hamburg home visit');
  await expect(page.getByText("couldn't be read")).toHaveCount(0);
});

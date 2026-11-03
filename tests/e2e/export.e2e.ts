import { readFileSync, statSync } from 'node:fs';
import type { Download, Page, TestInfo } from '@playwright/test';
import JSZip from 'jszip';
import {
  expect,
  fixture,
  goToGlossary,
  mockElevenLabs,
  ok,
  openApp,
  reloadApp,
  run,
  test,
} from './helpers';

const downloadButton = (page: Page) => page.getByRole('button', { name: 'Download .docx' });
const versionDialog = (page: Page) => page.getByRole('dialog', { name: 'Which version?' });

/** Transcribes the test recording, answered with the `fixture` response. */
async function transcribe(page: Page, fixture: string) {
  await mockElevenLabs(page, () => ok(0, fixture));
  await openApp(page);
  await goToGlossary(page);
  await run(page);
  await expect(page.locator('li.turn').first()).toBeVisible();
}

/** Transcribes the test recording, answered with the German fixture without its `language_code`. */
async function transcribeWithoutLanguageCode(page: Page, language?: string) {
  const { language_code: _omitted, ...response } = JSON.parse(fixture('two-speakers-short')) as {
    language_code: string;
  };
  await mockElevenLabs(page, async () => ({ status: 200, body: JSON.stringify(response) }));
  await openApp(page);
  if (language) {
    const options = page.getByRole('heading', { level: 2, name: 'Options' }).getByRole('button');
    await options.click();
    await page.getByLabel('Language').selectOption(language);
  }
  await goToGlossary(page);
  await run(page);
  await expect(page.locator('li.turn').first()).toBeVisible();
}

/** Saves the download under the test's output folder (kept for a look in Word) and returns its XML. */
async function saveAndRead(download: Download, testInfo: TestInfo) {
  const path = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  const zip = await JSZip.loadAsync(readFileSync(path));
  return { size: statSync(path).size, xml: await zip.file('word/document.xml')!.async('string') };
}

/** Adds an English translation of every turn to the saved transcript, without calling an LLM. */
const addSavedTranslation = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const open = indexedDB.open('describe-v1');
        open.onerror = () => resolve(false);
        open.onsuccess = () => {
          const db = open.result;
          const store = db.transaction('keyval', 'readwrite').objectStore('keyval');
          const key = 'describe.v1.lastTranscript';
          const get = store.get(key);
          get.onsuccess = () => {
            const doc = get.result as
              { turns: { id: string }[]; translations: Record<string, unknown> } | undefined;
            if (!doc) return resolve(false);
            const texts = Object.fromEntries(doc.turns.map((t) => [t.id, `English ${t.id}.`]));
            doc.translations = {
              en: {
                provider: 'claude',
                model: 'claude-opus-5-5',
                createdAt: '2026-10-13T12:30:00Z',
                texts,
              },
            };
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
  );

/** A German transcript with a saved translation, reopened from Setup's banner. */
async function openTranslatedTranscript(page: Page) {
  await transcribe(page, 'two-speakers-short');
  await expect.poll(() => addSavedTranslation(page)).toBe(true);
  await reloadApp(page);
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Output' })).toBeFocused();
}

test('downloads the transcript as .docx with the renamed speakers', async ({ page }, testInfo) => {
  await transcribe(page, 'three-speakers-en');
  await page.getByRole('textbox', { name: 'Name for Speaker 1' }).fill('Host');

  const downloading = page.waitForEvent('download');
  await downloadButton(page).click();
  const download = await downloading;
  await expect(versionDialog(page)).toBeHidden();

  expect(download.suggestedFilename()).toBe('tone-5s - transcript (English).docx');
  const { size, xml } = await saveAndRead(download, testInfo);
  expect(size).toBeGreaterThan(5 * 1024);
  expect(xml).toContain('Transcript – tone-5s');
  expect(xml).toContain('>Host: </w:t>');
  expect(xml).toContain('Thanks for joining the review today.');
  expect(xml).not.toContain('Speaker 1');
  await expect(downloadButton(page)).toBeFocused();
});

test('with a translation, asks which version and exports English', async ({ page }, testInfo) => {
  await openTranslatedTranscript(page);
  await downloadButton(page).click();

  const dialog = versionDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Original (German)' })).toBeChecked();
  await dialog.getByRole('radio', { name: 'English translation' }).check();
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download' }).click();
  const download = await downloading;

  expect(download.suggestedFilename()).toBe('tone-5s - transcript (English).docx');
  const { xml } = await saveAndRead(download, testInfo);
  expect(xml).toContain('English t1.');
  expect(xml).toContain('English (translated from German with Claude, claude-opus-5-5)');
  expect(xml).not.toContain('Guten Tag');
  await expect(dialog).toBeHidden();
  await expect(downloadButton(page)).toBeFocused();
});

test('with a translation, Escape cancels and Original exports German', async ({
  page,
}, testInfo) => {
  await openTranslatedTranscript(page);
  const downloads: Download[] = [];
  page.on('download', (d) => downloads.push(d));

  await downloadButton(page).click();
  await expect(versionDialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(versionDialog(page)).toBeHidden();
  await expect(downloadButton(page)).toBeFocused();

  await downloadButton(page).click();
  const downloading = page.waitForEvent('download');
  await versionDialog(page).getByRole('button', { name: 'Download' }).click();
  const download = await downloading;
  expect(downloads).toHaveLength(1);

  expect(download.suggestedFilename()).toBe('tone-5s - transcript (German).docx');
  const { xml } = await saveAndRead(download, testInfo);
  expect(xml).toContain('Guten Tag und willkommen zu unserem Gespräch.');
  expect(xml).toContain('German (detected)');
});

test('a response without a language code exports without one under Auto, on screen too (audit BUG-11)', async ({
  page,
}, testInfo) => {
  await transcribeWithoutLanguageCode(page);
  await expect(page.locator('.transcript-header dt')).toHaveText([
    'Duration',
    'Speakers',
    'Transcribed',
  ]);

  const downloading = page.waitForEvent('download');
  await downloadButton(page).click();
  const download = await downloading;

  expect(download.suggestedFilename()).toBe('tone-5s - transcript.docx');
  const { xml } = await saveAndRead(download, testInfo);
  expect(xml).toContain('Guten Tag und willkommen zu unserem Gespräch.');
  expect(xml).toContain('>Speakers: </w:t>');
  expect(xml).not.toContain('>Language: </w:t>');
  expect(xml).not.toContain('(detected)');
});

test('a response without a language code takes the language chosen on Setup', async ({
  page,
}, testInfo) => {
  await transcribeWithoutLanguageCode(page, 'de');
  await expect(page.locator('.transcript-header')).toContainText('German');

  const downloading = page.waitForEvent('download');
  await downloadButton(page).click();
  const download = await downloading;

  expect(download.suggestedFilename()).toBe('tone-5s - transcript (German).docx');
  const { xml } = await saveAndRead(download, testInfo);
  expect(xml).toContain('>Language: </w:t>');
  expect(xml).toContain('>German</w:t>');
});

import { readFileSync } from 'node:fs';
import type { Download, Page, TestInfo } from '@playwright/test';
import JSZip from 'jszip';
import {
  expect,
  goToGlossary,
  mockAnthropic,
  mockElevenLabs,
  ok,
  openApp,
  reloadApp,
  savedTurnText,
  run,
  test,
} from './helpers';

// Edit text on the Output step (Phase 9, DECISIONS D19): each turn's text becomes a box. Edits are
// saved, exported and left out of an existing English translation.

const T1 = 'Guten Tag und willkommen zu unserem Gespräch.';

const editButton = (page: Page) => page.getByRole('button', { name: 'Edit text' });
const doneButton = (page: Page) => page.getByRole('button', { name: 'Done' });
const versions = (page: Page) => page.getByRole('group', { name: 'Version' });
/** A turn's text box, named after its speaker and time, e.g. "Speaker 1, 00:00:00". */
const box = (page: Page, name: string) => page.getByRole('textbox', { name, exact: true });
const shownTexts = (page: Page) => page.locator('li.turn p.text');

/** Transcribes the German test recording; its audio is attached, so timestamps play. */
async function transcribe(page: Page) {
  await mockElevenLabs(page, () => ok());
  await openApp(page);
  await goToGlossary(page);
  await run(page);
  await expect(page.locator('li.turn')).toHaveCount(5);
}

/** Downloads the .docx (choosing `version` when asked) and returns its document XML. */
async function downloadDocx(page: Page, testInfo: TestInfo, version?: string) {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx' }).click();
  if (version) {
    const dialog = page.getByRole('dialog', { name: 'Which version?' });
    await dialog.getByRole('radio', { name: version }).check();
    await dialog.getByRole('button', { name: 'Download' }).click();
  }
  const download: Download = await downloading;
  const path = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  const zip = await JSZip.loadAsync(readFileSync(path));
  return zip.file('word/document.xml')!.async('string');
}

/** Where each turn's timestamp, speaker and text are, relative to the page. */
const turnLayout = (page: Page) =>
  page.locator('li.turn').evaluateAll((items) =>
    items.map((li) =>
      ['.timestamp', '.speaker', '.text'].map((part) => {
        const box = li.querySelector(part)!.getBoundingClientRect();
        return [box.left, box.top + window.scrollY, box.width, box.height];
      }),
    ),
  );

for (const width of [1280, 375]) {
  test(`turning Edit text on and off moves nothing (${width}px wide)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await mockElevenLabs(page, () => ok(0, 'three-speakers-en'));
    await openApp(page);
    await goToGlossary(page);
    await run(page);
    // Output opens before the transcript arrives.
    await expect(page.locator('li.turn')).toHaveCount(8);
    const before = await turnLayout(page);

    await editButton(page).click();
    await expect(page.locator('li.turn textarea')).toHaveCount(before.length);
    expect(await turnLayout(page)).toEqual(before);

    await doneButton(page).click();
    await expect(page.locator('li.turn textarea')).toHaveCount(0);
    expect(await turnLayout(page)).toEqual(before);
  });
}

test('an edit is saved and still there after a reload', async ({ page }) => {
  await transcribe(page);
  await editButton(page).click();
  // The same button, now labelled Done, keeps focus.
  await expect(doneButton(page)).toBeFocused();
  await expect(page.getByRole('textbox', { name: /, 00:00:\d\d$/ })).toHaveCount(5);
  const first = box(page, 'Speaker 1, 00:00:00');
  await expect(first).toHaveValue(T1);

  await first.fill('Guten Tag und willkommen bei Oticon.');
  await doneButton(page).click();
  await expect(shownTexts(page).first()).toHaveText('Guten Tag und willkommen bei Oticon.');
  await expect(page.locator('li.turn')).toHaveCount(5);
  await expect.poll(() => savedTurnText(page, 't1')).toBe('Guten Tag und willkommen bei Oticon.');

  await reloadApp(page);
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(shownTexts(page).first()).toHaveText('Guten Tag und willkommen bei Oticon.');
  await expect(editButton(page)).toBeVisible();
});

test('Enter finishes a turn, Tab goes on from it, and Escape puts the text back', async ({
  page,
}) => {
  await transcribe(page);
  await editButton(page).click();
  const first = box(page, 'Speaker 1, 00:00:00');

  // Clicking a box places the caret; it doesn't play. Space types a space.
  await first.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Willkommen!');
  await expect(page.locator('li.turn[aria-current="true"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.querySelector('audio')!.paused)).toBe(true);

  await page.keyboard.press('Enter');
  await expect(first).not.toBeFocused();
  await expect(first).toHaveValue(`${T1} Willkommen!`);

  // Tab goes on from the turn just finished: the next turn's timestamp, then its box.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Play from 00:00:03' })).toBeFocused();
  await page.keyboard.press('Tab');
  const second = box(page, 'Speaker 2, 00:00:03');
  await expect(second).toBeFocused();

  const before = await second.inputValue();
  await page.keyboard.type(' Nein.');
  await page.keyboard.press('Escape');
  await expect(second).not.toBeFocused();
  await expect(second).toHaveValue(before);

  await doneButton(page).click();
  await expect(shownTexts(page).first()).toHaveText(`${T1} Willkommen!`);
  await expect(shownTexts(page).nth(1)).toHaveText(before);
});

test('a pasted multi-line text becomes one line, and Ctrl+Z undoes the paste', async ({ page }) => {
  await transcribe(page);
  await editButton(page).click();
  const first = box(page, 'Speaker 1, 00:00:00');
  await first.click();
  await page.keyboard.press('End');

  await first.evaluate((el) => {
    const data = new DataTransfer();
    data.setData('text/plain', ' one\ntwo\r\n\r\nthree');
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect(first).toHaveValue(`${T1} one two three`);

  // Undo is Cmd+Z on macOS.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(first).toHaveValue(T1);
});

test('the Word file has the text as typed', async ({ page }, testInfo) => {
  await transcribe(page);
  await editButton(page).click();
  await box(page, 'Speaker 2, 00:00:03').fill('Danke, ich bin gern hier.');

  // The download stays available while editing.
  const xml = await downloadDocx(page, testInfo);
  expect(xml).toContain('Danke, ich bin gern hier.');
  expect(xml).toContain(T1);
});

test('with a translation, editing shows the Original and leaves the English alone', async ({
  page,
}, testInfo) => {
  await mockAnthropic(page);
  await transcribe(page);
  await page.getByRole('button', { name: 'Translate to English' }).click();
  const dialog = page.getByRole('dialog', { name: 'Translate to English' });
  await dialog.getByLabel('Claude (Anthropic) API key').fill('test-key');
  await dialog.getByRole('button', { name: 'Translate', exact: true }).click();
  await expect(shownTexts(page).first()).toHaveText('English t1.');

  await editButton(page).click();
  await expect(box(page, 'Speaker 1, 00:00:00')).toHaveValue(T1);
  await expect(page.locator('ol.turn-list')).toHaveAttribute('lang', 'de');
  await expect(versions(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Re-translate…' })).toBeHidden();

  await box(page, 'Speaker 1, 00:00:00').fill('Guten Tag.');
  await doneButton(page).click();
  await expect(versions(page)).toBeVisible();
  // The English of the edited turn is now out of date (DECISIONS.md D39).
  await expect(page.getByRole('button', { name: 'Update English…' })).toBeVisible();
  await expect(shownTexts(page).first()).toHaveText('Guten Tag.');
  await versions(page).getByRole('button', { name: 'English' }).click();
  await expect(shownTexts(page).first()).toHaveText('English t1.');
  await expect(page.locator('li.turn').first()).toContainText('Changed since translation');

  const english = await downloadDocx(page, testInfo, 'English translation');
  expect(english).toContain('English t1.');
  expect(english).not.toContain('Guten Tag.');
  const original = await downloadDocx(page, testInfo, 'Original (German)');
  expect(original).toContain('Guten Tag.');
  expect(original).not.toContain(T1);
});

import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { enterKey, expect, openApp, reloadApp, test } from './helpers';

const TONE_WAV = fileURLToPath(new URL('../../fixtures/audio/tone-5s.wav', import.meta.url));

/** The acceptance paste: 4 new terms and one case-insensitive duplicate. */
const PASTE = 'Oticon\nPhilips; hearing aid, Hörgerät\n\n oticon ';
const TERMS = ['Oticon', 'Philips', 'hearing aid', 'Hörgerät'];

const addBox = (page: Page) => page.getByLabel('Add terms');
const addButton = (page: Page) => page.getByRole('button', { name: 'Add', exact: true });
const termTexts = (page: Page) => page.locator('li.chip .chip-term');
const editBox = (page: Page) => page.getByRole('textbox', { name: 'Edit term' });
const status = (page: Page) => page.getByRole('status');
const emptyState = (page: Page) => page.getByText('A glossary is optional');
const storedTerms = (page: Page) =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem('describe.v1.glossary') ?? 'null') as unknown,
  );

/** Completes Setup (the key survives a reload; the file has to be chosen again) and opens Glossary. */
async function goToGlossary(page: Page) {
  if (await page.getByRole('button', { name: 'Open Settings' }).isVisible()) await enterKey(page);
  await page.locator('input[type="file"]').setInputFiles(TONE_WAV);
  await expect(page.getByText('00:00:05')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Glossary' })).toBeFocused();
}

async function addTerms(page: Page, text: string) {
  await addBox(page).fill(text);
  await addButton(page).click();
}

test('pasted terms are added, saved, and identical after a reload', async ({ page }) => {
  await openApp(page);
  await goToGlossary(page);
  await expect(emptyState(page)).toBeVisible();

  await addTerms(page, PASTE);
  // Announced to screen readers only (the region is visually hidden).
  await expect(status(page)).toHaveText('Added 4 · skipped 1 duplicate');
  await expect(addBox(page)).toHaveValue('');
  await expect(page.getByRole('heading', { name: '4 terms' })).toBeVisible();
  await expect(termTexts(page)).toHaveText(TERMS);
  expect(await storedTerms(page)).toEqual(TERMS);

  await reloadApp(page);
  await goToGlossary(page);
  await expect(termTexts(page)).toHaveText(TERMS);
});

test('mouse edits, deletes and Clear all are saved at once', async ({ page }) => {
  await openApp(page);
  await goToGlossary(page);
  await addTerms(page, PASTE);

  // Click the term text to edit; clicking elsewhere (blur) saves.
  await termTexts(page).filter({ hasText: 'hearing aid' }).click();
  await expect(editBox(page)).toBeFocused();
  await editBox(page).fill('hearing aids');
  await page.getByRole('heading', { name: '4 terms' }).click();
  await expect(editBox(page)).toHaveCount(0);
  expect(await storedTerms(page)).toEqual(['Oticon', 'Philips', 'hearing aids', 'Hörgerät']);

  // A duplicate keeps the row in edit mode with an error.
  await page.getByRole('button', { name: 'Edit term Philips' }).click();
  await editBox(page).fill('OTICON');
  await editBox(page).press('Enter');
  await expect(page.getByText('That term is already in the list.')).toBeVisible();
  await expect(editBox(page)).toHaveAttribute('aria-invalid', 'true');
  await editBox(page).press('Escape');
  await expect(editBox(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Delete term Oticon' }).click();
  expect(await storedTerms(page)).toEqual(['Philips', 'hearing aids', 'Hörgerät']);

  await page.getByRole('button', { name: 'Clear all' }).click();
  const dialog = page.getByRole('dialog', { name: 'Clear the glossary?' });
  await expect(dialog).toContainText("Remove all 3 terms? This can't be undone.");
  await dialog.getByRole('button', { name: 'Remove all' }).click();
  await expect(dialog).toBeHidden();
  await expect(emptyState(page)).toBeVisible();
  expect(await storedTerms(page)).toEqual([]);
});

test('works from the keyboard: add, edit, delete and clear', async ({ page }) => {
  await openApp(page);
  await goToGlossary(page);

  // Add with Ctrl+Enter.
  await addBox(page).focus();
  await page.keyboard.type('Oticon, Philips, Demant');
  await page.keyboard.press('Control+Enter');
  await expect(termTexts(page)).toHaveText(['Oticon', 'Philips', 'Demant']);

  // Edit: Enter on the Edit button, type (the old text is selected), Enter saves.
  await page.getByRole('button', { name: 'Edit term Philips' }).focus();
  await page.keyboard.press('Enter');
  await expect(editBox(page)).toBeFocused();
  await page.keyboard.type('Philips Hue');
  await page.keyboard.press('Enter');
  await expect(editBox(page)).toHaveCount(0);
  const editHue = page.getByRole('button', { name: 'Edit term Philips Hue' });
  await expect(editHue).toBeFocused();
  expect(await storedTerms(page)).toEqual(['Oticon', 'Philips Hue', 'Demant']);

  // Escape cancels the edit.
  await page.keyboard.press('Enter');
  await expect(editBox(page)).toBeFocused();
  await page.keyboard.type('Something else');
  await page.keyboard.press('Escape');
  await expect(editHue).toBeFocused();
  await expect(termTexts(page)).toHaveText(['Oticon', 'Philips Hue', 'Demant']);

  // Delete: Tab to the row's Delete button; focus moves to the next row's.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Delete term Philips Hue' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Delete term Demant' })).toBeFocused();
  expect(await storedTerms(page)).toEqual(['Oticon', 'Demant']);

  // Clear all: Escape cancels and returns focus to the button.
  const clearAll = page.getByRole('button', { name: 'Clear all' });
  const dialog = page.getByRole('dialog', { name: 'Clear the glossary?' });
  await clearAll.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(clearAll).toBeFocused();
  expect(await storedTerms(page)).toEqual(['Oticon', 'Demant']);

  // …and confirming removes everything.
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Remove all' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(emptyState(page)).toBeVisible();
  await expect(addBox(page)).toBeFocused();
  expect(await storedTerms(page)).toEqual([]);
});

test('terms ElevenLabs would reject are marked as skipped', async ({ page }) => {
  await openApp(page);
  await goToGlossary(page);
  const fifty = 'x'.repeat(50);
  const fortyNine = 'y'.repeat(49);
  await addTerms(page, ['Oticon', 'Foo [bar]', fifty, fortyNine].join('\n'));

  await expect(page.locator('li.chip.skipped .chip-term')).toHaveText(['Foo [bar]', fifty]);

  // The reasons open beneath the count.
  const summary = page.locator('details.skip-list summary');
  await expect(summary).toHaveText('2 terms will be skipped');
  await expect(page.getByText('contains < > { } [ ] or \\')).toBeHidden();
  await summary.click();
  await expect(page.getByText('contains < > { } [ ] or \\')).toBeVisible();
  await expect(page.getByText('50 characters or more')).toBeVisible();
});

// The clipboard is stubbed so that running the suite doesn't overwrite the developer's own clipboard
// (headless Chromium on Windows writes to the real one, converting \n to \r\n).
test.describe('Copy list', () => {
  test('puts the newline-separated terms on the clipboard', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { copied: string[] };
      w.copied = [];
      navigator.clipboard.writeText = (text: string) => {
        w.copied.push(text);
        return Promise.resolve();
      };
    });
    await openApp(page);
    await goToGlossary(page);
    await addTerms(page, PASTE);

    await page.getByRole('button', { name: 'Copy list' }).click();
    await expect(status(page)).toHaveText('Copied 4 terms.');
    const copied = await page.evaluate(() => (window as unknown as { copied: string[] }).copied);
    expect(copied).toEqual([TERMS.join('\n')]);
  });

  test('selects the list for Ctrl+C when the clipboard refuses', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.clipboard.writeText = () =>
        Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'));
    });
    await openApp(page);
    await goToGlossary(page);
    await addTerms(page, PASTE);

    await page.getByRole('button', { name: 'Copy list' }).click();
    const list = page.getByRole('textbox', { name: 'Glossary list' });
    await expect(list).toBeFocused();
    await expect(list).toHaveValue(TERMS.join('\n'));
    const selection = await list.evaluate((el: HTMLTextAreaElement) => [
      el.selectionStart,
      el.selectionEnd,
    ]);
    expect(selection).toEqual([0, TERMS.join('\n').length]);
    await expect(status(page)).toContainText('press Ctrl+C');

    await page.getByRole('button', { name: 'Close' }).click();
    await expect(list).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Copy list' })).toBeFocused();
  });
});

test('Back returns to Setup with its state intact; Run is enabled', async ({ page }) => {
  await openApp(page);
  await goToGlossary(page);
  // Running is covered in transcribe.e2e.ts.
  await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled();

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Setup' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Open Settings' })).toHaveCount(0);
  await expect(page.getByText('tone-5s.wav')).toBeVisible();
  await expect(page.getByText('00:00:05')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled();
});

test('the step buttons sit at the bottom of the window, and stay there on long pages', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const bottomGap = async () => {
    const box = await page.getByTestId('step-footer').boundingBox();
    return 720 - (box!.y + box!.height);
  };

  // Setup and an empty glossary are short: the bar sits at the bottom, above only the footer's Settings link.
  const expectAboveFooter = async () => {
    const gap = await bottomGap();
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(100);
  };
  await openApp(page);
  await expect(page.getByRole('button', { name: 'Next' })).toBeInViewport();
  await expectAboveFooter();
  await goToGlossary(page);
  await expectAboveFooter();

  // A long glossary: Run stays pinned to the bottom edge at the top of the page. (120 terms: pages are 80rem wide
  // since DECISIONS D24, and 60 short ones no longer fill the window.)
  await addTerms(page, Array.from({ length: 120 }, (_, i) => `term ${i}`).join('\n'));
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole('button', { name: 'Run' })).toBeInViewport();
  expect(Math.abs(await bottomGap())).toBeLessThan(2);
});

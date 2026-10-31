import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import JSZip from 'jszip';
import {
  englishFor,
  expect,
  goToGlossary,
  mockAnthropic,
  mockElevenLabs,
  mockGemini,
  ok,
  openApp,
  reloadApp,
  run,
  test,
  type LlmAnswer,
} from './helpers';

const translateButton = (page: Page) => page.getByRole('button', { name: 'Translate to English' });
const translateDialog = (page: Page) => page.getByRole('dialog', { name: 'Translate to English' });
const versions = (page: Page) => page.getByRole('group', { name: 'Version' });
const turnTexts = (page: Page) => page.locator('li.turn .text');
const turnHeads = (page: Page) =>
  page
    .locator('li.turn')
    .evaluateAll((items) =>
      items.map((li) => [
        li.querySelector('.timestamp')?.textContent?.trim(),
        li.querySelector('.speaker')?.textContent?.trim(),
      ]),
    );

/** Transcribes the test recording, answered with the `fixture` response. */
async function transcribe(page: Page, fixture = 'two-speakers-short') {
  await mockElevenLabs(page, () => ok(0, fixture));
  await openApp(page);
  await goToGlossary(page);
  await run(page);
  await expect(page.locator('li.turn').first()).toBeVisible();
}

/** Opens the dialog, enters the key for `provider` and starts the translation. */
async function translate(page: Page, provider: 'Claude' | 'Gemini' = 'Claude') {
  await translateButton(page).click();
  const dialog = translateDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: provider }).check();
  const company = provider === 'Claude' ? 'Anthropic' : 'Google';
  await dialog.getByLabel(`${provider} (${company}) API key`).fill('test-key');
  await expect(
    dialog.getByText(`Only the transcript text goes to ${company} (${provider})`),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Translate', exact: true }).click();
  await expect(dialog).toBeHidden();
}

test('translates a German transcript with Claude, switches versions and exports English', async ({
  page,
}, testInfo) => {
  const calls = await mockAnthropic(page);
  await transcribe(page);
  const heads = await turnHeads(page);
  await expect(turnTexts(page).first()).toHaveText('Guten Tag und willkommen zu unserem Gespräch.');

  await translate(page);

  await expect(versions(page).getByRole('button', { name: 'English' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(turnTexts(page)).toHaveText(
    ['t1', 't2', 't3', 't4', 't5'].map((id) => `English ${id}.`),
  );
  expect(await turnHeads(page)).toEqual(heads);
  await expect(page.locator('ol.turn-list')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'Re-translate…' })).toBeVisible();

  // One batch, sent the way the reference doc says: streamed, structured output, medium effort, fallback.
  expect(calls).toHaveLength(1);
  expect(calls[0]!.key).toBe('test-key');
  expect(calls[0]!.body).toMatchObject({
    model: 'claude-opus-5-5',
    stream: true,
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema' } },
  });
  expect(calls[0]!.input.segments.map((s) => s.id)).toEqual(['t1', 't2', 't3', 't4', 't5']);
  expect(calls[0]!.input.segments[0]!.speaker).toBe('Speaker 1');

  await versions(page).getByRole('button', { name: 'Original (German)' }).click();
  await expect(turnTexts(page).first()).toHaveText('Guten Tag und willkommen zu unserem Gespräch.');

  // The English export.
  await page.getByRole('button', { name: 'Download .docx' }).click();
  const choose = page.getByRole('dialog', { name: 'Which version?' });
  await choose.getByRole('radio', { name: 'English translation' }).check();
  const downloading = page.waitForEvent('download');
  await choose.getByRole('button', { name: 'Download' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('tone-5s - transcript (English).docx');
  const path = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  const xml = await (
    await JSZip.loadAsync(readFileSync(path))
  )
    .file('word/document.xml')!
    .async('string');
  expect(xml).toContain('English t1.');
  expect(xml).toContain('English (translated from German with Claude, claude-opus-5-5)');
  expect(xml).not.toContain('Guten Tag');
});

test('translates with Gemini and the chosen model', async ({ page }) => {
  const calls = await mockGemini(page);
  await transcribe(page);

  await translateButton(page).click();
  const dialog = translateDialog(page);
  await dialog.getByRole('radio', { name: 'Gemini' }).check();
  await dialog.getByLabel('Model').selectOption({ label: 'Gemini 3.6 Flash' });
  await dialog.getByLabel('Gemini (Google) API key').fill('test-key');
  await dialog.getByRole('checkbox', { name: "Don't show again" }).check();
  await dialog.getByRole('button', { name: 'Translate', exact: true }).click();

  await expect(turnTexts(page).first()).toHaveText('English t1.');
  expect(calls).toHaveLength(1);
  // Every Gemini request streams (DECISIONS.md T15).
  expect(calls[0]!.url).toContain('/models/gemini-3.6-flash:streamGenerateContent?alt=sse');
  expect(calls[0]!.key).toBe('test-key');
  expect(calls[0]!.url).not.toContain('test-key');

  // The next time, the dialog remembers Gemini and the model, has the key and skips the notice.
  await page.getByRole('button', { name: 'Re-translate…' }).click();
  await expect(dialog.getByRole('radio', { name: 'Gemini' })).toBeChecked();
  await expect(dialog.getByLabel('Model')).toHaveValue('gemini-3.6-flash');
  await expect(dialog.getByText('This replaces the English translation.')).toBeVisible();
  await expect(dialog.getByText('Only the transcript text')).toHaveCount(0);
  await expect(dialog.getByLabel('Gemini (Google) API key')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});

test('an incomplete batch is retried once, then Resume finishes without repeating batch 1', async ({
  page,
}) => {
  let failing = true;
  // Batch 2 (from t61) leaves out its first turn while `failing` is set.
  const answer: LlmAnswer = (call, n) => {
    const reply = englishFor(call, n) as { translations: { id: string }[] };
    const second = call.input.segments[0]!.id === 't61';
    return failing && second ? { translations: reply.translations.slice(1) } : reply;
  };
  const calls = await mockAnthropic(page, answer);
  await transcribe(page, 'many-turns');
  await expect(page.locator('li.turn')).toHaveCount(70);

  await translate(page);
  await expect(page.getByRole('alert')).toHaveText('Part of the translation came back incomplete.');
  await expect(page.getByRole('button', { name: 'Resume' })).toBeFocused();
  expect(calls.map((c) => c.input.segments[0]!.id)).toEqual(['t1', 't61', 't61']);
  await expect(versions(page)).toHaveCount(0); // nothing saved yet

  failing = false;
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(turnTexts(page).nth(69)).toHaveText('English t70.');
  await expect(turnTexts(page).first()).toHaveText('English t1.');
  expect(calls.map((c) => c.input.segments[0]!.id)).toEqual(['t1', 't61', 't61', 't61']);
  // Context for batch 2: the three turns before it, in the original language.
  expect(calls[3]!.input.context.map((c) => c.text)).toEqual([
    'Das ist Beitrag 58 im Gespräch.',
    'Das ist Beitrag 59 im Gespräch.',
    'Das ist Beitrag 60 im Gespräch.',
  ]);
});

test('Cancel aborts the request and saves nothing', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await mockAnthropic(page, async (call, n) => {
    await held;
    return englishFor(call, n);
  });
  await transcribe(page);

  const aborted = page.waitForEvent('requestfailed', (r) =>
    r.url().startsWith('https://api.anthropic.com/'),
  );
  await translate(page);
  await expect(page.getByText('Translating…')).toBeVisible();
  // The Translate button is gone while it runs; focus waits on the progress line.
  await expect(page.locator('.status-line')).toBeFocused();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await aborted;
  release();

  await expect(translateButton(page)).toBeFocused();
  await expect(versions(page)).toHaveCount(0);
  await expect(turnTexts(page).first()).toHaveText('Guten Tag und willkommen zu unserem Gespräch.');

  await reloadApp(page);
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(translateButton(page)).toBeVisible();
  await expect(versions(page)).toHaveCount(0);
});

test('the translation survives a reload', async ({ page }) => {
  await mockAnthropic(page);
  await transcribe(page);
  await translate(page);
  await expect(turnTexts(page).first()).toHaveText('English t1.');

  await reloadApp(page);
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(turnTexts(page).first()).toHaveText('Guten Tag und willkommen zu unserem Gespräch.');
  await versions(page).getByRole('button', { name: 'English' }).click();
  await expect(turnTexts(page).first()).toHaveText('English t1.');
  await expect(page.getByRole('button', { name: 'Re-translate…' })).toBeVisible();
});

test('an English transcript has no Translate button', async ({ page }) => {
  await transcribe(page, 'three-speakers-en');
  await expect(page.getByRole('button', { name: 'Download .docx' })).toBeVisible();
  await expect(translateButton(page)).toHaveCount(0);
  await expect(versions(page)).toHaveCount(0);
});

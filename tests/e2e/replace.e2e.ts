import { readFileSync } from 'node:fs';
import type { Download, Page, TestInfo } from '@playwright/test';
import JSZip from 'jszip';
import type { TranscriptDoc } from '../../src/domain/transcript';
import {
  clickInHeader,
  enterProject,
  expect,
  fixture,
  goToGlossary,
  mockAnthropic,
  mockElevenLabs,
  openApp,
  projectAnswer,
  reloadApp,
  run,
  test,
  useProjectFolder,
  type LlmAnswer,
} from './helpers';

// Find and replace names on Output (Phase 38, DECISIONS.md D59). ElevenLabs answers the German test fixture with
// "Anna" in three turns (in three cases) and "Annabel", which isn't a match, in the fourth.

const NAMED: Record<string, string> = {
  Tag: 'Anna',
  'Danke,': 'Anna,',
  Sie: 'anna',
  kleinen: 'Annabel',
};
const T1 = 'Guten Anna und willkommen zu unserem Gespräch.';
const T2 = 'Anna, ich freue mich sehr.';
const T3 = 'Wie lange arbeiten anna schon an dem Projekt?';
const T4 = 'Seit ungefähr zwei Jahren, gemeinsam mit einem Annabel Team.';
/** "Anna" as a whole word, in any case; not "Annabel". */
const ANNA = /\banna\b/i;

/** The two-speaker fixture with the words in NAMED replaced. */
function namedFixture(): string {
  const response = JSON.parse(fixture('two-speakers-short')) as {
    text: string;
    words: { text: string; type: string }[];
  };
  const words = response.words.map((w) =>
    w.type === 'word' && NAMED[w.text] ? { ...w, text: NAMED[w.text]! } : w,
  );
  return JSON.stringify({ ...response, words, text: words.map((w) => w.text).join('') });
}

const shownTexts = (page: Page) => page.locator('li.turn p.text');
const opener = (page: Page) => page.getByRole('button', { name: 'Find and replace…' });
const replaceDialog = (page: Page) => page.getByRole('dialog', { name: 'Find and replace' });
const versions = (page: Page) => page.getByRole('group', { name: 'Version' });

/** Transcribes the named recording and shows it on Output. */
async function transcribe(page: Page) {
  await mockElevenLabs(page, async () => ({ status: 200, body: namedFixture() }));
  await openApp(page);
  await goToGlossary(page);
  await run(page);
  await expect(page.locator('li.turn')).toHaveCount(5);
  await expect(shownTexts(page).first()).toHaveText(T1);
}

/** Opens the dialog, searches for `find` and fills Replace with. */
async function search(page: Page, find: string, replacement: string) {
  await opener(page).click();
  const dialog = replaceDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Find' }).fill(find);
  await dialog.getByRole('textbox', { name: 'Replace with' }).fill(replacement);
  return dialog;
}

/** Replace all, through its confirmation, then closes the dialog. */
async function replaceAll(page: Page, count: number) {
  const dialog = replaceDialog(page);
  await expect(dialog.getByRole('option')).toHaveCount(count);
  await dialog.getByRole('button', { name: 'Replace all' }).click();
  await expect(dialog.getByText(`Replace all ${count}?`)).toBeVisible();
  await dialog.getByRole('button', { name: 'Replace all' }).click();
  await expect(dialog.locator('.count')).toHaveText(`${count} replaced`);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

/** The autosaved transcript. */
const savedDoc = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<TranscriptDoc | null>((resolve) => {
        const open = indexedDB.open('describe-v1');
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          const get = db
            .transaction('keyval')
            .objectStore('keyval')
            .get('describe.v1.lastTranscript');
          get.onsuccess = () => {
            db.close();
            resolve((get.result as TranscriptDoc | undefined) ?? null);
          };
          get.onerror = () => resolve(null);
        };
      }),
  );

/** Every word of the doc's turns, as text. */
const wordsOf = (doc: TranscriptDoc) => doc.turns.flatMap((t) => t.words.map((w) => w.text));

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

test('step through with Next and Replace, then Replace all; it is saved, and in the Word file', async ({
  page,
}, testInfo) => {
  await transcribe(page);

  // The name selected in the first turn fills Find.
  await shownTexts(page)
    .first()
    .evaluate((p) => {
      const range = document.createRange();
      range.setStart(p.firstChild!, 6);
      range.setEnd(p.firstChild!, 10);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
    });
  await opener(page).click();
  const dialog = replaceDialog(page);
  const find = dialog.getByRole('textbox', { name: 'Find' });
  await expect(find).toBeFocused();
  await expect(find).toHaveValue('Anna');
  await expect(dialog.locator('.count')).toHaveText('1 of 3');
  await expect(dialog.getByRole('option')).toHaveText([
    /Speaker 1.*Guten Anna und/,
    /Speaker 2.*Anna, ich freue/,
    /Speaker 1.*arbeiten anna schon/,
  ]);
  await expect(dialog.getByRole('button', { name: 'Replace', exact: true })).toBeDisabled();

  // Next, then Replace the second: it leaves the list, and the third is current. The first, skipped, stays.
  await dialog.getByRole('textbox', { name: 'Replace with' }).fill('Participant 1');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.locator('.count')).toHaveText('2 of 3');
  await dialog.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(dialog.getByRole('option')).toHaveCount(2);
  await expect(dialog.locator('.count')).toHaveText('2 of 2');
  await expect(dialog.getByRole('option', { selected: true })).toContainText('arbeiten anna');
  await expect(shownTexts(page).nth(1)).toHaveText('Participant 1, ich freue mich sehr.');

  // Replace all asks first; Cancel changes nothing.
  await dialog.getByRole('button', { name: 'Replace all' }).click();
  await expect(dialog.getByText('Replace all 2?')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog.getByRole('button', { name: 'Replace all' })).toBeFocused();
  await expect(shownTexts(page).first()).toHaveText(T1);

  await dialog.getByRole('button', { name: 'Replace all' }).click();
  await dialog.getByRole('button', { name: 'Replace all' }).click();
  await expect(dialog.locator('.count')).toHaveText('3 replaced');
  await expect(dialog.getByRole('option')).toHaveCount(0);
  await expect(find).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener(page)).toBeFocused();

  const replaced = [
    'Guten Participant 1 und willkommen zu unserem Gespräch.',
    'Participant 1, ich freue mich sehr.',
    'Wie lange arbeiten Participant 1 schon an dem Projekt?',
    T4,
  ];
  await expect(shownTexts(page)).toHaveText([...replaced, /^Was war bisher/]);
  await expect(page.locator('li.turn')).toHaveCount(5);
  await expect(page.locator('li.turn .speaker')).toHaveText([
    'Speaker 1',
    'Speaker 2',
    'Speaker 1',
    'Speaker 2',
    'Speaker 1',
  ]);

  // The words are saved without the name too.
  await expect.poll(async () => (await savedDoc(page))?.turns[0]?.text).toBe(replaced[0]);
  const saved = (await savedDoc(page))!;
  expect(wordsOf(saved).filter((w) => ANNA.test(w))).toEqual([]);
  expect(wordsOf(saved)).toContain('Participant 1,');
  expect(wordsOf(saved)).toContain('Annabel');

  await reloadApp(page);
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(shownTexts(page)).toHaveText([...replaced, /^Was war bisher/]);

  const xml = await downloadDocx(page, testInfo);
  expect(xml).toContain('Participant 1, ich freue mich sehr.');
  expect(xml).not.toMatch(ANNA);
  expect(xml).toContain('Annabel');
});

test('the keyboard reaches everything: Enter is Next, the list is one Tab stop, Escape returns focus', async ({
  page,
}) => {
  await transcribe(page);
  await opener(page).focus();
  await page.keyboard.press('Enter');
  const dialog = replaceDialog(page);
  await expect(dialog.getByRole('textbox', { name: 'Find' })).toBeFocused();

  // Enter straight after typing searches at once; then it is Next.
  await page.keyboard.type('anna');
  await page.keyboard.press('Enter');
  await expect(dialog.locator('.count')).toHaveText('1 of 3');
  await page.keyboard.press('Enter');
  await expect(dialog.locator('.count')).toHaveText('2 of 3');

  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('textbox', { name: 'Replace with' })).toBeFocused();
  await page.keyboard.type('P1');
  await page.keyboard.press('Enter');
  await expect(dialog.locator('.count')).toHaveText('3 of 3');

  // The list: one Tab stop on the current match; the arrow keys move, Enter makes it current.
  await page.keyboard.press('Tab');
  const options = dialog.getByRole('option');
  await expect(options.nth(2)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(options.nth(0)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog.locator('.count')).toHaveText('1 of 3');

  // Replace, the one filled button, comes last; Close is the × before the fields.
  for (const name of ['Next', 'Replace all', 'Replace']) {
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name, exact: true })).toBeFocused();
  }
  await dialog.getByLabel('Find', { exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener(page)).toBeFocused();
});

test('in the English view it changes only the English; in the Original it makes the English out of date', async ({
  page,
}, testInfo) => {
  const english: LlmAnswer = (call) => ({
    translations: call.input.segments.map((s) => ({
      id: s.id,
      text: s.id === 't5' ? 'What has been hardest?' : `Thank you, Anna (${s.id}).`,
    })),
  });
  await mockAnthropic(page, english);
  await transcribe(page);
  await page.getByRole('button', { name: 'Translate to English' }).click();
  const translate = page.getByRole('dialog', { name: 'Translate to English' });
  await translate.getByLabel('Claude (Anthropic) API key').fill('test-key');
  await translate.getByRole('button', { name: 'Translate', exact: true }).click();
  await expect(shownTexts(page).first()).toHaveText('Thank you, Anna (t1).');

  const dialog = await search(page, 'Anna', 'P1');
  await expect(dialog.getByText('In the English translation')).toBeVisible();
  await replaceAll(page, 4);
  await expect(shownTexts(page).first()).toHaveText('Thank you, P1 (t1).');
  await expect(page.getByText('Changed since translation')).toHaveCount(0);

  const englishXml = await downloadDocx(page, testInfo, 'English translation');
  expect(englishXml).toContain('Thank you, P1 (t4).');
  expect(englishXml).not.toMatch(ANNA);
  const originalXml = await downloadDocx(page, testInfo, 'Original (German)');
  expect(originalXml).toContain(T1);
  expect(originalXml).toContain(T2);
  expect(originalXml).toContain(T3);

  // In the Original: the three turns with the name are out of date in the English view; Annabel's isn't.
  await versions(page).getByRole('button', { name: 'Original' }).click();
  await expect(shownTexts(page).first()).toHaveText(T1);
  const original = await search(page, 'Anna', 'P1');
  await expect(original.getByText('In the English translation')).toHaveCount(0);
  await replaceAll(page, 3);
  await expect(shownTexts(page).nth(2)).toHaveText('Wie lange arbeiten P1 schon an dem Projekt?');
  await expect(page.getByRole('button', { name: 'Update English…' })).toBeVisible();
  await versions(page).getByRole('button', { name: 'English' }).click();
  const turns = page.locator('li.turn');
  for (const i of [0, 1, 2]) await expect(turns.nth(i)).toContainText('Changed since translation');
  for (const i of [3, 4]) await expect(turns.nth(i)).not.toContainText('Changed since translation');
  await expect(shownTexts(page).first()).toHaveText('Thank you, P1 (t1).');
});

test('in a project, the session file loses the name from its text and words, and the summary goes out of date', async ({
  page,
}) => {
  const ROOT = 'Hearing at home';
  const folder = await useProjectFolder(page, { [ROOT]: {} });
  await mockAnthropic(page, projectAnswer);
  await transcribe(page);

  await page.getByRole('button', { name: 'Add to project…' }).click();
  await page
    .getByRole('dialog', { name: 'Add to project' })
    .getByRole('button', { name: 'New project…' })
    .click();
  const brief = page.getByRole('dialog', { name: 'Brief' });
  await brief.getByRole('button', { name: 'Save' }).click();
  await expect(brief).toBeHidden();
  const add = page.getByRole('dialog', { name: `Add to ${ROOT}` });
  await add.getByRole('checkbox').check();
  await add.getByLabel('Claude (Anthropic) API key').fill('test-key');
  await add.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText(`In ${ROOT}`)).toBeVisible();

  // The work is done once Find and replace is offered again; the view is English after the translation.
  await expect(opener(page)).toBeVisible();
  await versions(page).getByRole('button', { name: 'Original' }).click();
  await search(page, 'Anna', 'Participant 1');
  await replaceAll(page, 3);

  const transcriptFile = () => {
    const files = folder.files(ROOT);
    const name = Object.keys(files).find((p) => p.endsWith('.transcript.json'))!;
    return (JSON.parse(files[name]!) as { doc: TranscriptDoc }).doc;
  };
  await expect
    .poll(() => transcriptFile().turns[1]?.text)
    .toBe('Participant 1, ich freue mich sehr.');
  const saved = transcriptFile();
  expect(saved.turns.map((t) => t.text).filter((t) => ANNA.test(t))).toEqual([]);
  expect(wordsOf(saved).filter((w) => ANNA.test(w))).toEqual([]);
  expect(wordsOf(saved)).toContain('Participant 1,');

  await clickInHeader(page, 'Home');
  await enterProject(page);
  await expect(page.getByRole('listbox').getByRole('option').first()).toContainText(
    'Summary out of date',
  );
});

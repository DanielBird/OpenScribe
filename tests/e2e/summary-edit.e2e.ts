import type { Page } from '@playwright/test';
import type { SessionSummaryFile } from '../../src/domain/summary';
import { makeSummaryFile, projectFiles, summaryPath } from '../../src/testing/projectSeed';
import {
  enterProject,
  expect,
  openHome,
  test,
  useProjectFolder,
  type ProjectFolderHarness,
} from './helpers';
import { germanSession, translated } from './sessionDocs';

// Editing a summary by hand in Project mode (Phase 39, DECISIONS.md D60): typed in place, autosaved to its file with
// the change check, read back after a reload.

const ROOT = 'Hearing at home';
const doc = translated(germanSession(7));
const base = makeSummaryFile(doc);
const seeded: SessionSummaryFile = {
  ...base,
  summary: {
    ...base.summary,
    title: 'P07 – home visit',
    overview: 'The first paragraph.\n\nThe second paragraph.',
    researchQuestions: [
      {
        question: 'How do people fit charging into their day?',
        finding: 'Charging is part of the bedtime routine.',
        turnIds: ['t2'],
        quotes: [],
      },
    ],
  },
};
const summaryFile = summaryPath(doc);

async function openSummary(page: Page): Promise<ProjectFolderHarness> {
  const folder = await useProjectFolder(page, {
    [ROOT]: {
      ...projectFiles([doc]),
      [summaryFile]: `${JSON.stringify({ ...seeded, futureField: 'kept' }, null, 2)}\n`,
    },
  });
  await openHome(page);
  await enterProject(page);
  await page.getByRole('button', { name: 'Open project…' }).click();
  await page.getByRole('listbox').getByRole('option').filter({ hasText: 'P07' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'P07 – home visit' })).toBeVisible();
  return folder;
}

const saved = (folder: ProjectFolderHarness) =>
  JSON.parse(folder.files(ROOT)[summaryFile] ?? '{}') as SessionSummaryFile & {
    futureField?: string;
  };

const box = (page: Page, name: string | RegExp) => page.getByRole('textbox', { name });

async function replaceText(page: Page, name: string | RegExp, text: string): Promise<void> {
  const block = box(page, name);
  await block.click();
  await block.press('Control+a');
  await page.keyboard.type(text);
}

test('edits are typed in place, saved to the file, and there after a reload', async ({ page }) => {
  const folder = await openSummary(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
  await expect(box(page, 'Title')).toHaveAttribute('contenteditable', 'plaintext-only');

  await replaceText(page, 'Title', 'P07 – edited');
  await replaceText(page, /^Finding: How do people fit/, 'They charge by the bed.');
  await expect.poll(() => saved(folder).summary.title).toBe('P07 – edited');
  await expect
    .poll(() => saved(folder).summary.researchQuestions[0]?.finding)
    .toBe('They charge by the bed.');
  // Every other field is the model's, and a field this build doesn't know is kept.
  const file = saved(folder);
  expect(file).toMatchObject({
    createdAt: seeded.createdAt,
    transcriptHash: seeded.transcriptHash,
    model: seeded.model,
    futureField: 'kept',
  });
  expect(file.summary.researchQuestions[0]?.turnIds).toEqual(['t2']);
  await expect(page.getByRole('listbox').getByRole('option').first()).toContainText('P07 – edited');

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await expect(page.locator('[contenteditable]')).toHaveCount(0);

  await page.reload();
  await enterProject(page);
  await page.getByRole('listbox').getByRole('option').filter({ hasText: 'P07' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'P07 – edited' })).toBeVisible();
  await expect(page.getByText('They charge by the bed.')).toBeVisible();
});

test('the arrow keys cross blocks, Enter splits a paragraph, and Escape stays in the summary', async ({
  page,
}) => {
  const folder = await openSummary(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();

  const title = box(page, 'Title');
  await title.click();
  await title.press('End');
  await page.keyboard.press('ArrowDown');
  await expect(box(page, 'Synopsis')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(title).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(box(page, 'Synopsis')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(title).toBeFocused();

  const first = box(page, 'Overview, paragraph 1');
  await first.click();
  await first.press('End');
  await page.keyboard.press('Enter');
  await expect(box(page, 'Overview, paragraph 2')).toBeFocused();
  await page.keyboard.type('A new paragraph.');
  await expect
    .poll(() => saved(folder).summary.overview)
    .toBe('The first paragraph.\n\nA new paragraph.\n\nThe second paragraph.');
  await expect(box(page, 'Overview, paragraph 3')).toHaveText('The second paragraph.');

  // Backspace at a paragraph's start joins it to the one above.
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  await expect
    .poll(() => saved(folder).summary.overview)
    .toBe('The first paragraph. A new paragraph.\n\nThe second paragraph.');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Done' })).toBeFocused();
  await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
  await expect(box(page, 'Title')).toBeVisible();
});

test('a quote is added by pasting its words, and removed', async ({ page }) => {
  const folder = await openSummary(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();

  await page.getByRole('button', { name: 'Add quote' }).first().click();
  const draft = box(page, 'New quote');
  await expect(draft).toBeFocused();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', '<b>always take</b> the charger\nwith me');
    document.activeElement?.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect(draft).toHaveText('<b>always take</b> the charger with me');
  await replaceText(page, 'New quote', 'always take the charger with me');
  await page.keyboard.press('Enter');

  const question = page.locator('.questions > li').first();
  const card = question.locator('.quote-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('always take the charger with me');
  await expect(card).toContainText('Speaker 2');
  await expect
    .poll(() => saved(folder).summary.researchQuestions[0]?.quotes)
    .toEqual([{ turnId: 't4', text: 'always take the charger with me' }]);

  await card.getByRole('button', { name: /^Remove quote/ }).click();
  await expect(card).toHaveCount(0);
  await expect.poll(() => saved(folder).summary.researchQuestions[0]?.quotes).toEqual([]);
});

test('a file someone else changed stops saving, and Keep mine overwrites theirs', async ({
  page,
}) => {
  const folder = await openSummary(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await folder.put(
    ROOT,
    summaryFile,
    JSON.stringify({ ...seeded, summary: { ...seeded.summary, synopsis: 'Theirs.' } }),
  );
  await replaceText(page, 'Synopsis', 'Mine.');
  await expect(page.getByText("The project's copy of this summary has changed.")).toBeVisible();
  expect(saved(folder).summary.synopsis).toBe('Theirs.');

  await page.getByRole('button', { name: 'Keep mine' }).click();
  await expect(page.getByText("The project's copy of this summary has changed.")).toHaveCount(0);
  expect(saved(folder).summary.synopsis).toBe('Mine.');
});

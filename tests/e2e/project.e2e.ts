import type { Locator, Page } from '@playwright/test';
import { PROJECT_FILE } from '../../src/domain/sessionFiles';
import { formatTimestamp } from '../../src/domain/transcript';
import { makeCorpus } from '../../src/testing/corpus';
import {
  makeProjectFile,
  projectFiles,
  projectFileText,
  transcriptFileText,
  transcriptPath,
} from '../../src/testing/projectSeed';
import {
  enterProject,
  expect,
  modeButton,
  openHome,
  openSearch,
  test,
  useProjectFolder,
} from './helpers';

// Project mode against the fake project folder (Phase 14): create and open, reconnect, the rescan on focus, the
// brief, the model, the sessions list and the search in the chat pane (D30).

const ROOT = 'Hearing at home';
const { docs, planted } = makeCorpus({ hours: 16, seed: 14 });

/** Reloads and goes back into Project mode. */
async function reloadProject(page: Page) {
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeAttached();
  await enterProject(page);
}

/** Opens the seeded project through Open project. */
async function openSeeded(page: Page) {
  await openHome(page);
  await enterProject(page);
  await page.getByRole('button', { name: 'Open project…' }).click();
  await expect(page.getByRole('heading', { name: /^Sessions/ })).toBeVisible();
}

const sessionItems = (page: Page) => page.locator('li.session');

test("New project creates the project file and opens the Brief; a folder that isn't a project is refused", async ({
  page,
}) => {
  const folder = await useProjectFolder(page, { [ROOT]: {}, Downloads: { 'notes.txt': 'x' } });
  await openHome(page);
  await enterProject(page);
  await expect(
    page.getByText('A project can be a local folder or a shared one, for example in OneDrive.'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'New project…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Brief' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Project Name')).toHaveValue(ROOT);
  await expect(dialog.getByLabel('Project Name')).toBeFocused();
  expect(JSON.parse(folder.files(ROOT)[PROJECT_FILE]!)).toMatchObject({
    kind: 'describe.project',
    name: ROOT,
  });

  await dialog.getByLabel('Project Name').fill('Hearing at home 2026');
  await dialog.getByLabel('Research questions').fill('How do people charge?\n\nWho helps them?  ');
  await dialog.getByLabel('Respondent details').fill('Age\nCountry');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('banner')).toContainText('Hearing at home 2026');
  expect(JSON.parse(folder.files(ROOT)[PROJECT_FILE]!)).toMatchObject({
    name: 'Hearing at home 2026',
    brief: {
      researchQuestions: ['How do people charge?', 'Who helps them?'],
      metadataFields: ['Age', 'Country'],
    },
  });
  await expect(page.getByRole('heading', { name: 'Sessions 0' })).toBeVisible();
  await expect(page.getByText('No sessions yet.')).toBeVisible();

  // Change → Open project on a folder that isn't a project: refused, and Cancel goes back.
  await page.getByRole('button', { name: 'Change' }).click();
  await folder.pickNext('Downloads');
  await page.getByRole('button', { name: 'Open project…' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    "This folder isn't a DeScribe project. Choose the project folder, or use New project.",
  );
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Change' })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Sessions 0' })).toBeVisible();
  expect(folder.files('Downloads')).toEqual({ 'notes.txt': 'x' });

  // New project on the same folder opens it, without the Brief.
  await page.getByRole('button', { name: 'Change' }).click();
  await folder.pickNext(ROOT);
  await page.getByRole('button', { name: 'New project…' }).click();
  await expect(page.getByRole('heading', { name: 'Sessions 0' })).toBeVisible();
  await expect(dialog).toBeHidden();

  // After a reload, Home shows the project's name, and Project opens it again.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Analyse Hearing at home 2026' })).toBeVisible();
  await enterProject(page);
  await expect(page.getByRole('heading', { name: 'Sessions 0' })).toBeVisible();
});

test('a folder the browser refuses gets its own message, without Reconnect', async ({ page }) => {
  const folder = await useProjectFolder(page, { [ROOT]: {} }, { pick: 'refuse' });
  await openHome(page);
  await enterProject(page);
  await page.getByRole('button', { name: 'New project…' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    "The browser didn't let DeScribe use this folder. Try again and allow access. If it keeps failing, ask IT " +
      'whether folder access is blocked.',
  );
  await expect(page.getByRole('button', { name: /^Reconnect/ })).toHaveCount(0);
  expect(folder.files(ROOT)).toEqual({});

  // Allowed this time: the project is created.
  await folder.pickNext(ROOT);
  await page.getByRole('button', { name: 'New project…' }).click();
  await expect(page.getByRole('dialog', { name: 'Brief' })).toBeVisible();
  expect(folder.files(ROOT)[PROJECT_FILE]).toBeDefined();
});

test('lists the sessions, and asks for one Reconnect click after the browser session ends', async ({
  page,
}) => {
  const folder = await useProjectFolder(page, { [ROOT]: projectFiles(docs) });
  await openSeeded(page);
  await expect(page.getByRole('heading', { name: `Sessions ${docs.length}` })).toBeVisible();
  await expect(sessionItems(page)).toHaveCount(docs.length);
  const newest = [...docs].sort((a, b) => b.source.lastModified - a.source.lastModified)[0]!;
  await expect(sessionItems(page).first().locator('.name')).toHaveText(newest.source.fileName);
  await expect(sessionItems(page).first().locator('.meta')).toHaveText(
    /^(EN|DE|FR) · \d\d:\d\d:\d\d · \d+ \w+ 2026$/,
  );

  await folder.setPermission('prompt');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Analyse Hearing at home 2026' })).toBeVisible();
  await enterProject(page);
  const reconnect = page.getByRole('button', { name: 'Reconnect “Hearing at home 2026”' });
  await expect(reconnect).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open another project…' })).toBeVisible();
  await reconnect.click();
  await expect(sessionItems(page)).toHaveCount(docs.length);
});

test('the Reconnect screen also offers New project, which refusing a folder points to', async ({
  page,
}) => {
  const folder = await useProjectFolder(page, {
    [ROOT]: projectFiles(docs.slice(0, 1)),
    'New study': {},
  });
  await openSeeded(page);
  await folder.setPermission('prompt');
  await reloadProject(page);
  await expect(
    page.getByRole('button', { name: 'Reconnect “Hearing at home 2026”' }),
  ).toBeVisible();

  await folder.pickNext('New study');
  await page.getByRole('button', { name: 'Open another project…' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    "This folder isn't a DeScribe project. Choose the project folder, or use New project.",
  );

  await folder.pickNext('New study');
  await page.getByRole('button', { name: 'New project…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Brief' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Project Name')).toHaveValue('New study');
  expect(JSON.parse(folder.files('New study')[PROJECT_FILE]!)).toMatchObject({
    kind: 'describe.project',
    name: 'New study',
  });
});

test("picks up a colleague's new session when the window gets focus", async ({ page }) => {
  const folder = await useProjectFolder(page, { [ROOT]: projectFiles(docs.slice(1)) });
  await openSeeded(page);
  await expect(sessionItems(page)).toHaveCount(docs.length - 1);

  await folder.put(ROOT, transcriptPath(docs[0]!), transcriptFileText(docs[0]!));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(sessionItems(page)).toHaveCount(docs.length);
  await expect(page.getByText(docs[0]!.source.fileName, { exact: true })).toBeVisible();
});

test('a second load reads from the cache, and the sessions survive a reload', async ({ page }) => {
  await useProjectFolder(page, { [ROOT]: projectFiles(docs) });
  await openSeeded(page);
  const cached = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('describe-v1-corpus');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const count = open.result.transaction('sessions').objectStore('sessions').count();
          count.onsuccess = () => resolve(count.result);
          count.onerror = () => reject(count.error);
        };
      }),
  );
  expect(cached).toBe(docs.length);
  await reloadProject(page);
  await expect(sessionItems(page)).toHaveCount(docs.length);
});

test("reports files that can't be read and conflict copies, and loads the rest", async ({
  page,
}) => {
  const [a, b] = docs;
  const copy = transcriptPath(a!).replace('.transcript.json', '.transcript-LAPTOP-123.json');
  await useProjectFolder(page, {
    [ROOT]: {
      ...projectFiles([a!, b!]),
      [copy]: transcriptFileText(a!, '2020-01-01T00:00:00.000Z'),
      'sessions/broken--12345678.transcript.json': '{ not json',
      'sessions/notes.txt': 'ignored',
    },
  });
  await openSeeded(page);
  await expect(sessionItems(page)).toHaveCount(2);
  const details = page.locator('details.problems');
  await expect(details.locator('summary')).toHaveText("1 file couldn't be read · 1 conflict copy");
  await details.locator('summary').click();
  await expect(details).toContainText(
    "broken--12345678.transcript.json: This file isn't one DeScribe can read.",
  );
  await expect(details).toContainText(`${copy.slice('sessions/'.length)}: an older copy of`);
});

test("never overwrites a colleague's brief: Save says so, and Reload shows theirs", async ({
  page,
}) => {
  const folder = await useProjectFolder(page, { [ROOT]: projectFiles([]) });
  await openSeeded(page);
  await page.getByRole('button', { name: 'Brief' }).click();
  const dialog = page.getByRole('dialog', { name: 'Brief' });
  await dialog.getByLabel('Context').fill('Mine');

  const theirs = projectFileText({
    brief: { researchQuestions: ['Theirs?'], context: 'Their context', metadataFields: [] },
  });
  await folder.put(ROOT, PROJECT_FILE, theirs);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Someone else changed the brief. Reload to see their version.',
  );
  expect(folder.files(ROOT)[PROJECT_FILE]).toBe(theirs);

  await dialog.getByRole('button', { name: 'Reload' }).click();
  await expect(dialog.getByLabel('Context')).toHaveValue('Their context');
  await expect(dialog.getByLabel('Research questions')).toHaveValue('Theirs?');
  await dialog.getByLabel('Context').fill('Both of ours');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  expect(JSON.parse(folder.files(ROOT)[PROJECT_FILE]!)).toMatchObject({
    id: makeProjectFile().id,
    brief: { researchQuestions: ['Theirs?'], context: 'Both of ours' },
  });
});

test('the model defaults to Sonnet 5.5 and remembers Opus 5.5 across a reload', async ({
  page,
}) => {
  await useProjectFolder(page, { [ROOT]: projectFiles([]) });
  await openSeeded(page);
  const model = page.getByRole('combobox', { name: 'Model' });
  await expect(model).toHaveValue('claude-sonnet-5-5');
  await model.selectOption({ label: 'Opus 5.5' });
  await reloadProject(page);
  await expect(page.getByRole('combobox', { name: 'Model' })).toHaveValue('claude-opus-5-5');
});

test('search finds planted phrases in English and in the original, and Copy copies the turn with its citation', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await useProjectFolder(page, { [ROOT]: projectFiles(docs) });
  await openSeeded(page);
  const box = await openSearch(page);

  const english = planted.find((p) => p.field === 'english')!;
  const original = planted.find((p) => p.field === 'original')!;
  for (const plant of [english, original]) {
    await box.fill(`"${plant.phrase}"`);
    const doc = docs.find((d) => d.id === plant.sessionId)!;
    const result = page.locator('li.result', { hasText: doc.source.fileName });
    await expect(result).toBeVisible();
    await expect(result.locator('mark').first()).toBeVisible();
  }
  // The results are in the chat pane; the sessions list stays.
  await expect(page.locator('.detail-pane li.result').first()).toBeVisible();
  await expect(page.locator('li.session')).toHaveCount(docs.length);
  await expect(
    page.getByRole('status').filter({ hasText: /hits? in \d+ sessions?/ }),
  ).toBeVisible();

  // Copy: the whole turn's English text, with its citation.
  await box.fill(`"${english.phrase}"`);
  const doc = docs.find((d) => d.id === english.sessionId)!;
  const turn = doc.turns.find((t) => t.id === english.turnId)!;
  const englishText = doc.translations.en?.texts[turn.id] ?? turn.text;
  const hit = page.locator('li.result', { hasText: doc.source.fileName }).locator('li.hit').first();
  await hit.getByRole('button', { name: /^Copy/ }).click();
  await expect(hit.getByRole('button', { name: /^Copy/ })).toHaveText('Copied');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(`"${englishText}" — `);
  expect(copied).toContain(doc.source.fileName);

  // A bad query says what to change; Escape clears it.
  await box.fill('"charger');
  await expect(page.getByText('Close the quotation marks.')).toBeVisible();
  await box.press('Escape');
  await expect(box).toHaveValue('');
  await expect(page.getByText('Close the quotation marks.')).toBeHidden();

  // Chat brings the question box back; Search, the search as it was.
  await box.fill(`"${english.phrase}"`);
  const result = page.locator('li.result', { hasText: doc.source.fileName });
  await expect(result).toBeVisible();
  await modeButton(page, 'Chat').click();
  await expect(page.getByRole('textbox', { name: 'Question' })).toBeFocused();
  await expect(box).toBeHidden();
  await openSearch(page);
  await expect(box).toHaveValue(`"${english.phrase}"`);
  await expect(result).toBeVisible();
});

test("a hit opens to its whole turn without moving the snippet's words, and closes when clicked again or another opens", async ({
  page,
}) => {
  await useProjectFolder(page, { [ROOT]: projectFiles(docs) });
  await openSeeded(page);
  const box = await openSearch(page);

  // Two long turns in different sessions, each found by four words from its middle.
  const long = docs.flatMap((doc) =>
    doc.turns.filter((t) => t.text.split(' ').length > 120).map((turn) => ({ doc, turn })),
  );
  const first = long[0]!;
  const second = long.find((l) => l.doc.id !== first.doc.id)!;
  const phrase = ({ turn }: typeof first) =>
    `"${turn.text
      .split(' ')
      .slice(60, 64)
      .join(' ')
      .replace(/[^\p{L}\p{N} ]/gu, '')}"`;
  await box.fill(`${phrase(first)} OR ${phrase(second)}`);
  const hitFor = ({ doc, turn }: typeof first) =>
    page
      .locator('li.result', { hasText: doc.source.fileName })
      .locator('li.hit', { hasText: formatTimestamp(turn.start) });
  const [hit1, hit2] = [hitFor(first), hitFor(second)];
  const toggle1 = hit1.locator('button.hit-toggle');
  const toggle2 = hit2.locator('button.hit-toggle');
  const quote1 = hit1.locator('.snippet');
  await expect(toggle1).toHaveAttribute('aria-expanded', 'false');

  /** Where the hit's first match is within the hit, once nothing moves. */
  const matchAt = async (hit: typeof hit1) => {
    await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
    return hit.evaluate((li) => {
      const mark = li.querySelector('.words mark')!.getBoundingClientRect();
      const card = li.getBoundingClientRect();
      return { x: Math.round(mark.x - card.x), y: Math.round(mark.y - card.y) };
    });
  };
  const closedAt = await matchAt(hit1);

  // A click on the quote opens it below the snippet's words, which stay where they were.
  await quote1.click();
  await expect(toggle1).toHaveAttribute('aria-expanded', 'true');
  expect(await matchAt(hit1)).toEqual(closedAt);
  await expect(quote1.locator('mark').first()).toBeInViewport();
  const open = await quote1.evaluate((el) => {
    const text = (selector: string) => el.querySelector(selector)?.textContent ?? '';
    return {
      // The snippet's … stays before its words; there's nothing missing there now.
      turn: text('.before') + text('.words').slice(1) + text('.after'),
      lines: el.clientHeight / parseFloat(getComputedStyle(el).lineHeight),
      scrolls: el.scrollHeight > el.clientHeight,
    };
  });
  expect(open.turn).toBe(first.turn.text);
  expect(open.lines).toBeGreaterThan(2.95);
  expect(open.scrolls).toBe(true);
  await expect(quote1).toHaveAttribute('tabindex', '0');

  // The turn before the words is above them.
  await quote1.evaluate((el) => (el.scrollTop = 0));
  await expect(quote1.locator('.before')).toBeInViewport();

  // Another hit, from the keyboard, closes the first, whose words glide back to where they were.
  await toggle2.focus();
  await page.keyboard.press('Enter');
  await expect(toggle2).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle1).toHaveAttribute('aria-expanded', 'false');
  expect(await matchAt(hit1)).toEqual(closedAt);
  await expect(quote1.locator('.after')).toHaveCount(0);
  await hit2.locator('.time').click();
  await expect(toggle2).toHaveAttribute('aria-expanded', 'false');
});

test('a session lists its first 4 hits; Show all lists the rest below them, and Show fewer stays where it is', async ({
  page,
}) => {
  await useProjectFolder(page, { [ROOT]: projectFiles(docs) });
  await openSeeded(page);
  const box = await openSearch(page);
  await box.fill('the OR die OR le');
  const result = page.locator('li.result').first();
  const hits = result.locator('li.hit');
  await expect(hits).toHaveCount(4);
  const count = Number(/\d+/.exec((await result.locator('.hit-count').textContent()) ?? '')?.[0]);
  expect(count).toBeGreaterThan(4);

  /** Where an element is, once nothing moves: in the viewport, or within the scrolled results. */
  const at = async (locator: Locator) => {
    await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
    return locator.evaluate((el) => {
      const y = el.getBoundingClientRect().y;
      return {
        y: Math.round(y),
        inResults: Math.round(y + el.closest('.results-area')!.scrollTop),
      };
    });
  };

  // The first 4 stay where they are in every frame as the list grows; the first new hit takes focus.
  const fourth = await at(hits.nth(3));
  const frames = await result.evaluate(async (li) => {
    const hit = li.querySelectorAll('li.hit')[3]!;
    const area = li.closest('.results-area')!;
    const ys: number[] = [];
    li.querySelector<HTMLButtonElement>('button.show-all')!.click();
    do {
      await new Promise(requestAnimationFrame);
      ys.push(Math.round(hit.getBoundingClientRect().y + area.scrollTop));
    } while (document.getAnimations().length > 0);
    return ys;
  });
  expect(frames.length).toBeGreaterThan(2);
  expect(new Set(frames)).toEqual(new Set([fourth.inResults]));
  await expect(hits).toHaveCount(count);
  await expect(hits.nth(4).getByRole('button').first()).toBeFocused();

  // Show fewer, scrolled down to: it, and what's below it, stay put.
  const fewer = result.getByRole('button', { name: /^Show fewer/ });
  await fewer.scrollIntoViewIfNeeded();
  const before = await at(fewer);
  await fewer.click();
  await expect(hits).toHaveCount(4);
  const again = result.getByRole('button', { name: /^Show all/ });
  await expect(again).toBeFocused();
  expect((await at(again)).y).toBe(before.y);
});

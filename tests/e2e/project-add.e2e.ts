import type { Page } from '@playwright/test';
import type { SessionSummaryFile } from '../../src/domain/summary';
import type { TranscriptDoc } from '../../src/domain/transcript';
import {
  projectFiles,
  summaryFileText,
  summaryPath,
  transcriptFileText,
  transcriptPath,
} from '../../src/testing/projectSeed';
import {
  clickInHeader,
  enterProject,
  expect,
  goToGlossary,
  isSummaryCall,
  mockAnthropic,
  mockElevenLabs,
  mockGemini,
  ok,
  openApp,
  openHome,
  projectAnswer,
  run,
  test,
  useProjectFolder,
  type LlmAnswer,
} from './helpers';
import { germanSession, translated } from './sessionDocs';

// Phase 15: Add to project on Output (save → translate → summarise), saving back to the folder with the change check,
// and the summaries in Analyse mode. ElevenLabs and Claude are mocked; Claude answers translations and summaries.

const ROOT = 'Hearing at home';

const sessionsDir = (files: Record<string, string>, suffix: string) =>
  Object.keys(files).filter((p) => p.startsWith('sessions/') && p.endsWith(suffix));

/** Transcribes the test recording (German) and shows it on Output. */
async function transcribe(page: Page) {
  await mockElevenLabs(page, () => ok());
  await openApp(page);
  await goToGlossary(page);
  await run(page);
  await expect(page.locator('li.turn').first()).toBeVisible();
}

/** Opens the folder's project in Analyse mode, through Open project. */
async function openProject(page: Page) {
  await openHome(page);
  await enterProject(page);
  await page.getByRole('button', { name: 'Open project…' }).click();
  await expect(page.getByRole('heading', { name: /^Sessions/ })).toBeVisible();
}

const sessions = (page: Page) => page.getByRole('listbox').getByRole('option');

test('Add to project on a new transcript: saved, translated, summarised, and its quotes copy', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const folder = await useProjectFolder(page, { [ROOT]: {} });
  const calls = await mockAnthropic(page, projectAnswer);
  await transcribe(page);

  await page.getByRole('button', { name: 'Add to project…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add to project' });
  await dialog.getByRole('button', { name: 'New project…' }).click();
  // A new project opens its Brief over the dialog.
  const brief = page.getByRole('dialog', { name: 'Brief' });
  await expect(brief).toBeVisible();
  await brief.getByLabel('Research questions').fill('How do people charge?');
  await brief.getByRole('button', { name: 'Save' }).click();
  // The dialog below is titled for the project already; its key field is usable once the Brief has closed.
  await expect(brief).toBeHidden();
  const ready = page.getByRole('dialog', { name: `Add to “${ROOT}”` });
  await expect(ready).toBeVisible();
  await expect(ready).toContainText(
    'The transcript text is sent to Anthropic to translate and summarise.',
  );
  await ready.getByLabel('Claude (Anthropic) API key').fill('test-key');
  await ready.getByRole('button', { name: 'Add', exact: true }).click();

  await expect(page.getByText(`In ${ROOT}`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to project…' })).toHaveCount(0);
  await expect(page.locator('.status-line')).toHaveCount(0);
  // The translation is shown on Output too.
  await expect(page.locator('li.turn').first()).toContainText('English t1.');

  const files = folder.files(ROOT);
  const [transcriptName] = sessionsDir(files, '.transcript.json');
  const [summaryName] = sessionsDir(files, '.summary.json');
  const saved = JSON.parse(files[transcriptName!]!) as { doc: TranscriptDoc };
  expect(saved.doc.translations.en?.texts.t1).toBe('English t1.');
  const summary = JSON.parse(files[summaryName!]!) as SessionSummaryFile;
  expect(summary).toMatchObject({
    kind: 'describe.summary',
    model: 'claude-sonnet-5-5',
    droppedQuotes: 0,
  });
  expect(calls.map((c) => (isSummaryCall(c) ? 'summary' : 'translation'))).toEqual([
    'translation',
    'summary',
  ]);
  // The transcript file was written before Claude was asked anything.
  expect(calls[0]!.body.stream).toBe(true);

  await clickInHeader(page, 'Home');
  await enterProject(page);
  await expect(sessions(page)).toHaveCount(1);
  await expect(sessions(page).first()).toContainText(summary.summary.title);
  await expect(sessions(page).first()).toContainText('Summarised');
  await sessions(page).first().click();
  await expect(page.getByRole('heading', { level: 2, name: summary.summary.title })).toBeFocused();
  const firstQuote = page.locator('.quote-card').first();
  await firstQuote.getByRole('button', { name: /^Copy/ }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(
    /^"English t\d\.?" — Speaker \d, 00:00:\d\d, .+ \(translated from German\)$/,
  );
});

test('Summarise in Analyse mode translates a German session in its file, then summarises it', async ({
  page,
}) => {
  const doc = germanSession(7);
  const folder = await useProjectFolder(page, { [ROOT]: projectFiles([doc]) });
  await mockAnthropic(page, projectAnswer);
  await openProject(page);
  await expect(sessions(page).first()).toContainText('No summary');

  await sessions(page).first().click();
  await page.getByRole('button', { name: 'Summarise', exact: true }).click();
  const keyDialog = page.getByRole('dialog', { name: 'Summarise' });
  await keyDialog.getByLabel('Claude (Anthropic) API key').fill('test-key');
  await keyDialog.getByRole('button', { name: 'Summarise' }).click();

  await expect(page.locator('.themes .quote-card').first()).toBeVisible();
  await expect(sessions(page).first()).toContainText('Summarised');
  await expect(page.getByText('German, translated')).toBeVisible();
  const saved = JSON.parse(folder.files(ROOT)[transcriptPath(doc)]!) as { doc: TranscriptDoc };
  expect(saved.doc.translations.en?.provider).toBe('claude');
  expect(folder.files(ROOT)[summaryPath(doc)]).toBeDefined();
});

test('after Add to project, Open summary shows the new summary in Analyse mode, where the chat is', async ({
  page,
}) => {
  await useProjectFolder(page, { [ROOT]: projectFiles([]) });
  await mockAnthropic(page, projectAnswer);
  await transcribe(page);
  await expect(page.getByRole('button', { name: 'Open summary' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add to project…' }).click();
  await page
    .getByRole('dialog', { name: 'Add to project' })
    .getByRole('button', { name: 'Open project…' })
    .click();
  const ready = page.getByRole('dialog', { name: /^Add to “/ });
  await ready.getByLabel('Claude (Anthropic) API key').fill('test-key');
  await ready.getByRole('button', { name: 'Add', exact: true }).click();

  // Focus moves to it once the work is done, as it takes Add to project's place.
  const open = page.getByRole('button', { name: 'Open summary' });
  await expect(open).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.locator('.themes .quote-card').first()).toBeVisible();
  await expect(sessions(page).first()).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('textbox', { name: 'Question' })).toBeHidden();
  await page.getByRole('heading', { name: 'tone-5s.wav – session' }).press('Escape');
  await expect(page.getByRole('textbox', { name: 'Question' })).toBeVisible();
});

test('a session whose files are deleted from the folder can be added to the project again', async ({
  page,
}) => {
  const folder = await useProjectFolder(page, { [ROOT]: projectFiles([]) });
  await mockAnthropic(page, projectAnswer);
  await transcribe(page);
  await page.getByRole('button', { name: 'Add to project…' }).click();
  await page
    .getByRole('dialog', { name: 'Add to project' })
    .getByRole('button', { name: 'Open project…' })
    .click();
  const ready = page.getByRole('dialog', { name: /^Add to “/ });
  await ready.getByLabel('Claude (Anthropic) API key').fill('test-key');
  await ready.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.status-line')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add to project…' })).toHaveCount(0);

  // Someone deletes the session's files in File Explorer, then comes back to the window.
  for (const name of [
    ...sessionsDir(folder.files(ROOT), '.transcript.json'),
    ...sessionsDir(folder.files(ROOT), '.summary.json'),
  ]) {
    await folder.remove(ROOT, name);
  }
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: 'Add to project…' })).toBeVisible();
  await expect(page.getByText(/^In /)).toHaveCount(0);

  await page.getByRole('button', { name: 'Add to project…' }).click();
  await page
    .getByRole('dialog', { name: /^Add to “/ })
    .getByRole('button', { name: 'Add', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Add to project…' })).toHaveCount(0);
  await expect(page.locator('.status-line')).toHaveCount(0);
  expect(sessionsDir(folder.files(ROOT), '.transcript.json')).toHaveLength(1);
  expect(sessionsDir(folder.files(ROOT), '.summary.json')).toHaveLength(1);
});

test('Add to project can switch to a Gemini model in its dialog, which asks for the Gemini key', async ({
  page,
}) => {
  const folder = await useProjectFolder(page, { [ROOT]: projectFiles([]) });
  const claude = await mockAnthropic(page, projectAnswer);
  const gemini = await mockGemini(page, projectAnswer);
  await transcribe(page);

  await page.getByRole('button', { name: 'Add to project…' }).click();
  await page
    .getByRole('dialog', { name: 'Add to project' })
    .getByRole('button', { name: 'Open project…' })
    .click();
  const ready = page.getByRole('dialog', { name: /^Add to “/ });
  await expect(ready.getByLabel('Model')).toHaveValue('claude-sonnet-5-5');
  await ready.getByLabel('Model').selectOption({ label: 'Gemini 3.8 Flash' });
  await expect(ready).toContainText(
    'The transcript text is sent to Google to translate and summarise.',
  );
  await ready.getByLabel('Gemini (Google) API key').fill('test-key-gemini');
  await ready.getByRole('button', { name: 'Add', exact: true }).click();

  await expect(page.getByText(/^In /)).toBeVisible();
  await expect(page.locator('.status-line')).toHaveCount(0);
  expect(claude).toHaveLength(0);
  expect(gemini).toHaveLength(2);
  const files = folder.files(ROOT);
  const [summaryName] = sessionsDir(files, '.summary.json');
  const summary = JSON.parse(files[summaryName!]!) as SessionSummaryFile;
  expect(summary).toMatchObject({ provider: 'gemini', model: 'gemini-3.8-flash' });

  // The same setting as the Analyse header.
  await clickInHeader(page, 'Home');
  await enterProject(page);
  await expect(page.getByRole('combobox', { name: 'Model' })).toHaveValue('gemini-3.8-flash');
});

test('with a Gemini model, a German session is translated and summarised by Gemini, and its quotes copy', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const doc = germanSession(7);
  const folder = await useProjectFolder(page, { [ROOT]: projectFiles([doc]) });
  const claude = await mockAnthropic(page, projectAnswer);
  const gemini = await mockGemini(page, projectAnswer);
  await openProject(page);
  await page.getByLabel('Model').selectOption({ label: 'Gemini 4 Argon' });

  await sessions(page).first().click();
  await page.getByRole('button', { name: 'Summarise', exact: true }).click();
  const keyDialog = page.getByRole('dialog', { name: 'Summarise' });
  await expect(keyDialog).toContainText(
    'The transcript text is sent to Google to translate and summarise.',
  );
  await keyDialog.getByLabel('Gemini (Google) API key').fill('test-key-gemini');
  await keyDialog.getByRole('button', { name: 'Summarise' }).click();

  await expect(page.locator('.themes .quote-card').first()).toBeVisible();
  expect(claude).toHaveLength(0);
  expect(gemini.map((c) => (isSummaryCall(c) ? 'summary' : 'translation'))).toEqual([
    'translation',
    'summary',
  ]);
  expect(gemini.every((c) => c.key === 'test-key-gemini')).toBe(true);
  expect(gemini[0]!.url).toContain('/models/gemini-4-argon:streamGenerateContent?alt=sse');
  const saved = JSON.parse(folder.files(ROOT)[transcriptPath(doc)]!) as { doc: TranscriptDoc };
  expect(saved.doc.translations.en).toMatchObject({ provider: 'gemini', model: 'gemini-4-argon' });
  const summary = JSON.parse(folder.files(ROOT)[summaryPath(doc)]!) as SessionSummaryFile;
  expect(summary).toMatchObject({ provider: 'gemini', model: 'gemini-4-argon', droppedQuotes: 0 });
  await expect(page.locator('details', { hasText: 'Made with Gemini 4 Argon' })).toHaveCount(1);

  await page.locator('.quote-card').first().getByRole('button', { name: /^Copy/ }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(
    /^"English t\d+\.?" — Speaker \d, \d\d:\d\d:\d\d, .+ \(translated from German\)$/,
  );
});

test('an edit on Output reaches the file, the summary goes out of date, and Regenerate renews it', async ({
  page,
}) => {
  const doc = translated(germanSession(7));
  const folder = await useProjectFolder(page, {
    [ROOT]: { ...projectFiles([doc]), [summaryPath(doc)]: summaryFileText(doc) },
  });
  const calls = await mockAnthropic(page, projectAnswer);
  await openProject(page);
  await expect(sessions(page).first()).toContainText('Summarised');
  await sessions(page).first().click();
  await page.getByRole('button', { name: 'Open transcript' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Output' })).toBeFocused();
  await expect(page.getByText(`In Hearing at home 2026`)).toBeVisible();

  await page.getByLabel('Name for Speaker 1').fill('Interviewer');
  await expect
    .poll(
      () =>
        (JSON.parse(folder.files(ROOT)[transcriptPath(doc)]!) as { doc: TranscriptDoc }).doc
          .speakers[0]!.label,
    )
    .toBe('Interviewer');

  await clickInHeader(page, 'Home');
  await enterProject(page);
  await expect(sessions(page).first()).toContainText('Summary out of date');
  await sessions(page).first().click();
  await expect(
    page.getByText('Out of date: the transcript or the brief has changed.'),
  ).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('describe.v1.key.claude', 'test-key'));
  await page.getByRole('button', { name: 'Regenerate' }).first().click();
  const keyDialog = page.getByRole('dialog', { name: 'Summarise' });
  if (await keyDialog.isVisible()) {
    await keyDialog.getByLabel('Claude (Anthropic) API key').fill('test-key');
    await keyDialog.getByRole('button', { name: 'Summarise' }).click();
  }
  await expect(sessions(page).first()).toContainText('Summarised');
  expect(calls.filter(isSummaryCall)).toHaveLength(1);
  expect(calls.find(isSummaryCall)!.text).toContain('Interviewer (speaker_0)');
});

test("a file changed behind DeScribe's back stops the saves until Keep mine", async ({ page }) => {
  const doc = translated(germanSession(7));
  const folder = await useProjectFolder(page, { [ROOT]: projectFiles([doc]) });
  await openProject(page);
  await sessions(page).first().click();
  await page.getByRole('button', { name: 'Open transcript' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Output' })).toBeFocused();

  const theirs = {
    ...doc,
    speakers: doc.speakers.map((s, i) => (i === 0 ? { ...s, label: 'Theirs' } : s)),
  };
  await folder.put(
    ROOT,
    transcriptPath(doc),
    transcriptFileText(theirs, '2026-10-19T10:00:00.000Z'),
  );
  await page.getByLabel('Name for Speaker 1').fill('Mine');
  await expect(page.getByText("The project's copy of this transcript has changed.")).toBeVisible();
  const label = () =>
    (JSON.parse(folder.files(ROOT)[transcriptPath(doc)]!) as { doc: TranscriptDoc }).doc
      .speakers[0]!.label;
  expect(label()).toBe('Theirs');

  await page.getByRole('button', { name: 'Keep mine' }).click();
  await expect(page.getByText("The project's copy of this transcript has changed.")).toHaveCount(0);
  await expect.poll(label).toBe('Mine');
});

test('Summarise all asks first, runs one session at a time, and moves on past a failure', async ({
  page,
  consoleErrors,
}) => {
  const docs = [1, 2, 3].map((n) => translated(germanSession(n)));
  await useProjectFolder(page, { [ROOT]: projectFiles(docs) });
  const answer: LlmAnswer = (call, n) => {
    if (isSummaryCall(call) && call.text.includes('P02 Hamburg')) {
      return { not: 'a summary' };
    }
    return projectAnswer(call, n);
  };
  await mockAnthropic(page, answer);
  await openProject(page);
  await page.evaluate(() => localStorage.setItem('describe.v1.key.claude', 'test-key'));

  await page.getByRole('button', { name: 'Summarise all (3)' }).click();
  const confirm = page.getByRole('dialog', { name: 'Summarise all' });
  await expect(confirm).toContainText('Summarise 3 sessions, about');
  if (await confirm.getByLabel('Claude (Anthropic) API key').isVisible()) {
    await confirm.getByLabel('Claude (Anthropic) API key').fill('test-key');
  }
  await confirm.getByRole('button', { name: 'Summarise' }).click();

  await expect(page.getByRole('button', { name: 'Summarise all (1)' })).toBeVisible();
  await expect(sessions(page)).toHaveText([/Summarised/, /Summary failed/, /Summarised/]);
  consoleErrors.length = 0;
});

test('after a reload the link stays: a change asks for Reconnect, then saves without a conflict', async ({
  page,
}) => {
  const doc = translated(germanSession(7));
  const folder = await useProjectFolder(page, { [ROOT]: projectFiles([doc]) });
  await openProject(page);
  await sessions(page).first().click();
  await page.getByRole('button', { name: 'Open transcript' }).click();
  await expect(page.getByText('In Hearing at home 2026')).toBeVisible();

  // A new browser session: access to the folder has to be asked for again (file://).
  await folder.setPermission('prompt');
  await page.reload();
  await openHome(page);
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByText('In Hearing at home 2026')).toBeVisible();

  await page.getByLabel('Name for Speaker 1').fill('Interviewer');
  await expect(
    page.getByText('DeScribe no longer has access to “Hearing at home 2026”.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reconnect' }).click();
  await expect(page.getByText('DeScribe no longer has access')).toHaveCount(0);
  await expect(page.getByText("The project's copy of this transcript has changed.")).toHaveCount(0);
  await expect
    .poll(
      () =>
        (JSON.parse(folder.files(ROOT)[transcriptPath(doc)]!) as { doc: TranscriptDoc }).doc
          .speakers[0]!.label,
    )
    .toBe('Interviewer');
});

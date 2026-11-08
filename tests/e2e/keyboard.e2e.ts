import type { Locator, Page } from '@playwright/test';
import {
  expect,
  goToGlossary,
  isSummaryCall,
  mockAgent,
  mockAnthropic,
  mockElevenLabs,
  ok,
  openApp,
  openHome,
  projectAnswer,
  run,
  test,
  TONE_WAV,
  useProjectFolder,
  modeButton,
} from './helpers';
import { PROJECT_FILE } from '../../src/domain/sessionFiles';
import { agentMessage, textBlock, toolUseBlock } from '../../src/testing/agent';
import { makeCorpus } from '../../src/testing/corpus';
import { projectFiles, summaryFileText, summaryPath } from '../../src/testing/projectSeed';
import { germanSession, translated } from './sessionDocs';

// The whole flow with the keyboard only (Phase 8): Tab to each control, use Enter or typing, and check
// at every stop that the focused element shows a focus indicator. Dialogs return focus to their trigger
// and a step change focuses the new view's heading.

/**
 * Whether the focused element draws a visible focus indicator (outline or box-shadow). Inside the
 * native <audio> controls Chromium draws its own ring on the inner button (checked by screenshot).
 */
const focusIsVisible = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) return { ok: true, what: 'body' };
    if (el instanceof HTMLMediaElement) return { ok: true, what: 'audio controls' };
    const style = getComputedStyle(el);
    const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
    const what = `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}"`;
    return { ok: outline || style.boxShadow !== 'none', what };
  });

/**
 * Presses Tab (or Shift+Tab, `backwards`) until `target` has focus, checking the focus indicator at every
 * stop on the way.
 */
async function tabTo(page: Page, target: Locator, { maxStops = 40, backwards = false } = {}) {
  for (let i = 0; i < maxStops; i++) {
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
    const focus = await focusIsVisible(page);
    expect(focus.ok, `visible focus on ${focus.what}`).toBe(true);
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`Tab never reached ${target.toString()}`);
}

test('the full flow works from the keyboard, with visible focus throughout', async ({ page }) => {
  await mockElevenLabs(page, () => ok());
  await mockAnthropic(page);
  await openApp(page);

  // Setup: recording (the file chooser opens from the keyboard), the key on Settings, Next.
  await tabTo(page, page.getByRole('button', { name: 'Choose file…' }));
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles(TONE_WAV);
  await expect(page.getByText('00:00:05')).toBeVisible();
  await tabTo(page, page.getByRole('button', { name: 'Open Settings' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeFocused();
  await tabTo(page, page.getByLabel('ElevenLabs API key'));
  await page.keyboard.type('test-key');
  await tabTo(page, page.getByRole('button', { name: 'Back' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Setup' })).toBeFocused();
  await expect(page.getByText('00:00:05')).toBeVisible();
  await tabTo(page, page.getByRole('button', { name: 'Next' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Glossary' })).toBeFocused();

  // Glossary: add a term, Run.
  await tabTo(page, page.getByLabel('Add terms'));
  await page.keyboard.type('Oticon');
  await tabTo(page, page.getByRole('button', { name: 'Add', exact: true }));
  await page.keyboard.press('Enter');
  await expect(page.getByText('Oticon')).toBeVisible();
  await tabTo(page, page.getByRole('button', { name: 'Run' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Output' })).toBeFocused();
  await expect(page.locator('li.turn')).toHaveCount(5);

  // Output, in Tab order: translate (a dialog, closed again), rename a speaker, play a turn.
  const translate = page.getByRole('button', { name: 'Translate to English' });
  await tabTo(page, translate);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Translate to English' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(translate).toBeFocused();

  await tabTo(page, page.getByRole('textbox', { name: 'Name for Speaker 1' }));
  await page.keyboard.type('Interviewer');
  await expect(page.locator('li.turn .speaker').first()).toHaveText('Interviewer');

  await page.evaluate(() => {
    const audio = document.querySelector('audio');
    if (audio) audio.muted = true;
  });
  await tabTo(page, page.getByRole('button', { name: 'Play from 00:00:03' }));
  await page.keyboard.press('Enter');
  await expect(page.locator('li.turn[aria-current="true"]')).toContainText('Danke');

  // Settings from the footer, and Back to Output.
  const settings = page.getByRole('contentinfo').getByRole('button', { name: 'Settings' });
  await tabTo(page, settings, { maxStops: 60 });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeFocused();
  await tabTo(page, page.getByRole('button', { name: 'Back' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Output' })).toBeFocused();
});

test('Home and the Home button in the nav work from the keyboard', async ({ page }) => {
  await openHome(page);

  await tabTo(page, page.getByRole('button', { name: 'Transcribe' }));
  await tabTo(page, page.getByRole('button', { name: 'Analyse' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Analyse' })).toBeFocused();

  await tabTo(page, page.getByRole('button', { name: 'Home', exact: true }), { backwards: true });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeFocused();
});

test('Project works from the keyboard: open, the Brief, the model, search, Copy, Change, Reconnect and Try again', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { docs } = makeCorpus({ hours: 6, seed: 5 });
  const files = projectFiles(docs);
  const folder = await useProjectFolder(page, { 'Hearing at home': files });
  await openHome(page);
  await tabTo(page, page.getByRole('button', { name: 'Analyse' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Analyse' })).toBeFocused();

  await tabTo(page, page.getByRole('button', { name: 'Open project…' }));
  await page.keyboard.press('Enter');
  await expect(page.locator('li.session')).toHaveCount(docs.length);

  // The header's controls come before the panes.
  await tabTo(page, page.getByRole('button', { name: 'Brief' }), { backwards: true });
  await page.keyboard.press('Enter');
  const brief = page.getByRole('dialog', { name: 'Brief' });
  await expect(brief.getByLabel('Project Name')).toBeFocused();
  await tabTo(page, brief.getByRole('tab', { name: 'Context' }));
  await page.keyboard.press('ArrowRight');
  await expect(brief.getByRole('tab', { name: 'Research questions' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(brief.getByRole('textbox', { name: 'Key research questions' })).toBeFocused();
  await tabTo(page, brief.getByRole('button', { name: 'Cancel' }));
  await page.keyboard.press('Escape');
  await expect(brief).toBeHidden();
  await expect(page.getByRole('button', { name: 'Brief' })).toBeFocused();

  // The select's options are grouped by provider; typing a name moves across the groups. (Not the arrow keys:
  // on macOS they open the list instead of changing the value.)
  const model = page.getByRole('combobox', { name: 'Model' });
  await tabTo(page, model);
  await page.keyboard.type('Opus');
  await expect(model).toHaveValue('claude-opus-5-5');
  await page.keyboard.press('Tab');
  await tabTo(page, model, { backwards: true });
  await page.keyboard.type('Gemini 3.8');
  await expect(model).toHaveValue('gemini-3.8-flash');

  // Search, under the question box: it puts focus in its box. Then Copy the last hit, just above the box (and More).
  await tabTo(page, modeButton(page, 'Search'));
  await page.keyboard.press('Enter');
  const box = page.getByRole('searchbox', { name: 'Search transcripts' });
  await expect(box).toBeFocused();
  await page.keyboard.type('the');
  await page.keyboard.press('Enter');
  const copy = page.locator('li.hit').last().getByRole('button', { name: /^Copy/ });
  await tabTo(page, copy, { backwards: true });
  await page.keyboard.press('Enter');
  await expect(copy).toHaveText('Copied');
  await tabTo(page, box);
  await page.keyboard.press('Escape');
  await expect(page.locator('li.result')).toHaveCount(0);

  // Change, then Cancel back to the project.
  await tabTo(page, page.getByRole('button', { name: 'Change' }), { backwards: true });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Open project…' })).toBeFocused();
  await tabTo(page, page.getByRole('button', { name: 'Cancel' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Change' })).toBeFocused();

  // A new browser session: Reconnect.
  await folder.setPermission('prompt');
  await page.reload();
  await tabTo(page, page.getByRole('button', { name: /^Analyse/ }));
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByRole('button', { name: /^Reconnect/ }));
  await page.keyboard.press('Enter');
  await expect(page.locator('li.session')).toHaveCount(docs.length);

  // A damaged project file: Try again, once it's fixed.
  await folder.put('Hearing at home', PROJECT_FILE, '{');
  await page.reload();
  await tabTo(page, page.getByRole('button', { name: /^Analyse/ }));
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByRole('button', { name: 'Try again' }));
  await folder.put('Hearing at home', PROJECT_FILE, files[PROJECT_FILE]!);
  await page.keyboard.press('Enter');
  await expect(page.locator('li.session')).toHaveCount(docs.length);
});

test('Analyse works from the keyboard: the sessions list, a summary, Summarise all, Open transcript', async ({
  page,
}) => {
  const docs = [7, 8].map((n) => translated(germanSession(n)));
  await useProjectFolder(page, {
    'Hearing at home': {
      ...projectFiles(docs),
      [summaryPath(docs[0]!)]: summaryFileText(docs[0]!),
    },
  });
  await mockAnthropic(page, projectAnswer);
  await openHome(page);
  await tabTo(page, page.getByRole('button', { name: /^Analyse/ }));
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByRole('button', { name: 'Open project…' }));
  await page.keyboard.press('Enter');
  const options = page.getByRole('listbox').getByRole('option');
  await expect(options).toHaveCount(2);

  // One Tab stop for the list; the arrow keys move, Enter selects and moves to the summary.
  await tabTo(page, options.first());
  await page.keyboard.press('ArrowDown');
  await expect(options.nth(1)).toBeFocused();
  expect((await focusIsVisible(page)).ok).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 2, name: /P07/ })).toBeFocused();
  await tabTo(page, page.getByRole('button', { name: 'Open transcript' }));

  // Summarise all asks first; Escape returns to the button.
  const summariseAll = page.getByRole('button', { name: 'Summarise all (1)' });
  await tabTo(page, summariseAll, { backwards: true });
  await page.keyboard.press('Enter');
  const confirm = page.getByRole('dialog', { name: 'Summarise all' });
  await expect(confirm).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(summariseAll).toBeFocused();

  // The list's Tab stop stays on the selected session.
  await tabTo(page, options.nth(1), { backwards: true });

  // Open transcript, then Add to project isn't offered: it's in the project already.
  await tabTo(page, page.getByRole('button', { name: 'Open transcript' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Output' })).toBeFocused();
  await expect(page.getByText('In Hearing at home 2026')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to project…' })).toHaveCount(0);
});

test('Add to project works from the keyboard, and focus stays in the actions row', async ({
  page,
}) => {
  await useProjectFolder(page, { 'Hearing at home': projectFiles([]) });
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await mockAnthropic(page, async (call, n) => {
    if (isSummaryCall(call)) await held;
    return projectAnswer(call, n);
  });
  await mockElevenLabs(page, () => ok());
  await openApp(page);
  await goToGlossary(page);
  await run(page);

  const add = page.getByRole('button', { name: 'Add to project…' });
  await tabTo(page, add);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(add).toBeFocused();

  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Add to project' });
  await tabTo(page, dialog.getByRole('button', { name: 'Open project…' }));
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByLabel('Claude (Anthropic) API key'));
  await page.keyboard.type('test-key');
  await tabTo(page, page.getByRole('button', { name: 'Add', exact: true }));
  await page.keyboard.press('Enter');

  // The button goes; focus moves to the progress line, then stays in the view when the work ends.
  const status = page.locator('.status-line');
  await expect(status).toBeFocused();
  await tabTo(page, page.getByRole('button', { name: 'Cancel' }));
  release();
  await expect(status).toHaveCount(0);
  await expect(page.getByText('In Hearing at home 2026')).toBeVisible();
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
});

test('Add to project: the project is chosen from the keyboard', async ({ page }) => {
  await page.addInitScript(() =>
    sessionStorage.setItem('describe.v1.key.claude', JSON.stringify('test-key')),
  );
  const other = { id: '99999999-0000-4000-8000-000000000000', name: 'Field study Lyon' };
  const folder = await useProjectFolder(
    page,
    { 'Hearing at home': projectFiles([]), 'Field study': projectFiles([], other) },
    { pick: 'Hearing at home' },
  );
  await mockAnthropic(page, projectAnswer);
  await mockElevenLabs(page, () => ok());
  await openApp(page);
  await goToGlossary(page);
  await run(page);

  await tabTo(page, page.getByRole('button', { name: 'Add to project…' }));
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByRole('button', { name: 'Open project…' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Add to “Hearing at home 2026”' })).toBeVisible();
  await folder.pickNext('Field study');
  await tabTo(page, page.getByRole('button', { name: 'Open another project…' }));
  await page.keyboard.press('Enter');

  // The button goes while the project loads: focus lands on the new dropdown.
  const select = page.getByLabel('Project', { exact: true });
  await expect(select).toBeFocused();
  await expect(select).toHaveValue(other.id);
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(select).not.toHaveValue(other.id);

  await tabTo(page, page.getByRole('button', { name: 'Add', exact: true }));
  await page.keyboard.press('Enter');
  await expect(page.getByText('In Hearing at home 2026')).toBeVisible();
  expect(Object.keys(folder.files('Field study')).filter((p) => p.startsWith('sessions/'))).toEqual(
    [],
  );
});

test('the chat works from the keyboard: ask, Stop, the details, Copy, and Escape from a summary', async ({
  page,
}) => {
  const docs = [1, 2].map((n) => translated(germanSession(n)));
  await useProjectFolder(page, {
    'Hearing at home': {
      ...projectFiles(docs),
      ...Object.fromEntries(docs.map((d) => [summaryPath(d), summaryFileText(d)])),
    },
  });
  await page.addInitScript(() =>
    sessionStorage.setItem('describe.v1.key.claude', JSON.stringify('test-key')),
  );
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const answer = (text: string) => ({ message: agentMessage([textBlock(text)]) });
  await mockAgent(page, (n) => {
    if (n === 0) return { after: held, then: answer('Too late.') };
    if (n === 1)
      return {
        message: agentMessage([toolUseBlock('tu_1', 'search_transcripts', { query: 'charg*' })]),
      };
    return answer(
      'At night.\n\n<quote ref="s1/t2">I put them on the charger by the bed every evening.</quote>',
    );
  });
  await openHome(page);
  await tabTo(page, page.getByRole('button', { name: /^Analyse/ }));
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByRole('button', { name: 'Open project…' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(2);

  // Shift+Enter is a new line; Enter sends, and focus stays in the box.
  const question = page.getByRole('textbox', { name: 'Question' });
  await tabTo(page, question);
  await page.keyboard.type('Where do people');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('charge?');
  await expect(question).toHaveValue('Where do people\ncharge?');
  await page.keyboard.press('Enter');
  await expect(question).toHaveValue('');
  await expect(question).toBeFocused();

  // Stop is the next Tab stop, and keeps focus once it turns back into Send.
  await tabTo(page, page.getByRole('button', { name: 'Stop' }));
  await page.keyboard.press('Enter');
  await expect(page.locator('.chat-message.answer .status')).toHaveText('Stopped');
  await expect(page.getByRole('button', { name: 'Send' })).toBeFocused();
  release();

  await tabTo(page, question, { backwards: true });
  await page.keyboard.type('Where do people charge?');
  await page.keyboard.press('Enter');
  const last = page.locator('.chat-message.answer').nth(1);
  await expect(last).toContainText('At night.');

  // The details open with Enter; Copy is reachable.
  const summary = last.locator('details summary');
  await tabTo(page, summary, { backwards: true });
  await page.keyboard.press('Enter');
  await expect(last.locator('details li')).toBeVisible();
  await tabTo(page, last.getByRole('button', { name: /^Copy quote/ }), { backwards: true });

  // A summary from the list (newest first: P02), then Escape back to the chat, with focus in the box.
  const options = page.getByRole('listbox').getByRole('option');
  await tabTo(page, options.first(), { backwards: true });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 2, name: /P02/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(question).toBeFocused();
  await expect(last).toContainText('At night.');
});

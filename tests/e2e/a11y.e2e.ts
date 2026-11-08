import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';
import type { TranscriptDoc } from '../../src/domain/transcript';
import {
  clickInHeader,
  expect,
  fixture,
  goToGlossary,
  isSummaryCall,
  mockAnthropic,
  mockAgent,
  mockElevenLabs,
  ok,
  openApp,
  openSettings,
  openHome,
  projectAnswer,
  reloadApp,
  run,
  test,
  TONE_12S_WAV,
  TONE_WAV,
  useProjectFolder,
  withoutFolderAccess,
  openSearch,
} from './helpers';
import { PROJECT_FILE } from '../../src/domain/sessionFiles';
import { agentMessage, apiError, textBlock } from '../../src/testing/agent';
import { makeCorpus } from '../../src/testing/corpus';
import {
  projectFiles,
  summaryFileText,
  summaryPath,
  transcriptFileText,
  transcriptPath,
} from '../../src/testing/projectSeed';
import { germanSession, translated } from './sessionDocs';

// axe-core on Home, every step, every dialog, every Project state and the chat (Phases 8, 11, 14 and 17). Serious and critical violations fail the test;
// moderate and minor ones are attached to the report for a look.

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectAccessible(page: Page, testInfo: TestInfo, state: string) {
  // Checked at rest: a name still fading in the top row, or a quote still growing, fails checks it passes once
  // still. The spinner's endless animation doesn't count.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) => a.playState !== 'running' || !Number.isFinite(a.effect?.getComputedTiming().endTime),
      ),
  );
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const describe = (v: (typeof violations)[number]) =>
    `${v.id} (${v.impact}): ${v.help} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`;
  const minor = violations.filter((v) => v.impact !== 'serious' && v.impact !== 'critical');
  if (minor.length > 0) {
    testInfo.annotations.push({
      type: `axe: ${state}`,
      description: minor.map(describe).join('\n'),
    });
  }
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map(describe), `serious or critical axe violations: ${state}`).toEqual([]);
}

/**
 * Transcribes a test recording, so the audio is attached and turns can be played. By default the German
 * transcript, which can be translated.
 */
async function transcribe(page: Page, german = true) {
  await mockElevenLabs(page, () => ok(0, german ? 'two-speakers-short' : 'tone-12s'));
  await openApp(page);
  if (german) await goToGlossary(page);
  else await goToGlossary(page, TONE_12S_WAV, '00:00:12');
  await run(page);
  await expect(page.locator('li.turn')).toHaveCount(german ? 5 : 4);
}

test('Home, idle and while transcribing, and Project with no project', async ({
  page,
}, testInfo) => {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await mockElevenLabs(page, async () => {
    await released;
    return { status: 200, body: fixture('two-speakers-short') };
  });
  await openHome(page);
  await expectAccessible(page, testInfo, 'Home');

  const project = page.getByRole('button', { name: 'Analyse' });
  await project.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Analyse' })).toBeFocused();
  await expectAccessible(page, testInfo, 'Project, no project');

  await clickInHeader(page, 'Home');
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await goToGlossary(page);
  await run(page);
  await clickInHeader(page, 'Home');
  const transcribe = page.getByRole('button', { name: 'Transcribe' });
  await expect(transcribe).toHaveAccessibleName('Transcribe Transcribing…');
  await expectAccessible(page, testInfo, 'Home, transcribing');

  release();
  await expect(transcribe).toHaveAccessibleName('Transcribe');
});

test('Setup, empty and filled in, with Options open', async ({ page }, testInfo) => {
  await openApp(page);
  await expectAccessible(page, testInfo, 'Setup, empty');

  await openSettings(page);
  await expectAccessible(page, testInfo, 'Settings, empty');
  await page.getByText('Licences', { exact: true }).click();
  await expect(page.getByLabel('Licence texts')).toBeVisible();
  await expectAccessible(page, testInfo, 'Settings, licences open');
  await page.getByLabel('ElevenLabs API key').fill('test-key');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.locator('input[type="file"]').setInputFiles(TONE_12S_WAV);
  await expect(page.getByText('00:00:12')).toBeVisible();
  await expectAccessible(page, testInfo, 'Setup, filled in');
  await page.getByRole('heading', { level: 2, name: 'Options' }).getByRole('button').click();
  await expectAccessible(page, testInfo, 'Setup, options open');
});

test('Glossary with valid and invalid terms', async ({ page }, testInfo) => {
  await openApp(page);
  await goToGlossary(page);
  await expectAccessible(page, testInfo, 'Glossary, empty');
  await page.getByLabel('Add terms').fill('Oticon\nHörgerät\nA term with {braces}');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expectAccessible(page, testInfo, 'Glossary with terms');
});

test('Output with a playing transcript and a translation, and its dialogs', async ({
  page,
}, testInfo) => {
  await mockAnthropic(page);
  await transcribe(page);
  await page.locator('li.turn').nth(1).getByRole('button').click();
  await expectAccessible(page, testInfo, 'Output, playing');

  await page.getByRole('button', { name: 'Translate to English' }).click();
  const translateDialog = page.getByRole('dialog', { name: 'Translate to English' });
  await expect(translateDialog).toBeVisible();
  await expectAccessible(page, testInfo, 'Translate dialog');
  await translateDialog.getByLabel('Claude (Anthropic) API key').fill('test-key');
  await translateDialog.getByRole('button', { name: 'Translate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Re-translate…' })).toBeVisible();
  await expectAccessible(page, testInfo, 'Output, English');

  await page.getByRole('button', { name: 'Edit text' }).click();
  await expect(page.locator('li.turn textarea')).toHaveCount(5);
  await expectAccessible(page, testInfo, 'Output, editing');
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Download .docx' }).click();
  await expect(page.getByRole('dialog', { name: 'Which version?' })).toBeVisible();
  await expectAccessible(page, testInfo, 'Export dialog');
  await page.keyboard.press('Escape');

  await openSettings(page);
  await expectAccessible(page, testInfo, 'Settings, with a key');
  await page.getByRole('button', { name: 'Clear saved data…' }).click();
  await expect(page.getByRole('dialog', { name: 'Clear saved data?' })).toBeVisible();
  await expectAccessible(page, testInfo, 'Clear saved data confirmation');
});

test('the Run confirmation and a failed run', async ({ page, consoleErrors }, testInfo) => {
  await mockElevenLabs(page, async (n) =>
    n === 0 ? ok() : { status: 429, body: fixture('error-429') },
  );
  await openApp(page);
  await goToGlossary(page);
  await run(page);
  await expect(page.locator('li.turn')).toHaveCount(5);

  await clickInHeader(page, 'Glossary');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('dialog', { name: 'Start a new transcription?' })).toBeVisible();
  await expectAccessible(page, testInfo, 'Run confirmation');
  await page.getByRole('dialog').getByRole('button', { name: 'Run' }).click();

  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expectAccessible(page, testInfo, 'Output, failed run');
  // Chromium logs the mocked 429 as a failed resource load.
  consoleErrors.splice(0, consoleErrors.length, ...consoleErrors.filter((e) => !/429/.test(e)));
});

test('attaching a different recording after a reload asks first', async ({ page }, testInfo) => {
  await transcribe(page, false);
  await reloadApp(page);
  await page.getByRole('button', { name: 'Open' }).click();
  await expectAccessible(page, testInfo, 'Output, no audio');

  await page.getByTestId('audio-bar').locator('input[type="file"]').setInputFiles(TONE_WAV);
  await expect(page.getByRole('dialog', { name: 'Use this recording?' })).toBeVisible();
  await expectAccessible(page, testInfo, 'Mismatch confirmation');
});

test('Project: the chat settings', async ({ page }, testInfo) => {
  const { docs } = makeCorpus({ hours: 1, seed: 3 });
  await useProjectFolder(page, { 'Hearing at home': projectFiles(docs) });
  await openHome(page);
  await page.getByRole('button', { name: 'Analyse' }).click();
  await page.getByRole('button', { name: 'Open project…' }).click();
  await expect(page.getByRole('heading', { name: /^Sessions/ })).toBeVisible();

  await page.getByRole('button', { name: 'Chat settings' }).click();
  await expect(page.getByRole('group', { name: 'Chat settings' })).toBeVisible();
  await expectAccessible(page, testInfo, 'Project, chat settings');
  await page.locator('legend', { hasText: 'Tool calls' }).hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await expectAccessible(page, testInfo, 'Project, chat settings, an explanation');
});

test('Project: every state, search results and the Brief dialog', async ({ page }, testInfo) => {
  const { docs } = makeCorpus({ hours: 8, seed: 3 });
  const copy = transcriptPath(docs[0]!).replace('.transcript.json', '.transcript-LAPTOP.json');
  const folder = await useProjectFolder(page, {
    'Hearing at home': {
      ...projectFiles(docs),
      [copy]: transcriptFileText(docs[0]!, '2020-01-01T00:00:00.000Z'),
      'sessions/broken--12345678.transcript.json': '{',
    },
    Broken: { [PROJECT_FILE]: '{' },
  });
  await openHome(page);
  await page.getByRole('button', { name: 'Analyse' }).click();

  // Loading: hold the reads to see it.
  const release = await folder.holdReads('sessions/');
  await page.getByRole('button', { name: 'Open project…' }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expectAccessible(page, testInfo, 'Project, loading');
  await release();

  // Ready, with the problems open.
  await expect(page.getByRole('heading', { name: /^Sessions/ })).toBeVisible();
  await page.locator('details.problems summary').click();
  await expectAccessible(page, testInfo, 'Project, ready');

  // Search in the chat pane: empty, with results, and a bad query.
  const box = await openSearch(page);
  await expectAccessible(page, testInfo, 'Project, search');
  await box.fill('the OR die OR le');
  await expect(page.locator('li.result').first()).toBeVisible();
  await expectAccessible(page, testInfo, 'Project, search results');
  const toggle = page.locator('button.hit-toggle').first();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expectAccessible(page, testInfo, 'Project, search hit open');
  await page
    .locator('li.result')
    .first()
    .getByRole('button', { name: /^Show all/ })
    .click();
  await expect(page.getByRole('button', { name: /^Show fewer/ })).toBeVisible();
  await expectAccessible(page, testInfo, 'Project, search all hits');
  await box.fill('"charger');
  await expect(page.getByText('Close the quotation marks.')).toBeVisible();
  await expectAccessible(page, testInfo, 'Project, bad query');

  // The Brief dialog.
  await page.getByRole('button', { name: 'Brief' }).click();
  await expect(page.getByRole('dialog', { name: 'Brief' })).toBeVisible();
  await expectAccessible(page, testInfo, 'Brief dialog');
  await page.keyboard.press('Escape');

  // Change: the chooser, with a refused folder's notice.
  await page.getByRole('button', { name: 'Change' }).click();
  await folder.pickNext('Broken');
  await page.getByRole('button', { name: 'Open project…' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expectAccessible(page, testInfo, 'Project, Change');
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Error: the project file became damaged.
  await folder.put('Hearing at home', PROJECT_FILE, '{');
  await page.reload();
  await page.getByRole('button', { name: /^Analyse/ }).click();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expectAccessible(page, testInfo, 'Project, error');

  // Reconnect, and Home with a remembered project.
  await folder.setPermission('prompt');
  await page.reload();
  await expect(page.getByRole('button', { name: /^Analyse / })).toBeVisible();
  await expectAccessible(page, testInfo, 'Home, with a project');
  await page.getByRole('button', { name: /^Analyse/ }).click();
  await expect(page.getByRole('button', { name: /^Reconnect/ })).toBeVisible();
  await expectAccessible(page, testInfo, 'Project, reconnect');
});

test('Project in a browser without folder access', async ({ page }, testInfo) => {
  await withoutFolderAccess(page);
  await openHome(page);
  await page.getByRole('button', { name: 'Analyse' }).click();
  await expect(page.getByText("This browser can't open project folders.")).toBeVisible();
  await expectAccessible(page, testInfo, 'Project, unsupported');
});

test('the Project dropdown in Add to project, and the recent projects under Change', async ({
  page,
}, testInfo) => {
  const folder = await useProjectFolder(
    page,
    {
      'Hearing at home': projectFiles([]),
      'Field study': projectFiles([], {
        id: '99999999-0000-4000-8000-000000000000',
        name: 'Field study Lyon',
      }),
    },
    { pick: 'Hearing at home' },
  );
  await transcribe(page);

  await page.getByRole('button', { name: 'Add to project…' }).click();
  await page.getByRole('button', { name: 'Open project…' }).click();
  const one = page.getByRole('dialog', { name: 'Add to “Hearing at home 2026”' });
  await expect(one).toBeVisible();
  await expectAccessible(page, testInfo, 'Add to project, one project known');
  await folder.pickNext('Field study');
  await one.getByRole('button', { name: 'Open another project…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add to project' });
  await expect(dialog.getByLabel('Project', { exact: true })).toBeVisible();
  await expectAccessible(page, testInfo, 'Add to project, Project dropdown');
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await clickInHeader(page, 'Home');
  await page.getByRole('button', { name: /^Analyse/ }).click();
  await page.getByRole('button', { name: 'Change' }).click();
  await expect(page.getByRole('group', { name: 'Recent projects' })).toBeVisible();
  await expectAccessible(page, testInfo, 'Project, Change with recent projects');
});

test('Add to project, its progress and error, the folder notice, and a summary', async ({
  page,
  consoleErrors,
}, testInfo) => {
  const seeded = translated(germanSession(7));
  const folder = await useProjectFolder(page, {
    'Hearing at home': {
      ...projectFiles([seeded, germanSession(8)]),
      [summaryPath(seeded)]: summaryFileText(seeded),
    },
  });
  let summaries = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await mockAnthropic(page, async (call, n) => {
    if (!isSummaryCall(call)) return projectAnswer(call, n);
    summaries++;
    // The first summary is held, then the next two come back unreadable (a failure), then they work.
    if (summaries === 1) await held;
    if (summaries === 1 || summaries === 2) return { not: 'a summary' };
    return projectAnswer(call, n);
  });
  await transcribe(page);

  await page.getByRole('button', { name: 'Add to project…' }).click();
  await expect(page.getByRole('dialog', { name: 'Add to project' })).toBeVisible();
  await expectAccessible(page, testInfo, 'Add to project, no project');
  await page.getByRole('button', { name: 'Open project…' }).click();
  await expect(page.getByRole('dialog', { name: 'Add to “Hearing at home 2026”' })).toBeVisible();
  await expectAccessible(page, testInfo, 'Add to project, project open, key missing');
  await page.getByLabel('Claude (Anthropic) API key').fill('test-key');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await expect(page.locator('.status-line')).toContainText('Adding to project · summarising');
  await expectAccessible(page, testInfo, 'Output, adding to project');
  release();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  await expectAccessible(page, testInfo, 'Output, adding failed');
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByRole('button', { name: 'Resume' })).toHaveCount(0);
  await expect(page.locator('.status-line')).toHaveCount(0);

  const name = Object.keys(folder.files('Hearing at home')).find(
    (p) => p.endsWith('.transcript.json') && p.includes('tone-5s'),
  )!;
  const file = JSON.parse(folder.files('Hearing at home')[name]!) as { doc: TranscriptDoc };
  await folder.put('Hearing at home', name, transcriptFileText({ ...file.doc, createdAt: 'x' }));
  await page.getByLabel('Name for Speaker 1').fill('Interviewer');
  await expect(page.getByRole('button', { name: 'Keep mine' })).toBeVisible();
  await expectAccessible(page, testInfo, 'Output, the folder notice');

  await clickInHeader(page, 'Home');
  await page.getByRole('button', { name: /^Analyse/ }).click();
  const list = page.getByRole('listbox').getByRole('option');
  await list.filter({ hasText: 'P07' }).click();
  await expect(page.locator('.themes .quote-card').first()).toBeVisible();
  await page.locator('details.details summary').click();
  await expectAccessible(page, testInfo, 'Analyse, a summary');

  await page.getByRole('button', { name: /^Summarise all/ }).click();
  await expect(page.getByRole('dialog', { name: 'Summarise all' })).toBeVisible();
  await expectAccessible(page, testInfo, 'Analyse, Summarise all');
  consoleErrors.length = 0;
});

test('the chat: empty, the key dialog, answering, an answer, an error, and the notices', async ({
  page,
  consoleErrors,
}, testInfo) => {
  const docs = [1, 2].map((n) => translated(germanSession(n)));
  const folder = await useProjectFolder(page, {
    'Hearing at home': {
      ...projectFiles(docs),
      ...Object.fromEntries(docs.map((d) => [summaryPath(d), summaryFileText(d)])),
    },
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const quote = 'I put them on the charger by the bed every evening.';
  await mockAgent(page, (n) => {
    if (n === 0)
      return {
        after: held,
        then: {
          message: agentMessage([
            textBlock(
              `**Most** charge at night.\n\n<quote ref="s1/t2">${quote}</quote>\n\n<quote ref="s2/t2">Not said</quote>`,
            ),
          ]),
        },
      };
    return { status: 429, body: apiError('rate_limit_error', 'Rate limited') };
  });
  await openHome(page);
  await page.getByRole('button', { name: /^Analyse/ }).click();
  await page.getByRole('button', { name: 'Open project…' }).click();
  await expect(page.getByRole('heading', { name: /^Sessions/ })).toBeVisible();
  await expectAccessible(page, testInfo, 'Analyse, the empty chat');

  const question = page.getByRole('textbox', { name: 'Question' });
  await question.fill('Where do people charge?');
  await question.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Ask about the project' });
  await expect(dialog).toBeVisible();
  await expectAccessible(page, testInfo, 'Chat, the key dialog');
  await dialog.getByLabel('Claude (Anthropic) API key').fill('test-key');
  await dialog.getByRole('button', { name: 'Ask' }).click();

  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await expectAccessible(page, testInfo, 'Chat, answering');
  release();
  const answer = page.locator('.chat-message.answer').first();
  await expect(answer.locator('.quote-card')).toHaveCount(2);
  await expectAccessible(page, testInfo, 'Chat, an answer with quotes');

  // The answer is saved: the Chats tab lists it (D29).
  await page.getByRole('tab', { name: /^Chats/ }).click();
  await expect(page.getByRole('option', { name: /^Where do people charge\?/ })).toBeVisible();
  await expectAccessible(page, testInfo, 'Analyse, the Chats tab');
  await page.getByRole('tab', { name: /^Sessions/ }).click();

  await question.fill('And who helps?');
  await question.press('Enter');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expectAccessible(page, testInfo, 'Chat, an error');

  const added = translated(germanSession(3));
  await folder.put('Hearing at home', transcriptPath(added), transcriptFileText(added));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByLabel('Model').selectOption({ label: 'Opus 5.5' });
  await expect(page.locator('.chat-pane .notice')).toHaveCount(2);
  await expectAccessible(page, testInfo, 'Chat, the notices');
  // Chromium logs the mocked 429 as a failed resource load.
  consoleErrors.splice(0, consoleErrors.length, ...consoleErrors.filter((e) => !/429/.test(e)));
});

test('Analyse with a Gemini model: the grouped model select and the Gemini key dialogs', async ({
  page,
}, testInfo) => {
  await useProjectFolder(page, { 'Hearing at home': projectFiles([germanSession(7)]) });
  await openHome(page);
  await page.getByRole('button', { name: /^Analyse/ }).click();
  await page.getByRole('button', { name: 'Open project…' }).click();
  await expect(page.getByRole('heading', { name: /^Sessions/ })).toBeVisible();
  await page.getByLabel('Model').selectOption({ label: 'Gemini 3.8 Flash' });
  await expectAccessible(page, testInfo, 'Analyse, a Gemini model');

  const question = page.getByRole('textbox', { name: 'Question' });
  await question.fill('Where do people charge?');
  await question.press('Enter');
  const ask = page.getByRole('dialog', { name: 'Ask about the project' });
  await expect(ask.getByLabel('Gemini (Google) API key')).toBeVisible();
  await expect(ask).toContainText('are sent to Google');
  await expectAccessible(page, testInfo, 'Chat, the Gemini key');
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(question).toBeFocused();

  await page.getByRole('listbox').getByRole('option').first().click();
  await page.getByRole('button', { name: 'Summarise', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Summarise' });
  await expect(dialog.getByLabel('Gemini (Google) API key')).toBeVisible();
  await expectAccessible(page, testInfo, 'Summarise, the Gemini key');
});

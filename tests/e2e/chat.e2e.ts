import type { Page } from '@playwright/test';
import { agentMessage, apiError, textBlock, toolUseBlock } from '../../src/testing/agent';
import { functionCallPart, geminiTurn, geminiUsage, textPart } from '../../src/testing/geminiAgent';
import {
  projectFiles,
  summaryFileText,
  summaryPath,
  transcriptFileText,
  transcriptPath,
} from '../../src/testing/projectSeed';
import {
  enterProject,
  expect,
  mockAgent,
  mockGeminiAgent,
  openHome,
  test,
  useProjectFolder,
  type AgentReply,
} from './helpers';
import { germanSession, translated } from './sessionDocs';

// Phase 17: the project chat in Analyse mode. Claude is mocked with scripted streamed replies: tool calls, which run
// for real on the seeded project, then an answer.

const ROOT = 'Hearing at home';
const DOCS = [1, 2].map((n) => translated(germanSession(n)));
const SEEDED = {
  [ROOT]: {
    ...projectFiles(DOCS),
    ...Object.fromEntries(DOCS.map((d) => [summaryPath(d), summaryFileText(d)])),
  },
};

/** s1 is P01 (the oldest recording); its t2 is "I put them on the charger by the bed every evening." */
const QUOTE = 'I put them on the charger by the bed every evening.';
const CITATION = `"${QUOTE}" — Speaker 2, 00:00:10, Summary of P01 Hamburg home visit.m4a (translated from German)`;

/** About $0.30 a request with Sonnet 5.5. */
const USAGE = {
  input_tokens: 100_000,
  output_tokens: 10_000,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

const search = (query: string): AgentReply => ({
  message: agentMessage([toolUseBlock(`tu_${query}`, 'search_transcripts', { query })], {
    usage: USAGE,
  }),
});
const says = (text: string): AgentReply => ({
  message: agentMessage([textBlock(text)], { usage: USAGE }),
});

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** Opens the seeded project in Analyse mode, with the Claude key stored for this tab. */
async function openChat(page: Page, withKey = true) {
  if (withKey) {
    await page.addInitScript(() =>
      sessionStorage.setItem('describe.v1.key.claude', JSON.stringify('test-key')),
    );
  }
  await openHome(page);
  await enterProject(page);
  await page.getByRole('button', { name: 'Open project…' }).click();
  await expect(page.getByRole('heading', { name: /^Sessions/ })).toBeVisible();
}

const question = (page: Page) => page.getByRole('textbox', { name: 'Question' });
const answers = (page: Page) => page.locator('.chat-message.answer');

async function ask(page: Page, text: string) {
  await question(page).fill(text);
  await question(page).press('Enter');
}

test('a question streams an answer with its activity, cost and a checked quote that copies', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await useProjectFolder(page, SEEDED);
  const calls = await mockAgent(page, (n) =>
    n === 0
      ? search('charg*')
      : says(`Most people charge at night.\n\n<quote ref="s1/t2">${QUOTE}</quote>`),
  );
  await openChat(page);

  await ask(page, 'Where do people charge?');
  const answer = answers(page).first();
  await expect(answer).toContainText('Most people charge at night.');
  await expect(page.getByRole('status').filter({ hasText: 'Answer ready' })).toBeAttached();
  await expect(question(page)).toBeFocused();
  expect(calls).toHaveLength(2);
  expect(calls[0]!.key).toBe('test-key');
  expect(calls[0]!.body.tools.map((t) => t.name)).toContain('search_transcripts');

  // The details: collapsed, with the summary line, opening to the activity.
  const details = answer.locator('details');
  await expect(details.locator('summary')).toHaveText('1 search · ≈ $0.60');
  await expect(details.locator('li')).toBeHidden();
  await details.locator('summary').click();
  await expect(details.locator('li')).toHaveText([/^Searched "charg\*"/]);

  const card = answer.locator('.quote-card');
  await expect(card.locator('blockquote')).toHaveText(`“${QUOTE}”`);
  await expect(card.locator('.source')).toHaveText(
    'Speaker 2 · 00:00:10 · Summary of P01 Hamburg home visit.m4a · translated from German',
  );
  await card.getByRole('button', { name: /^Copy quote: I put them on the charger/ }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CITATION);
});

test('with Gemini, a question runs a function call, streams a checked quote that copies, and echoes the signature', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await useProjectFolder(page, SEEDED);
  await page.addInitScript(() =>
    sessionStorage.setItem('describe.v1.key.gemini', JSON.stringify('test-key-gemini')),
  );
  const claude = await mockAgent(page, () => says('Not Claude.'));
  // About $0.23 a request with Gemini 3.8 Flash: 0.1M in × $1.50 + 0.01M out × $7.50.
  const usage = geminiUsage(100_000, 10_000);
  const calls = await mockGeminiAgent(page, (n) =>
    n === 0
      ? {
          response: geminiTurn(
            [functionCallPart('search_transcripts', { query: 'charg*' }, { signature: 'sig-e2e' })],
            { usage },
          ),
        }
      : {
          response: geminiTurn(
            [textPart(`Most people charge at night.\n\n<quote ref="s1/t2">${QUOTE}</quote>`)],
            { usage },
          ),
        },
  );
  await openChat(page, false);
  await page.getByLabel('Model').selectOption({ label: 'Gemini 3.8 Flash' });

  await ask(page, 'Where do people charge?');
  const answer = answers(page).first();
  await expect(answer).toContainText('Most people charge at night.');
  await expect(page.getByRole('status').filter({ hasText: 'Answer ready' })).toBeAttached();
  expect(claude).toHaveLength(0);
  expect(calls).toHaveLength(2);
  expect(calls[0]!.key).toBe('test-key-gemini');
  expect(calls[0]!.url).toContain('/models/gemini-3.8-flash:streamGenerateContent?alt=sse');
  expect(calls[0]!.body.tools[0]!.functionDeclarations.map((f) => f.name)).toContain(
    'search_transcripts',
  );
  // The model's turn goes back as it came, its thought signature included, then the function's response.
  const contents = calls[1]!.body.contents;
  expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
  expect(contents[1]!.parts[0]).toEqual({
    functionCall: { name: 'search_transcripts', args: { query: 'charg*' } },
    thoughtSignature: 'sig-e2e',
  });
  expect(contents[2]!.parts[0]).toMatchObject({
    functionResponse: { name: 'search_transcripts', response: { output: expect.any(String) } },
  });

  const details = answer.locator('details');
  await expect(details.locator('summary')).toHaveText('1 search · ≈ $0.45');
  await details.locator('summary').click();
  await expect(details.locator('li')).toHaveText([/^Searched "charg\*"/]);

  const card = answer.locator('.quote-card');
  await expect(card.locator('blockquote')).toHaveText(`“${QUOTE}”`);
  await card.getByRole('button', { name: /^Copy quote: I put them on the charger/ }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CITATION);
});

test('an invented quote is marked and has no Copy', async ({ page }) => {
  await useProjectFolder(page, SEEDED);
  await mockAgent(page, () =>
    says(
      [
        `<quote ref="s1/t2">${QUOTE}</quote>`,
        '<quote ref="s2/t4">Then I always take the charger with me</quote>',
        '<quote ref="s1/t4">I never charge them at all</quote>',
        'Text that looks like <b>HTML</b> stays text.',
      ].join('\n'),
    ),
  );
  await openChat(page);

  await ask(page, 'Quotes about charging?');
  const answer = answers(page).first();
  const cards = answer.locator('.quote-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(2)).toContainText('Not found in the transcript');
  await expect(cards.nth(2).getByRole('button')).toHaveCount(0);
  await expect(answer).toContainText('Text that looks like <b>HTML</b> stays text.');
  await expect(answer.locator('b')).toHaveCount(0);
  await expect(answer.getByRole('button', { name: 'Copy all quotes' })).toHaveCount(0);
});

test('a follow-up carries the earlier turns; New chat starts afresh', async ({ page }) => {
  await useProjectFolder(page, SEEDED);
  const calls = await mockAgent(page, (n) => says(`Answer ${n + 1}.`));
  await openChat(page);

  await ask(page, 'First question?');
  await expect(answers(page).first()).toContainText('Answer 1.');
  await ask(page, 'Second question?');
  await expect(answers(page).nth(1)).toContainText('Answer 2.');

  const followUp = calls[1]!.body.messages;
  expect(followUp.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  expect(JSON.stringify(followUp[0])).toContain('First question?');
  expect(JSON.stringify(followUp[1])).toContain('Answer 1.');

  await page.getByRole('tab', { name: /^Chats/ }).click();
  await page.getByRole('button', { name: 'New chat' }).click();
  await expect(page.locator('.chat-message')).toHaveCount(0);
  await expect(question(page)).toBeFocused();

  await ask(page, 'Third question?');
  await expect(answers(page).first()).toContainText('Answer 3.');
  expect(calls[2]!.body.messages.map((m) => m.role)).toEqual(['user']);
});

test('Stop ends the answer at once, keeps what was written, and the next question works', async ({
  page,
}) => {
  await useProjectFolder(page, SEEDED);
  const hold = deferred();
  const calls = await mockAgent(page, (n) => {
    if (n === 0)
      return {
        message: agentMessage([
          textBlock('Let me look through the sessions.'),
          toolUseBlock('tu_1', 'search_transcripts', { query: 'charg*' }),
        ]),
      };
    if (n === 1) return { after: hold.promise, then: says('Too late.') };
    return says('A fresh answer.');
  });
  await openChat(page);

  await ask(page, 'Where do people charge?');
  const answer = answers(page).first();
  await expect(answer).toContainText('Let me look through the sessions.');
  await expect.poll(() => calls.length).toBe(2);
  await page.getByRole('button', { name: 'Stop' }).click();

  await expect(answer.locator('.status')).toHaveText('Stopped');
  await expect(answer).toContainText('Let me look through the sessions.');
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();

  await ask(page, 'Try once more?');
  await expect(answers(page).nth(1)).toContainText('A fresh answer.');
  // The stopped question isn't part of the conversation.
  expect(calls[2]!.body.messages.map((m) => m.role)).toEqual(['user']);
  hold.resolve();
});

test('a session added during the chat shows the notice, and its New chat starts afresh', async ({
  page,
}) => {
  const folder = await useProjectFolder(page, SEEDED);
  await mockAgent(page, () => says('An answer.'));
  await openChat(page);
  await ask(page, 'Where do people charge?');
  await expect(answers(page).first()).toContainText('An answer.');

  const added = translated(germanSession(3));
  await folder.put(ROOT, transcriptPath(added), transcriptFileText(added));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));

  const notice = page.locator('.chat-pane .notice');
  await expect(notice).toHaveText(/1 new session since this chat started\./);
  await notice.getByRole('button', { name: 'New chat' }).click();
  await expect(page.locator('.chat-message')).toHaveCount(0);
  await expect(notice).toHaveCount(0);
});

test('a 429 shows the message in place of the answer, and Try again asks again', async ({
  page,
  consoleErrors,
}) => {
  await useProjectFolder(page, SEEDED);
  const calls = await mockAgent(page, (n) =>
    n === 0
      ? {
          status: 429,
          body: apiError('rate_limit_error', 'Number of requests has exceeded your rate limit'),
        }
      : says('It worked this time.'),
  );
  await openChat(page);

  await ask(page, 'Where do people charge?');
  const answer = answers(page).first();
  await expect(answer.locator('.error')).toBeVisible();
  await expect(answer.getByRole('button', { name: 'Try again' })).toBeVisible();

  await answer.getByRole('button', { name: 'Try again' }).click();
  await expect(answers(page).first()).toContainText('It worked this time.');
  await expect(page.locator('.chat-message')).toHaveCount(2);
  expect(calls[1]!.body.messages.map((m) => m.role)).toEqual(['user']);
  // Chromium logs the mocked 429 as a failed resource load.
  consoleErrors.splice(0, consoleErrors.length, ...consoleErrors.filter((e) => !/429/.test(e)));
});

test('a missing Claude key opens the key dialog before asking', async ({ page }) => {
  await useProjectFolder(page, SEEDED);
  const calls = await mockAgent(page, () => says('Answered with the new key.'));
  await openChat(page, false);

  await ask(page, 'Where do people charge?');
  const dialog = page.getByRole('dialog', { name: 'Ask about the project' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Ask' })).toBeDisabled();
  await dialog.getByLabel('Claude (Anthropic) API key').fill('test-key');
  await dialog.getByRole('button', { name: 'Ask' }).click();

  await expect(answers(page).first()).toContainText('Answered with the new key.');
  expect(calls[0]!.key).toBe('test-key');
});

test('a long chat suggests /compact, which summarises it; the next question carries only the summary', async ({
  page,
}) => {
  await useProjectFolder(page, SEEDED);
  const SUMMARY = 'You asked where people charge: at night, by the bed (s1).';
  const calls = await mockAgent(page, (n) =>
    n === 0
      ? {
          message: agentMessage([textBlock('At night.')], {
            usage: { ...USAGE, input_tokens: 700_000 },
          }),
        }
      : says(n === 1 ? SUMMARY : 'Her husband helps.'),
  );
  await openChat(page);

  await ask(page, 'Where do people charge?');
  const notice = page.locator('.chat-pane .notice');
  await expect(notice).toHaveText(
    'This chat is long. Type /compact to summarise it, or start a new chat.',
  );

  await ask(page, '/compact keep the quotes');
  await expect(page.getByRole('status').filter({ hasText: 'Chat compacted' })).toBeAttached();
  const divider = page.locator('.chat-compaction');
  await expect(divider.locator('summary')).toHaveText('Earlier messages summarised');
  await expect(notice).toHaveCount(0);
  // The earlier question and answer stay on screen; the command isn't a question.
  await expect(page.locator('.chat-message')).toHaveCount(2);

  // The summary is asked for on the same prefix, so it is read from the cache.
  const [asked, summarised] = calls.map((c) => c.body);
  expect(summarised!.system).toEqual(asked!.system);
  expect(summarised!.tools).toEqual(asked!.tools);
  expect(summarised!.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  expect(JSON.stringify(summarised!.messages[2])).toContain(
    'The researcher asked you to keep this in particular: keep the quotes',
  );

  await divider.locator('summary').click();
  await expect(divider.locator('.summary')).toContainText(SUMMARY);

  await ask(page, 'Who helps?');
  await expect(answers(page).nth(1)).toContainText('Her husband helps.');
  const after = calls[2]!.body.messages;
  expect(after.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  expect(after[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: SUMMARY }] });
  expect(after[2]).toEqual({ role: 'user', content: 'Who helps?' });
  expect(JSON.stringify(after)).not.toContain('Where do people charge?');
});

import type { Page } from '@playwright/test';
import type { ChatFile } from '../../src/domain/chat';
import { agentMessage, textBlock } from '../../src/testing/agent';
import {
  chatFileText,
  chatPath,
  COLLEAGUE,
  makeChatFile,
  projectFiles,
  summaryFileText,
  summaryPath,
} from '../../src/testing/projectSeed';
import {
  enterProject,
  expect,
  mockAgent,
  openHome,
  test,
  useProjectFolder,
  type AgentReply,
  type ProjectFolderHarness,
} from './helpers';
import { germanSession, translated } from './sessionDocs';

// Phase 21 (DECISIONS.md D29): chats are saved in the project folder's chats/, listed under the sidebar's Chats tab,
// opened again after a reload and resumed; a colleague's chat is read, and asking in it saves a copy.

const ROOT = 'Hearing at home';
const DOCS = [1, 2].map((n) => translated(germanSession(n)));
const SEEDED = {
  ...projectFiles(DOCS),
  ...Object.fromEntries(DOCS.map((d) => [summaryPath(d), summaryFileText(d)])),
};

/** s1 is P01 (the oldest recording); its t2 is this. */
const QUOTE = 'I put them on the charger by the bed every evening.';
const ANSWER = `Most people charge at night.\n\n<quote ref="s1/t2">${QUOTE}</quote>`;

const says = (text: string): AgentReply => ({ message: agentMessage([textBlock(text)]) });

const question = (page: Page) => page.getByRole('textbox', { name: 'Question' });
const answers = (page: Page) => page.locator('.chat-message.answer');
const chatsTab = (page: Page) => page.getByRole('tab', { name: /^Chats/ });

async function ask(page: Page, text: string) {
  await question(page).fill(text);
  await question(page).press('Enter');
}

/** Opens the seeded project in Analyse mode, with the Claude key stored for this tab. */
async function openProject(page: Page) {
  await page.addInitScript(() =>
    sessionStorage.setItem('describe.v1.key.claude', JSON.stringify('test-key')),
  );
  await openHome(page);
  await enterProject(page);
  await page.getByRole('button', { name: 'Open project…' }).click();
  await expect(page.getByRole('heading', { name: /^Sessions/ })).toBeAttached();
}

/** The chat files in the folder, read back as the app wrote them. */
function chatFiles(folder: ProjectFolderHarness): [string, ChatFile][] {
  return Object.entries(folder.files(ROOT))
    .filter(([path]) => path.startsWith('chats/'))
    .map(([path, text]) => [path, JSON.parse(text) as ChatFile]);
}

test('a chat is saved, listed, opened again after a reload, and goes on in the same file', async ({
  page,
}) => {
  const folder = await useProjectFolder(page, { [ROOT]: SEEDED });
  const calls = await mockAgent(page, (n) => says(n === 0 ? ANSWER : 'Yes, every evening.'));
  await openProject(page);
  await expect(chatsTab(page)).toHaveText('Chats 0');

  await ask(page, 'Where do people charge?');
  await expect(answers(page).first()).toContainText('Most people charge at night.');
  await expect.poll(() => chatFiles(folder).length).toBe(1);
  const [[path, saved]] = chatFiles(folder) as [[string, ChatFile]];
  expect(path).toMatch(/^chats\/\d{4}-\d{2}-\d{2}-\d{4}--[0-9a-f]{8}\.chat\.json$/);
  expect(saved).toMatchObject({
    kind: 'describe.chat',
    schemaVersion: 1,
    title: 'Where do people charge?',
    forkedFrom: null,
    sessionKeys: { [DOCS[0]!.id]: 's1', [DOCS[1]!.id]: 's2' },
  });
  expect(saved.author.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  expect(saved.messages.map((m) => [m.role, 'text' in m ? m.text : m.summary])).toEqual([
    ['user', 'Where do people charge?'],
    ['assistant', ANSWER],
  ]);
  await expect(chatsTab(page)).toHaveText('Chats 1');

  // After a reload the chat pane starts empty, and the chat is in the list.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeAttached();
  await enterProject(page);
  await expect(chatsTab(page)).toHaveText('Chats 1');
  await expect(answers(page)).toHaveCount(0);

  await chatsTab(page).click();
  const option = page.getByRole('option', { name: /^Where do people charge\?/ });
  await expect(option).toContainText('You');
  await option.click();
  await expect(option).toHaveAttribute('aria-selected', 'true');
  const card = answers(page).first().locator('.quote-card');
  await expect(card.locator('blockquote')).toHaveText(`“${QUOTE}”`);

  await ask(page, 'Every evening?');
  await expect(answers(page).nth(1)).toContainText('Yes, every evening.');
  // The earlier question and answer go back as text, quote tag included.
  expect(calls[1]!.body.messages).toEqual([
    { role: 'user', content: 'Where do people charge?' },
    { role: 'assistant', content: [{ type: 'text', text: ANSWER }] },
    { role: 'user', content: 'Every evening?' },
  ]);
  await expect.poll(() => chatFiles(folder)[0]?.[1].messages.length).toBe(4);
  const [[samePath, longer]] = chatFiles(folder) as [[string, ChatFile]];
  expect(samePath).toBe(path);
  expect(longer.id).toBe(saved.id);
  expect(longer.updatedAt > saved.updatedAt).toBe(true);
});

test("a colleague's chat is listed with their name, and asking in it saves a copy as yours", async ({
  page,
}) => {
  const theirs = makeChatFile({
    sessionKeys: { [DOCS[0]!.id]: 's1', [DOCS[1]!.id]: 's2' },
    messages: [
      { role: 'user', id: 'q1', at: '2026-10-20T14:02:00.000Z', text: 'Where do people charge?' },
      {
        role: 'assistant',
        id: 'a1',
        at: '2026-10-20T14:03:00.000Z',
        text: ANSWER,
        status: 'done',
        activity: [],
        costUsd: 0.3,
        model: 'claude-sonnet-5-5',
      },
    ],
  });
  const folder = await useProjectFolder(page, {
    [ROOT]: { ...SEEDED, [chatPath(theirs)]: chatFileText(theirs) },
  });
  await mockAgent(page, () => says('At work too, sometimes.'));
  await openProject(page);

  await chatsTab(page).click();
  const option = page.getByRole('option', { name: new RegExp(`^${theirs.title}`) });
  await expect(option).toContainText(COLLEAGUE.name);
  await option.click();
  await expect(page.locator('.chat-pane .owner')).toHaveText(
    `${COLLEAGUE.name}’s chat. Asking saves a copy as yours.`,
  );
  await expect(answers(page).first().locator('.quote-card blockquote')).toHaveText(`“${QUOTE}”`);

  await ask(page, 'And at work?');
  await expect(answers(page).nth(1)).toContainText('At work too, sometimes.');
  await expect.poll(() => chatFiles(folder).length).toBe(2);
  const copy = chatFiles(folder).find(([, file]) => file.id !== theirs.id)![1];
  expect(copy).toMatchObject({ forkedFrom: theirs.id, title: theirs.title });
  expect(copy.author.id).not.toBe(COLLEAGUE.id);
  expect(copy.messages).toHaveLength(4);
  // The colleague's file is untouched.
  expect(folder.files(ROOT)[chatPath(theirs)]).toBe(chatFileText(theirs));
  await expect(page.locator('.chat-pane .owner')).toHaveCount(0);
  // The copy is yours, and the newest.
  const options = page.locator('#sidebar-panel-chats').getByRole('option');
  await expect(options).toHaveCount(2);
  await expect(options.first()).toContainText('You');
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await expect(options.nth(1)).toContainText(COLLEAGUE.name);
});

test('selecting the open chat again shows what a colleague added to it since (audit BUG-9)', async ({
  page,
}) => {
  const theirs = makeChatFile({ sessionKeys: { [DOCS[0]!.id]: 's1', [DOCS[1]!.id]: 's2' } });
  const folder = await useProjectFolder(page, {
    [ROOT]: { ...SEEDED, [chatPath(theirs)]: chatFileText(theirs) },
  });
  await openProject(page);

  await chatsTab(page).click();
  const option = page.getByRole('option', { name: new RegExp(`^${theirs.title}`) });
  await option.click();
  await expect(answers(page)).toHaveCount(1);
  const listed = await option.textContent();

  const added: ChatFile = {
    ...theirs,
    updatedAt: '2026-10-21T09:01:00.000Z',
    messages: [
      ...theirs.messages,
      { role: 'user', id: 'q2', at: '2026-10-21T09:00:00.000Z', text: 'And at work?' },
      {
        role: 'assistant',
        id: 'a2',
        at: '2026-10-21T09:01:00.000Z',
        text: 'At work too, sometimes.',
        status: 'done',
        activity: [],
        costUsd: 0.3,
        model: 'claude-sonnet-5-5',
      },
    ],
  };
  await folder.put(ROOT, chatPath(theirs), chatFileText(added));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  // The rescan has read the newer file when the row shows its later date.
  await expect(option).not.toHaveText(listed ?? '');
  await expect(answers(page)).toHaveCount(1);

  await option.click();
  await expect(answers(page)).toHaveCount(2);
  await expect(answers(page).nth(1)).toContainText('At work too, sometimes.');
});

test('a compacted chat is saved with its summary, reopens with the divider, and goes on from the summary', async ({
  page,
}) => {
  const SUMMARY = 'You asked where people charge: at night.';
  const folder = await useProjectFolder(page, { [ROOT]: SEEDED });
  const calls = await mockAgent(page, (n) => says([ANSWER, SUMMARY, 'Yes.'][n] ?? 'More.'));
  await openProject(page);

  await ask(page, 'Where do people charge?');
  await expect(answers(page).first()).toContainText('Most people charge at night.');
  await ask(page, '/compact');
  await expect(page.locator('.chat-compaction summary')).toHaveText('Earlier messages summarised');
  await expect.poll(() => chatFiles(folder)[0]?.[1].messages.length).toBe(3);
  expect(chatFiles(folder)[0]![1].messages[2]).toMatchObject({
    role: 'compaction',
    summary: SUMMARY,
    focus: '',
  });

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeAttached();
  await enterProject(page);
  await chatsTab(page).click();
  await page.getByRole('option', { name: /^Where do people charge\?/ }).click();
  await expect(page.locator('.chat-compaction summary')).toHaveText('Earlier messages summarised');
  await expect(answers(page)).toHaveCount(1);

  await ask(page, 'Every evening?');
  await expect(answers(page).nth(1)).toContainText('Yes.');
  const sent = calls[2]!.body.messages;
  expect(sent.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  expect(JSON.stringify(sent[0])).toContain('Summarise this chat so far');
  expect(sent[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: SUMMARY }] });
  expect(sent[2]).toEqual({ role: 'user', content: 'Every evening?' });
});

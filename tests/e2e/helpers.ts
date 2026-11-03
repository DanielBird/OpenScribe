import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type Locator, type Page, type Route } from '@playwright/test';
import { claudeSse } from '../../src/testing/claudeSse';
import { geminiSse } from '../../src/testing/geminiSse';
import { summaryReplyForInput } from '../../src/testing/summary';

/** The built single file, opened the way colleagues open it: over file://. */
export const APP_URL = new URL('../../dist/describe.html', import.meta.url).href;

/**
 * Playwright's `test`, plus an automatic guard that fails the test if the page logs a console
 * error (this includes CSP violations) or throws an uncaught error. Import `test` from here, not
 * from `@playwright/test`. A test that expects an error can inspect and remove it from
 * `consoleErrors` before it ends.
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      page.on('pageerror', (err) => errors.push(`Uncaught: ${err.message}`));
      await use(errors);
      expect(errors, 'console errors during the test').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Opens dist/describe.html and waits for Home, where the app always starts. */
export async function openHome(page: Page): Promise<void> {
  await page.goto(APP_URL);
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeAttached();
}

/** Clicks Transcribe on Home and waits for the steps. */
async function enterTranscribe(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await expect(page.getByRole('navigation', { name: 'Steps' })).toBeVisible();
}

/** Opens dist/describe.html in Transcribe mode: Home, then Transcribe. */
export async function openApp(page: Page): Promise<void> {
  await openHome(page);
  await enterTranscribe(page);
}

/**
 * Clicks a page in the top row. The row names only the current page until the pointer is over it, so this points at
 * the row's left end first (away from Analyse's controls, which don't open it).
 */
export async function clickInHeader(page: Page, name: string): Promise<void> {
  const header = page.getByRole('banner');
  await header.hover({ position: { x: 1, y: 1 } });
  await header.getByRole('button', { name, exact: true }).click();
}

/** Reloads the page and goes back into Transcribe mode. Use it instead of `page.reload()`. */
export async function reloadApp(page: Page): Promise<void> {
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeAttached();
  await enterTranscribe(page);
}

/** The text of a turn in the autosaved transcript, or null. */
export const savedTurnText = (page: Page, turnId: string) =>
  page.evaluate(
    (id) =>
      new Promise<string | null>((resolve) => {
        const open = indexedDB.open('describe-v1');
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          const get = db
            .transaction('keyval')
            .objectStore('keyval')
            .get('describe.v1.lastTranscript');
          get.onsuccess = () => {
            const doc = get.result as { turns: { id: string; text: string }[] } | undefined;
            db.close();
            resolve(doc?.turns.find((t) => t.id === id)?.text ?? null);
          };
          get.onerror = () => resolve(null);
        };
      }),
    turnId,
  );

/** The 5-second test recording (`node scripts/make-test-audio.mjs`). */
export const TONE_WAV = fileURLToPath(new URL('../../fixtures/audio/tone-5s.wav', import.meta.url));

/** The 12-second recording whose pitch changes every 3 s; `fixture('tone-12s')` is its transcript. */
export const TONE_12S_WAV = fileURLToPath(
  new URL('../../fixtures/audio/tone-12s.wav', import.meta.url),
);

/** An ElevenLabs response from `fixtures/elevenlabs/`, e.g. `fixture('two-speakers-short')`. */
export const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/elevenlabs/${name}.json`, import.meta.url), 'utf8');

/** What ElevenLabs answers to any origin, including `null` from file:// (reference doc, CORS). */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
};

export interface Reply {
  status: number;
  body: string;
}

export interface SeenRequest {
  key: string | null;
  body: string;
}

/**
 * Answers each transcription request with what `reply(n)` resolves to (n = 0, 1, …). The reply can wait,
 * to keep the request in flight. Returns the requests seen.
 */
export async function mockElevenLabs(page: Page, reply: (n: number) => Promise<Reply>) {
  const requests: SeenRequest[] = [];
  await page.route('https://api.elevenlabs.io/**', async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    const n = requests.length;
    requests.push({
      key: await req.headerValue('xi-api-key'),
      body: req.postDataBuffer()?.toString('latin1') ?? '',
    });
    const { status, body } = await reply(n);
    try {
      await route.fulfill({ status, headers: CORS, contentType: 'application/json', body });
    } catch {
      // The page cancelled the request first; there is nothing left to answer.
    }
  });
  return requests;
}

/** A successful transcription with the `name` fixture, after `delayMs`. */
export const ok = (delayMs = 0, name = 'two-speakers-short') =>
  new Promise<Reply>((resolve) =>
    setTimeout(() => resolve({ status: 200, body: fixture(name) }), delayMs),
  );

/** One translation batch as the app sends it (the user message, as JSON). */
export interface LlmInput {
  glossary: string[];
  context: { speaker: string; text: string }[];
  segments: { id: string; speaker: string; text: string }[];
}

/**
 * A request to Claude or Gemini: the key header, the whole body and its user message. `input` is the message read
 * as a translation batch; reading it from another request (a summary's tagged text) throws.
 */
export interface LlmCall {
  url: string;
  key: string | null;
  body: Record<string, unknown>;
  text: string;
  readonly input: LlmInput;
}

/** What the model returns: `{ translations: [{ id, text }] }` for a batch, a summary for a summary request. */
export type LlmAnswer = (call: LlmCall, n: number) => unknown;

/** Translates every requested segment as "English <id>.". */
export const englishFor: LlmAnswer = (call) => ({
  translations: call.input.segments.map((s) => ({ id: s.id, text: `English ${s.id}.` })),
});

/** A session summary request (Phase 15), not a translation batch. */
export const isSummaryCall = (call: LlmCall) => call.text.includes('<transcript>');

/** A valid summary of the session the request sent, quoting its turns. */
export const summaryFor: LlmAnswer = (call) => summaryReplyForInput(call.text);

/** Project work: translations as `englishFor`, summaries as `summaryFor`. */
export const projectAnswer: LlmAnswer = (call, n) =>
  isSummaryCall(call) ? summaryFor(call, n) : englishFor(call, n);

const LLM_CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
};

/** A fake model's HTTP reply body. */
interface LlmReply {
  contentType: string;
  body: string;
}

const jsonReply = (value: unknown): LlmReply => ({
  contentType: 'application/json',
  body: JSON.stringify(value),
});

/**
 * Routes `pattern` to a fake model: each POST is parsed with `read`, answered with `answer(call, n)`
 * (which may wait), and the reply is wrapped with `wrap`. Returns the calls seen.
 */
async function mockLlm(
  page: Page,
  pattern: string,
  keyHeader: string,
  read: (body: Record<string, unknown>) => string,
  wrap: (text: string, body: Record<string, unknown>, url: string) => LlmReply,
  answer: LlmAnswer,
) {
  const calls: LlmCall[] = [];
  await page.route(pattern, async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: LLM_CORS });
      return;
    }
    const body = JSON.parse(req.postData() ?? '{}') as Record<string, unknown>;
    const text = read(body);
    const call: LlmCall = {
      url: req.url(),
      key: await req.headerValue(keyHeader),
      body,
      text,
      get input() {
        return JSON.parse(text) as LlmInput;
      },
    };
    const n = calls.length;
    calls.push(call);
    const reply = wrap(JSON.stringify(await answer(call, n)), body, call.url);
    try {
      await route.fulfill({
        status: 200,
        headers: LLM_CORS,
        contentType: reply.contentType,
        body: reply.body,
      });
    } catch {
      // The page cancelled the request first; there is nothing left to answer.
    }
  });
  return calls;
}

/** Fakes the Claude Messages API (`api.anthropic.com`), streaming the reply when the request asks for it. */
export const mockAnthropic = (page: Page, answer: LlmAnswer = englishFor) =>
  mockLlm(
    page,
    'https://api.anthropic.com/**',
    'x-api-key',
    (body) => (body.messages as { content: string }[])[0]!.content,
    (text, body) => {
      const message = {
        id: 'msg_e2e',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        stop_details: null,
        usage: { input_tokens: 100, output_tokens: 100 },
      };
      return body.stream === true
        ? { contentType: 'text/event-stream', body: claudeSse(message) }
        : jsonReply(message);
    },
    answer,
  );

/** One scripted reply of the project agent: a message (streamed), an HTTP error, or a reply that waits. */
export type AgentReply =
  | { message: Record<string, unknown> }
  | { status: number; body: unknown }
  | { after: Promise<unknown>; then: AgentReply };

/** A project agent request as the page sent it. */
export interface AgentCall {
  key: string | null;
  body: { messages: { role: string; content: unknown }[]; tools: { name: string }[] } & Record<
    string,
    unknown
  >;
}

/**
 * Fakes the project agent's requests to Claude (Phase 17): those with `tools`. Request n gets `replies(n)`; others go
 * on to any other `api.anthropic.com` route. An error reply says not to retry, so a 429 shows at once.
 */
export async function mockAgent(
  page: Page,
  replies: (n: number, call: AgentCall) => AgentReply | Promise<AgentReply>,
) {
  const calls: AgentCall[] = [];
  await page.route('https://api.anthropic.com/**', async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: LLM_CORS });
      return;
    }
    const body = JSON.parse(req.postData() ?? '{}') as AgentCall['body'];
    if (!Array.isArray(body.tools)) {
      await route.fallback();
      return;
    }
    const call: AgentCall = { key: await req.headerValue('x-api-key'), body };
    const n = calls.length;
    calls.push(call);
    let reply = await replies(n, call);
    while ('after' in reply) {
      await reply.after;
      reply = reply.then;
    }
    try {
      if ('message' in reply) {
        await route.fulfill({
          status: 200,
          headers: LLM_CORS,
          contentType: 'text/event-stream',
          body: claudeSse(reply.message),
        });
      } else {
        await route.fulfill({
          status: reply.status,
          headers: {
            ...LLM_CORS,
            'access-control-expose-headers': '*',
            'x-should-retry': 'false',
          },
          contentType: 'application/json',
          body: JSON.stringify(reply.body),
        });
      }
    } catch {
      // The page cancelled the request first (Stop, New chat); there is nothing left to answer.
    }
  });
  return calls;
}

/** One scripted reply of the project agent with Gemini: a model turn (streamed), or one that waits. */
export type GeminiAgentReply =
  { response: Record<string, unknown> } | { after: Promise<unknown>; then: GeminiAgentReply };

/** A project agent request to Gemini as the page sent it. */
export interface GeminiAgentCall {
  url: string;
  key: string | null;
  body: {
    contents: { role: string; parts: Record<string, unknown>[] }[];
    tools: { functionDeclarations: { name: string }[] }[];
  } & Record<string, unknown>;
}

/**
 * Fakes the project agent's requests to Gemini (Phase 20): those with `tools`. Request n gets `replies(n)`; others go
 * on to any other `generativelanguage.googleapis.com` route.
 */
export async function mockGeminiAgent(
  page: Page,
  replies: (n: number, call: GeminiAgentCall) => GeminiAgentReply | Promise<GeminiAgentReply>,
) {
  const calls: GeminiAgentCall[] = [];
  await page.route('https://generativelanguage.googleapis.com/**', async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: LLM_CORS });
      return;
    }
    const body = JSON.parse(req.postData() ?? '{}') as GeminiAgentCall['body'];
    if (!Array.isArray(body.tools)) {
      await route.fallback();
      return;
    }
    const call: GeminiAgentCall = {
      url: req.url(),
      key: await req.headerValue('x-goog-api-key'),
      body,
    };
    const n = calls.length;
    calls.push(call);
    let reply = await replies(n, call);
    while ('after' in reply) {
      await reply.after;
      reply = reply.then;
    }
    try {
      await route.fulfill({
        status: 200,
        headers: LLM_CORS,
        contentType: 'text/event-stream',
        body: geminiSse(reply.response),
      });
    } catch {
      // The page cancelled the request first (Stop, New chat); there is nothing left to answer.
    }
  });
  return calls;
}

/**
 * Fakes Gemini (`generativelanguage.googleapis.com`): `streamGenerateContent` is answered with server-sent events,
 * as the app streams every request (DECISIONS.md T15); `generateContent` with JSON.
 */
export const mockGemini = (page: Page, answer: LlmAnswer = englishFor) =>
  mockLlm(
    page,
    'https://generativelanguage.googleapis.com/**',
    'x-goog-api-key',
    (body) => (body.contents as { parts: { text: string }[] }[])[0]!.parts[0]!.text,
    (text, _body, url) => {
      const response = {
        candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100 },
      };
      return url.includes(':streamGenerateContent')
        ? { contentType: 'text/event-stream', body: geminiSse(response) }
        : jsonReply(response);
    },
    answer,
  );

/** Opens Settings from the footer and waits for it. */
export async function openSettings(page: Page): Promise<void> {
  await page.getByRole('contentinfo').getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeFocused();
}

/** Enters a key on Settings and goes Back to where Settings was opened from. */
export async function enterKey(page: Page, label = 'ElevenLabs API key', value = 'test-key') {
  await openSettings(page);
  await page.getByLabel(label).fill(value);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toHaveCount(0);
}

/** Completes Setup with a key and a test recording (by default the 5-second one), and opens Glossary. */
export async function goToGlossary(page: Page, recording = TONE_WAV, duration = '00:00:05') {
  // Setup offers Settings only while the ElevenLabs key is missing.
  if (await page.getByRole('button', { name: 'Open Settings' }).isVisible()) await enterKey(page);
  await page.locator('input[type="file"]').setInputFiles(recording);
  await expect(page.getByText(duration)).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Glossary' })).toBeFocused();
}

/** Clicks Run on Glossary and waits for Output. */
export async function run(page: Page) {
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Output' })).toBeFocused();
}

export { useProjectFolder, withoutFolderAccess } from './projectFolder';
export type { FolderFiles, ProjectFolderHarness } from './projectFolder';

/** Clicks Project on Home and waits for the Project view. */
export async function enterProject(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Analyse/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Analyse' })).toBeFocused();
}

/** The chat pane's Chat | Search toggle, under the question box (D30). */
export const modeButton = (page: Page, name: 'Chat' | 'Search'): Locator =>
  page.getByRole('group', { name: 'Mode' }).getByRole('button', { name });

/** Switches the chat pane to Search and returns its box, which has focus. */
export async function openSearch(page: Page): Promise<Locator> {
  await modeButton(page, 'Search').click();
  const box = page.getByRole('searchbox', { name: 'Search transcripts' });
  await expect(box).toBeFocused();
  return box;
}

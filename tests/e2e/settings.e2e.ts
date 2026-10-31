import { readFileSync } from 'node:fs';
import type { Page, Route } from '@playwright/test';
import { PROJECT_FILE } from '../../src/domain/sessionFiles';
import { makeCorpus } from '../../src/testing/corpus';
import { projectFiles } from '../../src/testing/projectSeed';
import {
  clickInHeader,
  enterProject,
  expect,
  goToGlossary,
  mockElevenLabs,
  ok,
  openApp,
  openHome,
  openSettings,
  reloadApp,
  run,
  test,
  useProjectFolder,
} from './helpers';

const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/elevenlabs/${name}.json`, import.meta.url), 'utf8');

/** What ElevenLabs answers to any origin, including `null` from file:// (reference doc, CORS). */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const settingsLink = (page: Page) =>
  page.getByRole('contentinfo').getByRole('button', { name: 'Settings' });
const keyInput = (page: Page) => page.getByLabel('ElevenLabs API key');
/** One key's field on Settings: its input, Show key, Verify key and the check's result. */
const field = (page: Page, label: string) =>
  page.locator('.key-field').filter({ has: page.getByLabel(label, { exact: true }) });
const rememberBox = (page: Page) =>
  page.getByRole('checkbox', { name: 'Remember keys on this computer' });
const backButton = (page: Page) => page.getByRole('button', { name: 'Back' });

test('Settings opens from the footer and Back returns to where it was opened', async ({ page }) => {
  await openHome(page);
  await openSettings(page);
  await expect(settingsLink(page)).toHaveCount(0);
  await expect(page.getByRole('banner')).toContainText('Settings');
  await expect(
    page.getByText('DeScribe primarily runs in your browser', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText(/^v\d+\.\d+\.\d+ · built \d{4}-\d{2}-\d{2}$/)).toBeVisible();
  await backButton(page).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeFocused();

  await page.getByRole('button', { name: 'Transcribe' }).click();
  await clickInHeader(page, 'Glossary');
  await openSettings(page);
  await backButton(page).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Glossary' })).toBeFocused();

  await clickInHeader(page, 'Home');
  await enterProject(page);
  await openSettings(page);
  await backButton(page).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Analyse' })).toBeFocused();
});

test('Setup offers Settings while the key is missing, and Back returns to Setup', async ({
  page,
}) => {
  await openApp(page);
  await expect(page.getByText('Add your ElevenLabs API key in Settings.')).toBeVisible();
  await page.getByRole('button', { name: 'Open Settings' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeFocused();
  await keyInput(page).fill('test-key');
  await backButton(page).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Setup' })).toBeFocused();
  await expect(page.getByText('Add your ElevenLabs API key in Settings.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open Settings' })).toHaveCount(0);
});

test('an unremembered key survives a reload but not a new tab', async ({ page, context }) => {
  await openHome(page);
  await openSettings(page);
  await keyInput(page).fill('test-key');
  await expect(rememberBox(page)).not.toBeChecked();

  await page.reload();
  await openSettings(page);
  await expect(keyInput(page)).toHaveValue('test-key');

  const newTab = await context.newPage();
  await openHome(newTab);
  await openSettings(newTab);
  await expect(keyInput(newTab)).toHaveValue('');
  await newTab.close();
});

test('a remembered key survives a new tab, and unticking removes it from localStorage', async ({
  page,
  context,
}) => {
  await openHome(page);
  await openSettings(page);
  await keyInput(page).fill('test-key');
  await rememberBox(page).check();

  const newTab = await context.newPage();
  await openHome(newTab);
  await openSettings(newTab);
  await expect(keyInput(newTab)).toHaveValue('test-key');
  await expect(rememberBox(newTab)).toBeChecked();
  await newTab.close();

  await rememberBox(page).uncheck();
  const stored = await page.evaluate(() => localStorage.getItem('describe.v1.key.elevenlabs'));
  expect(stored).toBeNull();
  await expect(keyInput(page)).toHaveValue('test-key'); // still there for this tab
});

// Chromium logs every 4xx response as a console error; those are expected in the Verify key tests.
function dropFailedLoads(consoleErrors: string[]) {
  const rest = consoleErrors.filter((e) => !/Failed to load resource/i.test(e));
  consoleErrors.splice(0, consoleErrors.length, ...rest);
}

test.describe('Verify key (mocked ElevenLabs)', () => {
  /** Answers every ElevenLabs request with `status` and `body`; records the requests made. */
  async function mockKeyCheck(page: Page, status: number, body: string) {
    const requests: { method: string; key: string | null }[] = [];
    await page.route('https://api.elevenlabs.io/**', async (route: Route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: CORS });
        return;
      }
      requests.push({ method: req.method(), key: await req.headerValue('xi-api-key') });
      await route.fulfill({ status, headers: CORS, contentType: 'application/json', body });
    });
    return requests;
  }

  test('accepts a key when ElevenLabs only complains about the missing audio', async ({
    page,
    consoleErrors,
  }) => {
    const requests = await mockKeyCheck(page, 400, fixture('error-400-missing-file'));
    await openHome(page);
    await openSettings(page);
    await keyInput(page).fill('test-key');
    await field(page, 'ElevenLabs API key').getByRole('button', { name: 'Verify key' }).click();

    await expect(page.getByText('The key works with ElevenLabs Speech-to-Text.')).toBeVisible();
    expect(requests).toEqual([{ method: 'POST', key: 'test-key' }]);
    dropFailedLoads(consoleErrors);
  });

  test('reports a key ElevenLabs does not recognise', async ({ page, consoleErrors }) => {
    await mockKeyCheck(page, 401, fixture('error-401'));
    await openHome(page);
    await openSettings(page);
    await keyInput(page).fill('test-key');
    await field(page, 'ElevenLabs API key').getByRole('button', { name: 'Verify key' }).click();

    await expect(
      page.getByText("ElevenLabs doesn't recognise this key. Check that you copied all of it."),
    ).toBeVisible();

    // Editing the key clears the result.
    await keyInput(page).fill('test-key-2');
    await expect(page.getByText("ElevenLabs doesn't recognise this key.")).toHaveCount(0);
    dropFailedLoads(consoleErrors);
  });
});

test('Forget all keys removes remembered keys, also after a reload', async ({ page }) => {
  await openHome(page);
  await openSettings(page);
  await keyInput(page).fill('test-key');
  await rememberBox(page).check();
  await page.reload();
  await openSettings(page);
  await expect(keyInput(page)).toHaveValue('test-key');

  await page.getByRole('button', { name: 'Forget all keys' }).click();
  await expect(keyInput(page)).toBeFocused();
  await expect(keyInput(page)).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Forget all keys' })).toHaveCount(0);

  await page.reload();
  await openSettings(page);
  await expect(keyInput(page)).toHaveValue('');
});

test('Clear saved data removes the glossary and last transcript, keeps the key', async ({
  page,
}) => {
  await mockElevenLabs(page, () => ok());
  await openHome(page);
  await openSettings(page);
  await keyInput(page).fill('test-key');
  await rememberBox(page).check();
  await backButton(page).click();
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await goToGlossary(page);
  await page.getByLabel('Add terms').fill('Oticon');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await run(page);
  await expect(page.locator('li.turn')).toHaveCount(5);

  await openSettings(page);
  const trigger = page.getByRole('button', { name: 'Clear saved data…' });
  await trigger.click();
  const confirm = page.getByRole('dialog', { name: 'Clear saved data?' });
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Clear' }).click();
  await expect(confirm).toBeHidden();
  await expect(trigger).toBeFocused();
  await backButton(page).click();

  // Output has nothing left to show, so the app is back on Setup with Output locked.
  await expect(page.getByRole('heading', { level: 1, name: 'Setup' })).toBeAttached();
  await expect(page.getByRole('button', { name: 'Output' })).toBeDisabled();

  await reloadApp(page);
  await expect(page.getByRole('button', { name: 'Open Settings' })).toHaveCount(0);
  await expect(page.getByText('Last transcript:')).toHaveCount(0);
  await clickInHeader(page, 'Glossary');
  await expect(page.getByText('Oticon')).toHaveCount(0);
});

test("Clear saved data forgets the project and its text cache, but not the folder's files", async ({
  page,
}) => {
  const { docs } = makeCorpus({ hours: 4, seed: 9 });
  const files = projectFiles(docs);
  const folder = await useProjectFolder(page, { 'Hearing at home': files });
  await openHome(page);
  await enterProject(page);
  await page.getByRole('button', { name: 'Open project…' }).click();
  await expect(page.locator('li.session')).toHaveCount(docs.length);
  await clickInHeader(page, 'Home');
  await expect(page.getByRole('button', { name: 'Analyse Hearing at home 2026' })).toBeVisible();

  await openSettings(page);
  await page.getByRole('button', { name: 'Clear saved data…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Clear saved data?' });
  await expect(confirm).toContainText('the link to your project');
  await confirm.getByRole('button', { name: 'Clear' }).click();
  await expect(confirm).toBeHidden();
  await backButton(page).click();
  await expect(page.getByRole('button', { name: 'Analyse', exact: true })).toBeVisible();

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
  expect(cached).toBe(0);
  expect(folder.files('Hearing at home')).toEqual(files);
  expect(folder.files('Hearing at home')[PROJECT_FILE]).toBeDefined();

  await page.reload();
  await enterProject(page);
  await expect(page.getByRole('button', { name: 'Open project…' })).toBeVisible();
});

test.describe('Verify key (mocked Claude and Gemini)', () => {
  const LLM = {
    claude: {
      label: 'Claude (Anthropic) API key',
      url: 'https://api.anthropic.com/**',
      keyHeader: 'x-api-key',
      models: { data: [], has_more: false, first_id: null, last_id: null },
      badKey: {
        type: 'error',
        error: { type: 'authentication_error', message: 'invalid x-api-key' },
      },
      badStatus: 401,
      ok: 'The key works with Claude.',
      rejected: "Claude doesn't recognise this key. Check that you copied all of it.",
    },
    gemini: {
      label: 'Gemini (Google) API key',
      url: 'https://generativelanguage.googleapis.com/**',
      keyHeader: 'x-goog-api-key',
      models: { models: [{ name: 'models/gemini-3.8-flash' }] },
      badKey: {
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          status: 'INVALID_ARGUMENT',
          details: [
            { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' },
          ],
        },
      },
      badStatus: 400,
      ok: 'The key works with Gemini.',
      rejected: "Gemini didn't accept this key. Check that you copied all of it.",
    },
  } as const;

  /** Answers the provider's requests with `status` and `body`; records the requests made. */
  async function mockModels(
    page: Page,
    url: string,
    keyHeader: string,
    status: number,
    body: unknown,
  ) {
    const requests: { method: string; path: string; key: string | null }[] = [];
    await page.route(url, async (route: Route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: { ...CORS, 'access-control-allow-methods': 'GET, OPTIONS' },
        });
        return;
      }
      requests.push({
        method: req.method(),
        path: new URL(req.url()).pathname,
        key: await req.headerValue(keyHeader),
      });
      await route.fulfill({
        status,
        headers: CORS,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    });
    return requests;
  }

  for (const [id, p] of Object.entries(LLM)) {
    test(`accepts a ${id} key the API lists models for`, async ({ page }) => {
      const requests = await mockModels(page, p.url, p.keyHeader, 200, p.models);
      await openHome(page);
      await openSettings(page);
      await page.getByLabel(p.label, { exact: true }).fill('test-key');
      await field(page, p.label).getByRole('button', { name: 'Verify key' }).click();

      await expect(field(page, p.label).getByRole('status')).toHaveText(`✓ ${p.ok}`);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ method: 'GET', key: 'test-key' });
      expect(requests[0]!.path).toMatch(/\/models$/);
    });

    test(`reports a ${id} key the API rejects`, async ({ page, consoleErrors }) => {
      await mockModels(page, p.url, p.keyHeader, p.badStatus, p.badKey);
      await openHome(page);
      await openSettings(page);
      await page.getByLabel(p.label, { exact: true }).fill('test-key');
      await field(page, p.label).getByRole('button', { name: 'Verify key' }).click();

      await expect(field(page, p.label).getByRole('status')).toHaveText(`✗ ${p.rejected}`);
      dropFailedLoads(consoleErrors);
    });
  }
});

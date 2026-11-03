import type { Page } from '@playwright/test';
import {
  clickInHeader,
  enterKey,
  expect,
  fixture,
  goToGlossary,
  mockElevenLabs,
  ok,
  openApp,
  reloadApp,
  run,
  test,
  type Reply,
} from './helpers';

/** A reply that waits until `release()` is called. */
function heldReply() {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let arrived!: () => void;
  const seen = new Promise<void>((resolve) => (arrived = resolve));
  return {
    seen,
    release,
    reply: async (): Promise<Reply> => {
      arrived();
      await released;
      return { status: 200, body: fixture('two-speakers-short') };
    },
  };
}

// Chromium logs every 4xx/5xx response as a console error; those are expected in error tests.
function dropFailedLoads(consoleErrors: string[]) {
  const rest = consoleErrors.filter((e) => !/Failed to load resource/i.test(e));
  consoleErrors.splice(0, consoleErrors.length, ...rest);
}

const jobStatus = (page: Page) => page.getByTestId('job-status');
const turns = (page: Page) => page.locator('li.turn');
const speakerLabels = (page: Page) => turns(page).locator('.speaker');
const runButton = (page: Page) => page.getByRole('button', { name: 'Run' });

/** The labels saved in IndexedDB (once the app has created the database). */
const savedLabels = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string[] | null>((resolve) => {
        const open = indexedDB.open('describe-v1');
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          const get = db
            .transaction('keyval')
            .objectStore('keyval')
            .get('describe.v1.lastTranscript');
          get.onerror = () => resolve(null);
          get.onsuccess = () => {
            const doc = get.result as { speakers: { label: string }[] } | undefined;
            resolve(doc ? doc.speakers.map((s) => s.label) : null);
            db.close();
          };
        };
      }),
  );

test('Run uploads, transcribes and shows the transcript with the glossary sent', async ({
  page,
}) => {
  const requests = await mockElevenLabs(page, () => ok(2000));
  await openApp(page);
  await goToGlossary(page);
  await page.getByLabel('Add terms').fill('Oticon');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await run(page);

  // Under a route mock Chromium reports the upload done only when the response arrives, so the
  // request stays in "Uploading" for the whole delay (see the Phase 4 handoff).
  await expect(jobStatus(page).getByRole('status')).toHaveText('Uploading');
  await expect(jobStatus(page).getByRole('progressbar', { name: 'Upload progress' })).toBeVisible();
  await expect(jobStatus(page).getByRole('button', { name: 'Cancel' })).toBeVisible();

  await expect(turns(page)).toHaveCount(5);
  await expect(jobStatus(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2, name: 'tone-5s.wav' })).toBeVisible();
  await expect(page.getByText('1 glossary term')).toBeVisible();
  await expect(turns(page).locator('.timestamp')).toHaveText([
    '00:00:00',
    '00:00:03',
    '00:00:06',
    '00:00:09',
    '00:00:13',
  ]);
  await expect(speakerLabels(page)).toHaveText([
    'Speaker 1',
    'Speaker 2',
    'Speaker 1',
    'Speaker 2',
    'Speaker 1',
  ]);
  await expect(turns(page).first()).toContainText('Guten Tag und willkommen zu unserem Gespräch.');
  await expect(page.getByRole('textbox', { name: /^Name for Speaker/ })).toHaveCount(2);

  expect(requests).toHaveLength(1);
  expect(requests[0]?.key).toBe('test-key');
  expect(requests[0]?.body).toMatch(/name="keyterms"\r\n\r\nOticon\r\n/);
  expect(requests[0]?.body).toMatch(/name="model_id"\r\n\r\nscribe_v2\r\n/);
});

test('a renamed speaker updates every turn and survives a reload', async ({ page }) => {
  await mockElevenLabs(page, () => ok());
  await openApp(page);
  await goToGlossary(page);
  await run(page);
  await expect(turns(page)).toHaveCount(5);

  await page.getByRole('textbox', { name: 'Name for Speaker 1' }).fill('Interviewer');
  await expect(speakerLabels(page)).toHaveText([
    'Interviewer',
    'Speaker 2',
    'Interviewer',
    'Speaker 2',
    'Interviewer',
  ]);
  await expect.poll(() => savedLabels(page)).toEqual(['Interviewer', 'Speaker 2']);

  await reloadApp(page);
  const banner = page.getByText('Last transcript: tone-5s.wav · ');
  await expect(banner).toBeVisible();
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Output' })).toBeFocused();
  await expect(speakerLabels(page).first()).toHaveText('Interviewer');
  // With a speaker named, the panel starts collapsed.
  const nameField = page.getByRole('textbox', { name: 'Name for Speaker 1' });
  await expect(nameField).toBeHidden();
  await page.locator('summary', { hasText: 'Speakers' }).click();
  await expect(nameField).toHaveValue('Interviewer');
});

test('a rejected key offers Back to setup, not Try again', async ({ page, consoleErrors }) => {
  await mockElevenLabs(page, () => Promise.resolve({ status: 401, body: fixture('error-401') }));
  await openApp(page);
  await goToGlossary(page);
  await run(page);

  await expect(jobStatus(page).getByRole('status')).toHaveText(
    'ElevenLabs rejected the API key. Check the key in Settings.',
  );
  // What a report needs, from the response, under the message.
  const details = jobStatus(page).locator('details pre');
  await expect(details).toBeHidden();
  await jobStatus(page).getByText('Technical details').click();
  await expect(details).toContainText('auth · HTTP 401');
  await expect(details).toContainText('(request fixture-request-0003)');
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to setup' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Setup' })).toBeFocused();
  dropFailedLoads(consoleErrors);
});

test('a busy service offers Try again, which repeats the request', async ({
  page,
  consoleErrors,
}) => {
  const requests = await mockElevenLabs(page, (n) =>
    n === 0 ? Promise.resolve({ status: 429, body: fixture('error-429') }) : ok(),
  );
  await openApp(page);
  await goToGlossary(page);
  await run(page);

  await expect(jobStatus(page).getByRole('status')).toHaveText(
    "ElevenLabs is busy or your plan's limit was reached. Try again in a minute.",
  );
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(turns(page)).toHaveCount(5);
  expect(requests).toHaveLength(2);
  // The same request again; only the multipart boundary differs.
  const unbounded = (body = '') => body.replace(/WebKitFormBoundary\w+/g, 'boundary');
  expect(unbounded(requests[1]?.body)).toBe(unbounded(requests[0]?.body));
  dropFailedLoads(consoleErrors);
});

test('Try again uses a key changed in Settings meanwhile', async ({ page, consoleErrors }) => {
  const requests = await mockElevenLabs(page, (n) =>
    n === 0 ? Promise.resolve({ status: 429, body: fixture('error-429') }) : ok(),
  );
  await openApp(page);
  await goToGlossary(page);
  await run(page);
  await expect(jobStatus(page).getByRole('status')).toHaveText(
    "ElevenLabs is busy or your plan's limit was reached. Try again in a minute.",
  );

  await enterKey(page, 'ElevenLabs API key', 'test-key-2');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(turns(page)).toHaveCount(5);
  expect(requests.map((r) => r.key)).toEqual(['test-key', 'test-key-2']);
  const unbounded = (body = '') => body.replace(/WebKitFormBoundary\w+/g, 'boundary');
  expect(unbounded(requests[1]?.body)).toBe(unbounded(requests[0]?.body));
  dropFailedLoads(consoleErrors);
});

test('Cancel aborts the request and ignores a late response', async ({ page }) => {
  const held = heldReply();
  await mockElevenLabs(page, held.reply);
  await openApp(page);
  await goToGlossary(page);
  await run(page);
  await held.seen;

  await jobStatus(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(jobStatus(page).getByRole('status')).toHaveText('Transcription cancelled.');
  await expect(page.getByRole('heading', { level: 1, name: 'Output' })).toBeFocused();

  held.release();
  await expect(page.getByRole('button', { name: 'Start again' })).toBeVisible();
  // Give a late response time to arrive; it must not replace the cancelled state.
  await page.waitForTimeout(300);
  await expect(turns(page)).toHaveCount(0);
  await expect(jobStatus(page).getByRole('status')).toHaveText('Transcription cancelled.');
});

test('a run carries on while Home is shown, and Transcribe returns to Output', async ({ page }) => {
  const held = heldReply();
  await mockElevenLabs(page, held.reply);
  await openApp(page);
  await goToGlossary(page);
  await run(page);
  await held.seen;

  await clickInHeader(page, 'Home');
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeFocused();
  const transcribe = page.getByRole('button', { name: 'Transcribe' });
  await expect(transcribe).toHaveAccessibleName('Transcribe Transcribing…');

  held.release();
  await expect(transcribe).toHaveAccessibleName('Transcribe');
  await transcribe.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Output' })).toBeFocused();
  await expect(turns(page)).toHaveCount(5);
});

test('closing the tab during a run asks for confirmation', async ({ page }) => {
  const held = heldReply();
  await mockElevenLabs(page, held.reply);
  await openApp(page);
  await goToGlossary(page);
  await run(page);
  await held.seen;

  const dialog = page.waitForEvent('dialog');
  void page.close({ runBeforeUnload: true });
  const shown = await dialog;
  expect(shown.type()).toBe('beforeunload');
  await shown.accept();
  held.release();
});

test('a second Run asks before replacing the last transcript', async ({ page }) => {
  await mockElevenLabs(page, () => ok());
  await openApp(page);
  await goToGlossary(page);
  await run(page);
  await expect(turns(page)).toHaveCount(5);

  await clickInHeader(page, 'Glossary');
  await runButton(page).click();
  const confirm = page.getByRole('dialog', { name: 'Start a new transcription?' });
  await expect(confirm).toContainText('This replaces your last transcript ("tone-5s.wav").');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole('heading', { level: 1, name: 'Glossary' })).toBeVisible();

  await runButton(page).click();
  await confirm.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Output' })).toBeFocused();
  await expect(turns(page)).toHaveCount(5);
});

test('on Output, the step nav stays at the top while the transcript scrolls', async ({ page }) => {
  await mockElevenLabs(page, () => ok(0, 'many-turns'));
  await openApp(page);
  await goToGlossary(page);
  await run(page);
  await expect(page.locator('li.turn')).toHaveCount(70);

  const nav = page.getByRole('navigation', { name: 'Steps' });
  await page.locator('li.turn').nth(40).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  expect((await nav.boundingBox())?.y).toBe(0);
  await expect(nav.getByRole('button', { name: 'Output' })).toBeInViewport();

  // Only Output pins it.
  await clickInHeader(page, 'Setup');
  await expect(nav).toHaveCSS('position', 'static');
});

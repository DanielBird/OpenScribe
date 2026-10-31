import type { Page } from '@playwright/test';
import {
  expect,
  goToGlossary,
  mockElevenLabs,
  ok,
  openApp,
  reloadApp,
  run,
  test,
  TONE_12S_WAV,
  TONE_WAV,
} from './helpers';

// fixtures/audio/tone-12s.wav with its transcript (fixture 'tone-12s'): turns start at 0, 3, 6 and 9 s.

const audio = (page: Page) => page.locator('audio');
const bar = (page: Page) => page.getByTestId('audio-bar');
const turn = (page: Page, timestamp: string) => page.locator('li.turn', { hasText: timestamp });
const playFrom = (page: Page, timestamp: string) =>
  page.getByRole('button', { name: `Play from ${timestamp}` });

/** The <audio> element's state. */
const media = (page: Page) =>
  audio(page).evaluate((a: HTMLAudioElement) => ({ time: a.currentTime, paused: a.paused }));

/** Keeps the test silent; set before anything plays. */
const mute = (page: Page) =>
  audio(page).evaluate((a: HTMLAudioElement) => {
    a.muted = true;
  });

/** Plays from `timestamp` and checks that it started there. */
async function playAt(page: Page, timestamp: string, sec: number) {
  await playFrom(page, timestamp).click();
  await expect.poll(async () => (await media(page)).paused).toBe(false);
  const { time } = await media(page);
  expect(time).toBeGreaterThanOrEqual(sec - 0.05);
  expect(time).toBeLessThan(sec + 0.3);
}

/** Transcribes tone-12s.wav and opens Output. */
async function transcribe(page: Page) {
  await mockElevenLabs(page, () => ok(0, 'tone-12s'));
  await openApp(page);
  await goToGlossary(page, TONE_12S_WAV, '00:00:12');
  await run(page);
  await expect(page.locator('li.turn')).toHaveCount(4);
}

/** Reloads, so the audio is gone, and opens the saved transcript. */
async function reloadAndOpen(page: Page) {
  await reloadApp(page);
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('li.turn')).toHaveCount(4);
}

const attach = (page: Page, file: Parameters<Page['setInputFiles']>[1]) =>
  bar(page).locator('input[type="file"]').setInputFiles(file);

test('clicking a turn plays from its start and highlights it; the highlight follows', async ({
  page,
}) => {
  // Short enough that the last turn starts out of view.
  await page.setViewportSize({ width: 1000, height: 420 });
  await transcribe(page);
  await mute(page);
  await expect(turn(page, '00:00:09')).not.toBeInViewport();
  await expect(page.locator('li.turn[aria-current="true"]')).toHaveCount(0);

  await playAt(page, '00:00:06', 6);
  await expect(turn(page, '00:00:06')).toHaveAttribute('aria-current', 'true');
  await expect(turn(page, '00:00:06')).toHaveClass(/is-active/);
  await expect(bar(page).locator('.speaker')).toHaveText('Speaker 1');

  // About 3 s later the next turn is active, and Follow has scrolled it into view.
  await expect(turn(page, '00:00:09')).toHaveAttribute('aria-current', 'true', { timeout: 6000 });
  await expect(turn(page, '00:00:06')).not.toHaveAttribute('aria-current');
  await expect(turn(page, '00:00:09')).toBeInViewport();
  await expect(bar(page).locator('.speaker')).toHaveText('Speaker 2');
});

test('clicking the text of a turn plays from its start', async ({ page }) => {
  await transcribe(page);
  await mute(page);
  await turn(page, '00:00:03').locator('.text').click();
  await expect.poll(async () => (await media(page)).paused).toBe(false);
  expect((await media(page)).time).toBeGreaterThanOrEqual(2.95);
  await expect(turn(page, '00:00:03')).toHaveAttribute('aria-current', 'true');
});

test('after a reload, attaching the same recording brings playback back', async ({ page }) => {
  await transcribe(page);
  await reloadAndOpen(page);
  await expect(bar(page)).toContainText('Attach the recording to listen along.');
  await expect(playFrom(page, '00:00:03')).toHaveCount(0);

  await attach(page, TONE_12S_WAV);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(bar(page)).not.toContainText("Not the transcript's recording.");
  await mute(page);
  await playAt(page, '00:00:03', 3);
  await expect(turn(page, '00:00:03')).toHaveAttribute('aria-current', 'true');
});

test('attaching a different recording asks first and is marked in the bar', async ({ page }) => {
  await transcribe(page);
  await reloadAndOpen(page);

  await attach(page, TONE_WAV);
  const dialog = page.getByRole('dialog', { name: 'Use this recording?' });
  await expect(dialog).toContainText(
    `It doesn't match the transcript's recording ("tone-12s.wav").`,
  );
  await dialog.getByRole('button', { name: 'Use it' }).click();
  await expect(bar(page)).toContainText("Not the transcript's recording.");
  await expect(playFrom(page, '00:00:03')).toBeVisible();
  await expect(bar(page).getByRole('button', { name: 'Choose another file…' })).toBeVisible();
});

test('a recording the browser cannot play shows the format message', async ({ page }) => {
  await transcribe(page);
  await reloadAndOpen(page);

  const bytes = Buffer.alloc(4096);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 73 + 41) % 256;
  await attach(page, { name: 'broken.mp3', mimeType: 'audio/mpeg', buffer: bytes });
  await page.getByRole('dialog').getByRole('button', { name: 'Use it' }).click();

  await expect(bar(page).getByRole('alert')).toHaveText(
    "This file format can't be played in the browser. The transcript is not affected.",
  );
  await expect(playFrom(page, '00:00:03')).toHaveCount(0);
  await expect(page.locator('li.turn')).toHaveCount(4);
  await expect(bar(page).getByRole('button', { name: 'Choose another file…' })).toBeVisible();

  // A converted copy can be attached in its place.
  await attach(page, TONE_12S_WAV);
  await expect(bar(page).getByRole('alert')).toHaveCount(0);
  await expect(playFrom(page, '00:00:03')).toBeVisible();
});

test('Space and K play and pause, but not while typing a speaker name', async ({ page }) => {
  await transcribe(page);
  await mute(page);

  await page.keyboard.press('Space');
  await expect.poll(async () => (await media(page)).paused).toBe(false);
  await page.keyboard.press('k');
  await expect.poll(async () => (await media(page)).paused).toBe(true);
  const pausedAt = (await media(page)).time;

  const name = page.getByLabel('Name for Speaker 1');
  await name.click();
  await page.keyboard.type('Kim k');
  await page.keyboard.press('Space');
  await expect(name).toHaveValue('Kim k ');
  expect(await media(page)).toEqual({ time: pausedAt, paused: true });
});

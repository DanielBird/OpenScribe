import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import {
  clickInHeader,
  enterKey,
  expect,
  goToGlossary,
  mockAnthropic,
  mockElevenLabs,
  ok,
  openApp,
  openSettings,
  reloadApp,
  run,
  test,
  TONE_WAV,
} from './helpers';

// Phase 8 robustness review: unusual recordings, unusual names, and storage or network failures.

const BLIP_WAV = fileURLToPath(new URL('../../fixtures/audio/blip-50ms.wav', import.meta.url));
const turns = (page: Page) => page.locator('li.turn');
const downloadButton = (page: Page) => page.getByRole('button', { name: 'Download .docx' });

/** Transcribes the test recording (or `recording`), answered with the `fixture` response. */
async function transcribe(page: Page, fixture: string, recording = TONE_WAV) {
  await mockElevenLabs(page, () => ok(0, fixture));
  await openApp(page);
  await goToGlossary(page, recording);
  await run(page);
}

/** True when the page is wider than the window (a horizontal scrollbar). */
const scrollsSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

/** Drops the console errors Chromium logs for failed requests, which these tests cause on purpose. */
function dropFailedLoads(consoleErrors: string[]) {
  const rest = consoleErrors.filter(
    (e) => !/Failed to load resource|net::ERR_INTERNET_DISCONNECTED/i.test(e),
  );
  consoleErrors.splice(0, consoleErrors.length, ...rest);
}

test.describe('recordings', () => {
  test('a recording shorter than 100 ms is refused before upload', async ({ page }) => {
    await openApp(page);
    await enterKey(page);
    await page.locator('input[type="file"]').setInputFiles(BLIP_WAV);
    await expect(page.getByText('The recording is too short.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  test('silence: no turns, and nothing to export, translate or play', async ({ page }) => {
    await transcribe(page, 'silence');
    await expect(page.getByText('No speech was detected in this recording.')).toBeVisible();
    await expect(turns(page)).toHaveCount(0);
    await expect(downloadButton(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Translate to English' })).toHaveCount(0);
    await expect(page.getByTestId('audio-bar')).toHaveCount(0);
  });

  test('a single speaker: one name to edit, and the export works', async ({ page }) => {
    await transcribe(page, 'long-monologue');
    await expect(turns(page)).toHaveCount(3);
    await expect(page.getByRole('textbox', { name: /^Name for Speaker/ })).toHaveCount(1);
    const downloading = page.waitForEvent('download');
    await downloadButton(page).click();
    expect((await downloading).suggestedFilename()).toBe('tone-5s - transcript (English).docx');
  });

  test('32 speakers fit a phone-width window, and their colours repeat after ten', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await transcribe(page, 'thirty-two-speakers');
    await expect(turns(page)).toHaveCount(32);
    await expect(page.getByRole('textbox', { name: /^Name for Speaker/ })).toHaveCount(32);
    const colour = (i: number) =>
      turns(page)
        .nth(i)
        .evaluate((li) => getComputedStyle(li).getPropertyValue('--turn-color').trim());
    expect(await colour(10)).toBe(await colour(0));
    expect(await colour(1)).not.toBe(await colour(0));
    expect(await scrollsSideways(page)).toBe(false);
  });
});

test('a long file name with accents, CJK and emoji wraps, and the export name is cut safely', async ({
  page,
}) => {
  // A short temp folder keeps the full path under Windows' 260-character limit.
  const dir = mkdtempSync(join(tmpdir(), 'describe-'));
  const name = `Kundengespräch Hörgeräte – Ærøskøbing 東京会議 🎧 ${'sehr langer Dateiname '.repeat(5)}Ende.wav`;
  const recording = join(dir, name);
  copyFileSync(TONE_WAV, recording);
  try {
    await page.setViewportSize({ width: 375, height: 812 });
    await transcribe(page, 'two-speakers-short', recording);
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    expect(await scrollsSideways(page)).toBe(false);

    const downloading = page.waitForEvent('download');
    await downloadButton(page).click();
    const fileName = (await downloading).suggestedFilename();
    expect(fileName).toMatch(/^Kundengespräch Hörgeräte – Ærøskøbing 東京会議 🎧 sehr/);
    expect(fileName.endsWith(' - transcript (German).docx')).toBe(true);
    const base = fileName.slice(0, -' - transcript (German).docx'.length);
    expect(Array.from(base).length).toBeLessThanOrEqual(120);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.describe('storage', () => {
  test('without localStorage and sessionStorage the app still works, and remembers nothing', async ({
    page,
  }) => {
    // As when the browser blocks site data: even reading the property throws.
    await page.addInitScript(() => {
      for (const name of ['localStorage', 'sessionStorage']) {
        Object.defineProperty(window, name, {
          configurable: true,
          get() {
            throw new DOMException('Access is denied for this document.', 'SecurityError');
          },
        });
      }
    });
    await mockElevenLabs(page, () => ok());
    await openApp(page);
    await goToGlossary(page);
    await page.getByLabel('Add terms').fill('Oticon');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText(/isn.t saving/)).toBeVisible();
    await run(page);
    await expect(turns(page)).toHaveCount(5);

    await reloadApp(page);
    await expect(page.getByRole('button', { name: 'Open Settings' })).toBeVisible();
    await clickInHeader(page, 'Glossary');
    await expect(page.getByText('Oticon')).toHaveCount(0);
  });

  test('when IndexedDB is full, Output warns and carries on', async ({ page }) => {
    await page.addInitScript(() => {
      IDBObjectStore.prototype.put = function () {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      };
    });
    await transcribe(page, 'two-speakers-short');
    await expect(turns(page)).toHaveCount(5);
    await expect(
      page.getByText(
        "This browser isn't saving transcripts, so this one will be lost when you close the tab.",
      ),
    ).toBeVisible();
    const downloading = page.waitForEvent('download');
    await downloadButton(page).click();
    await downloading;
  });
});

test.describe('offline', () => {
  /** Every API host fails as if the network were down. Nothing reaches the real APIs. */
  async function goOffline(page: Page, hosts: string[]) {
    for (const host of hosts) {
      await page.route(`${host}/**`, (route) => route.abort('internetdisconnected'));
    }
  }

  test('Verify key and Run explain that ElevenLabs can’t be reached', async ({
    page,
    consoleErrors,
  }) => {
    await goOffline(page, ['https://api.elevenlabs.io']);
    await openApp(page);
    await openSettings(page);
    await page.getByLabel('ElevenLabs API key').fill('test-key');
    await page
      .locator('.key-field')
      .filter({ has: page.getByLabel('ElevenLabs API key') })
      .getByRole('button', { name: 'Verify key' })
      .click();
    await expect(page.getByTestId('key-check')).toContainText("Couldn't reach ElevenLabs.");
    await page.getByRole('button', { name: 'Back' }).click();

    await goToGlossary(page);
    await run(page);
    const status = page.getByTestId('job-status');
    await expect(status).toContainText(
      "Couldn't reach ElevenLabs. Check your internet connection or whether your network blocks api.elevenlabs.io.",
    );
    await expect(status.getByRole('button', { name: 'Try again' })).toBeVisible();
    dropFailedLoads(consoleErrors);
  });

  test('a translation explains that Claude can’t be reached and offers Resume', async ({
    page,
    consoleErrors,
  }) => {
    await mockAnthropic(page);
    await transcribe(page, 'two-speakers-short');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await goOffline(page, ['https://api.anthropic.com']);

    await page.getByRole('button', { name: 'Translate to English' }).click();
    const dialog = page.getByRole('dialog', { name: 'Translate to English' });
    await dialog.getByLabel('Claude (Anthropic) API key').fill('test-key');
    await dialog.getByRole('button', { name: 'Translate', exact: true }).click();

    await expect(page.getByRole('alert')).toContainText("Couldn't reach Claude.", {
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
    dropFailedLoads(consoleErrors);
  });
});

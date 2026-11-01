import type { Page } from '@playwright/test';
import {
  enterKey,
  expect,
  goToGlossary,
  mockElevenLabs,
  ok,
  openApp,
  reloadApp,
  run,
  test,
  TONE_WAV,
} from './helpers';

// The API keys are on Settings: settings.e2e.ts.
const nextButton = (page: Page) => page.getByRole('button', { name: 'Next' });
const fileInput = (page: Page) => page.locator('input[type="file"]');
/** The heading button that opens and closes Options. */
const optionsToggle = (page: Page) =>
  page.getByRole('heading', { level: 2, name: 'Options' }).getByRole('button');

test('a key and a valid recording enable Next, which leads to Glossary', async ({ page }) => {
  await openApp(page);

  await enterKey(page);
  await fileInput(page).setInputFiles(TONE_WAV);

  await expect(page.getByText('tone-5s.wav')).toBeVisible();
  await expect(page.getByText('156.3 KB')).toBeVisible();
  await expect(page.getByText('00:00:05')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /Error|Warning/ })).toHaveCount(0);

  await expect(nextButton(page)).toBeEnabled();
  await nextButton(page).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Glossary' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Glossary' })).toHaveAttribute(
    'aria-current',
    'step',
  );
});

test('Next stays disabled with the reasons listed, and again after Remove', async ({ page }) => {
  await openApp(page);
  await expect(nextButton(page)).toBeDisabled();
  await expect(page.getByText('Add your ElevenLabs API key in Settings.')).toBeVisible();
  await expect(page.getByText('Choose a recording.')).toBeVisible();

  await enterKey(page);
  await expect(page.getByText('Add your ElevenLabs API key in Settings.')).toHaveCount(0);
  await fileInput(page).setInputFiles(TONE_WAV);
  await expect(nextButton(page)).toBeEnabled();

  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('tone-5s.wav')).toHaveCount(0);
  await expect(nextButton(page)).toBeDisabled();
  await expect(page.getByText('Choose a recording.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose file…' })).toBeFocused();
});

test('language and zero retention survive a reload; the speaker count does not', async ({
  page,
}) => {
  await openApp(page);
  await optionsToggle(page).click();
  await page.getByLabel('Language').selectOption('de');
  await page.getByLabel('Zero retention').click();
  await page.getByLabel('Number of speakers').fill('2');

  await reloadApp(page);
  await optionsToggle(page).click();
  await expect(page.getByLabel('Language')).toHaveValue('de');
  await expect(page.getByLabel('Zero retention')).toBeChecked();
  await expect(page.getByLabel('Number of speakers')).toHaveValue('');
});

test('a language chosen from the list goes to ElevenLabs as its own code', async ({ page }) => {
  const requests = await mockElevenLabs(page, () => ok());
  await openApp(page);
  await optionsToggle(page).click();
  await page.getByLabel('Language').selectOption({ label: 'Spanish' });
  await optionsToggle(page).click();
  await expect(page.getByText('Language: Spanish')).toBeVisible();

  await goToGlossary(page);
  await run(page);
  await expect(page.locator('li.turn').first()).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]?.body).toMatch(/name="language_code"\r\n\r\nspa\r\n/);
});

test('every control is labelled and the form works from the keyboard', async ({ page }) => {
  await openApp(page);

  const controls = page.locator('main').locator('input:not([type="file"]), select');
  await expect(controls.locator('visible=true')).toHaveCount(0);

  // Options opens with the keyboard.
  await optionsToggle(page).focus();
  await page.keyboard.press('Enter');
  await expect(optionsToggle(page)).toHaveAttribute('aria-expanded', 'true');
  const shown = controls.locator('visible=true');
  await expect(shown).toHaveCount(2); // language + speakers
  for (let i = 0; i < 2; i++) await expect(shown.nth(i)).toHaveAccessibleName(/\S/);
  await expect(page.getByRole('switch', { name: /Zero retention/ })).toBeVisible();

  // Tab from the top of the view reaches "Choose file…", and Enter opens the file chooser.
  await page.getByRole('heading', { level: 1, name: 'Setup' }).focus();
  const choose = page.getByRole('button', { name: 'Choose file…' });
  for (let i = 0; i < 20 && !(await choose.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(choose).toBeFocused();
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles(TONE_WAV);
  await expect(page.getByText('00:00:05')).toBeVisible();
});

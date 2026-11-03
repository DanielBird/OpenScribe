import { readFileSync } from 'node:fs';
import { clickInHeader, expect, openApp, openHome, openSettings, test } from './helpers';

const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

test('loads the shell from file:// without any network requests', async ({ page }) => {
  const networkRequests: string[] = [];
  page.on('request', (req) => {
    if (/^(https?|wss?):/i.test(req.url())) networkRequests.push(req.url());
  });

  await openApp(page);

  await expect(page).toHaveTitle('DeScribe');
  expect(page.url()).toMatch(/^file:\/\/.*\/dist\/describe\.html$/);

  const steps = page.getByRole('navigation', { name: 'Steps' }).getByRole('button');
  await expect(steps).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Setup' })).toHaveAttribute('aria-current', 'step');
  await expect(page.getByRole('button', { name: 'Setup' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Glossary' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Output' })).toBeDisabled();

  await expect(page.getByRole('heading', { level: 1, name: 'Setup' })).toBeVisible();
  await expect(page.getByRole('contentinfo')).toHaveText('Settings');

  // The version is on Settings.
  await openSettings(page);
  await expect(page.getByText(`v${version} · built`)).toBeVisible();

  expect(networkRequests).toEqual([]);
});

test('opens on Home; Transcribe returns to the step left, and Home leads back', async ({
  page,
}) => {
  const heading = (name: string) => page.getByRole('heading', { level: 1, name });
  const transcribe = page.getByRole('button', { name: 'Transcribe' });
  const project = page.getByRole('button', { name: 'Analyse' });

  await openHome(page);
  await expect(transcribe).toBeVisible();
  await expect(project).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Steps' })).toHaveCount(0);
  await expect(heading('Home')).not.toBeFocused();

  await transcribe.click();
  await expect(heading('Setup')).toBeFocused();
  await clickInHeader(page, 'Glossary');
  await expect(heading('Glossary')).toBeFocused();

  await clickInHeader(page, 'Home');
  await expect(heading('Home')).toBeFocused();
  await transcribe.click();
  await expect(heading('Glossary')).toBeFocused();

  await clickInHeader(page, 'Home');
  await project.click();
  await expect(heading('Analyse')).toBeFocused();
  await expect(page.getByRole('banner')).toHaveText(/^\s*Home\s*\/\s*Analyse\s*$/);
  await expect(page.getByText('A project can be a local or shared folder.')).toBeVisible();
  await clickInHeader(page, 'Home');
  await expect(heading('Home')).toBeFocused();
});

test('ships the CSP from DECISIONS.md T1 as the first element in <head>', async ({ page }) => {
  await openApp(page);

  const csp = page.locator('meta[http-equiv="Content-Security-Policy"]');
  await expect(csp).toHaveCount(1);
  const content = (await csp.getAttribute('content')) ?? '';
  expect(content).toContain("default-src 'none'");
  expect(content).toContain(
    'connect-src https://api.elevenlabs.io https://api.anthropic.com https://generativelanguage.googleapis.com',
  );
  expect(content).not.toContain('unsafe-eval');

  const firstHeadChild = await page.evaluate(
    () => document.head.firstElementChild?.outerHTML ?? '',
  );
  expect(firstHeadChild).toContain('Content-Security-Policy');
});

test('the CSP blocks requests to hosts outside the allow-list', async ({ page, consoleErrors }) => {
  // Safety net: if the CSP ever failed, the request must still not leave the machine.
  await page.route('https://example.com/**', (route) => route.abort());
  await openApp(page);

  const result = await page.evaluate(() =>
    fetch('https://example.com/probe').then(
      () => 'reached',
      () => 'blocked',
    ),
  );
  expect(result).toBe('blocked');

  // The browser reports the violation as a console error; that one is expected here.
  const isCspViolation = (e: string) => /Content Security Policy/i.test(e);
  await expect.poll(() => consoleErrors.some(isCspViolation)).toBe(true);
  const unexpected = consoleErrors.filter((e) => !isCspViolation(e));
  consoleErrors.splice(0, consoleErrors.length, ...unexpected);
});

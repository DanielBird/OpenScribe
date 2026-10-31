import { projectFiles } from '../../src/testing/projectSeed';
import {
  clickInHeader,
  enterProject,
  expect,
  openHome,
  openSettings,
  test,
  useProjectFolder,
} from './helpers';
import { germanSession } from './sessionDocs';

// The browser's Back and Forward move between pages (DECISIONS.md D28), over file:// and without changing the URL.

test('Back and Forward move between Home and the steps; the URL never changes', async ({
  page,
}) => {
  const heading = (name: string) => page.getByRole('heading', { level: 1, name });
  await openHome(page);
  const url = page.url();

  await page.getByRole('button', { name: 'Transcribe' }).click();
  await expect(heading('Setup')).toBeFocused();
  await clickInHeader(page, 'Glossary');
  await expect(heading('Glossary')).toBeFocused();

  await page.goBack();
  await expect(heading('Setup')).toBeFocused();
  await page.goBack();
  await expect(heading('Home')).toBeFocused();
  await page.goForward();
  await expect(heading('Setup')).toBeFocused();
  await page.goForward();
  await expect(heading('Glossary')).toBeFocused();
  expect(page.url()).toBe(url);

  // Settings is a page too; Back returns to where it was opened.
  await openSettings(page);
  await page.goBack();
  await expect(heading('Glossary')).toBeFocused();

  // A reload still opens on Home.
  await page.reload();
  await expect(heading('Home')).toBeAttached();
  expect(page.url()).toBe(url);
});

test('Back closes a session summary in Project, and Forward opens it again', async ({ page }) => {
  await useProjectFolder(page, { Study: projectFiles([germanSession(1), germanSession(2)]) });
  await openHome(page);
  await enterProject(page);
  await page.getByRole('button', { name: 'Open project…' }).click();
  await expect(page.getByRole('heading', { name: /^Sessions/ })).toBeVisible();

  const question = page.getByRole('textbox', { name: 'Question' });
  const first = page.getByRole('listbox').getByRole('option').first();
  await first.click();
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await expect(question).toBeHidden();

  await page.goBack();
  await expect(question).toBeVisible();
  await expect(question).toBeFocused();
  await page.goForward();
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await expect(question).toBeHidden();

  await page.goBack();
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeFocused();
});

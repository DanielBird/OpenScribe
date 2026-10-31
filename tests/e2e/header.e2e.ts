import type { Locator, Page } from '@playwright/test';
import { projectFiles } from '../../src/testing/projectSeed';
import {
  clickInHeader,
  enterProject,
  expect,
  openApp,
  openHome,
  openSettings,
  test,
  useProjectFolder,
} from './helpers';
import { germanSession } from './sessionDocs';

// The top row names the current page, and unfolds to the whole path while the pointer is over it or the keyboard is
// in it (DECISIONS.md D32).

/** The place in the top row that holds the page `name`. */
const place = (page: Page, name: string) =>
  page
    .getByRole('banner')
    .locator('.slot', { has: page.getByRole('button', { name, exact: true }) });

async function folded(slot: Locator): Promise<void> {
  await expect(slot).toHaveCSS('width', '0px');
  await expect(slot).toHaveCSS('opacity', '0');
}

async function unfolded(slot: Locator): Promise<void> {
  await expect(slot).toHaveCSS('opacity', '1');
  await expect(slot).not.toHaveCSS('width', '0px');
}

/** Points at the row's left end, away from Analyse's controls. */
const pointAtRow = (page: Page) => page.getByRole('banner').hover({ position: { x: 1, y: 1 } });

/** Moves the pointer off the row, onto the page below it. */
const pointAway = (page: Page) => page.mouse.move(600, 400);

/** When each place that folds starts to move, left to right. */
const delays = (page: Page) =>
  page
    .getByRole('banner')
    .locator('.fold')
    .evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).transitionDelay)));

const rising = (xs: number[]) => xs.slice(1).every((x, i) => x > xs[i]!);

test('the top row names the current page, and the whole path while the pointer is over it', async ({
  page,
}) => {
  await openApp(page);
  await pointAway(page);
  await unfolded(place(page, 'Setup'));
  for (const name of ['Home', 'Glossary', 'Output']) await folded(place(page, name));

  await pointAtRow(page);
  for (const name of ['Home', 'Setup', 'Glossary', 'Output']) await unfolded(place(page, name));

  await pointAway(page);
  for (const name of ['Home', 'Glossary', 'Output']) await folded(place(page, name));
  await unfolded(place(page, 'Setup'));
});

test('the path unfolds from the left and folds from the right', async ({ page }) => {
  await openApp(page);
  await pointAtRow(page);
  await expect.poll(async () => rising(await delays(page))).toBe(true);

  await pointAway(page);
  await expect.poll(async () => rising((await delays(page)).reverse())).toBe(true);
});

test("Analyse's controls don't open the path; its name does", async ({ page }) => {
  await useProjectFolder(page, { Study: projectFiles([germanSession(1)]) });
  await openHome(page);
  await enterProject(page);
  await page.getByRole('button', { name: 'Open project…' }).click();
  await expect(page.getByRole('heading', { name: /^Sessions/ })).toBeVisible();
  const banner = page.getByRole('banner');
  const home = place(page, 'Home');

  await banner.getByRole('button', { name: 'Brief' }).hover();
  // Opening would start Home's transition at once (it waits in its delay), so none on the next frame means closed.
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(await home.evaluate((el) => el.getAnimations().length)).toBe(0);
  await folded(home);

  await banner.locator('[aria-current="page"]').hover();
  await unfolded(home);
});

test('the keyboard opens the path while it is in it', async ({ page }) => {
  await openApp(page);
  await pointAway(page);
  await folded(place(page, 'Home'));

  await page.getByRole('heading', { level: 1, name: 'Setup' }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Glossary', exact: true })).toBeFocused();
  await unfolded(place(page, 'Home'));

  await page.keyboard.press('Tab');
  await folded(place(page, 'Home'));
});

test('a page change swaps the names together', async ({ page }) => {
  await openApp(page);
  await clickInHeader(page, 'Glossary');
  await pointAway(page);
  await folded(place(page, 'Setup'));

  // Slowed down, so the swap is still running when it's checked.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.1 });
  await page.goBack();
  const widthDelays = (name: string) =>
    place(page, name).evaluate((el) =>
      el
        .getAnimations()
        .filter((a) => a instanceof CSSTransition && a.transitionProperty === 'width')
        .map((a) => a.effect?.getTiming().delay),
    );
  await expect.poll(() => widthDelays('Setup')).toEqual([0]);
  expect(await widthDelays('Glossary')).toEqual([0]);

  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
  await unfolded(place(page, 'Setup'));
  await folded(place(page, 'Glossary'));
});

test('opening Transcribe or Analyse from Home shows its page where it rests', async ({ page }) => {
  await openHome(page);
  const banner = page.getByRole('banner');
  const current = banner.locator('[aria-current]');
  // Slowed down, so anything moving would still be moving when it's checked.
  const cdp = await page.context().newCDPSession(page);
  const rate = (playbackRate: number) => cdp.send('Animation.setPlaybackRate', { playbackRate });

  for (const [tile, name] of [
    ['Transcribe', 'Setup'],
    ['Analyse', 'Analyse'],
  ] as const) {
    await rate(0.1);
    await page.getByRole('button', { name: tile }).click();
    await expect(current).toHaveText(name);
    expect(await banner.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
    expect((await current.boundingBox())?.x).toBe((await banner.boundingBox())?.x);

    await rate(1);
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeFocused();
    await expect(banner.locator('nav')).toHaveCount(0);
  }
});

test("straight from Home into Analyse, the steps still folding away don't push its name", async ({
  page,
}) => {
  await openApp(page);
  const banner = page.getByRole('banner');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.1 });
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeFocused();
  await expect(banner.locator('nav')).toHaveCount(1);

  await page.getByRole('button', { name: 'Analyse' }).click();
  const name = banner.locator('.project-name');
  await expect(name).toHaveText('Analyse');
  expect(await banner.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  expect((await name.boundingBox())?.x).toBe((await banner.boundingBox())?.x);
  await expect(banner.locator('nav')).toHaveCount(0);
});

test('the row keeps its height while the steps come and go', async ({ page }) => {
  await openApp(page);
  const banner = page.getByRole('banner');
  const nav = banner.locator('nav');
  const rest = (await banner.boundingBox())?.height;
  // Slowed down, and the row's height read on every frame for a while.
  const cdp = await page.context().newCDPSession(page);
  const rate = (playbackRate: number) => cdp.send('Animation.setPlaybackRate', { playbackRate });
  const heights = () =>
    banner.evaluate(
      (el) =>
        new Promise<number[]>((resolve) => {
          const seen = new Set<number>();
          const start = performance.now();
          const frame = () => {
            seen.add(el.getBoundingClientRect().height);
            if (performance.now() - start < 800) requestAnimationFrame(frame);
            else resolve([...seen]);
          };
          frame();
        }),
    );

  // Leaving for Home from the open path: the steps fold away.
  await pointAtRow(page);
  await unfolded(place(page, 'Home'));
  await rate(0.1);
  await banner.getByRole('button', { name: 'Home', exact: true }).click();
  expect(await heights()).toEqual([rest]);
  await rate(1);
  await expect(nav).toHaveCount(0);

  // Back from Settings to a step: the steps come in.
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await openSettings(page);
  await expect(nav).toHaveCount(0);
  await rate(0.1);
  await page.getByRole('button', { name: 'Back' }).click();
  expect(await heights()).toEqual([rest]);
});

test('with reduced motion, the path opens and closes without moving', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  await expect(place(page, 'Home')).toHaveCSS('transition-duration', '0s');

  await pointAtRow(page);
  await unfolded(place(page, 'Home'));
  await pointAway(page);
  await folded(place(page, 'Home'));
});

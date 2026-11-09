// Progressive frame loading on the SYNTHETIC progressive fixture (fixtures/handler.ts): each
// `/frames` reply waits 1.2 s and lists more frames (4, 10, 18, then all 30; 31 found with one
// `outside_cutout`), like a live backend with a small SX_LIVE_CUTOUTS_PER_REQUEST. Also the
// sky's "cached — loads instantly" markers from the fixture `/v1/sky/cached`.
// The parts are counted per browser session (a cookie), so these tests may run in parallel.
import { expect, test, type Page } from '@playwright/test';

async function search(page: Page, text: string) {
  const input = page.getByTestId('search-input');
  await input.fill(text);
  await input.press('Enter');
}

const counter = (page: Page) => page.getByTestId('frame-counter');
const headline = (page: Page) => page.getByTestId('frames-progress-headline');

test('a progressive object plays while its frames arrive, then completes', async ({ page }) => {
  await page.goto('/');
  await search(page, 'Synthetic progressive');

  // Never blank: the search state says where it is looking first.
  await expect(page.getByTestId('loading')).toContainText(
    'Searching the archive for SPHEREx frames at RA 30.00000°, Dec +30.00000°',
  );
  await expect(headline(page)).toHaveText(
    'Fetching SPHEREx frames for this object from the archive… 4 of 31 ready.',
  );
  await expect(page.getByTestId('frames-progress-detail')).toContainText(
    'The archive search found 31 frames: 4 ready to play, 26 still to download, 1 not usable',
  );
  await expect(counter(page)).toHaveText('Frame 1 of 4');
  // The deferred count is in the progress box, not repeated in the refusal list.
  await expect(page.getByTestId('missing')).not.toContainText('not downloaded yet');

  // The spectrum waits for the complete list.
  await page.getByRole('button', { name: 'Show spectrum', exact: true }).click();
  await expect(page.getByTestId('spectrum-waiting')).toContainText(
    'The spectrum is measured once all frames have been downloaded',
  );

  // Playback works mid-load and is not reset by the next part.
  const play = page.getByTestId('play-pause');
  await expect(play).toBeEnabled();
  await play.click();
  await expect(play).toHaveText('Pause');
  await expect(counter(page)).not.toHaveText(/^Frame 1 of/);
  await expect(counter(page)).toHaveText(/ of 10$/, { timeout: 10_000 });
  await expect(play).toHaveText('Pause');
  await expect(headline(page)).toContainText('10 of 31 ready');

  // Complete: the progress box goes, the spectrum is measured on its own.
  await expect(page.getByTestId('frames-progress')).toHaveCount(0, { timeout: 15_000 });
  await expect(counter(page)).toHaveText(/ of 30$/);
  await expect(page.getByTestId('spectrum-waiting')).toHaveCount(0);
  await expect(page.getByTestId('spectrum-table')).toBeAttached({ timeout: 10_000 });
  await expect(page.getByTestId('announcer')).toHaveText(
    /Finished fetching frames: 30 frames ready|Spectrum/,
  );
  await play.click();
  await expect(play).toHaveText('Play');
});

test('Stop keeps the frames shown so far; Continue fetches the rest', async ({ page }) => {
  await page.goto('/');
  await search(page, 'Synthetic progressive');
  await expect(headline(page)).toContainText('4 of 31 ready');

  const stop = page.getByTestId('frames-stop');
  await stop.focus();
  await page.keyboard.press('Enter'); // keyboard reachable (R9)
  await expect(headline(page)).toHaveText('Stopped. 4 of 31 frames ready; 26 not downloaded.');
  await expect(page.getByTestId('announcer')).toHaveText('Stopped fetching frames. 4 of 31 ready.');
  // Nothing more arrives while stopped (a part takes 1.2 s).
  await page.waitForTimeout(3000);
  await expect(counter(page)).toHaveText('Frame 1 of 4');
  // The frames shown so far still play.
  await page.getByTestId('play-pause').click();
  await expect(counter(page)).not.toHaveText('Frame 1 of 4');
  await page.getByTestId('play-pause').click();

  await page.getByTestId('frames-continue').click();
  await expect(headline(page)).toContainText('Fetching SPHEREx frames');
  await expect(page.getByTestId('frames-progress')).toHaveCount(0, { timeout: 15_000 });
  await expect(counter(page)).toHaveText(/ of 30$/);
});

test('a new search replaces a progressive load', async ({ page }) => {
  await page.goto('/');
  await search(page, 'Synthetic progressive');
  await expect(headline(page)).toContainText('4 of 31 ready');
  await search(page, 'RW Aur');
  await expect(page.getByTestId('object-name')).toHaveText('RW Aurigae');
  await expect(counter(page)).toHaveText('Frame 1 of 24');
  await page.waitForTimeout(3000);
  await expect(page.getByTestId('frames-progress')).toHaveCount(0);
  await expect(counter(page)).toHaveText('Frame 1 of 24');
});

test('cached spots get their own markers, a target is marked once', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('sky-pane')).toHaveAttribute('data-sky-state', 'ready', {
    timeout: 30_000,
  });
  await page.waitForFunction(() => '__sxSky' in globalThis);
  // Look at the spot (RA 45°, Dec −15°), so its marker is on screen.
  await page.evaluate(() => {
    const hook = (globalThis as unknown as { __sxSky: { setView(v: object): void } }).__sxSky;
    hook.setView({ ra: 45, dec: -15, fovDeg: 30 });
  });
  // eps Ind B and R Dra are in the cached list but already have target markers; the spot and the
  // Aqua Prime fixture (issue #60) are marked by the cached list only.
  await expect(page.getByTestId('sky-cached-marker')).toHaveCount(2, { timeout: 15_000 });
  const cached = page.locator(
    '[data-testid="sky-cached-marker"][data-object-id="synthetic-cached-spot"]',
  );
  await expect(cached).toHaveCount(1);
  await expect(cached).toHaveAccessibleName(
    'RA 45.00000°, Dec −15.00000°: cached, 12 frames, loads instantly. Open it',
  );
  // Off screen markers are hidden, so count them in the DOM.
  await expect(page.getByTestId('sky-marker').filter({ hasText: 'Epsilon Indi B' })).toHaveCount(1);
  await expect(page.locator('[data-object-id="eps-indi-b"]')).toHaveCount(0);
  // Keyboard: focus shows the label; Enter opens the spot with its coordinates.
  await cached.focus();
  await expect(cached.locator('.sx-marker-label')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('search-input')).toHaveValue('45.00000,-15.00000');
  await expect(counter(page)).toHaveText('Frame 1 of 12');
  await expect(page.getByTestId('frames-progress')).toHaveCount(0);
});

test('a linked frame that has not arrived yet stays in the link, then opens', async ({ page }) => {
  const frame = 'synthetic-progressive-f012';
  await page.goto(`/#ra=30&dec=30&name=Synthetic+progressive&frame=${frame}`);
  await expect(headline(page)).toContainText('4 of 31 ready');
  await expect(counter(page)).toHaveText('Frame 1 of 4');
  // Copying or reloading the page meanwhile keeps the frame.
  expect(new URL(page.url()).hash).toContain(`frame=${frame}`);
  await expect(counter(page)).toHaveText('Frame 13 of 18', { timeout: 10_000 });
  expect(new URL(page.url()).hash).toContain(`frame=${frame}`);
});

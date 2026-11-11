// M1 "Done when": all 5 targets play and show a spectrum from fixtures (issue #3, A1.1).
// The dev server runs with `--mode fixtures` (playwright.config.ts), so /v1 answers from the
// SYNTHETIC fixtures; no backend is needed.
import { expect, test, type Page } from '@playwright/test';
import { openMore } from './flipbookUi';

/** Collects console errors and page errors, except those whose text or URL matches `allow`. */
function trackErrors(page: Page, allow: RegExp[] = []): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const where = `${msg.text()} ${msg.location().url}`;
    if (!allow.some((r) => r.test(where))) errors.push(where);
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

async function search(page: Page, text: string) {
  const input = page.getByTestId('search-input');
  await input.fill(text);
  await input.press('Enter');
}

/**
 * Picks a demo target from the search list, as a user does: a pointer press opens the list (it does
 * not open on programmatic focus, WCAG 3.2.1), then the row is clicked. The "Test targets" chips
 * were replaced by this list (issue #68 Track D).
 */
async function pickTarget(page: Page, name: string) {
  const input = page.getByTestId('search-input');
  await input.click();
  // After an earlier pick the field holds that name and the list is filtered by it: clear it.
  await input.fill('');
  await page
    .getByTestId('search-list')
    .getByRole('option', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
    .click();
}

/**
 * Spectrum shape per target, like the real backend on the full cache (issue #24): Barnard's Star
 * and R Draconis saturate (no points), RW Aurigae has a few short-wavelength points only.
 */
const TARGETS: readonly { name: string; points: number; flagged: number }[] = [
  { name: "Barnard's Star", points: 0, flagged: 0 },
  { name: 'Epsilon Indi B', points: 22, flagged: 3 },
  { name: 'WISE 0855-0714', points: 22, flagged: 3 },
  { name: 'RW Aurigae', points: 4, flagged: 0 },
  { name: 'R Draconis', points: 0, flagged: 0 },
];

test.describe('the five A1.1 targets', () => {
  for (const [i, { name, points, flagged }] of TARGETS.entries()) {
    test(`${name}: plays its frames and shows its spectrum or says why not`, async ({ page }) => {
      // R Draconis has one deliberately missing cutout (refusal path), which logs a 404.
      const errors = trackErrors(page, [/r-dra-f005\.png/]);
      await page.goto('/');

      if (i === 0) await search(page, name);
      else {
        await pickTarget(page, name);
      }

      await expect(page.getByTestId('fixture-banner')).toBeVisible();
      await expect(page.getByTestId('object-name')).toHaveText(name);
      const counter = page.getByTestId('frame-counter');
      await expect(counter).toHaveText('1 / 24');
      await expect(page.getByTestId('badge').first()).toHaveText('Fixture');
      await openMore(page, 'about');
      await expect(page.getByTestId('orientation-note')).toBeVisible();
      const img = page.getByTestId('cutout');
      await expect
        .poll(() => img.evaluate((el: { naturalWidth: number }) => el.naturalWidth))
        .toBeGreaterThan(0);

      // Play, see the frame change, pause.
      const play = page.getByTestId('play-pause');
      await expect(play).toBeEnabled();
      await play.click();
      await expect(play).toHaveText('Pause');
      await expect(counter).not.toHaveText('1 / 24', { timeout: 10_000 });
      await play.click();
      await expect(play).toHaveText('Play');

      // Step with the keyboard: wavelength and time change.
      await page.keyboard.press('Home'); // focus is on Play, so this is ignored by the flipbook
      await page.getByTestId('frame-viewer').focus();
      await page.keyboard.press('Home');
      await expect(counter).toHaveText('1 / 24');
      // The wavelength is in the player's frame info, the date on the picture's corner.
      const wl = await page.locator('.sx-frame-info').textContent();
      const date = await page.getByTestId('frame-date').textContent();
      await page.keyboard.press('ArrowRight');
      await expect(counter).toHaveText('2 / 24');
      await expect(page.locator('.sx-frame-info')).not.toHaveText(wl ?? '');
      expect(date).toMatch(/^\s*\d{1,2} [A-Z][a-z]{2} 2025\s*$/);

      // The spectrum is always on the card (no click on the ring): the chart with a hollow ring per
      // flagged point and an error bar per good one, or why there is none.
      await expect(page.getByTestId('spectrum-panel')).toBeVisible();
      const chart = page.getByTestId('spectrum-chart');
      if (points === 0) {
        await expect(page.getByTestId('no-spectrum')).toContainText('No spectrum:');
        await expect(chart).toHaveCount(0);
      } else {
        await expect(chart).toBeVisible();
        await expect(chart.locator('line[stroke-opacity=".25"]')).toHaveCount(points - flagged);
        await expect(chart.locator('circle[fill="none"]')).toHaveCount(flagged);
        await expect(chart.locator('circle:not([fill="none"])')).toHaveCount(points - flagged);
        // ASSUMPTION: the "Not absolute photometry" caveat (Q-23) is no longer on the card; reported.
      }
      await expect(page.getByTestId('spectrum-panel')).not.toContainText('Not available:');

      // Shareable link with coordinates.
      expect(new URL(page.url()).hash).toMatch(/^#ra=[\d.]+&dec=-?[\d.]+&name=/);
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }
});

test('R Draconis: a missing cutout is refused, not drawn', async ({ page }) => {
  await page.goto('/');
  await search(page, 'R Dra');
  await expect(page.getByTestId('frame-counter')).toHaveText('1 / 24');
  await openMore(page, 'about');
  await expect(page.getByTestId('preload-progress')).toContainText('1 unavailable');
  await page.getByTestId('scrubber').fill('5');
  await expect(page.getByTestId('frame-counter')).toHaveText('6 / 24');
  await expect(page.getByTestId('cutout-unavailable')).toBeVisible();
  await expect(page.getByTestId('object-ring')).toHaveCount(0);
  const missing = page.getByTestId('missing');
  await expect(missing).toContainText('Frames found but not shown:');
  await expect(missing).toContainText(
    '1 frame whose image could not be loaded from the archive or the cache.',
  );
  await expect(missing).toContainText(
    '1 frame where the object’s position falls outside the image.',
  );
  await expect(missing).not.toContainText('Not available:');
  // The frame IDs sit behind a disclosure.
  const cutout = missing.locator('[data-testid="refusal-group"][data-reason="cutout"]');
  await expect(cutout.getByText('r-dra-f005')).toHaveCount(0);
  await cutout.locator('summary').click();
  await expect(cutout.getByText('r-dra-f005')).toBeVisible();
  await expect(cutout.locator('summary')).toContainText('(hide frame IDs)');
  const outside = missing.locator('[data-testid="refusal-group"][data-reason="outside_cutout"]');
  await outside.locator('summary').click();
  await expect(outside.getByText('r-dra-f024')).toBeVisible();

  // Keys pressed in the ID box stay there: no flipbook step, seek or play (keyboard, R9).
  const box = outside.getByRole('region', {
    name: 'Frames found but not shown, frame IDs: outside the image',
  });
  await box.focus();
  for (const key of ['End', 'Home', 'ArrowRight', ' ']) await page.keyboard.press(key);
  await expect(page.getByTestId('frame-counter')).toHaveText('6 / 24');
  await expect(page.getByTestId('play-pause')).toHaveText('Play');
});

test("Barnard's Star: a saturated object says why there is no spectrum", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await search(page, "Barnard's Star");
  await expect(page.getByTestId('frame-counter')).toHaveText('1 / 24');

  // The card's spectrum says it in one sentence; no chart, no table.
  await expect(page.getByTestId('no-spectrum')).toHaveText(
    "No spectrum: Barnard's Star is too bright and saturates the detector in 23 of 24 frames, so its brightness can't be measured.",
  );
  await expect(page.getByTestId('spectrum-chart')).toHaveCount(0);
  await expect(page.getByTestId('spectrum-table')).toHaveCount(0);
  await expect(page.getByTestId('spectrum-panel')).not.toContainText('Not available:');
  await expect(page.getByTestId('announcer')).toContainText(
    "No spectrum for Barnard's Star: the detector flagged the object’s centre as saturated or unusable in 23 of 24 frames.",
  );
  // ASSUMPTION: the per-reason frame-ID lists of the old Spectrum panel are not on the card.
  expect(errors, errors.join('\n')).toEqual([]);
});

test('RW Aurigae: a partial spectrum draws only the points it could measure', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await search(page, 'RW Aur');
  await expect(page.getByTestId('frame-counter')).toHaveText('1 / 24');

  const chart = page.getByTestId('spectrum-chart');
  await expect(chart).toBeVisible();
  await expect(chart.locator('circle')).toHaveCount(4);
  // The text equivalent of the chart (screen readers): one row per point.
  await expect(page.getByTestId('spectrum-table').locator('tbody tr')).toHaveCount(4);
  await expect(page.getByTestId('announcer')).toContainText(
    /Spectrum loaded: 4 points, 0 flagged, .* 20 frames not measured\./,
  );
  // ASSUMPTION: the coverage sentence and the refusal groups of the old Spectrum panel are gone.
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a shared link with coordinates loads the object', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/#ra=76.95653&dec=30.40144');
  await expect(page.getByTestId('object-name')).toHaveText('RA 76.95653°, Dec +30.40144°');
  await expect(page.getByTestId('frame-counter')).toHaveText('1 / 24');
  await expect(page.getByTestId('search-input')).toHaveValue('76.95653,30.40144');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a shared link with a name and frame opens on that frame', async ({ page }) => {
  await page.goto('/#ra=248.16761&dec=66.75498&name=R%20Dra&frame=r-dra-f007');
  await expect(page.getByTestId('object-name')).toHaveText('R Draconis');
  await expect(page.getByTestId('frame-counter')).toHaveText('8 / 24');
});

test('the back button returns to the previous object', async ({ page }) => {
  await page.goto('/');
  await pickTarget(page, 'RW Aurigae');
  await expect(page.getByTestId('object-name')).toHaveText('RW Aurigae');
  await pickTarget(page, 'R Draconis');
  await expect(page.getByTestId('object-name')).toHaveText('R Draconis');
  await page.goBack();
  await expect(page.getByTestId('object-name')).toHaveText('RW Aurigae');
  await expect(page.getByTestId('frame-counter')).toHaveText('1 / 24');
});

test('pausing on a frame writes it to the link', async ({ page }) => {
  await page.goto('/');
  await search(page, 'RW Aur');
  await expect(page.getByTestId('frame-counter')).toHaveText('1 / 24');
  await page.getByRole('button', { name: 'Next frame' }).click();
  await expect(page.getByTestId('frame-counter')).toHaveText('2 / 24');
  await expect.poll(() => new URL(page.url()).hash).toContain('frame=rw-aur-f001');
});

test('an unknown name shows an error (404)', async ({ page }) => {
  // No console-error check: the 404 is deliberate and the browser logs it.
  await page.goto('/');
  await search(page, 'Nowhere Star');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('No object found for “Nowhere Star”');
  await expect(alert).toContainText('Server says:');
});

test('a slow archive (504) shows an error and Try again recovers', async ({ page }) => {
  let calls = 0;
  await page.route('**/v1/resolve**', async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.fulfill({
        status: 504,
        json: { error: 'upstream_timeout', detail: 'IRSA did not answer in time.' },
      });
    } else await route.fallback();
  });
  await page.goto('/');
  await search(page, 'RW Aur');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('The archive is slow or not answering');
  await expect(alert).toContainText('IRSA did not answer in time.');
  await alert.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('frame-counter')).toHaveText('1 / 24');
});

test('a slow reply shows the loading state', async ({ page }) => {
  await page.route('**/v1/objects/*/frames', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.fallback();
  });
  await page.goto('/');
  await search(page, 'RW Aur');
  // The island says one word now (the sentence with the position is gone).
  await expect(page.getByTestId('loading')).toHaveText('Searching');
  await expect(page.getByTestId('frame-counter')).toHaveText('1 / 24');
  await expect(page.getByTestId('loading')).toHaveCount(0);
});

test('a refused moving object says why, with no frames', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await search(page, 'Synthetic refused mover');
  await expect(page.getByTestId('no-frames')).toContainText(
    'The predicted path of this object could not be loaded',
  );
  await expect(page.getByTestId('flipbook')).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Rainbow Trails: one dot per frame for a mover; disabled with a reason otherwise', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await search(page, "Barnard's Star");
  await expect(page.getByTestId('frame-counter')).toHaveText('1 / 24');
  await openMore(page, 'about');
  await expect(page.getByTestId('trails-toggle')).toHaveCount(0);
  await expect(page.getByTestId('trails-reason')).toContainText('native orientation');

  await search(page, 'Synthetic mover');
  await expect(page.getByTestId('frame-counter')).toHaveText('1 / 16');
  await openMore(page, 'about');
  await expect(page.getByTestId('orientation-note')).toContainText('North up');
  const toggle = page.getByTestId('trails-toggle');
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('trail-dot')).toHaveCount(16);
  await expect(page.getByTestId('announcer')).toContainText('Rainbow Trails');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('keyboard only: search, play and pause, see the spectrum', async ({ page }) => {
  await page.goto('/');
  // The search is a dock button that opens into the field; "/" focuses it from anywhere.
  await expect(page.getByTestId('search-input')).toBeVisible();
  await page.keyboard.press('/');
  await expect(page.getByTestId('search-input')).toBeFocused();
  await page.keyboard.type('RW Aur');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('frame-counter')).toHaveText('1 / 24');
  await expect(page.getByTestId('play-pause')).toBeEnabled();
  // The island has grown into the panel (issue #66): its controls can take focus.
  await expect(page.getByTestId('island')).toHaveAttribute('data-arrived', '');

  const tabTo = async (testId: string) => {
    for (let k = 0; k < 30; k++) {
      await page.keyboard.press('Tab');
      if (
        await page
          .getByTestId(testId)
          .evaluate((el: { matches(s: string): boolean }) => el.matches(':focus'))
      )
        return;
    }
    throw new Error(`could not Tab to ${testId}`);
  };

  await tabTo('frame-viewer');
  await page.keyboard.press(' ');
  await expect(page.getByTestId('play-pause')).toHaveText('Pause');
  await page.keyboard.press(' ');
  await expect(page.getByTestId('play-pause')).toHaveText('Play');
  await expect(page.getByTestId('announcer')).toContainText(/Paused\. Frame \d+ of 24/);

  // The spectrum is on the card already: nothing to open.
  await expect(page.getByTestId('spectrum-chart')).toBeVisible();
});

test('three numbers ask for decimal degrees', async ({ page }) => {
  await page.goto('/');
  await search(page, '17 57 48');
  await expect(page.getByTestId('search-problem')).toContainText('decimal degrees');
  await expect(page.getByTestId('search-input')).toHaveAttribute('aria-invalid', 'true');
});

// ---- Code-review regressions ----

test('Back to the page without a hash clears the object (review finding 2)', async ({ page }) => {
  await page.goto('/');
  await pickTarget(page, 'RW Aurigae');
  await expect(page.getByTestId('object-name')).toHaveText('RW Aurigae');
  await page.goBack();
  await expect.poll(() => new URL(page.url()).hash).toBe('');
  await expect(page.getByTestId('object-name')).toHaveCount(0);
  await expect(page.getByTestId('flipbook')).toHaveCount(0);
  await expect(page.getByTestId('search-input')).toHaveValue('');
});

test('a link with unusable coordinates says so (review finding 3)', async ({ page }) => {
  await page.goto('/#ra=999&dec=5');
  await expect(page.getByTestId('link-problem')).toContainText('Link coordinates ignored');
  await expect(page.getByTestId('announcer')).toContainText('Link coordinates ignored');
  await expect(page.getByTestId('search-input')).toHaveAttribute('aria-describedby', /\S+ \S+/);
});

test('Rainbow Trails is disabled with a reason when every cutout fails (review finding 6)', async ({
  page,
}) => {
  await page.route('**/v1/objects/synthetic-mover/cutouts/*', (route) =>
    route.fulfill({ status: 404, json: { error: 'not_found', detail: 'test' } }),
  );
  await page.goto('/');
  await search(page, 'Synthetic mover');
  await openMore(page, 'about');
  await expect(page.getByTestId('preload-progress')).toContainText('16 unavailable');
  await expect(page.getByTestId('trails-toggle')).toHaveCount(0);
  await expect(page.getByTestId('trails-reason')).toContainText('No cutout could be loaded');
});

test('flipbook keys ignore Alt, Ctrl and Meta (review finding 5)', async ({ page }) => {
  await page.goto('/');
  await search(page, 'RW Aur');
  const counter = page.getByTestId('frame-counter');
  await expect(counter).toHaveText('1 / 24');
  await expect(page.getByTestId('play-pause')).toBeEnabled();
  // The island has grown into the panel (issue #66): its controls can take focus.
  await expect(page.getByTestId('island')).toHaveAttribute('data-arrived', '');
  await page.getByTestId('frame-viewer').focus();
  await page.keyboard.press('Alt+ArrowRight');
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Control+ArrowRight');
  await expect(page.getByTestId('play-pause')).toHaveText('Play');
  await expect(counter).toHaveText('1 / 24');
  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveText('2 / 24');
});

test('Space does not start play while Play is disabled (review finding 9)', async ({ page }) => {
  // Hold every cutout after the first, so Play stays disabled (it needs 4 frames ready).
  await page.route('**/v1/objects/rw-aur/cutouts/*', async (route) => {
    if (route.request().url().includes('rw-aur-f000')) await route.fallback();
    else await new Promise(() => {}); // never answers during the test
  });
  await page.goto('/');
  await search(page, 'RW Aur');
  await expect(page.getByTestId('frame-counter')).toHaveText('1 / 24');
  const play = page.getByTestId('play-pause');
  await expect(play).toBeDisabled();
  // The island has grown into the panel (issue #66): its controls can take focus.
  await expect(page.getByTestId('island')).toHaveAttribute('data-arrived', '');
  await page.getByTestId('frame-viewer').focus();
  // Record whether each keydown had its default prevented once it bubbled to window.
  await page.evaluate(() => {
    const w = globalThis as unknown as {
      sxPrevented: string[];
      addEventListener(
        type: string,
        fn: (e: { key: string; defaultPrevented: boolean }) => void,
      ): void;
    };
    w.sxPrevented = [];
    w.addEventListener('keydown', (e) => w.sxPrevented.push(`${e.key}:${e.defaultPrevented}`));
  });
  await page.keyboard.press(' ');
  await page.keyboard.press('k');
  await expect(play).toHaveText('Play');
  // Re-review item 1: Space and K are still consumed (default prevented), so Space cannot scroll.
  const prevented = await page.evaluate(
    () => (globalThis as unknown as { sxPrevented: string[] }).sxPrevented,
  );
  expect(prevented).toEqual([' :true', 'k:true']);
  await expect(page.getByTestId('announcer')).not.toContainText('Playing');
});

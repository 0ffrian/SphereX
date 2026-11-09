// M1 "Done when": all 5 targets play and show a spectrum from fixtures (issue #3, A1.1).
// The dev server runs with `--mode fixtures` (playwright.config.ts), so /v1 answers from the
// SYNTHETIC fixtures; no backend is needed.
import { expect, test, type Page } from '@playwright/test';

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
        await page
          .getByRole('group', { name: 'Test targets' })
          .getByRole('button', { name, exact: true })
          .click();
      }

      await expect(page.getByTestId('fixture-banner')).toBeVisible();
      await expect(page.getByTestId('object-name')).toHaveText(name);
      const counter = page.getByTestId('frame-counter');
      await expect(counter).toHaveText('Frame 1 of 24');
      await expect(page.getByTestId('badge').first()).toHaveText('Fixture');
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
      await expect(counter).not.toHaveText('Frame 1 of 24', { timeout: 10_000 });
      await play.click();
      await expect(play).toHaveText('Play');

      // Step with the keyboard: wavelength and time change.
      await page.keyboard.press('Home'); // focus is on Play, so this is ignored by the flipbook
      await page.getByTestId('frame-viewer').focus();
      await page.keyboard.press('Home');
      await expect(counter).toHaveText('Frame 1 of 24');
      const wl = await page.getByTestId('frame-wavelength').textContent();
      const time = await page.getByTestId('frame-time').textContent();
      await page.keyboard.press('ArrowRight');
      await expect(counter).toHaveText('Frame 2 of 24');
      await expect(page.getByTestId('frame-wavelength')).not.toHaveText(wl ?? '');
      await expect(page.getByTestId('frame-time')).not.toHaveText(time ?? '');
      await expect(page.getByTestId('frame-time')).toHaveText(/^2025-05-03 \d\d:\d\d:\d\d UTC$/);

      // Click the object: spectrum with error bars and flagged points, or why there is none.
      await page.getByTestId('object-ring').click();
      await expect(page.locator('#spectrum-heading')).toBeFocused();
      const chart = page.getByTestId('spectrum-chart');
      if (points === 0) {
        await expect(page.getByTestId('no-spectrum')).toContainText(
          'the detector flagged the object’s centre as saturated or unusable',
        );
        await expect(chart).toHaveCount(0);
        await expect(page.getByTestId('spectrum-caveat')).toHaveCount(0);
      } else {
        await expect(chart).toBeVisible();
        await expect(chart.getByTestId('error-bar')).toHaveCount(points);
        await expect(chart.getByTestId('flagged-point')).toHaveCount(flagged);
        await expect(chart.getByTestId('point')).toHaveCount(points - flagged);
        // Q-23: never presented as absolute photometry.
        await expect(page.getByTestId('spectrum-caveat')).toContainText('Not absolute photometry');
      }
      await expect(page.getByTestId('spectrum-missing')).toBeVisible();
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
  await expect(page.getByTestId('frame-counter')).toHaveText('Frame 1 of 24');
  await expect(page.getByTestId('preload-progress')).toContainText('1 unavailable');
  await page.getByTestId('scrubber').fill('5');
  await expect(page.getByTestId('frame-counter')).toHaveText('Frame 6 of 24');
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
  await expect(page.getByTestId('frame-counter')).toHaveText('Frame 6 of 24');
  await expect(page.getByTestId('play-pause')).toHaveText('Play');
});

test("Barnard's Star: a saturated object says why there is no spectrum", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await search(page, "Barnard's Star");
  await expect(page.getByTestId('frame-counter')).toHaveText('Frame 1 of 24');
  await expect(page.getByTestId('missing')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show spectrum', exact: true }).click();

  await expect(page.getByTestId('no-spectrum')).toHaveText(
    'There is no spectrum: this tool could not measure any of the 24 frames found. In 23 of them, the detector flagged the object’s centre as saturated or unusable; the reason for the other frame is below.',
  );
  // D-02: the frame checks still wear the provenance badge, above the sentence.
  const badge = page.getByTestId('spectrum-panel').getByTestId('badge');
  await expect(badge).toHaveText('Fixture');
  const html = await page
    .getByTestId('spectrum-panel')
    .evaluate((el: { innerHTML: string }) => el.innerHTML);
  expect(html.indexOf('data-testid="badge"')).toBeGreaterThan(-1);
  expect(html.indexOf('data-testid="badge"')).toBeLessThan(
    html.indexOf('data-testid="no-spectrum"'),
  );
  await expect(page.getByTestId('spectrum-chart')).toHaveCount(0);
  await expect(page.getByTestId('spectrum-caveat')).toHaveCount(0);
  await expect(page.getByTestId('spectrum-table')).toHaveCount(0);

  const list = page.getByTestId('spectrum-missing');
  await expect(list).toContainText('Frames not measured:');
  const groups = list.getByTestId('refusal-group');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toHaveAttribute('data-reason', 'saturated');
  await expect(groups.nth(0).locator('summary')).toContainText(
    '23 frames where the detector flagged the object’s centre as saturated or unusable.',
  );
  await expect(groups.nth(1)).toHaveAttribute('data-reason', 'aperture_flags');
  await expect(page.getByTestId('spectrum-panel')).not.toContainText('Not available:');
  await expect(page.getByTestId('announcer')).toContainText(
    "No spectrum for Barnard's Star: the detector flagged the object’s centre as saturated or unusable in 23 of 24 frames.",
  );

  // Keyboard: focus the saturated group's summary and open it with Enter.
  await groups.nth(0).locator('summary').focus();
  await page.keyboard.press('Enter');
  const ids = groups
    .nth(0)
    .getByRole('region', { name: 'Frames not measured, frame IDs: saturated' });
  await expect(ids).toBeVisible();
  await expect(ids.getByText('barnards-star-f000', { exact: true })).toBeVisible();
  await expect(ids.getByRole('listitem')).toHaveCount(23);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('RW Aurigae: a partial spectrum says which frames it covers', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await search(page, 'RW Aur');
  await expect(page.getByTestId('frame-counter')).toHaveText('Frame 1 of 24');
  await page.getByRole('button', { name: 'Show spectrum', exact: true }).click();

  const chart = page.getByTestId('spectrum-chart');
  await expect(chart).toBeVisible();
  await expect(chart.getByTestId('point')).toHaveCount(4);
  const coverage = page.getByTestId('spectrum-coverage');
  await expect(coverage).toHaveText(
    /^This tool could measure 4 of the 24 frames found\. The measured points lie between \d\.\d{3} µm and \d\.\d{3} µm; the frames found span /,
  );
  await expect(page.getByTestId('spectrum-caveat')).toBeVisible();
  const groups = page.getByTestId('spectrum-missing').getByTestId('refusal-group');
  await expect(groups).toHaveCount(3);
  expect(
    await groups.evaluateAll((els) => els.map((el) => el.getAttribute('data-reason'))),
  ).toEqual(['saturated', 'aperture_edge', 'aperture_flags']);
  await expect(groups.nth(0).locator('summary')).toContainText(
    '18 frames where the detector flagged',
  );
  // The refusals come after the data table, so the chart sits next to its text equivalent.
  await page.getByText('Show data table').click();
  await expect(page.getByTestId('spectrum-table')).toBeVisible();
  const html = await page
    .getByTestId('spectrum-panel')
    .evaluate((el: { innerHTML: string }) => el.innerHTML);
  expect(html.indexOf('data-testid="spectrum-table"')).toBeGreaterThan(-1);
  expect(html.indexOf('data-testid="spectrum-table"')).toBeLessThan(
    html.indexOf('data-testid="spectrum-missing"'),
  );
  await expect(page.getByTestId('announcer')).toContainText(
    /Spectrum loaded: 4 points, 0 flagged, .* 20 frames not measured\./,
  );
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a shared link with coordinates loads the object', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/#ra=76.95653&dec=30.40144');
  await expect(page.getByTestId('object-name')).toHaveText('RA 76.95653°, Dec +30.40144°');
  await expect(page.getByTestId('frame-counter')).toHaveText('Frame 1 of 24');
  await expect(page.getByTestId('search-input')).toHaveValue('76.95653,30.40144');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a shared link with a name and frame opens on that frame', async ({ page }) => {
  await page.goto('/#ra=248.16761&dec=66.75498&name=R%20Dra&frame=r-dra-f007');
  await expect(page.getByTestId('object-name')).toHaveText('R Draconis');
  await expect(page.getByTestId('frame-counter')).toHaveText('Frame 8 of 24');
});

test('the back button returns to the previous object', async ({ page }) => {
  await page.goto('/');
  const picks = page.getByRole('group', { name: 'Test targets' });
  await picks.getByRole('button', { name: 'RW Aurigae' }).click();
  await expect(page.getByTestId('object-name')).toHaveText('RW Aurigae');
  await picks.getByRole('button', { name: 'R Draconis' }).click();
  await expect(page.getByTestId('object-name')).toHaveText('R Draconis');
  await page.goBack();
  await expect(page.getByTestId('object-name')).toHaveText('RW Aurigae');
  await expect(page.getByTestId('frame-counter')).toHaveText('Frame 1 of 24');
});

test('pausing on a frame writes it to the link', async ({ page }) => {
  await page.goto('/');
  await search(page, 'RW Aur');
  await expect(page.getByTestId('frame-counter')).toHaveText('Frame 1 of 24');
  await page.getByRole('button', { name: 'Next frame' }).click();
  await expect(page.getByTestId('frame-counter')).toHaveText('Frame 2 of 24');
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
  await expect(page.getByTestId('frame-counter')).toHaveText('Frame 1 of 24');
});

test('a slow reply shows the loading state', async ({ page }) => {
  await page.route('**/v1/objects/*/frames', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.fallback();
  });
  await page.goto('/');
  await search(page, 'RW Aur');
  await expect(page.getByTestId('loading')).toContainText(
    'Searching the archive for SPHEREx frames at RA 76.95653°, Dec +30.40144°',
  );
  await expect(page.getByTestId('frame-counter')).toHaveText('Frame 1 of 24');
  await expect(page.getByTestId('loading')).toHaveCount(0);
});

test('a refused moving object says why, with no frames', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await search(page, 'Synthetic refused mover');
  await expect(page.getByTestId('no-frames')).toContainText(
    'Frames for moving Solar System objects are not searched yet',
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
  await expect(page.getByTestId('frame-counter')).toHaveText('Frame 1 of 24');
  await expect(page.getByTestId('trails-toggle')).toBeDisabled();
  await expect(page.getByTestId('trails-reason')).toContainText('native orientation');

  await search(page, 'Synthetic mover');
  await expect(page.getByTestId('frame-counter')).toHaveText('Frame 1 of 16');
  await expect(page.getByTestId('orientation-note')).toHaveCount(0);
  const toggle = page.getByTestId('trails-toggle');
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('trail-dot')).toHaveCount(16);
  await expect(page.getByTestId('announcer')).toContainText('Rainbow Trails');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('keyboard only: search, play and pause, open the spectrum', async ({ page }) => {
  await page.goto('/');
  // A Tab pressed before the app has rendered lands on <body>; wait for the first control.
  await expect(page.getByTestId('search-input')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('search-input')).toBeFocused();
  await page.keyboard.type('RW Aur');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('frame-counter')).toHaveText('Frame 1 of 24');
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

  await page.keyboard.press('Home');
  await tabTo('object-ring');
  await page.keyboard.press('Enter');
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
  await page
    .getByRole('group', { name: 'Test targets' })
    .getByRole('button', { name: 'RW Aurigae' })
    .click();
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
  await expect(page.getByTestId('preload-progress')).toContainText('16 unavailable');
  await expect(page.getByTestId('trails-toggle')).toBeDisabled();
  await expect(page.getByTestId('trails-reason')).toContainText('No cutout could be loaded');
});

test('flipbook keys ignore Alt, Ctrl and Meta (review finding 5)', async ({ page }) => {
  await page.goto('/');
  await search(page, 'RW Aur');
  const counter = page.getByTestId('frame-counter');
  await expect(counter).toHaveText('Frame 1 of 24');
  await expect(page.getByTestId('play-pause')).toBeEnabled();
  // The island has grown into the panel (issue #66): its controls can take focus.
  await expect(page.getByTestId('island')).toHaveAttribute('data-arrived', '');
  await page.getByTestId('frame-viewer').focus();
  await page.keyboard.press('Alt+ArrowRight');
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Control+ArrowRight');
  await expect(page.getByTestId('play-pause')).toHaveText('Play');
  await expect(counter).toHaveText('Frame 1 of 24');
  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveText('Frame 2 of 24');
});

test('Space does not start play while Play is disabled (review finding 9)', async ({ page }) => {
  // Hold every cutout after the first, so Play stays disabled (it needs 4 frames ready).
  await page.route('**/v1/objects/rw-aur/cutouts/*', async (route) => {
    if (route.request().url().includes('rw-aur-f000')) await route.fallback();
    else await new Promise(() => {}); // never answers during the test
  });
  await page.goto('/');
  await search(page, 'RW Aur');
  await expect(page.getByTestId('frame-counter')).toHaveText('Frame 1 of 24');
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

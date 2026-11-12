// Issue #12 overlays on the SYNTHETIC fixtures: markers, flag mask, field of view, contamination,
// refusals and the combine panel. The flipbook keeps working whatever the overlays do.
import { expect, test, type Page } from '@playwright/test';
import { openMore } from './flipbookUi';

async function search(page: Page, text: string) {
  const input = page.getByTestId('search-input');
  await input.fill(text);
  await input.press('Enter');
  await expect(page.getByTestId('frame-counter')).toHaveText(/^1 \/ \d+$/);
  const img = page.getByTestId('cutout');
  await expect
    .poll(() => img.evaluate((el: { naturalWidth: number }) => el.naturalWidth))
    .toBeGreaterThan(0);
  // The toggles are in the card's "More" row (closed at first), Overlays tab.
  await openMore(page, 'overlays');
}

test('Epsilon Indi B: markers, contamination, flags, field of view and combine', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('/');
  await search(page, 'Epsilon Indi B');

  const gaia = page.getByTestId('overlay-toggle-gaia');
  await expect(gaia).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('marker')).toHaveCount(0);
  await gaia.click();
  await expect(gaia).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid="marker"][data-catalog="gaia"]').first()).toBeAttached();
  await expect(page.locator('[data-testid="marker"][data-catalog="wise"]')).toHaveCount(0);
  await expect(page.getByTestId('contamination-line').first()).toContainText(
    'inside the photometry aperture',
  );
  // The spectrum stays on the card under the markers (no ring click to open it any more).
  await expect(page.getByTestId('spectrum-panel')).toBeVisible();

  await page.getByTestId('overlay-toggle-flags').click();
  await expect(page.getByTestId('flag-mask')).toBeAttached();
  await expect(page.getByTestId('flag-legend')).toContainText('Saturated');

  await page.getByTestId('overlay-toggle-fov').click();
  await expect(page.getByTestId('fov-map')).toBeVisible();
  // Frame 3 has no footprint in the fixtures: refused, said so.
  await page.getByTestId('scrubber').fill('2');
  await expect(page.getByTestId('fov-refused')).toBeVisible();
  await expect(page.getByTestId('overlay-missing')).toContainText('no detector footprint');

  await openMore(page, 'combine');
  await page.getByTestId('combine').locator('summary').click();
  await expect(page.getByTestId('combine-warning')).toContainText('µm and');
  await page.getByTestId('combine-show').click();
  await expect(page.getByTestId('combine-image')).toBeVisible();
  await expect
    .poll(() =>
      page.getByTestId('combine-image').evaluate((el: { naturalWidth: number }) => el.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(page.getByTestId('combine-warning')).toContainText('different wavelengths');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('WISE 0855: Gaia is refused with a reason, WISE still works', async ({ page }) => {
  await page.goto('/');
  await search(page, 'WISE 0855');
  await page.getByTestId('overlay-toggle-wise').click();
  await expect(page.getByTestId('overlay-toggle-gaia')).toBeDisabled();
  await expect(page.getByTestId('overlay-reason')).toHaveText(
    'Gaia stars are not available for this object.',
  );
  await expect(page.getByTestId('overlay-missing')).toContainText(
    'Gaia star positions are not available for this object',
  );
  await expect(page.locator('[data-testid="marker"][data-catalog="wise"]').first()).toBeAttached();
});

test('a failed overlays request leaves the flipbook working', async ({ page }) => {
  await page.route('**/v1/objects/*/overlays', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'archive_down', detail: 'Test outage.' }),
    }),
  );
  await page.goto('/');
  await search(page, 'RW Aur');
  await page.getByTestId('overlay-toggle-gaia').click();
  await expect(page.getByTestId('error')).toContainText('Overlays could not be loaded');
  await page.getByTestId('scrubber').fill('3');
  await expect(page.getByTestId('frame-counter')).toHaveText('4 / 24');
  await expect(page.getByTestId('cutout')).toBeVisible();
});

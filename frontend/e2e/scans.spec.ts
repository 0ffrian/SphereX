// Issue #157 (live-areas mock-up states 1, 2, 10 and 11) on the SYNTHETIC fixture server with the
// MOCKED scan API (`?scan=mock`, app/area/scanApi.ts; its objects are invented test values):
// select a region of 15 squares, the gridded offer, scanning square by square (states, skipped
// square, circles with the predicted toggle), a page reload mid-scan, then the combined results.
import { expect, test, type Page } from '@playwright/test';

interface SkyHook {
  setView(v: { ra: number; dec: number; fovDeg: number }): void;
  getView(): { ra: number; dec: number; fovDeg: number };
}
// At 1280 × 800 and 17°, the selection is 9.6° × 6.0°: 5 × 3 squares, as in the mock-up.
const VIEW = { ra: 30, dec: 10, fovDeg: 17 };

async function open(page: Page, query: string) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/${query}`);
  await expect(page.getByTestId('sky-pane')).toHaveAttribute('data-sky-state', 'ready', {
    timeout: 30_000,
  });
  await page.waitForFunction(() => '__sxSky' in globalThis);
  await page.evaluate(() => localStorage.removeItem('sx-scan-run'));
  await page.evaluate(
    (v) => (globalThis as unknown as { __sxSky: SkyHook }).__sxSky.setView(v),
    VIEW,
  );
}
const square = (page: Page, i: number) => page.getByTestId(`scan-square-${i}`);

test('select, grid, scan square by square, reload mid-scan, then the combined results', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await open(page, '?scan=mock&scan_ms=2500');
  await page.getByTestId('tool-area').click();
  await expect(page.getByTestId('area-hint')).toContainText(
    'Click a region to scan · scroll to resize · drag to turn the sky',
  );
  await page.mouse.move(640, 400);
  await page.mouse.move(645, 402);
  await expect(page.getByTestId('area-aim')).toHaveText('9.6° × 6.0° · 15 squares · about 4 h');

  // State 2: the region fills the screen, gridded 5 × 3 and numbered.
  await page.mouse.click(645, 402);
  const overlay = page.getByTestId('scan-overlay');
  await expect(overlay).toHaveAttribute('data-cols', '5');
  await expect(overlay).toHaveAttribute('data-rows', '3');
  await expect(square(page, 15)).toHaveAttribute('data-state', 'plain');
  const card = page.getByTestId('scan-card');
  await expect(card).toHaveAttribute('data-state', 'offer');
  await expect(page.getByTestId('scan-facts')).toContainText(
    '15 (5 × 3) of up to 2°, 1 already done',
  );
  await expect(page.getByTestId('scan-facts')).toContainText('SPHEREx DR1');

  // State 10: square 1 is stored (done at once), the others are analysed left to right.
  await page.getByTestId('scan-start').click();
  await expect(card).toHaveAttribute('data-state', 'running');
  await expect(square(page, 1)).toHaveAttribute('data-state', 'done');
  await expect(square(page, 2)).toHaveAttribute('data-state', 'running');
  await expect(square(page, 15)).toHaveAttribute('data-state', 'todo');
  await expect(page.getByTestId('scan-time')).toContainText(/Square 2 of 15/);
  // Square 4 is skipped: red, with a status-dot message.
  await expect(square(page, 4)).toHaveAttribute('data-state', 'skipped', { timeout: 20_000 });
  await expect(page.getByTestId('scan-skipped')).toContainText('Square 4 skipped');
  await expect(page.getByTestId('scan-skipped')).toContainText(
    'No two visits close in time there.',
  );
  // Circles: 7051 Sean carries across squares 2 and 3; predicted ones hidden until asked.
  const sean = page.locator('[data-obj="7051 Sean"]');
  await expect(sean).toHaveAttribute('data-kind', 'known');
  await expect(sean).toContainText('squares 2–3');
  await expect(page.locator('[data-testid="scan-object"][data-kind="predicted"]')).toHaveCount(0);
  await page.getByTestId('scan-predicted').click();
  await expect(
    page.locator('[data-testid="scan-object"][data-kind="predicted"]').first(),
  ).toBeVisible();
  await page.getByTestId('scan-predicted').click();

  // A reload mid-scan: the run comes back from GET /v1/runs/{id}, every square redrawn.
  const before = await square(page, 2).getAttribute('data-state');
  expect(before).toBe('done');
  await page.reload();
  await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 30_000 });
  await expect(square(page, 1)).toHaveAttribute('data-state', 'done');
  await expect(square(page, 2)).toHaveAttribute('data-state', 'done');
  await expect(square(page, 4)).toHaveAttribute('data-state', 'skipped');

  // State 11: the combined results.
  await expect(page.getByTestId('scan-card')).toHaveAttribute('data-state', 'done', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('scan-prov')).toContainText(
    'Computed live · SPHEREx DR1 · 14 of 15 squares',
  );
  await expect(page.getByTestId('scan-prov')).toContainText(
    'Square 4 skipped: no two visits close in time',
  );
  await expect(page.getByTestId('scan-filter-found')).toHaveAttribute('aria-pressed', 'true');
  const seanRow = page.locator('[data-testid="scan-row"][data-object="7051 Sean"]');
  await expect(seanRow).toContainText('squares 2–3 · 27 Jun');
  await page.getByTestId('scan-filter-known').click();
  await expect(page.locator('[data-testid="scan-row"]').first()).toBeVisible();
  await expect(page.getByTestId('scan-rates')).toContainText('Detection rates not measured yet');
  const download = page.waitForEvent('download');
  await page.getByTestId('scan-export').click();
  expect((await download).suggestedFilename()).toMatch(/^run-.*\.ecsv$/);
  // Scan again: back to selecting.
  await page.getByTestId('scan-again').click();
  await expect(page.getByTestId('sky-canvas')).toHaveAttribute('data-area-mode', 'aim');
});

test('Stop keeps the finished squares; Escape leaves while selecting', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page, '?scan=mock&scan_ms=3000');
  await page.getByTestId('tool-known').click();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('scan-card')).toHaveAttribute('data-state', 'offer');
  await page.getByTestId('scan-start').click();
  await expect(square(page, 2)).toHaveAttribute('data-state', 'running');
  // Pause and Resume are icon buttons with their names; the card has no Minimise button.
  await expect(page.getByTestId('scan-minimise')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pause the scan' }).click();
  await expect(page.getByTestId('scan-card')).toHaveAttribute('data-state', 'paused');
  await page.getByRole('button', { name: 'Resume the scan' }).click();
  await expect(page.getByTestId('scan-card')).toHaveAttribute('data-state', 'running');
  await page.getByTestId('scan-stop').click();
  await expect(page.getByTestId('scan-card')).toHaveAttribute('data-state', 'stopped');
  await expect(square(page, 1)).toHaveAttribute('data-state', 'done');
  await expect(square(page, 2)).toHaveAttribute('data-state', 'todo');
  await expect(page.getByTestId('scan-prov')).toContainText('Stopped');
  await page.getByTestId('scan-again').click();
  await expect(page.getByTestId('sky-canvas')).toHaveAttribute('data-area-mode', 'aim');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tool-known')).toHaveAttribute('aria-pressed', 'false');
});

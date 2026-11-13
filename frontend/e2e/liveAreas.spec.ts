// Issue #144 (Q-462; live-areas mock-up states 1 to 6) on the SYNTHETIC fixture server with the
// MOCKED live job API (`?live=mock…`, app/area/liveAreaApi.ts): select one square (issue #157
// replaced the 2.2° aim and the draw step), the offer, computing, the hand-off to the existing Known list, waiting, the
// failures and Escape. The prepared-area index is routed so the done area appears in it, as the
// backend (#141) stores a live area where `GET /v1/areas` serves it.
import { expect, test, type Page } from '@playwright/test';

interface SkyHook {
  setView(v: { ra: number; dec: number; fovDeg: number }): void;
  getView(): { ra: number; dec: number; fovDeg: number };
}
const NOW = '2026-11-13T07:28:00.000Z';
const VIEW = { ra: 30, dec: 10, fovDeg: 20 };

async function open(page: Page, query: string, opts: { stored?: () => boolean } = {}) {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  const stored = opts.stored ?? (() => false);
  await page.route('**/v1/areas', (r) =>
    r.fulfill(
      json({
        areas: stored()
          ? [{ area_id: 'live-dr1', ra: 30, dec: 10, width_deg: 8, height_deg: 8, data_release: 'spherex_dr1', n_frames: 14, n_visits: 2, computed_at: NOW, cached_at: NOW }]
          : [],
        cached_at: NOW, computed_at: NOW, missing: [],
        provenance: { areas: { tag: 'derived', source: 'test', formula: 'test' } },
      }),
    ),
  );
  await page.route('**/v1/areas/live-dr1/known', (r) =>
    r.fulfill(
      json({
        known: [{ designation: '9532 Abramenko', number: 9532, object_id: null, kind: 'asteroid', v_mag: 17.4, n_frames: 14, n_visits: 2, track_available: false, positions: [] }],
        skybot: [{ visit: 1, fetched_at: NOW }],
        cached_at: NOW, computed_at: NOW, missing: [],
        provenance: { positions: { tag: 'model_dependent', assumption: 'test', source: 'test' }, skybot: { tag: 'measured', source: 'test' } },
      }),
    ),
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/${query}`);
  await expect(page.getByTestId('sky-pane')).toHaveAttribute('data-sky-state', 'ready', { timeout: 30_000 });
  await page.waitForFunction(() => '__sxSky' in globalThis);
  await page.evaluate((v) => (globalThis as unknown as { __sxSky: SkyHook }).__sxSky.setView(v), VIEW);
}
const fov = (page: Page) => page.evaluate(() => (globalThis as unknown as { __sxSky: SkyHook }).__sxSky.getView().fovDeg);

/**
 * State 1 (issue #157): the pointer is the region, drawn to scale; at the default view it is many
 * squares. Zoomed in to one square, a click selects it and the single-area flow (#144) follows.
 */
async function aimAndDraw(page: Page) {
  await page.getByTestId('tool-known').click();
  const canvas = page.getByTestId('sky-canvas');
  await expect(canvas).toHaveAttribute('data-area-mode', 'aim');
  await expect(page.getByTestId('area-hint')).toContainText('Click a region to scan');
  await page.mouse.move(640, 400);
  const aim = page.getByTestId('area-aim');
  await expect(aim).toBeVisible();
  await expect(aim).toContainText(/^\d+\.\d° × \d+\.\d° · \d+ squares · about \d+ h$/);
  // Drawn to scale: SELECT_FRACTION (0.35) of the screen's height.
  const h = (await aim.boundingBox())!.height;
  expect(h).toBeGreaterThan(270);
  expect(h).toBeLessThan(290);
  // A drag still turns the sky (no zoom, still selecting).
  await page.mouse.down();
  await page.mouse.move(700, 430, { steps: 4 });
  await page.mouse.up();
  expect(await fov(page)).toBeCloseTo(20, 5);
  await expect(canvas).toHaveAttribute('data-area-mode', 'aim');
  // Zoomed in, the region is one square: a click selects it as a single area.
  await page.evaluate((v) => (globalThis as unknown as { __sxSky: SkyHook }).__sxSky.setView(v), { ...VIEW, fovDeg: 3 });
  await page.mouse.move(645, 405);
  await expect(aim).toContainText(/1 square · about \d+ min$/);
  await page.mouse.click(640, 400);
}

test('select one square, offer, compute, then the Known list opens', async ({ page }) => {
  test.setTimeout(60_000);
  let done = false;
  await open(page, '?live=mock&live_ms=4000', { stored: () => done });
  await aimAndDraw(page);
  const card = page.getByTestId('live-card');
  await expect(card).toHaveAttribute('data-state', 'offer', { timeout: 15_000 });
  await expect(page.getByTestId('live-facts')).toContainText('SPHEREx DR1');
  await expect(page.getByTestId('live-facts')).toContainText('12 Jun 2026, 11:11 and 12:49 UTC (1.6 h apart)');
  await expect(page.getByTestId('area-box')).toContainText(/^\d\.\d\d° × \d\.\d\d°$/);
  await page.getByTestId('live-compute').click();
  await expect(card).toHaveAttribute('data-state', 'running');
  await expect(page.locator('[data-testid="live-steps"] li[data-state="done"]').first()).toBeVisible();
  await expect(page.getByTestId('live-time')).toContainText('elapsed');
  // Minimise: the island's pill keeps the step.
  await page.getByTestId('live-minimise').click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Known objects · Step \d of 6/ })).toBeVisible();
  done = true;
  // The area is stored: the existing Known list opens it, unchanged.
  await expect(page.getByTestId('known-row')).toContainText('Abramenko', { timeout: 20_000 });
});

test('waiting: another area is computing; Cancel goes back to the offer', async ({ page }) => {
  await open(page, '?live=mock-queued&live_hold=0');
  await page.getByTestId('tool-known').click();
  // The keyboard way: Enter selects the region in the middle (one square when zoomed in).
  await page.evaluate((v) => (globalThis as unknown as { __sxSky: SkyHook }).__sxSky.setView(v), { ...VIEW, fovDeg: 3 });
  await page.keyboard.press('Enter');
  const card = page.getByTestId('live-card');
  await expect(card).toHaveAttribute('data-state', 'offer', { timeout: 15_000 });
  await page.getByTestId('live-compute').click();
  await expect(card).toHaveAttribute('data-state', 'queued');
  await expect(page.getByTestId('live-waiting')).toHaveText('Another area is computing. Yours starts next.');
  await expect(page.getByTestId('live-time')).toHaveText('Starts in about 4 minthen about 9 min');
  await page.getByTestId('live-stop').click();
  await expect(card).toHaveAttribute('data-state', 'offer');
});

test('failures: no visit pair, archive not reachable (Try again), offline', async ({ page }) => {
  // Three page loads: under parallel load they can pass the 30 s default.
  test.setTimeout(60_000);
  for (const [q, code, title] of [
    ['mock-no-pair', 'area:no_visit_pair', 'No two visits close in time'],
    ['mock-unreachable', 'upstream_unavailable', 'Frame archive not reachable'],
    ['mock-offline', 'offline', 'Not available offline'],
  ] as const) {
    await open(page, `?live=${q}`);
    await page.getByTestId('tool-area').click();
    await page.evaluate((v) => (globalThis as unknown as { __sxSky: SkyHook }).__sxSky.setView(v), { ...VIEW, fovDeg: 3 });
    await page.keyboard.press('Enter');
    const failed = page.getByTestId('live-failed');
    await expect(failed).toHaveAttribute('data-code', code, { timeout: 15_000 });
    await expect(failed.locator('b')).toHaveText(title);
    await expect(page.getByTestId('live-retry')).toHaveCount(code === 'upstream_unavailable' ? 1 : 0);
    await page.getByTestId('live-draw-again').click();
    await expect(page.getByTestId('sky-canvas')).toHaveAttribute('data-area-mode', 'aim');
  }
});

test('Escape leaves the tool while aiming', async ({ page }) => {
  await open(page, '?live=mock');
  await page.getByTestId('tool-known').click();
  await expect(page.getByTestId('sky-canvas')).toHaveAttribute('data-area-mode', 'aim');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tool-known')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('sky-canvas')).not.toHaveAttribute('data-area-mode', /aim|draw/);
});

// Issue #144 (Q-462; live-areas mock-up states 1 to 6) on the SYNTHETIC fixture server with the
// MOCKED live job API (`?live=mock…`, app/area/liveAreaApi.ts): aim, zoom north up to 2.2°, draw
// with the 2° clamp, the offer, computing, the hand-off to the existing Known list, waiting, the
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

/** States 1 and 2: aim, click, draw a box past 2° (held at the limit) and release. */
async function aimAndDraw(page: Page) {
  await page.getByTestId('tool-known').click();
  const canvas = page.getByTestId('sky-canvas');
  await expect(canvas).toHaveAttribute('data-area-mode', 'aim');
  await expect(page.getByTestId('area-hint')).toContainText('Click a patch to zoom in');
  await page.mouse.move(640, 400);
  const aim = page.getByTestId('area-aim');
  await expect(aim).toBeVisible();
  await expect(aim).toContainText('Next view · 3.5° × 2.2°');
  // Drawn to scale: at 20° the next view (2.2° tall) is about a tenth of the screen's height.
  const h = (await aim.boundingBox())!.height;
  expect(h).toBeGreaterThan(70);
  expect(h).toBeLessThan(100);
  // A drag still turns the sky (no zoom, still aiming).
  await page.mouse.down();
  await page.mouse.move(700, 430, { steps: 4 });
  await page.mouse.up();
  expect(await fov(page)).toBeCloseTo(20, 5);
  await expect(canvas).toHaveAttribute('data-area-mode', 'aim');
  // A click zooms north up to the patch, 2.2° tall; the pointer becomes a +.
  await page.mouse.click(640, 400);
  await expect.poll(() => fov(page), { timeout: 5_000 }).toBeCloseTo(2.2, 3);
  await expect(canvas).toHaveAttribute('data-area-mode', 'draw');
  await expect(page.getByTestId('area-hint')).toContainText('Drag to draw your area');
  // The box follows the drag and stops at 2° a side.
  await page.mouse.move(250, 180);
  await page.mouse.down();
  await page.mouse.move(800, 500, { steps: 4 });
  await page.mouse.move(1200, 640, { steps: 4 });
  await expect(page.getByTestId('area-readout')).toHaveText(/^2\.00° × \d\.\d\d° · 2° max$/);
  await page.mouse.up();
}

test('aim, zoom, draw at 2° max, offer, compute, then the Known list opens', async ({ page }) => {
  test.setTimeout(60_000);
  let done = false;
  await open(page, '?live=mock&live_ms=4000', { stored: () => done });
  await aimAndDraw(page);
  const card = page.getByTestId('live-card');
  await expect(card).toHaveAttribute('data-state', 'offer', { timeout: 15_000 });
  await expect(page.getByTestId('live-facts')).toContainText('SPHEREx DR1');
  await expect(page.getByTestId('live-facts')).toContainText('12 Jun 2026, 11:11 and 12:49 UTC (1.6 h apart)');
  await expect(page.getByTestId('area-box')).toContainText(/^2\.00° × \d\.\d\d°$/);
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
  await page.keyboard.press('Enter'); // the keyboard way: an area in the middle, at most 2° a side
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
  for (const [q, code, title] of [
    ['mock-no-pair', 'area:no_visit_pair', 'No two visits close in time'],
    ['mock-unreachable', 'upstream_unavailable', 'Frame archive not reachable'],
    ['mock-offline', 'offline', 'Not available offline'],
  ] as const) {
    await open(page, `?live=${q}`);
    await page.getByTestId('tool-area').click();
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

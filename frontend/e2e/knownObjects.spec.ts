// Issue #130 on the SYNTHETIC fixture server plus routed replies shaped like the committed Eros pack
// (area eros-2026-03): draw a square over Eros -> the Known list shows 433 Eros from `/known`, its
// positions are drawn on the sky, Track it opens the card on `/frames` (18 frames, not the demo's 16);
// a square elsewhere -> `area:not_prepared`. The routes stand in for the real backend, which these
// tests do not need; the replies follow shared/schemas/area-*.schema.json.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

interface SkyHook {
  setView(v: { ra: number; dec: number; fovDeg: number }): void;
}

const NOW = '2026-11-12T08:59:13.327Z';
const EROS_ID = 'sbdb-20000433';
const demo = JSON.parse(readFileSync('public/demo/eros/eros.json', 'utf8')) as {
  hops: { frame_id: string; mjd_avg: number; wl_um: number }[];
};
const iso = (mjd: number) => new Date((mjd - 40587) * 86400000).toISOString();
// 16 demo frames plus two the demo has no cutout for: 18, as the pack says.
const FRAME_IDS = [...demo.hops.map((h) => h.frame_id), '2026W12_2A_0158_5_D1', '2026W12_2A_0158_5_D4'];
const frameTime = (i: number) =>
  i < demo.hops.length ? iso(demo.hops[i]!.mjd_avg) : '2026-03-20T08:40:00.000Z';

const indexBody = {
  areas: [
    {
      area_id: 'eros-2026-03', ra: 91.23046, dec: 13.42786, width_deg: 1.05, height_deg: 0.63,
      data_release: 'spherex_qr2', n_frames: 18, n_visits: 2, computed_at: NOW, cached_at: NOW,
    },
  ],
  cached_at: NOW, computed_at: NOW, missing: [],
  provenance: { areas: { tag: 'derived', source: 'test', formula: 'test' } },
};
// An object the pack cannot Track offline (no object id): its row says Open, with the reason.
const OTHER = {
  designation: '2026 AB1', number: null, object_id: null, kind: 'asteroid', v_mag: 19.2,
  n_frames: 2, n_visits: 1, track_available: false,
  positions: [{ frame_id: FRAME_IDS[0], time: frameTime(0), ra: 91.0, dec: 13.3 }],
};
const knownBody = (trackAvailable: boolean, other = false) => ({
  known: [
    ...(other ? [OTHER] : []),
    {
      designation: '433 Eros', number: 433, object_id: EROS_ID, kind: 'asteroid', v_mag: 11.5,
      n_frames: 18, n_visits: 2, track_available: trackAvailable,
      positions: FRAME_IDS.map((frame_id, i) => ({
        frame_id, time: frameTime(i), ra: 90.75 + i * 0.001, dec: 13.559,
      })),
    },
  ],
  skybot: [{ visit: 1, fetched_at: '2026-11-12T08:59:01.899Z' }, { visit: 2, fetched_at: '2026-11-12T08:59:11.158Z' }],
  cached_at: NOW, computed_at: NOW, missing: [],
  provenance: {
    positions: { tag: 'model_dependent', assumption: 'test', source: 'test' },
    skybot: { tag: 'measured', source: 'test' },
  },
});
const framesBody = {
  id: EROS_ID,
  frames: FRAME_IDS.map((frame_id, i) => ({
    frame_id, time: frameTime(i), wavelength_um: 1 + i * 0.1, x: 5, y: 5,
    cutout_url: `/v1/objects/${EROS_ID}/cutouts/${frame_id}.png`, flags: [],
  })),
  north_up: true, stretch: { kind: 'asinh', params: {} }, data_release: 'spherex_qr2', cached_at: NOW, missing: [],
};

async function routes(page: Page, trackAvailable: boolean, other = false) {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/v1/areas', (r) => r.fulfill(json(indexBody)));
  await page.route('**/v1/areas/eros-2026-03/known', (r) => r.fulfill(json(knownBody(trackAvailable, other))));
  await page.route(`**/v1/objects/${EROS_ID}/frames`, (r) => r.fulfill(json(framesBody)));
  await page.route(`**/v1/objects/${EROS_ID}/path`, (r) =>
    r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found', detail: 'no path' }) }),
  );
}

async function drawAt(page: Page, view: { ra: number; dec: number; fovDeg: number }) {
  await page.goto('/');
  await expect(page.getByTestId('sky-pane')).toHaveAttribute('data-sky-state', 'ready', { timeout: 30_000 });
  await page.waitForFunction(() => '__sxSky' in globalThis);
  await page.evaluate((v) => (globalThis as unknown as { __sxSky: SkyHook }).__sxSky.setView(v), view);
  await page.getByTestId('tool-known').click();
  await page.keyboard.press('Enter');
}

test('draw over Eros: the Known list shows 433 Eros from /known, with positions on the sky', async ({ page }) => {
  await routes(page, false, true);
  await drawAt(page, { ra: 91.23, dec: 13.43, fovDeg: 3 });
  const list = page.getByTestId('known-list');
  await expect(list).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('known-row')).toHaveCount(2);
  const eros = page.getByTestId('known-row').filter({ hasText: 'Eros' });
  await expect(eros).toContainText('433');
  await expect(eros).toContainText('18 frames in 2 visits');
  // Q-455 (3): the demo object stays trackable while the pack says track_available false (#129).
  await expect(eros).toContainText('Track it');
  await expect(page.getByTestId('known-skybot')).toContainText('SkyBoT last answered');
  // An object with no Track offline: Open, with the reason.
  const other = page.getByTestId('known-row').filter({ hasText: '2026 AB1' });
  await expect(other).toContainText('Open');
  await expect(other.getByTestId('known-no-track')).toHaveText('Track not prepared for this object offline');
  await expect(page.getByTestId('demo-tag')).toHaveCount(0);
  await expect(page.getByTestId('known-position').first()).toBeAttached();
});

test('Track it opens the card on the backend frame list (18 frames) with the Demo tag on the pictures', async ({ page }) => {
  await routes(page, true);
  await drawAt(page, { ra: 91.23, dec: 13.43, fovDeg: 3 });
  await expect(page.getByTestId('known-row')).toContainText('Track it', { timeout: 15_000 });
  await page.getByTestId('known-row').click();
  await expect(page.getByTestId('eros-card')).toBeVisible();
  await expect(page.getByTestId('frame-counter')).toContainText('/ 18');
  await expect(page.getByTestId('eros-real')).toContainText('18 frames from the backend');
  await expect(page.getByTestId('demo-tag')).toHaveText('Demo cutouts');
});

test('a square elsewhere is refused with area:not_prepared', async ({ page }) => {
  await routes(page, false);
  await drawAt(page, { ra: 10, dec: 60, fovDeg: 3 });
  const refused = page.getByTestId('area-refused');
  await expect(refused).toBeVisible({ timeout: 15_000 });
  await expect(refused).toHaveAttribute('data-code', 'area:not_prepared');
  await expect(refused).toHaveText('No prepared data for this area yet.');
  await expect(page.getByTestId('known-row')).toHaveCount(0);
});

// Issue #145 (Q-466, Q-469; live-areas mock-up states 6 to 9) on the SYNTHETIC fixture server, with
// the area replies routed (shaped like shared/schemas/area-*.schema.json) and the Track job MOCKED
// (`?track=mock`, app/area/trackJobApi.ts; backend #142): the Known list marks Detected rows first,
// filters, and computes a Track on demand before the Track view opens; Discovery says the detection
// rates are not measured yet, and a track no known object explains builds a labelled placeholder.
import { expect, test, type Page } from '@playwright/test';

interface SkyHook {
  setView(v: { ra: number; dec: number; fovDeg: number }): void;
}
const NOW = '2026-11-13T07:28:00.000Z';
const AREA = 'live-0123456789ab';
const T1 = '2026-06-27T04:48:00.000Z';
const T2 = '2026-06-27T06:29:00.000Z';
const FRAMES = ['2026W26_1A_0001_1_D1', '2026W26_1A_0001_2_D1', '2026W26_2A_0002_1_D1', '2026W26_2A_0002_2_D1'];
const timeOf = (i: number) => (i < 2 ? T1 : T2);
const at = (ra: number, dec: number) => FRAMES.map((frame_id, i) => ({ frame_id, time: timeOf(i), ra: ra + i * 0.004, dec: dec + i * 0.002 }));
const prov = { tag: 'derived', source: 'test', formula: 'test' };

const known = (designation: string, number: number | null, id: string | null, v: number, ra: number, dec: number) => ({
  designation, number, object_id: id, kind: 'asteroid', v_mag: v, n_frames: 4, n_visits: 2, track_available: false, positions: at(ra, dec),
});
const KNOWN = [
  known('102490 1999 TD264', 102490, 'sbdb-102490', 21.0, 30.1, 10.1),
  known('7347 1993 EW', 7347, 'sbdb-7347', 17.9, 29.9, 9.9),
  known('9532 Abramenko', 9532, 'sbdb-9532', 17.4, 30.0, 10.0),
];
const dots = FRAMES.map((frame_id, i) => ({
  frame_id,
  dot_id: `${frame_id}:1`,
  ra: 30.0 + i * 0.004,
  dec: 10.0 + i * 0.002,
}));
const track = (id: string, verdict: string, match: unknown, ids: string[]) => ({
  track_id: id, visits: [1, 2],
  tracklets: [
    { visit: 1, dot_ids: ids.slice(0, 2), v_in_deg_day: 0.3, pa_in_deg: 64, rms_px: 0.2 },
    { visit: 2, dot_ids: ids.slice(2), v_in_deg_day: 0.3, pa_in_deg: 64, rms_px: 0.2 },
  ],
  rate_deg_day: 0.31, pa_deg: 64, u_inv_au: null, status: 'track', reason: null, verdict, match,
  linker: 'pairs', unchecked_by: [], sed: null,
});

async function routes(page: Page) {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/v1/areas', (r) =>
    r.fulfill(json({
      areas: [{ area_id: AREA, ra: 30, dec: 10, width_deg: 1, height_deg: 1, data_release: 'spherex_dr1', n_frames: 4, n_visits: 2, computed_at: NOW, cached_at: NOW }],
      cached_at: NOW, computed_at: NOW, missing: [], provenance: { areas: prov },
    })),
  );
  await page.route(`**/v1/areas/${AREA}/known`, (r) =>
    r.fulfill(json({
      known: KNOWN, skybot: [{ visit: 1, fetched_at: NOW }, { visit: 2, fetched_at: NOW }],
      cached_at: NOW, computed_at: NOW, missing: [],
      provenance: { positions: { tag: 'model_dependent', assumption: 'test', source: 'test' }, skybot: { tag: 'measured', source: 'test' } },
    })),
  );
  await page.route(`**/v1/areas/${AREA}/tracks`, (r) =>
    r.fulfill(json({
      tracks: [
        track('T1', 'found_blind', { designation: '9532 Abramenko', number: 9532, object_id: 'sbdb-9532', v_mag: 17.4, median_sep_px: 0.24, fetched_at: NOW }, dots.map((d) => d.dot_id)),
        track('T7', 'unexplained', null, dots.map((d) => d.dot_id)),
      ],
      skybot: [{ visit: 1, fetched_at: NOW }], cached_at: NOW, computed_at: NOW, missing: [],
      provenance: { tracks: prov, match: { tag: 'model_dependent', assumption: 'test', source: 'test' }, sed: prov },
    })),
  );
  await page.route(`**/v1/areas/${AREA}/dots`, (r) =>
    r.fulfill(json({
      visits: [1, 2].map((v) => ({
        visit: v,
        dots: dots.filter((_, i) => (i < 2 ? 1 : 2) === v).map((d, k) => ({
          dot_id: d.dot_id, frame_id: d.frame_id, detector: 1, exposure: k + 1, time: v === 1 ? T1 : T2, x: 5, y: 5,
          ra: d.ra, dec: d.dec, flux_uJy: 21, flux_err: 3, snr: 6, wavelength_um: 1.6, bandwidth_um: 0.04, flags: [], label: 'mover',
        })),
      })),
      cached_at: NOW, computed_at: NOW, missing: [],
      provenance: { position: prov, photometry: prov, wavelength: prov, label: prov },
    })),
  );
  await page.route(`**/v1/areas/${AREA}`, (r) =>
    r.fulfill(json({
      area_id: AREA, ra: 30, dec: 10, width_deg: 1, height_deg: 1, data_release: 'spherex_dr1', n_frames: 4, n_visits: 2,
      frames: FRAMES.map((frame_id, i) => ({
        frame_id, detector: 1, visit: i < 2 ? 1 : 2, exposure: (i % 2) + 1, time: timeOf(i),
        wavelength_min_um: 1, wavelength_max_um: 2, s_region: 'POLYGON ICRS 29.5 9.5 30.5 9.5 30.5 10.5 29.5 10.5',
      })),
      coverage: [], steps: { n_dots: 4, n_glitches: 0, n_stars: 0, n_fixed: 0, n_static_one_visit: 0, n_tracks: 2, n_possible: 0, n_found_blind: 1, n_unexplained: 1, n_unchecked: 0 },
      method: { settings: {} }, cached_at: NOW, computed_at: NOW, missing: [],
      provenance: { frames: prov, coverage: prov, steps: prov },
    })),
  );
  // The Track computed on demand is read with its window (Q-468): `/frames?around=…&days=3`.
  // Without the window the backend answers for the object's base windows, so that reads 404 here.
  await page.route('**/v1/objects/sbdb-7347/frames**', (r) => {
    const q = new URL(r.request().url()).searchParams;
    if (!q.get('around') || q.get('days') !== '3')
      return r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found', detail: 'no base frames' }) });
    return r.fulfill(json({
      id: 'sbdb-7347',
      frames: FRAMES.map((frame_id, i) => ({ frame_id, time: timeOf(i), wavelength_um: 1 + i * 0.1, x: 5, y: 5, cutout_url: `/v1/objects/sbdb-7347/cutouts/${frame_id}.png`, flags: [] })),
      north_up: true, stretch: { kind: 'asinh', params: {} }, data_release: 'spherex_dr1', cached_at: NOW, missing: [],
    }));
  });
}

async function draw(page: Page, tool: 'tool-known' | 'tool-area', query = '') {
  await routes(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/${query}`);
  await expect(page.getByTestId('sky-pane')).toHaveAttribute('data-sky-state', 'ready', { timeout: 30_000 });
  await page.waitForFunction(() => '__sxSky' in globalThis);
  await page.evaluate((v) => (globalThis as unknown as { __sxSky: SkyHook }).__sxSky.setView(v), { ra: 30, dec: 10, fovDeg: 3 });
  await page.getByTestId(tool).click();
  await page.keyboard.press('Enter');
}

test('Known: detected first, filter, provenance lines; full numbers', async ({ page }) => {
  await draw(page, 'tool-known');
  const rows = page.getByTestId('known-row');
  await expect(rows).toHaveCount(3, { timeout: 20_000 });
  await expect(rows.nth(0)).toHaveAttribute('data-object', '9532 Abramenko');
  await expect(rows.nth(0).getByTestId('known-chip')).toHaveText('Detected');
  await expect(rows.nth(0)).toContainText('0.24 px from predicted');
  await expect(rows.nth(1)).toHaveAttribute('data-object', '7347 1993 EW');
  await expect(rows.nth(2).locator('.sx-kr-num')).toHaveText('102490');
  // Held UI issue 3: the number is not cut.
  const num = rows.nth(2).locator('.sx-kr-num');
  expect(await num.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await expect(page.getByTestId('area-precomputed')).toContainText('Computed live · 13 Nov 2026 07:28 UTC · SPHEREx DR1');
  await expect(page.getByTestId('area-visits')).toHaveText('Visits 27 Jun 2026, 04:48 and 06:29 UTC · 4 frames');
  await page.getByTestId('known-filter-predicted').click();
  await expect(rows).toHaveCount(2);
  await page.getByTestId('known-filter-detected').click();
  await expect(rows).toHaveCount(1);
  // The detected object's measured dots and its label on the sky.
  await expect(page.getByTestId('known-measured').first()).toBeAttached();
  await expect(page.getByTestId('known-label')).toHaveText('9532 Abramenko');
});

test('Known: Track it computes the Track (mocked job), then the Track view opens', async ({ page }) => {
  test.setTimeout(60_000);
  await draw(page, 'tool-known', '?track=mock&track_ms=3000');
  const row = page.getByTestId('known-row').filter({ hasText: '1993 EW' });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByTestId('known-track').click();
  const job = page.getByTestId('track-job');
  await expect(job).toBeVisible();
  await expect(page.getByTestId('area-card').locator('h2')).toHaveText('7347 1993 EW');
  await expect(page.locator('[data-testid="track-steps"] li[data-state="done"]').first()).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('track-time')).toContainText('elapsed');
  await expect(page.getByTestId('eros-card')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('frame-counter')).toContainText('/ 4');
});

test('Discovery: rates caveat, Export ECSV; an unexplained track builds a placeholder', async ({ page }) => {
  test.setTimeout(60_000);
  await draw(page, 'tool-area');
  await expect(page.getByTestId('disc-rates')).toContainText('Detection rates not measured yet', { timeout: 20_000 });
  await expect(page.getByTestId('disc-export')).toHaveAttribute('href', `/v1/areas/${AREA}/export.ecsv`);
  await expect(page.getByTestId('disc-list')).not.toContainText('9532 9532');
  await page.getByTestId('disc-mover-T7').click();
  await expect(page.getByTestId('real-track-card')).toBeVisible();
  await expect(page.getByTestId('track-track')).toBeDisabled();
  await expect(page.getByTestId('track-no-orbit')).toHaveText('Orbit not known');
  await page.getByTestId('track-build').click();
  await expect(page.getByTestId('build-pane')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('build-pane')).toContainText('T7 · unexplained track');
  await expect(page.getByTestId('build-pane')).toContainText('Placeholder · size and shape not measured');
});

test('#173: ← steps back one level: track to its list (row in focus), list to your patch; a click on the patch reopens it', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await draw(page, 'tool-area');
  await expect(page.getByTestId('disc-rates')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('disc-mover-T7').click();
  await expect(page.getByTestId('real-track-card')).toBeVisible();
  await page.screenshot({ path: 'test-results/173-track-card.png' });
  const back = page.getByTestId('area-back');
  await expect(back).toHaveAccessibleName('Back to the Discovery list');
  await back.click();
  await expect(page.getByTestId('disc-card')).toBeVisible();
  await expect(page.getByTestId('disc-mover-T7')).toBeFocused();
  await page.screenshot({ path: 'test-results/173-disc-list.png' });
  await expect(page.getByTestId('area-back')).toHaveAccessibleName('Back to your patch');
  await page.getByTestId('area-back').click();
  await expect(page.getByTestId('disc-card')).toHaveCount(0);
  await page.waitForTimeout(1200);
  const pane = await page.getByTestId('sky-pane').boundingBox();
  await page.mouse.click(pane!.x + pane!.width / 2, pane!.y + pane!.height / 2);
  await expect(page.getByTestId('disc-card')).toBeVisible();
});

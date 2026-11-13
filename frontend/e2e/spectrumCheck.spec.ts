// Issue #162 (A18.7, Q-474) on the committed Eros pack (backend/assets/areas, area eros-2026-03):
// the routes serve the pack's own stored replies (summary, dots, tracks) on the SYNTHETIC fixture
// server, and the spectrum check comes from the mock behind `?spectra=mock` until #161's endpoint
// exists (the mock is the mock-up's Eros values). Without `?spectra=mock` the check is "not run".
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

interface SkyHook {
  setView(v: { ra: number; dec: number; fovDeg: number }): void;
}

const PACK = join(process.cwd(), '../backend/assets/areas/v1/derived.area/spherex_qr2');
/** The pack's stored body of one stage (each entry is a `.json` meta beside its `.body`). */
function stage(name: string): string {
  for (const dir of readdirSync(PACK))
    for (const f of readdirSync(join(PACK, dir)).filter((x) => x.endsWith('.json'))) {
      const meta = JSON.parse(readFileSync(join(PACK, dir, f), 'utf8')) as { key: { query: { stage: string; id: string } } };
      if (meta.key.query.stage === name && meta.key.query.id === 'eros-2026-03')
        return readFileSync(join(PACK, dir, f.replace(/\.json$/, '.body')), 'utf8');
    }
  throw new Error(`no ${name} stage in the pack`);
}
const summary = JSON.parse(stage('summary')) as { computed_at: string; cached_at: string; n_frames: number; data_release: string };

const indexBody = {
  areas: [
    {
      area_id: 'eros-2026-03', ra: 91.23046, dec: 13.42786, width_deg: 1.05, height_deg: 0.63,
      data_release: summary.data_release, n_frames: summary.n_frames, n_visits: 2,
      computed_at: summary.computed_at, cached_at: summary.cached_at,
    },
  ],
  cached_at: summary.cached_at, computed_at: summary.computed_at, missing: [],
  provenance: { areas: { tag: 'derived', source: 'test', formula: 'test' } },
};

async function openDiscovery(page: Page, query: string) {
  const body = (b: string) => ({ status: 200, contentType: 'application/json', body: b });
  await page.route('**/v1/areas', (r) => r.fulfill(body(JSON.stringify(indexBody))));
  await page.route('**/v1/areas/eros-2026-03', (r) => r.fulfill(body(stage('summary'))));
  await page.route('**/v1/areas/eros-2026-03/dots', (r) => r.fulfill(body(stage('dots'))));
  await page.route('**/v1/areas/eros-2026-03/tracks', (r) => r.fulfill(body(stage('tracks'))));
  // As a backend before #161: no route. The mock never asks.
  await page.route('**/v1/areas/eros-2026-03/spectra', (r) =>
    r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'spectra_not_prepared', detail: 'not run' }) }),
  );
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`/${query}`);
  await expect(page.getByTestId('sky-pane')).toHaveAttribute('data-sky-state', 'ready', { timeout: 30_000 });
  await page.waitForFunction(() => '__sxSky' in globalThis);
  await page.evaluate((v) => (globalThis as unknown as { __sxSky: SkyHook }).__sxSky.setView(v), { ra: 91.23, dec: 13.43, fovDeg: 3 });
  await page.getByTestId('tool-area').click();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('disc-rates')).toBeVisible({ timeout: 30_000 });
}

test('Discovery on the Eros pack: row verdicts, T3 chart with heat glow, the accordion', async ({ page }) => {
  test.setTimeout(90_000);
  await openDiscovery(page, '?spectra=mock');
  await expect(page.getByTestId('disc-steps')).toContainText('3 rock-like, 1 very red, 5 one colour');
  const word = (id: string) => page.getByTestId(`disc-mover-${id}`).getByTestId('spectrum-word');
  for (const id of ['T3', 'T1', 'T4']) await expect(word(id)).toHaveText('Rock-like');
  await expect(word('T8')).toHaveText('Very red');
  for (const id of ['T2', 'T5', 'T6', 'T7', 'T9']) await expect(word(id)).toHaveText('One colour');
  await expect(page.getByTestId('disc-filter-rock')).toHaveText('Rock-like 3');

  await page.getByTestId('disc-mover-T3').click();
  await expect(page.getByTestId('spectrum-verdict')).toContainText('Looks like sunlight off a rock');
  await expect(page.getByTestId('spectrum-verdict')).toContainText('Includes heat glow');
  const chart = page.getByTestId('spectrum-chart');
  await expect(chart).toHaveAttribute('role', 'img');
  await expect(chart.getByTestId('spectrum-point')).toHaveCount(14);
  const how = page.getByTestId('spectrum-how').getByRole('button', { name: 'How this is checked' });
  await how.click();
  await expect(how).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('spectrum-formula')).toBeVisible();
});

test('without ?spectra=mock the check is not run: no verdicts, listed under Not shown', async ({ page }) => {
  test.setTimeout(90_000);
  await openDiscovery(page, '');
  await expect(page.getByTestId('spectrum-word')).toHaveCount(0);
  await expect(page.getByTestId('area-missing').locator('li[data-code="spectra:not_run"]')).toHaveText('Spectrum check not run.');
});

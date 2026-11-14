// Issue #158 (live-areas mock-up states 12 and 13) on the SYNTHETIC fixture server with RECORDED
// RUNS routed in: e2e/fixtures/runs/ holds run records written by #156's backend (`<cache>/runs/
// <run_id>.json`) during real SPHEREx DR1 scans on 13 Nov 2026 (one done with 13 tracks and
// 8925 Boattini, one with a failed square, one stopped), and the merged results the backend
// answered for the finished one. The list (`GET /v1/runs`) is built from them as the backend builds
// it. Nothing here is invented: the replay plays the real events at their real times.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// Sky, replay and Escape flows on SwiftShader: allow for a loaded machine running workers in
// parallel (as scans.spec.ts does); each step still waits on its own assertion.
test.describe.configure({ timeout: 90_000 });

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/runs/${name}`, import.meta.url), 'utf8')) as Run;
interface Run {
  run_id: string;
  kind: 'discovery' | 'known';
  region: { ra: number; dec: number; width_deg: number; height_deg: number };
  state: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  totals: Record<string, number>;
  squares: { index: number; state: string }[];
  events: {
    t: number;
    type: string;
    object?: { kind: string; designation?: string; track_id?: string; square?: number };
  }[];
}
const DONE = load('run-dr1.json');
const RESULTS = JSON.parse(
  readFileSync(new URL('./fixtures/runs/run-dr1-results.json', import.meta.url), 'utf8'),
) as unknown;
const STOPPED = load('run-stopped.json');
const FAILEDSQ = load('run-failed-square.json');

/** The list row of a run, as `GET /v1/runs` builds it (#156 RunSummary). */
function summary(r: Run, now = Date.parse('2026-11-14T00:00:00Z')) {
  const start = r.started_at ? Date.parse(r.started_at) : null;
  const end = r.finished_at ? Date.parse(r.finished_at) : now;
  return {
    run_id: r.run_id,
    kind: r.kind,
    region: r.region,
    state: r.state,
    created_at: r.created_at,
    duration_s: start === null ? null : (end - start) / 1000,
    totals: r.totals,
    squares_done: r.squares.filter((s) => s.state === 'done').length,
    squares_total: r.squares.length,
  };
}
const RUNS = [DONE, FAILEDSQ, STOPPED].sort((a, b) => b.created_at.localeCompare(a.created_at));
const json = (body: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function open(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/v1/runs', (r) => r.fulfill(json({ runs: RUNS.map((x) => summary(x)) })));
  for (const r of RUNS) {
    await page.route(`**/v1/runs/${r.run_id}`, (q) => q.fulfill(json(r)));
  }
  await page.route(`**/v1/runs/${DONE.run_id}/results`, (q) => q.fulfill(json(RESULTS)));
  await page.goto('/');
  await expect(page.getByTestId('sky-pane')).toHaveAttribute('data-sky-state', 'ready', {
    timeout: 30_000,
  });
  await page.evaluate(() => localStorage.removeItem('sx-scan-run'));
}

test('the runs button lists every run, newest first, with a filter and states in words', async ({
  page,
}) => {
  await open(page);
  const button = page.getByTestId('runs-button');
  await expect(button).toHaveAccessibleName('Runs');
  // Right after the readout, the same height (mock-up state 12).
  const rb = (await button.boundingBox())!;
  const ro = (await page.getByTestId('sky-readout').boundingBox())!;
  expect(Math.abs(rb.height - ro.height)).toBeLessThanOrEqual(1);
  expect(rb.x).toBeGreaterThan(ro.x + ro.width - 1);

  await button.click();
  const menu = page.getByTestId('runs-menu');
  await expect(menu).toBeVisible();
  const rows = page.getByTestId('runs-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute('data-run', DONE.run_id);
  await expect(page.getByTestId('runs-filter-all')).toHaveText('All 3');
  await expect(page.getByTestId('runs-filter-discovery')).toHaveText('Discovery 3');
  await expect(page.getByTestId('runs-filter-known')).toHaveText('Known 0');
  // A finished run has no state word; a stopped one says when, in red; one going says where.
  await expect(rows.nth(0)).toContainText('near RA 208°, Dec −11°');
  await expect(rows.nth(0)).toContainText(/found, \d+ unexplained/);
  await expect(rows.nth(0)).not.toContainText(/Running|Stopped/);
  const stopped = page.locator(`[data-run="${STOPPED.run_id}"]`);
  await expect(stopped).toContainText('Stopped after 0 of 2 squares');
  await expect(stopped.locator('[data-tone="fail"]')).toHaveText('Stopped');
  // A finished run with a failed square still needs no state word (its ticks show it, below).
  const failed = page.locator(`[data-run="${FAILEDSQ.run_id}"]`);
  await expect(failed).not.toContainText(/Running|Stopped|Failed/);
  await expect(failed).toContainText('2 squares');

  await page.getByTestId('runs-filter-known').click();
  await expect(rows).toHaveCount(0);
  await page.getByTestId('runs-filter-all').click();
  await page.screenshot({ path: 'test-results/158-12-runs.png' });

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();
});

test('play replays a recorded run on the sky: squares, circles and ticks at their times', async ({
  page,
}) => {
  await open(page);
  await page.getByTestId('runs-button').click();
  await page.locator(`[data-run="${DONE.run_id}"]`).getByTestId('runs-play').click();
  await expect(page.getByTestId('runs-menu')).toBeHidden();
  const tag = page.getByTestId('replay-tag');
  await expect(tag).toHaveText(/^Replay · Discovery · 13 Nov \d\d:\d\d UTC$/);
  const overlay = page.getByTestId('scan-overlay');
  await expect(overlay).toHaveAttribute('data-replay', 'true');
  await expect(page.getByTestId('replay-speed-60')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('replay-play')).toBeFocused();
  await expect(page.getByTestId('runs-button')).toHaveAccessibleName('End the replay');
  await page.waitForTimeout(1300); // the flight to the run's region (about a second)

  // Pause, then drive the timeline from the keyboard: Home is the start, End is the end.
  await page.getByTestId('replay-play').click();
  const tl = page.getByTestId('replay-timeline');
  await tl.focus();
  await page.keyboard.press('Home');
  for (const s of DONE.squares)
    await expect(page.getByTestId(`scan-square-${s.index}`)).toHaveAttribute('data-state', 'todo');
  await expect(page.getByTestId('scan-object')).toHaveCount(0);
  await page.keyboard.press('End');
  for (const s of DONE.squares)
    await expect(page.getByTestId(`scan-square-${s.index}`)).toHaveAttribute('data-state', s.state);
  const shown = new Set(
    DONE.events
      .filter((e) => e.type === 'found' && e.object && e.object.kind !== 'predicted')
      .map((e) => pick(e.object!)),
  ).size;
  await expect(page.getByTestId('scan-object')).toHaveCount(shown);
  const n = DONE.squares.length;
  await expect(page.getByTestId('replay-time')).toContainText(`square ${n} of ${n}`);
  // One tick per find (not predicted) and per skipped or failed square.
  await expect(page.getByTestId('replay-tick')).not.toHaveCount(0);

  // Deterministic: the same position shows the same frame.
  await page.keyboard.press('Home');
  await page.keyboard.press('PageDown');
  const a = await page.getByTestId('replay-time').textContent();
  // The frame: square states, objects and labels (screen coordinates follow the camera).
  const frame = async () =>
    (await overlay.innerHTML()).replace(/ (points|d|x|y|cx|cy)="[^"]*"/g, '');
  const sqA = await frame();
  await page.keyboard.press('End');
  await page.keyboard.press('Home');
  await page.keyboard.press('PageDown');
  expect(await page.getByTestId('replay-time').textContent()).toBe(a);
  expect(await frame()).toBe(sqA);
  await page.screenshot({ path: 'test-results/158-13-replay.png' });

  // Escape ends it, focus back on the runs button.
  await page.keyboard.press('Escape');
  await expect(tag).toBeHidden();
  await expect(overlay).toBeHidden();
  await expect(page.getByTestId('runs-button')).toBeFocused();
});

test('Escape with the sky credit popover open over a replay closes the popover only', async ({
  page,
}) => {
  await open(page);
  await page.getByTestId('runs-button').click();
  await page.locator(`[data-run="${DONE.run_id}"]`).getByTestId('runs-play').click();
  const tag = page.getByTestId('replay-tag');
  await expect(tag).toBeVisible();
  await page.getByTestId('sky-credit-button').click();
  const box = page.getByTestId('sky-credit-box');
  await expect(box).toBeVisible();
  // One Escape: the popover closes, focus goes back to its button, the replay goes on.
  await page.keyboard.press('Escape');
  await expect(box).toBeHidden();
  await expect(page.getByTestId('sky-credit-button')).toBeFocused();
  await expect(tag).toBeVisible();
  // The next Escape ends the replay.
  await page.keyboard.press('Escape');
  await expect(tag).toBeHidden();
  await expect(page.getByTestId('runs-button')).toBeFocused();
});

test('Escape with the credit popover open over the runs list closes the list first, then the popover', async ({
  page,
}) => {
  await open(page);
  await page.getByTestId('sky-credit-button').click();
  const box = page.getByTestId('sky-credit-box');
  await expect(box).toBeVisible();
  // Open the list from the keyboard (a pointer press outside the popover would close it).
  await page.getByTestId('runs-button').focus();
  await page.keyboard.press('Enter');
  const menu = page.getByTestId('runs-menu');
  await expect(menu).toBeVisible();
  await expect(box).toBeVisible();
  // Focus in the list: the focused list closes first (A21.10), and only the list.
  await page.getByTestId('runs-filter-all').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('runs-button')).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeHidden();
  await expect(page.getByTestId('runs-button')).toBeFocused();
  await expect(box).toBeVisible();
  await expect(page.getByTestId('sky-credit-button')).toHaveAttribute('aria-expanded', 'true');
  // The next Escape closes the popover, focus back on its button.
  await page.keyboard.press('Escape');
  await expect(box).toBeHidden();
  await expect(page.getByTestId('sky-credit-button')).toBeFocused();
  await expect(page.getByTestId('runs-button')).toHaveAttribute('aria-expanded', 'false');
});

test('a failed square is a red tick on the timeline', async ({ page }) => {
  await open(page);
  await page.getByTestId('runs-button').click();
  await page.locator(`[data-run="${FAILEDSQ.run_id}"]`).getByTestId('runs-play').click();
  await expect(page.locator('[data-testid="replay-tick"][data-kind="skipped"]')).toHaveCount(1);
  await page.getByTestId('replay-timeline').focus();
  await page.keyboard.press('End');
  await expect(page.getByTestId('scan-square-1')).toHaveAttribute('data-state', 'failed');
  await expect(page.getByTestId('scan-square-2')).toHaveAttribute('data-state', 'done');
});

test('under reduced motion the replay steps in whole seconds', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await page.getByTestId('runs-button').click();
  await page.locator(`[data-run="${DONE.run_id}"]`).getByTestId('runs-play').click();
  await page.getByTestId('replay-speed-1').click();
  await page.waitForTimeout(2300);
  const text = (await page.getByTestId('replay-time').locator('b').textContent()) ?? '';
  // 1× stepped: a whole number of seconds, never a fraction shown mid-step.
  expect(text).toMatch(/^0:0[1-3]$/);
  await page.getByTestId('runs-button').click();
  await expect(page.getByTestId('replay-tag')).toBeHidden();
});

test('a row opens the run: the scan card shows its combined results', async ({ page }) => {
  await open(page);
  await page.getByTestId('runs-button').click();
  await page.locator(`[data-run="${DONE.run_id}"]`).getByTestId('runs-open').click();
  const card = page.getByTestId('scan-card');
  await expect(card).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('scan-overlay')).toBeVisible();
  await expect(page.getByTestId('scan-overlay')).not.toHaveAttribute('data-replay', 'true');
});

/** The object's identity in the overlay (designation, else square and track). */
function pick(o: { kind: string; designation?: string; track_id?: string; square?: number }) {
  return o.designation ?? `${o.square}:${o.track_id}`;
}

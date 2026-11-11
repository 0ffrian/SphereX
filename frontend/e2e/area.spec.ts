// Area search on the SYNTHETIC fixtures (A18.1 to A18.3; issue #96, P8): choose the tool, drag a
// square, snap to the prepared area, the layers, visits and blink, selecting a track, a square that
// is not prepared with Fly there, Escape, `#area=` links and reduced motion. Positions for drags
// come from the layer's own projection (`__sxAreaLayer.skyToScreen`), never hard-coded pixels.
import { expect, test, type Page } from '@playwright/test';

interface SkyHook {
  setView(v: { ra: number; dec: number; fovDeg: number }): void;
  getView(): { ra: number; dec: number; fovDeg: number };
}
interface AreaHook {
  stats(): { dots: number; tracks: number; labels: number; outline: string; visit: number };
  skyToScreen(ra: number, dec: number): { x: number; y: number; inFront: boolean } | null;
  trackDotScreen(id: string): { x: number; y: number } | null;
}
interface Win {
  __sxSky: SkyHook;
  __sxAreaLayer: AreaHook;
  requestAnimationFrame(cb: () => void): number;
}

async function skyReady(page: Page) {
  await expect(page.getByTestId('sky-pane')).toHaveAttribute('data-sky-state', 'ready', {
    timeout: 30_000,
  });
  await page.waitForFunction(() => '__sxSky' in globalThis && '__sxAreaLayer' in globalThis);
}

async function frames(page: Page) {
  await page.evaluate(
    () =>
      new Promise((r) => {
        const w = globalThis as unknown as Win;
        w.requestAnimationFrame(() => w.requestAnimationFrame(() => r(null)));
      }),
  );
}

async function setView(page: Page, v: { ra: number; dec: number; fovDeg: number }) {
  await page.evaluate((view) => (globalThis as unknown as Win).__sxSky.setView(view), v);
  await frames(page);
}

const stats = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as Win).__sxAreaLayer.stats());

/** Page coordinates of a sky position. */
async function screenOf(page: Page, ra: number, dec: number) {
  const p = await page.evaluate(
    ([r, d]) => (globalThis as unknown as Win).__sxAreaLayer.skyToScreen(r!, d!),
    [ra, dec],
  );
  const box = (await page.getByTestId('sky-canvas').boundingBox())!;
  return { x: box.x + p!.x, y: box.y + p!.y };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

/** Drags a square of `half` px round a sky position. */
async function dragAround(page: Page, ra: number, dec: number, half = 50) {
  const c = await screenOf(page, ra, dec);
  await drag(page, { x: c.x - half, y: c.y - half }, { x: c.x + half, y: c.y + half });
}

const pane = (page: Page) => page.getByTestId('sky-pane');

test.describe('Area search', () => {
  test('draw, snap, layers, visits, blink, select a track', async ({ page }) => {
    await page.goto('/');
    await skyReady(page);
    await page.getByTestId('tool-area').click();
    await expect(pane(page)).toHaveAttribute('data-pointer-mode', 'draw');
    await expect(page.getByTestId('area-card-title')).toHaveText('Area search');
    await setView(page, { ra: 150, dec: 10, fovDeg: 3 });
    await dragAround(page, 150.05, 10.0);
    await expect(page.getByTestId('area-card-title')).toHaveText('Area · 1.00° × 0.60°');
    await expect(page.getByTestId('area-precomputed')).toHaveText(/^Precomputed · run 2026-11-10/);
    await expect(pane(page)).not.toHaveAttribute('data-pointer-mode', 'draw');
    await expect.poll(async () => (await stats(page)).tracks).toBe(4);
    const s = await stats(page);
    expect(s.outline).toBe('box');
    expect(s.dots).toBeGreaterThan(100);
    expect(s.labels).toBe(4);
    // The text alternative is appended to the canvas description.
    const described = await page.getByTestId('sky-canvas').getAttribute('aria-describedby');
    expect(described!.split(' ')).toHaveLength(2);
    await expect(page.getByTestId('area-alt')).toHaveText(/4 movers, 1 found blind as/);

    // Visits.
    await page.getByTestId('area-visit-2').click();
    await expect.poll(async () => (await stats(page)).visit).toBe(2);
    // Blink on: the visit changes by itself; off: it stays.
    await page.getByTestId('area-blink').click();
    await expect(page.getByTestId('area-blink')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await stats(page)).visit, { timeout: 5000 }).toBe(1);
    await page.getByTestId('area-blink').click();
    await expect(page.getByTestId('area-blink')).toHaveAttribute('aria-pressed', 'false');

    // A click near T1 selects it and does not search the sky. The area is moved right of the card
    // first (the camera looks east of it; east is left on the sky).
    await page.getByTestId('area-visit-1').click();
    await setView(page, { ra: 151.5, dec: 10, fovDeg: 3 });
    const t1 = await page.evaluate(() =>
      (globalThis as unknown as Win).__sxAreaLayer.trackDotScreen('T1'),
    );
    const box = (await page.getByTestId('sky-canvas').boundingBox())!;
    await page.mouse.click(box.x + t1!.x + 5, box.y + t1!.y + 5);
    await expect(page.getByTestId('area-selected')).toHaveText('Selected: T1');
    await expect(page.getByTestId('area-card')).toBeVisible();

    // Measured only hides tracks and labels and shows the note.
    await page.getByTestId('area-honesty-measured').click();
    await expect(page.getByTestId('area-measured-note')).toBeVisible();
    await expect.poll(async () => (await stats(page)).tracks).toBe(0);
    expect((await stats(page)).labels).toBe(0);
    await page.getByTestId('area-honesty-derived').click();
  });

  test('not prepared, Fly there, draw again; a drag over a marker draws', async ({ page }) => {
    await page.goto('/');
    await skyReady(page);
    await page.getByTestId('tool-area').click();
    // Start the drag on a target marker: in draw mode it draws (the marker lets it through).
    const marker = page.locator('[data-testid="sky-marker"][data-target-id="barnards-star"]');
    const res = await page.request.get(`/v1/resolve?q=${encodeURIComponent("Barnard's Star")}`);
    const target = (await res.json()) as { ra: number; dec: number };
    await setView(page, { ra: target.ra, dec: target.dec, fovDeg: 10 });
    await expect(marker).toBeVisible({ timeout: 15_000 });
    const mb = (await marker.boundingBox())!;
    const from = { x: mb.x + mb.width / 2, y: mb.y + mb.height / 2 };
    // Too small first (the card says why), then a real square from the marker.
    await drag(page, { x: from.x + 200, y: from.y }, { x: from.x + 210, y: from.y + 10 });
    await expect(page.getByTestId('area-refusal')).toHaveText('Drag a bigger square');
    await drag(page, from, { x: from.x + 80, y: from.y + 80 });
    await expect(page.getByTestId('area-not-prepared')).toBeVisible();
    await expect(page.getByTestId('area-card')).toBeVisible();
    // Fly there.
    await page.locator('[data-testid="area-fly-there"][data-area-id="fixture:area-main"]').click();
    await expect
      .poll(async () => {
        const v = await page.evaluate(() => (globalThis as unknown as Win).__sxSky.getView());
        return Math.abs(v.ra - 150) < 2 && Math.abs(v.dec - 10) < 2;
      })
      .toBe(true);
    await frames(page);
    await dragAround(page, 150.0, 10.0, 40);
    await expect(page.getByTestId('area-card-title')).toHaveText('Area · 1.00° × 0.60°');
    // Draw again, then Escape leaves drawing and keeps the area.
    await page.getByTestId('area-draw-again').click();
    await expect(pane(page)).toHaveAttribute('data-pointer-mode', 'draw');
    await page.keyboard.press('Escape');
    await expect(pane(page)).not.toHaveAttribute('data-pointer-mode', 'draw');
    expect((await stats(page)).outline).toBe('box');
    await expect(page.getByTestId('area-card')).toBeVisible();
  });

  test('#area= link: four visits blink in order; an unknown area is a link problem', async ({
    page,
  }) => {
    await page.goto('/#area=fixture%3Aarea-multivisit');
    await skyReady(page);
    await expect(page.getByTestId('area-card-title')).toHaveText('Area · 0.60° × 0.60°');
    await expect(page.locator('[data-testid="area-visits"] [role="radio"]')).toHaveCount(4);
    await page.getByTestId('area-blink').click();
    const seen = new Set<number>();
    await expect
      .poll(
        async () => {
          seen.add((await stats(page)).visit);
          return seen.size;
        },
        { timeout: 8000, intervals: [200] },
      )
      .toBe(4);
    // Leaving the tool stops the blink and keeps the area for later.
    await page.getByTestId('tool-sky').click();
    await page.getByTestId('tool-area').click();
    await expect(page.getByTestId('area-blink')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('area-card-title')).toHaveText('Area · 0.60° × 0.60°');

    await page.goto('/#area=nope');
    await expect(page.getByTestId('link-problem')).toHaveText(/Link area “nope” is not prepared/);
  });
});

test.describe('Area search under reduced motion', () => {
  test('Fly there is instant and the blink steps', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await skyReady(page);
    await page.getByTestId('tool-area').click();
    await setView(page, { ra: 30, dec: 0, fovDeg: 3 });
    await dragAround(page, 30, 0);
    await page.locator('[data-testid="area-fly-there"][data-area-id="fixture:area-main"]').click();
    const v = await page.evaluate(() => (globalThis as unknown as Win).__sxSky.getView());
    expect(Math.abs(v.ra - 150)).toBeLessThan(2);
    await frames(page);
    await dragAround(page, 150, 10, 40);
    await expect(page.getByTestId('area-blink')).toHaveCount(0);
    const next = page.getByTestId('area-next-visit');
    await next.click();
    await expect.poll(async () => (await stats(page)).visit).toBe(2);
    await next.click();
    await expect.poll(async () => (await stats(page)).visit).toBe(1);
  });
});

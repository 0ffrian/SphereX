// Sky view (shell prototype) on the SYNTHETIC fixture sky: the picture's orientation read back from
// the screen (north up, east LEFT), click-to-pick running the search, drag not picking, markers,
// keyboard, the "/" shortcut, refusal states, phone width with touch, and a frame-time measurement.
// Headless Chromium runs three's WebGL2 fallback (SwiftShader).
import { expect, test, type Page } from '@playwright/test';
import { fixtureGreenForDec, fixtureRedForRa } from '../fixtures/sky';

/** Browser globals used inside page.evaluate (this file is type-checked without the DOM lib). */
interface Browser {
  requestAnimationFrame(cb: (t: number) => void): number;
  performance: { now(): number };
  createImageBitmap(b: unknown): Promise<{ width: number; height: number }>;
  OffscreenCanvas: new (
    w: number,
    h: number,
  ) => {
    getContext(k: '2d'): {
      drawImage(i: unknown, x: number, y: number): void;
      getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
    } | null;
  };
  document: { documentElement: { scrollWidth: number } };
}

interface SkyHook {
  setView(v: { ra: number; dec: number; fovDeg: number }): void;
  getView(): { ra: number; dec: number; fovDeg: number };
  stats: { renders: number; renderMs: number };
}

async function skyReady(page: Page) {
  await expect(page.getByTestId('sky-pane')).toHaveAttribute('data-sky-state', 'ready', {
    timeout: 30_000,
  });
  await page.waitForFunction(() => '__sxSky' in globalThis);
}

async function setView(page: Page, v: { ra: number; dec: number; fovDeg: number }) {
  await page.evaluate((view) => {
    (globalThis as unknown as { __sxSky: SkyHook }).__sxSky.setView(view);
  }, v);
  // Two frames: the render, then the marker and readout updates.
  await page.evaluate(
    () =>
      new Promise((r) => {
        const w = globalThis as unknown as Browser;
        w.requestAnimationFrame(() => w.requestAnimationFrame(() => r(null)));
      }),
  );
}

/** RGB of screen pixels, from a page screenshot decoded in the browser. */
async function pixels(page: Page, points: [number, number][]): Promise<number[][]> {
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(
    async ({ b64, pts }) => {
      const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
      const w = globalThis as unknown as Browser;
      const bmp = await w.createImageBitmap(blob);
      const c = new w.OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      return pts.map(([x, y]) => {
        // Median of a 5×5 box, so a stray pixel does not decide.
        const d = ctx.getImageData(Math.round(x) - 2, Math.round(y) - 2, 5, 5).data;
        const ch = (k: number) => {
          const v: number[] = [];
          for (let i = k; i < d.length; i += 4) v.push(d[i]!);
          v.sort((a, b) => a - b);
          return v[12]!;
        };
        return [ch(0), ch(1), ch(2)];
      });
    },
    { b64: png, pts: points },
  );
}

async function canvasBox(page: Page) {
  const box = await page.getByTestId('sky-canvas').boundingBox();
  if (!box) throw new Error('no sky canvas');
  return box;
}

test('the shell and search render, then the sky image loads (smallest first, then larger)', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  // Hold the larger image so the first state can be seen.
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/equirect_1024.png', async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByTestId('search-input')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Tools' })).toBeVisible();
  await skyReady(page);
  const canvas = page.getByTestId('sky-canvas');
  await expect(canvas).toHaveAttribute('data-sky-width', '512');
  release();
  await expect(canvas).toHaveAttribute('data-sky-width', '1024');
  // Provenance and credit of the picture (D-02): Estimated with the formula, plus the credit.
  const credit = page.getByTestId('sky-credit');
  await expect(credit).toContainText('Synthetic test sky (fixture)');
  await expect(credit.getByTestId('badge-estimated')).toHaveText(/^Estimated/);
  await expect(credit.getByTestId('badge-estimated-formula')).toContainText('red = 16 + 120');
  await expect(credit).toContainText('SYNTHETIC');
  await expect(page.getByTestId('fixture-banner')).toBeVisible();
  await expect(canvas).toHaveAttribute('aria-label', /All-sky image: Synthetic test sky/);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('orientation from inside: north up, east (higher RA) to the LEFT', async ({ page }) => {
  await page.goto('/');
  await skyReady(page);
  await expect(page.getByTestId('sky-canvas')).toHaveAttribute('data-sky-width', '1024');
  const ra = 105;
  const dec = 15;
  await setView(page, { ra, dec, fovDeg: 30 });
  const b = await canvasBox(page);
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const d = 120;
  const [centre, left, right, up, down] = await pixels(page, [
    [cx, cy],
    [cx - d, cy],
    [cx + d, cy],
    [cx, cy - d],
    [cx, cy + d],
  ]);
  // The synthetic sky's red channel grows with RA and its green channel with Dec.
  expect(left![0]!, 'left of centre has a higher RA (east left)').toBeGreaterThan(right![0]! + 2);
  expect(up![1]!, 'above the centre has a higher Dec (north up)').toBeGreaterThan(down![1]! + 2);
  // And the centre is the RA/Dec the camera looks at (±4 levels ≈ ±12° RA, ±6° Dec).
  expect(Math.abs(centre![0]! - fixtureRedForRa(ra))).toBeLessThanOrEqual(4);
  expect(Math.abs(centre![1]! - fixtureGreenForDec(dec))).toBeLessThanOrEqual(4);
  // The readout says the same.
  await expect(page.getByTestId('readout-ra')).toHaveText('105.0000°');
  await expect(page.getByTestId('readout-dec')).toHaveText('+15.0000°');
});

test('a click picks the position and runs the search; a drag does not', async ({ page }) => {
  await page.goto('/');
  await skyReady(page);
  await setView(page, { ra: 200, dec: -10, fovDeg: 40 });
  const b = await canvasBox(page);
  const input = page.getByTestId('search-input');

  // Drag: the view moves, nothing is searched.
  const before = await page.evaluate(
    () => (globalThis as unknown as { __sxSky: SkyHook }).__sxSky.getView().ra,
  );
  await page.mouse.move(b.x + 300, b.y + 300);
  await page.mouse.down();
  await page.mouse.move(b.x + 360, b.y + 320, { steps: 6 });
  await page.mouse.up();
  const after = await page.evaluate(
    () => (globalThis as unknown as { __sxSky: SkyHook }).__sxSky.getView().ra,
  );
  expect(after).toBeGreaterThan(before); // dragging right brings the east side in
  await expect(input).toHaveValue('');
  await expect(page.getByTestId('object-panel')).toHaveCount(0);

  // Hover shows the position under the pointer.
  await page.mouse.move(b.x + 250, b.y + 200);
  await expect(page.getByTestId('sky-readout')).toContainText('pointer');

  // Click: coordinates with 6 decimals go into the search, and the search runs.
  await page.mouse.click(b.x + 250, b.y + 200);
  await expect(input).toHaveValue(/^\d{1,3}\.\d{6},-?\d{1,2}\.\d{6}$/);
  const q = await input.inputValue();
  await expect(page.getByTestId('object-panel')).toBeVisible();
  // The fixture server knows only its targets, so this position is a clean "not found".
  await expect(page.getByRole('alert')).toContainText(`No object found for “${q}”`);
  // Picked coordinates are user input, tagged `derived` (Q-25).
  const picked = page.getByTestId('sky-picked-text');
  await expect(picked.getByTestId('badge-estimated')).toBeVisible();
  await expect(page.getByTestId('sky-picked')).toBeAttached();
});

test('clicking the centre on a known target opens its flipbook; a newer click wins', async ({
  page,
}) => {
  // Name lookups (the target markers) are refused here, so no marker sits on the centre; the
  // first coordinate pick is held back, so the second pick must win.
  let first = true;
  await page.route('**/v1/resolve**', async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    if (/[a-z]/i.test(q)) return route.abort();
    if (first) {
      first = false;
      await new Promise((r) => setTimeout(r, 1500));
    }
    await route.fallback().catch(() => undefined); // the page may have aborted it meanwhile
  });
  await page.goto('/');
  await skyReady(page);
  // RW Aurigae in the fixtures (from SIMBAD): RA 76.95653, Dec +30.40144. At 2° one pixel is
  // about 13″, well inside the fixture's 1′ match radius.
  await setView(page, { ra: 76.95653, dec: 30.40144, fovDeg: 2 });
  const b = await canvasBox(page);
  await page.mouse.click(b.x + 40, b.y + 40);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.getByTestId('object-name')).toHaveText('RA 76.95653°, Dec +30.40144°');
  await expect(page.getByTestId('frame-counter')).toHaveText('Frame 1 of 24');
  await page.waitForTimeout(1700);
  await expect(page.getByTestId('object-name')).toHaveText('RA 76.95653°, Dec +30.40144°');
  await expect(page.getByRole('alert')).toHaveCount(0);
  // The transport bar drives the flipbook.
  await page.getByRole('button', { name: 'Next frame' }).click();
  await expect(page.getByTestId('frame-counter')).toHaveText('Frame 2 of 24');
});

test('target markers come from /v1/resolve and open the object', async ({ page }) => {
  await page.goto('/');
  await skyReady(page);
  await setView(page, { ra: 76.95653, dec: 30.40144, fovDeg: 30 });
  const marker = page.getByRole('button', { name: 'RW Aurigae on the sky: open it' });
  await expect(marker).toBeVisible({ timeout: 15_000 });
  // The marker sits on the target: at the view centre.
  const b = await canvasBox(page);
  const m = await marker.boundingBox();
  expect(Math.abs(m!.x + 22 - (b.x + b.width / 2))).toBeLessThan(2);
  expect(Math.abs(m!.y + 22 - (b.y + b.height / 2))).toBeLessThan(2);
  await marker.click();
  await expect(page.getByTestId('object-name')).toHaveText('RW Aurigae');
  await expect(page.getByTestId('search-input')).toHaveValue('RW Aurigae');
  await expect(page.getByTestId('sky-selected')).toBeAttached();
});

test('keyboard: arrows pan, +/− zoom, Enter picks the centre; "/" focuses the search', async ({
  page,
}) => {
  await page.goto('/');
  await skyReady(page);
  await setView(page, { ra: 100, dec: 0, fovDeg: 40 });
  const canvas = page.getByTestId('sky-canvas');
  await canvas.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('readout-ra')).toHaveText('104.0000°'); // left looks east
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('readout-dec')).toHaveText('+4.0000°');
  await page.keyboard.press('+');
  await expect(page.getByTestId('sky-readout')).toContainText('FOV 32°');
  await page.keyboard.press('-');
  await expect(page.getByTestId('sky-readout')).toContainText('FOV 40°');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('search-input')).toHaveValue('104.000000,4.000000');

  // "/" from a button focuses the search; typed into the field it is just a character.
  await page.getByTestId('tool-flipbook').focus();
  await page.keyboard.press('/');
  await expect(page.getByTestId('search-input')).toBeFocused();
  await page.keyboard.type('a/b');
  await expect(page.getByTestId('search-input')).toHaveValue('a/b');
});

test('tool rail opens real panels; Escape closes and returns focus', async ({ page }) => {
  await page.goto('/');
  const tools = page.getByRole('navigation', { name: 'Tools' });
  await expect(tools.getByRole('button')).toHaveCount(4);
  await expect(tools.getByRole('button', { name: 'Sky' })).toHaveAttribute('aria-pressed', 'true');
  await tools.getByRole('button', { name: 'Flipbook' }).click();
  await expect(page.getByTestId('panel-empty')).toBeVisible();
  await page.getByRole('button', { name: 'Close Flipbook' }).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('object-panel')).toHaveCount(0);
  await expect(tools.getByRole('button', { name: 'Flipbook' })).toBeFocused();
  await tools.getByRole('button', { name: '3D viewer' }).click();
  await expect(page.getByRole('region', { name: '3D view', exact: true })).toBeVisible();
});

test('no sky image installed: says so, shows a grid, and picking still works', async ({ page }) => {
  await page.route('**/v1/sky/index.json', (route) => route.fulfill({ json: { surveys: [] } }));
  await page.goto('/');
  await expect(page.getByTestId('sky-pane')).toHaveAttribute('data-sky-state', 'none');
  await expect(page.getByTestId('sky-status')).toContainText('No sky image is installed');
  const b = await canvasBox(page);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.getByTestId('search-input')).toHaveValue(/^\d+\.\d{6},/);
});

test('a broken sky index or image is refused, never blank, and search still works', async ({
  page,
}) => {
  await page.route('**/v1/sky/*/equirect_*.png', (route) => route.fulfill({ status: 500 }));
  await page.goto('/');
  await expect(page.getByTestId('sky-pane')).toHaveAttribute('data-sky-state', 'error');
  await expect(page.getByTestId('sky-status')).toContainText('could not be loaded');
  await page.getByTestId('search-input').fill('RW Aur');
  await page.getByTestId('search-input').press('Enter');
  await expect(page.getByTestId('frame-counter')).toHaveText('Frame 1 of 24');
});

test.describe('phone width (400 × 860, touch)', () => {
  test.use({ viewport: { width: 400, height: 860 }, hasTouch: true, isMobile: true });

  test('no horizontal overflow; touch drag pans, pinch zooms, tap picks; panel is a bottom sheet', async ({
    page,
  }) => {
    await page.goto('/');
    await skyReady(page);
    expect(
      await page.evaluate(
        () => (globalThis as unknown as Browser).document.documentElement.scrollWidth,
      ),
    ).toBeLessThanOrEqual(400);
    // Phones stay at the smaller image list's cap (4096); the fixture's 1024 is under it.
    const b = await canvasBox(page);
    const cdp = await page.context().newCDPSession(page);
    const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', pts: [number, number][]) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: pts.map(([x, y], id) => ({ x, y, id })),
      });
    const view = () =>
      page.evaluate(() => (globalThis as unknown as { __sxSky: SkyHook }).__sxSky.getView());
    await setView(page, { ra: 150, dec: 0, fovDeg: 40 });
    const x0 = b.x + b.width / 2;
    const y0 = b.y + b.height / 2;
    // One-finger drag down: the north side comes in.
    await touch('touchStart', [[x0, y0]]);
    for (let k = 1; k <= 10; k++) await touch('touchMove', [[x0, y0 + k * 12]]);
    await touch('touchEnd', []);
    const dragged = await view();
    expect(dragged.dec).toBeGreaterThan(5);
    await expect(page.getByTestId('object-panel')).toHaveCount(0); // a drag is not a pick
    // Two-finger pinch out: zoom in.
    await touch('touchStart', [
      [x0 - 30, y0],
      [x0 + 30, y0],
    ]);
    for (let k = 1; k <= 5; k++) {
      await touch('touchMove', [
        [x0 - 30 - k * 10, y0],
        [x0 + 30 + k * 10, y0],
      ]);
    }
    await touch('touchEnd', []);
    expect((await view()).fovDeg).toBeLessThan(dragged.fovDeg * 0.7);
    // A tap picks.
    await page.touchscreen.tap(x0, y0);
    await expect(page.getByTestId('search-input')).toHaveValue(/^\d+\.\d{6},/);
    const panel = page.getByTestId('object-panel');
    await expect(panel).toBeVisible();
    const p = await panel.boundingBox();
    const v = await page.locator('.sx-view').boundingBox();
    // Docked at the bottom, on top of the credit strip (D-35), which it never covers.
    const c = await page.getByTestId('sky-credit-box').boundingBox();
    expect(Math.abs(c!.y + c!.height - (v!.y + v!.height))).toBeLessThan(2);
    expect(Math.abs(p!.y + p!.height - c!.y)).toBeLessThan(2);
    expect(p!.width).toBeGreaterThan(v!.width - 2);
    expect(
      await page.evaluate(
        () => (globalThis as unknown as Browser).document.documentElement.scrollWidth,
      ),
    ).toBeLessThanOrEqual(400);
  });
});

test('performance: drag and zoom for 3 s; report frame times', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await skyReady(page);
  await expect(page.getByTestId('sky-canvas')).toHaveAttribute('data-sky-width', '1024');
  const b = await canvasBox(page);
  const stats0 = await page.evaluate(() => ({
    ...(globalThis as unknown as { __sxSky: SkyHook }).__sxSky.stats,
  }));
  // Record rAF intervals while the drag and wheel run.
  await page.evaluate(() => {
    const g = globalThis as unknown as Browser & { __sxFrames: number[]; __sxStop: boolean };
    g.__sxFrames = [];
    g.__sxStop = false;
    let last = g.performance.now();
    const tick = (t: number) => {
      g.__sxFrames.push(t - last);
      last = t;
      if (!g.__sxStop) g.requestAnimationFrame(tick);
    };
    g.requestAnimationFrame(tick);
  });
  const t0 = Date.now();
  let k = 0;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  while (Date.now() - t0 < 1500) {
    k++;
    await page.mouse.move(
      b.x + b.width / 2 + 200 * Math.sin(k / 8),
      b.y + b.height / 2 + 80 * Math.cos(k / 11),
    );
  }
  await page.mouse.up();
  while (Date.now() - t0 < 3000) {
    k++;
    await page.mouse.wheel(0, k % 40 < 20 ? -60 : 60);
  }
  const result = await page.evaluate(() => {
    const g = globalThis as unknown as {
      __sxFrames: number[];
      __sxStop: boolean;
      __sxSky: SkyHook;
    };
    g.__sxStop = true;
    return { frames: g.__sxFrames.slice(1), stats: { ...g.__sxSky.stats } };
  });
  const f = result.frames.slice().sort((a, b2) => a - b2);
  const mean = f.reduce((s, x) => s + x, 0) / f.length;
  const p95 = f[Math.floor(f.length * 0.95)]!;
  const renders = result.stats.renders - stats0.renders;
  const cpuMs = (result.stats.renderMs - stats0.renderMs) / Math.max(1, renders);
  const report = {
    inputEvents: k,
    rafFrames: f.length,
    meanFrameMs: Number(mean.toFixed(2)),
    p95FrameMs: Number(p95.toFixed(2)),
    fps: Number((1000 / mean).toFixed(1)),
    renders,
    meanRenderCpuMs: Number(cpuMs.toFixed(2)),
  };
  console.log(`sky performance (headless, WebGL2 on SwiftShader): ${JSON.stringify(report)}`);
  test.info().annotations.push({ type: 'sky-performance', description: JSON.stringify(report) });
  expect(renders).toBeGreaterThan(10);
  // Render on demand: at most one render per animation frame (plus resizes).
  expect(renders).toBeLessThanOrEqual(f.length + 2);
});

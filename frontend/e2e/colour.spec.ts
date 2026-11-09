// Flipbook colour views on the SYNTHETIC fixtures: Raw → Colour / Wavelength tint (the pixels on
// screen are coloured and playback still advances) → SPHEREx composite (picture, 3-band legend,
// transport locked) → back to Raw (grey again, playback restored); a refused composite in plain
// words; the `colour=` link parameter; phone width. SX_SHOT_DIR=<dir> keeps screenshots.
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';

/** Browser globals used inside page.evaluate (this file is type-checked without the DOM lib). */
interface Browser {
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
  document: { documentElement: { scrollWidth: number; clientWidth: number } };
}

interface ScrollEl {
  closest(sel: string): ScrollEl | null;
  getBoundingClientRect(): { top: number };
  scrollTop: number;
}

/** Hides the ring and the composite marker, which are coloured on purpose. */
const HIDE_MARKERS =
  '[data-testid="object-ring"], [data-testid="composite-marker"] { visibility: hidden !important; }';

/**
 * Largest channel spread max(R, G, B) − min(R, G, B) over the top half of an element's screenshot
 * (the SYNTHETIC label sits bottom right), inset by 3 px from the border. 0 for pure grey.
 */
async function colourSpread(page: Page, el: Locator): Promise<number> {
  const png = (await el.screenshot()).toString('base64');
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const w = globalThis as unknown as Browser;
    const bmp = await w.createImageBitmap(blob);
    const c = new w.OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(3, 3, bmp.width - 6, Math.floor(bmp.height / 2) - 3).data;
    let best = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i]!;
      const g = d[i + 1]!;
      const b = d[i + 2]!;
      best = Math.max(best, Math.max(r, g, b) - Math.min(r, g, b));
    }
    return best;
  }, png);
}

/** Saves a screenshot under SX_SHOT_DIR; `top` is scrolled to the top of its panel first. */
async function shot(page: Page, el: Locator | null, name: string, top?: Locator) {
  const dir = process.env.SX_SHOT_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  // Scroll only the panel body (scrollIntoView would also scroll the page's fixed layout).
  await top?.evaluate((e: ScrollEl) => {
    const body = e.closest('.sx-panel-body');
    if (body) {
      body.scrollTop += e.getBoundingClientRect().top - body.getBoundingClientRect().top - 8;
    }
  });
  const png = el ? await el.screenshot() : await page.screenshot();
  writeFileSync(`${dir}/${name}.png`, png);
}

async function search(page: Page, text: string) {
  const input = page.getByTestId('search-input');
  await input.fill(text);
  await input.press('Enter');
}

async function cutoutLoaded(page: Page) {
  const img = page.getByTestId('cutout');
  await expect
    .poll(() => img.evaluate((el: { naturalWidth: number }) => el.naturalWidth))
    .toBeGreaterThan(0);
}

test('Raw → Wavelength tint → SPHEREx composite → Raw', async ({ page }) => {
  test.setTimeout(90_000); // a long walk through four views; 30 s is tight under load
  // Tall enough that the panel shows the controls, the picture and its legend together.
  await page.setViewportSize({ width: 1280, height: 1200 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await search(page, 'Epsilon Indi B');
  const counter = page.getByTestId('frame-counter');
  await expect(counter).toHaveText('Frame 1 of 24');
  await cutoutLoaded(page);
  // The panel is see-through until the island has arrived; the picture is measured after that.
  await expect(page.getByTestId('island')).toHaveAttribute('data-arrived', '');
  await page.addStyleTag({ content: HIDE_MARKERS });
  const viewer = page.getByTestId('frame-viewer');
  const panel = page.getByTestId('object-panel');

  // Raw: grey pixels, Raw checked, no colour sub-choice.
  const switcher = page.getByRole('radiogroup', { name: 'Picture' });
  await expect(switcher.getByRole('radio', { name: 'Raw' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('radiogroup', { name: 'Colour view' })).toHaveCount(0);
  expect(await colourSpread(page, viewer)).toBeLessThanOrEqual(2);
  await shot(page, panel, 'desktop-raw', page.getByTestId('colour-controls'));

  // Colour → Wavelength tint (the default view): the same pixels, multiplied by a colour.
  await switcher.getByRole('radio', { name: 'Colour' }).click();
  const views = page.getByRole('radiogroup', { name: 'Colour view' });
  await expect(views.getByRole('radio', { name: 'Wavelength tint' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByTestId('tint-overlay')).toBeVisible();
  await expect.poll(() => colourSpread(page, viewer), { timeout: 20_000 }).toBeGreaterThan(40);
  await expect(page.getByTestId('tint-legend')).toContainText('Estimated');
  await expect(page.getByTestId('tint-legend-current')).toHaveText(/^This frame: \d\.\d{3} µm$/);
  await expect(page.getByTestId('cutout')).toHaveCSS('image-rendering', 'pixelated');
  expect(new URL(page.url()).hash).toContain('colour=tint');
  await shot(page, panel, 'desktop-tint', page.getByTestId('colour-controls'));

  // Playback still advances, and the tint follows each frame's wavelength.
  const overlay = page.getByTestId('tint-overlay');
  const firstWl = await overlay.getAttribute('data-wavelength');
  const play = page.getByTestId('play-pause');
  await expect(play).toBeEnabled();
  await play.click();
  await expect(counter).not.toHaveText('Frame 1 of 24', { timeout: 10_000 });
  await play.click();
  await expect(play).toHaveText('Play');
  await expect(overlay).not.toHaveAttribute('data-wavelength', firstWl ?? '');

  // SPHEREx composite: one picture with its legend; the transport bar does not drive it.
  await views.getByRole('radio', { name: 'SPHEREx composite' }).click();
  const image = page.getByTestId('composite-image');
  await expect(image).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => image.evaluate((el: { naturalWidth: number }) => el.naturalWidth))
    .toBe(64);
  await expect(image).toHaveCSS('image-rendering', 'pixelated');
  await expect(page.getByTestId('composite-band')).toHaveCount(3);
  await expect(page.getByTestId('composite-bands')).toContainText('Blue:');
  await expect(page.getByTestId('composite-bands')).toContainText('Red:');
  await expect(page.getByTestId('composite-orientation')).toContainText('North up, east left');
  await expect(page.getByTestId('composite-marker')).toHaveCount(1);
  await expect(page.getByTestId('frame-viewer')).toHaveCount(0);
  await expect(play).toBeDisabled();
  await expect(page.getByTestId('transport-locked')).toHaveText(
    'A composite is one picture; switch to Raw or Wavelength tint to play frames.',
  );
  await expect(page.getByTestId('scrubber')).toHaveCount(0);
  // Each poll is a screenshot, which is slow on a software renderer with a full-size sky behind.
  await expect
    .poll(() => colourSpread(page, page.getByTestId('composite-viewer')), { timeout: 20_000 })
    .toBeGreaterThan(40);
  expect(new URL(page.url()).hash).toContain('colour=composite');
  await shot(page, panel, 'desktop-composite', page.getByTestId('colour-controls'));
  await shot(page, null, 'desktop-composite-page');

  // Back to Raw: grey again, the transport restored.
  await switcher.getByRole('radio', { name: 'Raw' }).click();
  await cutoutLoaded(page);
  await expect(page.getByTestId('tint-overlay')).toHaveCount(0);
  await expect
    .poll(() => colourSpread(page, page.getByTestId('frame-viewer')))
    .toBeLessThanOrEqual(2);
  await expect(page.getByTestId('scrubber')).toBeVisible();
  await expect(play).toBeEnabled();
  expect(new URL(page.url()).hash).not.toContain('colour=');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a refused composite says why in plain words', async ({ page }) => {
  await page.goto('/');
  await search(page, 'R Dra');
  await expect(page.getByTestId('frame-counter')).toHaveText('Frame 1 of 24');
  await page.getByRole('radio', { name: 'Colour' }).click();
  await page.getByRole('radio', { name: 'SPHEREx composite' }).click();
  const box = page.getByTestId('composite-refused');
  await expect(box).toContainText('There is no SPHEREx colour composite for this object.');
  await expect(box).toContainText(
    'There are not enough usable frames near the three colour wavelengths to make a composite.',
  );
  await expect(box).not.toContainText('Not available:');
  await expect(page.getByTestId('composite-image')).toHaveCount(0);
  await expect(page.getByTestId('play-pause')).toBeDisabled();
});

test('a link with colour=composite opens the composite; one without it stays raw', async ({
  page,
}) => {
  await page.goto('/#name=Epsilon%20Indi%20B&colour=composite');
  // A cold load: resolve, frames, then the composite (slow with 4 workers on SwiftShader).
  await expect(page.getByTestId('composite-image')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('radio', { name: 'SPHEREx composite' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.goto('/#name=RW%20Aur');
  await page.reload();
  await expect(page.getByTestId('frame-counter')).toHaveText('Frame 1 of 24');
  await expect(page.getByRole('radio', { name: 'Raw' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('composite')).toHaveCount(0);
});

test.describe('phone width', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the composite fits, with 44 px touch targets', async ({ page }) => {
    await page.goto('/#name=Epsilon%20Indi%20B&colour=composite');
    const image = page.getByTestId('composite-image');
    await expect(image).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => image.evaluate((el: { naturalWidth: number }) => el.naturalWidth))
      .toBe(64);
    for (const name of ['Raw', 'Colour', 'Wavelength tint', 'SPHEREx composite']) {
      const box = await page.getByRole('radio', { name }).boundingBox();
      expect(box!.height, name).toBeGreaterThanOrEqual(44);
    }
    const overflow = await page.evaluate(() => {
      const d = (globalThis as unknown as Browser).document.documentElement;
      return d.scrollWidth - d.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.getByTestId('transport-locked')).toBeVisible();
    await shot(page, null, 'phone-390-composite', page.getByTestId('composite-viewer'));
  });
});

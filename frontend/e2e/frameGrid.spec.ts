// The flipbook draws every frame of an object on one fixed grid (app/flipbook/frameGrid.ts), so
// the picture box, the object ring and the lines below never move between frames of different
// sizes. Barnard's Star in the SYNTHETIC fixtures cycles 64×64, 63×64, 64×63, 63×63 px cutouts
// and frame 2 is clipped at a detector edge (64×40, object near the top): the grid area outside it
// is hatched as "no data". One steady line says how many frames are hatched; the per-frame caption (gone with the redesign; the picture's alt text names the edge)
// shows only while paused, in lines reserved for every frame (R9: nothing flashes in playback).
// The picture swaps only once the next <img> has decoded (frameSwap.ts), so playback never shows
// an undecoded, black <img>.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openMore, setFps } from './flipbookUi';

const SUMMARY = '1 of 24 frames is at a detector edge; its missing part is hatched.';
const EDGE_CAPTION = 'Edge of the detector: part of this cutout lies outside it.';

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('not visible');
  return b;
}

async function cutoutLoaded(page: Page) {
  await expect
    .poll(() =>
      page.getByTestId('cutout').evaluate((el: { naturalWidth: number }) => el.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(page.getByTestId('object-ring')).toBeVisible();
}

for (const tint of [false, true]) {
  test(`frames of different sizes keep one box, scale and ring spot${tint ? ' (tint)' : ''}`, async ({
    page,
  }) => {
    await page.goto('/');
    const input = page.getByTestId('search-input');
    await input.fill("Barnard's Star");
    await input.press('Enter');
    const counter = page.getByTestId('frame-counter');
    await expect(counter).toHaveText('1 / 24');
    if (tint) {
      await page.getByRole('group', { name: 'Picture' }).getByRole('button', { name: 'Colour' }).click();
      await expect(page.getByTestId('tint-overlay')).toBeVisible();
    }
    // The steady no-data line and the cutout count are in More > About.
    await openMore(page, 'about');
    await cutoutLoaded(page);
    const viewer = page.getByTestId('frame-viewer');
    await expect(viewer).toHaveAttribute('data-grid', '65');

    // Focus first: it may scroll the panel, which is not a layout change. The island has grown
    // into the panel (issue #66) before its controls can take focus.
    await expect(page.getByTestId('island')).toHaveAttribute('data-arrived', '');
    await viewer.focus();
    const first = {
      viewer: await box(viewer),
      ring: await box(page.getByTestId('object-ring')),
      below: await box(page.getByTestId('preload-progress')),
      noData: await box(page.getByTestId('frame-no-data')),
    };
    // Inside the 1 px border.
    const pxPerSource = (await viewer.evaluate((el) => el.clientWidth)) / 65;
    const sizes = new Set<string>();
    for (let k = 0; k < 7; k++) {
      if (k > 0) {
        await page.keyboard.press('ArrowRight');
        await expect(counter).toHaveText(`${k + 1} / 24`);
      }
      await cutoutLoaded(page);
      const place = await box(page.getByTestId('frame-place'));
      // Constant scale: the drawn frame is its own size in source pixels × one factor.
      const natural = await page
        .getByTestId('cutout')
        .evaluate((el: { naturalWidth: number; naturalHeight: number }) => [
          el.naturalWidth,
          el.naturalHeight,
        ]);
      sizes.add(natural.join('x'));
      expect(place.width).toBeCloseTo(natural[0]! * pxPerSource, 0);
      expect(place.height).toBeCloseTo(natural[1]! * pxPerSource, 0);
      if (tint) {
        const overlay = await box(page.getByTestId('tint-overlay'));
        expect(overlay).toEqual(place);
      }
      // Only the clipped frame (index 2) is hatched; 63/64 px frames on the 65 px grid are not.
      const hatch = page.getByTestId('no-data-hatch');
      // One steady line for the whole object, with the hatch swatch, on every frame.
      await expect(page.getByTestId('no-data-summary')).toHaveText(SUMMARY);
      await expect(page.getByTestId('no-data-swatch')).toBeVisible();
      if (k === 2) {
        await expect(hatch).toHaveCount(1);
        await expect(hatch).toHaveAttribute('data-no-data', 'edge');
        // Static: no animation or transition on the hatching.
        await expect(hatch).toHaveCSS('animation-name', 'none');
        await expect(hatch).toHaveCSS('transition-duration', '0s');
        // Behind the frame, over the whole grid: only the part outside the frame shows.
        const h = await box(hatch);
        expect(h.width).toBeCloseTo(65 * pxPerSource, 0);
        expect(h.height).toBeCloseTo(65 * pxPerSource, 0);
        expect(
          await hatch.evaluate((el) => el.nextElementSibling?.getAttribute('data-testid')),
        ).toBe('frame-place');
        // Stepped there (paused): the picture's text alternative names the edge (the per-frame
        // caption under the picture went with the redesign).
        await expect(page.getByTestId('cutout')).toHaveAttribute('alt', new RegExp(EDGE_CAPTION));
        await expect(page.getByTestId('cutout')).toHaveAttribute(
          'alt',
          /The hatched area has no data\.$/,
        );
      } else {
        await expect(hatch).toHaveCount(0);
        await expect(page.getByTestId('cutout')).not.toHaveAttribute('alt', /hatched/);
      }
      // The box, the ring, the reserved no-data lines and the line below stay put.
      expect(await box(viewer)).toEqual(first.viewer);
      expect(await box(page.getByTestId('object-ring'))).toEqual(first.ring);
      expect(await box(page.getByTestId('frame-no-data'))).toEqual(first.noData);
      expect((await box(page.getByTestId('preload-progress'))).y).toBe(first.below.y);
    }
    // The steps covered every size, including the clipped frame.
    expect([...sizes].sort()).toEqual(['63x63', '63x64', '64x40', '64x63', '64x64']);
  });
}

test('an object without clipped frames reserves no no-data lines', async ({ page }) => {
  await page.goto('/');
  const input = page.getByTestId('search-input');
  await input.fill('Epsilon Indi B');
  await input.press('Enter');
  await expect(page.getByTestId('frame-counter')).toHaveText('1 / 24');
  await cutoutLoaded(page);
  await openMore(page, 'about');
  await expect(page.getByTestId('frame-no-data')).toHaveCount(0);
  await expect(page.getByTestId('no-data-hatch')).toHaveCount(0);
});

interface PlaybackSamples {
  samples: number;
  /** The viewer said "picture" but the visible <img> had not decoded (a black box). */
  undecoded: number;
  /** "Cutout unavailable" on screen. */
  unavailable: number;
  /** No picture yet (loading). */
  noPicture: number;
  /** The per-frame no-data caption was visible. */
  caption: number;
  /** The steady no-data line was on screen. */
  summary: number;
  /** The caption's or the transport bar's frame number differed from the frame on screen. */
  mismatch: number;
  hatched: number;
  shown: number[];
}

/**
 * Samples the viewer on every animation frame for `ms` (as the user's probe did). Runs in the page,
 * so it is a source string: the e2e TypeScript config has no DOM types.
 */
function samplePlayback(page: Page, ms: number): Promise<PlaybackSamples> {
  return page.evaluate(`new Promise((done) => {
    const out = { samples: 0, undecoded: 0, unavailable: 0, noPicture: 0, caption: 0, summary: 0,
      mismatch: 0, hatched: 0, shown: [] };
    const q = (id) => document.querySelector('[data-testid="' + id + '"]');
    const end = performance.now() + ${ms};
    const tick = () => {
      out.samples++;
      const v = q('frame-viewer');
      const img = document.querySelector('img[data-testid="cutout"]');
      const kind = v.getAttribute('data-shown');
      const i = Number(v.getAttribute('data-shown-index'));
      if (kind === 'picture') {
        const visible = img && getComputedStyle(img).visibility === 'visible';
        if (!visible || !img.complete || img.naturalWidth === 0) out.undecoded++;
      } else if (kind === 'failed') out.unavailable++;
      else out.noPicture++;
      if (q('cutout-unavailable')) out.unavailable += kind === 'failed' ? 0 : 1;
      const cap = q('frame-no-data-caption');
      if (cap && getComputedStyle(cap).visibility === 'visible') out.caption++;
      if (q('no-data-summary')) out.summary++;
      if (q('no-data-hatch')) out.hatched++;
      const n = (t) => Number(/([0-9]+)/.exec(t || '')?.[1]);
      const info = document.querySelector('.sx-frame-info b');
      if (n(q('frame-counter').textContent) !== i + 1 || (info && n(info.textContent) !== i + 1)) {
        out.mismatch++;
      }
      if (out.shown[out.shown.length - 1] !== i) out.shown.push(i);
      if (performance.now() < end) requestAnimationFrame(tick);
      else done(out);
    };
    requestAnimationFrame(tick);
  })`);
}

async function openBarnard(page: Page, tint: boolean) {
  await page.goto('/');
  const input = page.getByTestId('search-input');
  await input.fill("Barnard's Star");
  await input.press('Enter');
  await expect(page.getByTestId('frame-counter')).toHaveText('1 / 24');
  if (tint) {
    await page.getByRole('group', { name: 'Picture' }).getByRole('button', { name: 'Colour' }).click();
    await expect(page.getByTestId('tint-overlay')).toBeVisible();
  }
  // Every cutout preloaded, none unavailable (More > About).
  await openMore(page, 'about');
  await expect(page.getByTestId('preload-progress')).toHaveText(/^24 of 24 loaded$/);
  await cutoutLoaded(page);
}

for (const tint of [false, true]) {
  test(`fastest playback: always a decoded picture, never "unavailable", no flashing caption${tint ? ' (tint)' : ''}`, async ({
    page,
  }) => {
    await openBarnard(page, tint);
    await setFps(page, 8);
    const play = page.getByTestId('play-pause');
    await play.click();
    await expect(play).toHaveText('Pause');
    // 6 s at 8 fps: two loops of 24 frames.
    const r = await samplePlayback(page, 6_000);
    await play.click();

    expect(r.samples).toBeGreaterThan(100);
    expect(r.undecoded, 'samples showing an undecoded <img>').toBe(0);
    expect(r.unavailable, 'samples showing "Cutout unavailable"').toBe(0);
    expect(r.noPicture, 'samples with no picture').toBe(0);
    expect(r.mismatch, 'frame number differs from the picture').toBe(0);
    // The clipped frame was played (hatched) but its caption never showed; the steady line did.
    expect(r.shown).toContain(2);
    expect(r.hatched).toBeGreaterThan(0);
    expect(r.caption, 'per-frame caption visible during playback').toBe(0);
    expect(r.summary).toBe(r.samples);
    // Each frame was on screen (none skipped) across both loops.
    expect(new Set(r.shown).size).toBe(24);
    const viewer = page.getByTestId('frame-viewer');
    await expect(viewer).toHaveAttribute('data-decode-failed', '0');
    await expect(viewer).toHaveAttribute('data-timed-out', '0');
  });
}

test('paused on the clipped frame the picture names the edge; the steady line never changes', async ({
  page,
}) => {
  await openBarnard(page, false);
  const counter = page.getByTestId('frame-counter');
  await setFps(page, 1);
  await page.getByTestId('scrubber').fill('1');
  await expect(counter).toHaveText('2 / 24');
  const play = page.getByTestId('play-pause');
  await play.click();
  // At 1 fps frame 3 (the clipped one) shows for a second: hatched.
  await expect(counter).toHaveText('3 / 24');
  await expect(page.getByTestId('no-data-hatch')).toHaveCount(1);
  await expect(page.getByTestId('no-data-summary')).toHaveText(SUMMARY);
  await play.click();
  await expect(play).toHaveText('Play');
  await expect(counter).toHaveText('3 / 24');
  await expect(page.getByTestId('cutout')).toHaveAttribute('alt', new RegExp(EDGE_CAPTION));
});

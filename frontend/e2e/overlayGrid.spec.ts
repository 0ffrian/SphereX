// Issue #12 overlays on the fixed frame grid (frameGrid.ts) and the two-slot picture swap
// (frameSwap.ts), on the SYNTHETIC fixtures. Barnard's Star cycles 64×64, 63×64, 64×63, 63×63 px
// cutouts in native orientation (each rotated), frame 2 is clipped at a detector edge (64×40), and
// the grid is 65 px. A catalogue marker must sit on its source in the picture on every frame, use
// the same placement as the picture, and follow the frame on screen (which can trail the requested
// one while the next cutout decodes).
import { expect, test, type Page } from '@playwright/test';

interface Marker {
  catalog: string;
  id: string;
  x: number;
  y: number;
}
interface OverlaysReply {
  frames: { frame_id: string; markers: Marker[] }[];
}
interface FramesReply {
  frames: { frame_id: string }[];
}

const ID = 'barnards-star';
const GRID = 65;

async function openBarnard(page: Page) {
  await page.goto('/');
  const input = page.getByTestId('search-input');
  await input.fill("Barnard's Star");
  await input.press('Enter');
  await expect(page.getByTestId('frame-counter')).toHaveText('Frame 1 of 24');
  await expect(page.getByTestId('frame-viewer')).toHaveAttribute('data-grid', String(GRID));
}

async function replies(page: Page): Promise<{ overlays: OverlaysReply; frames: FramesReply }> {
  const o = await page.request.get(`/v1/objects/${ID}/overlays`);
  const f = await page.request.get(`/v1/objects/${ID}/frames`);
  return { overlays: (await o.json()) as OverlaysReply, frames: (await f.json()) as FramesReply };
}

/** Gaia markers of each frame, by frame index (the fixture's own reply). */
function gaiaByFrame(r: { overlays: OverlaysReply; frames: FramesReply }): Marker[][] {
  return r.frames.frames.map(
    (f) =>
      r.overlays.frames
        .find((o) => o.frame_id === f.frame_id)
        ?.markers.filter((m) => m.catalog === 'gaia') ?? [],
  );
}

interface GridSamples {
  samples: number;
  /** Samples with a picture and markers drawn. */
  checked: number;
  /** A marker missing, extra, or more than 1.5 CSS px from where the shown frame puts it. */
  wrong: number;
  /** Markers drawn while no picture is shown. */
  stray: number;
  shown: number[];
  firstWrong: string | null;
}

/**
 * Samples the viewer on every animation frame for `ms`. For the shown frame, every expected
 * marker inside the grid must be drawn at frame-place's left/top + (x + 0.5) source pixels, and
 * nothing else. A source string: the e2e TypeScript config has no DOM types.
 */
function sampleMarkers(page: Page, expected: Marker[][], ms: number, stepAt = -1) {
  return page.evaluate(`new Promise((done) => {
    const expected = ${JSON.stringify(expected)};
    const grid = ${GRID};
    const out = { samples: 0, checked: 0, wrong: 0, stray: 0, shown: [], firstWrong: null };
    const q = (id) => document.querySelector('[data-testid="' + id + '"]');
    const start = performance.now();
    const end = start + ${ms};
    let stepped = ${stepAt} < 0;
    const tick = () => {
      const now = performance.now();
      if (!stepped && now - start >= ${stepAt}) {
        stepped = true;
        q('frame-viewer').dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
        );
      }
      out.samples++;
      const v = q('frame-viewer');
      const kind = v.getAttribute('data-shown');
      const i = Number(v.getAttribute('data-shown-index'));
      if (out.shown[out.shown.length - 1] !== i) out.shown.push(i);
      const drawn = [...document.querySelectorAll('[data-testid="marker"]')];
      if (kind !== 'picture') {
        if (drawn.length > 0) out.stray++;
      } else {
        const vr = v.getBoundingClientRect();
        const innerLeft = vr.left + v.clientLeft;
        const innerTop = vr.top + v.clientTop;
        const px = v.clientWidth / grid;
        const place = q('frame-place').getBoundingClientRect();
        const want = expected[i]
          .map((m) => ({ id: m.id, sx: place.left + (m.x + 0.5) * px, sy: place.top + (m.y + 0.5) * px }))
          .filter((m) => m.sx >= innerLeft - 0.01 && m.sx <= innerLeft + grid * px + 0.01 &&
            m.sy >= innerTop - 0.01 && m.sy <= innerTop + grid * px + 0.01);
        const got = new Map(drawn.map((el) => {
          const c = el.querySelector('circle').getBoundingClientRect();
          return [el.getAttribute('data-id'), { sx: c.left + c.width / 2, sy: c.top + c.height / 2 }];
        }));
        out.checked++;
        let bad = got.size !== want.length ? 'count ' + got.size + ' != ' + want.length : null;
        for (const w of want) {
          const g = got.get(w.id);
          if (!g) { bad = bad || 'missing ' + w.id; continue; }
          if (Math.abs(g.sx - w.sx) > 1.5 || Math.abs(g.sy - w.sy) > 1.5) {
            bad = bad || w.id + ' at ' + g.sx.toFixed(1) + ',' + g.sy.toFixed(1) +
              ' want ' + w.sx.toFixed(1) + ',' + w.sy.toFixed(1);
          }
        }
        if (bad) {
          out.wrong++;
          if (!out.firstWrong) out.firstWrong = 'frame ' + i + ': ' + bad;
        }
      }
      if (now < end) requestAnimationFrame(tick);
      else done(out);
    };
    requestAnimationFrame(tick);
  })`) as Promise<GridSamples>;
}

/** Grey value of the shown cutout at each marker's nearest pixel (read from the decoded <img>). */
function brightnessAtMarkers(page: Page, markers: Marker[]): Promise<number[]> {
  return page.evaluate(`(() => {
    const img = document.querySelector('img[data-testid="cutout"]');
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    return ${JSON.stringify(markers)}.map((m) => {
      const x = Math.min(c.width - 1, Math.max(0, Math.round(m.x)));
      const y = Math.min(c.height - 1, Math.max(0, Math.round(m.y)));
      return d[(y * c.width + x) * 4];
    });
  })()`) as Promise<number[]>;
}

test('Gaia markers sit on their stars on every frame size, clipped frame included', async ({
  page,
}) => {
  await openBarnard(page);
  const expected = gaiaByFrame(await replies(page));
  await page.getByTestId('overlay-toggle-gaia').click();
  await expect(page.locator('[data-testid="marker"][data-catalog="gaia"]').first()).toBeAttached();

  const viewer = page.getByTestId('frame-viewer');
  const counter = page.getByTestId('frame-counter');
  for (let k = 0; k < 5; k++) {
    if (k > 0) {
      await viewer.focus();
      await page.keyboard.press('ArrowRight');
    }
    await expect(counter).toHaveText(`Frame ${k + 1} of 24`);
    await expect(viewer).toHaveAttribute('data-shown', 'picture');
    await expect(viewer).toHaveAttribute('data-shown-index', String(k));
    // Placement: the same transform as the picture box (checked over a few animation frames).
    const r = await sampleMarkers(page, expected, 150);
    expect(r.wrong, r.firstWrong ?? '').toBe(0);
    expect(r.checked).toBeGreaterThan(0);
    // On the source: the picture is bright where each drawn marker is (synthetic stars have
    // amplitude 30-200 over a 14-26 background; see fixtures/synthetic.ts).
    const drawnIds = await page
      .locator('[data-testid="marker"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
    const drawn = expected[k]!.filter((m) => drawnIds.includes(m.id));
    expect(drawn.length).toBeGreaterThan(0);
    for (const v of await brightnessAtMarkers(page, drawn)) expect(v).toBeGreaterThan(30);
  }

  // The flag mask is drawn in the frame's own box, on the clipped frame too.
  await page.getByTestId('overlay-toggle-flags').click();
  const mask = page.getByTestId('flag-mask');
  await expect(mask).toBeAttached();
  await page.getByTestId('scrubber').fill('2');
  await expect(counter).toHaveText('Frame 3 of 24');
  await expect(viewer).toHaveAttribute('data-shown-index', '2');
  await expect(page.getByTestId('no-data-hatch')).toHaveCount(1);
  await expect
    .poll(() => mask.evaluate((el: { naturalHeight: number }) => el.naturalHeight))
    .toBe(40);
  expect(await mask.boundingBox()).toEqual(await page.getByTestId('frame-place').boundingBox());
});

test('markers follow the frame on screen during fast playback', async ({ page }) => {
  await openBarnard(page);
  const expected = gaiaByFrame(await replies(page));
  await expect(page.getByTestId('preload-progress')).toHaveText(/^Cutouts loaded: 24 of 24$/);
  await page.getByTestId('overlay-toggle-gaia').click();
  await expect(page.locator('[data-testid="marker"]').first()).toBeAttached();
  await page.locator('select[title="Speed"]').selectOption('8');
  const play = page.getByTestId('play-pause');
  await play.click();
  await expect(play).toHaveText('Pause');
  const r = await sampleMarkers(page, expected, 4_000);
  await play.click();
  expect(r.wrong, r.firstWrong ?? '').toBe(0);
  expect(r.stray).toBe(0);
  expect(r.checked).toBeGreaterThan(50);
  // Every size was on screen, the clipped frame (2) included.
  expect(new Set(r.shown).size).toBeGreaterThanOrEqual(20);
  expect(r.shown).toContain(2);
});

test('while the next cutout decodes, markers stay with the frame still on screen', async ({
  page,
}) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Frame 2's cutout (index 1) is held back, so stepping to it leaves frame 1 on screen.
  await page.route(`**/v1/objects/${ID}/cutouts/${ID}-f001.png`, async (route) => {
    await gate;
    await route.continue();
  });
  await openBarnard(page);
  const expected = gaiaByFrame(await replies(page));
  const viewer = page.getByTestId('frame-viewer');
  await expect(viewer).toHaveAttribute('data-shown', 'picture');
  await page.getByTestId('overlay-toggle-gaia').click();
  await expect(page.locator('[data-testid="marker"]').first()).toBeAttached();

  // Step at 100 ms, release the cutout at about 600 ms (inside the swap's 1 s hold), sample 2.5 s.
  const sampling = sampleMarkers(page, expected, 2_500, 100);
  await page.waitForTimeout(600);
  release();
  const r = await sampling;
  expect(r.wrong, r.firstWrong ?? '').toBe(0);
  expect(r.stray).toBe(0);
  // Frame 1 stayed on screen (with its markers) after the step, then frame 2 took over.
  expect(r.shown[0]).toBe(0);
  expect(r.shown).toContain(1);
  await expect(viewer).toHaveAttribute('data-shown-index', '1');
});

test('the colour composite hides the overlays and says so; Raw brings them back', async ({
  page,
}) => {
  await openBarnard(page);
  await page.getByTestId('overlay-toggle-gaia').click();
  await expect(page.locator('[data-testid="marker"]').first()).toBeAttached();
  // Wavelength tint: markers stay, above the tint.
  await page
    .getByRole('radiogroup', { name: 'Picture' })
    .getByRole('radio', { name: 'Colour' })
    .click();
  await expect(page.getByTestId('tint-overlay')).toBeVisible();
  await expect(page.locator('[data-testid="marker"]').first()).toBeAttached();
  await page
    .getByRole('radiogroup', { name: 'Colour view' })
    .getByRole('radio', { name: 'SPHEREx composite' })
    .click();
  await expect(page.getByTestId('overlay-composite-note')).toBeVisible();
  await expect(page.getByTestId('marker')).toHaveCount(0);
  await expect(page.getByTestId('overlay-details')).toHaveCount(0);
  await page
    .getByRole('radiogroup', { name: 'Picture' })
    .getByRole('radio', { name: 'Raw' })
    .click();
  await expect(page.getByTestId('overlay-composite-note')).toHaveCount(0);
  await expect(page.locator('[data-testid="marker"]').first()).toBeAttached();
});

test('progressive loading: overlays wait for the full frame list and are asked for once', async ({
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (/\/overlays$/.test(new URL(r.url()).pathname)) asked.push(r.url());
  });
  await page.goto('/');
  const input = page.getByTestId('search-input');
  await input.fill('Synthetic progressive');
  await input.press('Enter');
  await expect(page.getByTestId('frames-progress')).toBeVisible();
  await page.getByTestId('overlay-toggle-gaia').click();
  await expect(page.getByTestId('overlay-waiting')).toBeVisible();
  expect(asked).toHaveLength(0);
  await expect(page.getByTestId('frames-progress')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('overlay-waiting')).toHaveCount(0);
  await expect(page.locator('[data-testid="marker"]').first()).toBeAttached();
  expect(asked).toHaveLength(1);
});

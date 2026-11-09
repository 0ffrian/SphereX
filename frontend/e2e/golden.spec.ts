// 10.6 gates 2 and 6: golden frames. Every fixture that has a 3D view is drawn at each of the three
// honesty states (D-21) through the panel's own path (window.__sxShow, as shaderKinds.spec.ts does)
// and compared with the committed golden by SSIM, not exact pixels. Headless Chromium has no GPU, so
// this is the WebGL2 fallback (SwiftShader): it catches a changed picture, it is not a look review
// (that is docs/rendering/reference/checklist.md).
//   SX_UPDATE_GOLDENS=1 npx playwright test golden   writes the goldens (review the diff, then commit).
//
// `asteroid_shape` is the real Eros model (Gaskell, backend/assets/shapes, served at /data/shapes by
// the fixtures server, issue #62). The low quality tier set below draws its coarse level
// (eros-gaskell.lod1.glb, `chooseLod`), which SwiftShader finishes at every state (re-checked 9 Nov
// 2026), so no state is skipped any more. SKIP_STATES stays for a state a software rasteriser
// cannot draw; such a state needs a GPU-only check instead.
// Excluded fixture: `candidate` has no 3D view (R5/D-21: a candidate has no measured size, so nothing is
// drawn and the panel shows the "nothing to draw" message). A fixture whose body draws nothing at
// every state would give three identical black goldens, which test nothing.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import {
  BACKGROUND_TOLERANCE,
  GOLDEN_MAX_COLOUR_DELTA,
  GOLDEN_MIN_CHANNEL_SSIM,
  GOLDEN_MIN_SSIM,
  SPACE_BACKGROUND_RGB,
} from './golden';
import { openViewer, viewerCanvas } from './viewer';
import { scoreFrames, type Rgb } from './ssim';

const EXCLUDED = new Set(['candidate']);
const HONESTY = ['measured', 'derived', 'artistic'] as const;
/**
 * Extra states drawn at a quality tier other than the low one every golden runs at (PR #63 review):
 * the asteroid's displacement by the baked height map is off on `low` (Q-117), so it needs a golden
 * of its own at `medium`. The file is `<kind>.<honesty>.<tier>.png`.
 */
const TIER_STATES: Record<string, readonly { honesty: (typeof HONESTY)[number]; tier: string }[]> =
  { asteroid_procedural: [{ honesty: 'artistic', tier: 'medium' }] };
const SKIP_STATES: Record<string, readonly string[]> = {};
/** D-21 / R5.3: the tags each honesty state may draw. */
const SHOWN_TAGS: Record<(typeof HONESTY)[number], readonly string[]> = {
  measured: ['measured'],
  derived: ['measured', 'derived', 'model_dependent', 'inferred_from_analog'],
  artistic: ['measured', 'derived', 'model_dependent', 'inferred_from_analog', 'artistic'],
};
const GOLDEN_DIR = fileURLToPath(new URL('./__goldens__/', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../../shared/fixtures/', import.meta.url));
const UPDATE = process.env.SX_UPDATE_GOLDENS === '1';

const kinds = readdirSync(`${FIXTURES}cards`)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -5))
  .filter((k) => !EXCLUDED.has(k))
  .sort();
const read = (dir: string, k: string) =>
  JSON.parse(readFileSync(`${FIXTURES}${dir}/${k}.json`, 'utf8')) as unknown;

/**
 * The comet fixture offers no tail layers (the backend offers them only with a published result),
 * so its golden would show a nucleus and a coma only. The golden adds the two layers the viewer
 * knows about, as the backend would send them, so that the tails are covered too. Deterministic:
 * the same two layers every run. The epoch is the card's own (the panel's `__sxShow` path).
 */
function paramsFor(k: string): unknown {
  const params = read('params', k) as { layers: unknown[] };
  if (k !== 'comet') return params;
  const layer = (id: string, tag: string, tier: number) => ({
    id,
    tag,
    tier,
    description: `${id} (golden: synthetic layer, as the backend would send it)`,
    requires: [],
  });
  return {
    ...params,
    layers: [...params.layers, layer('ion_tail', 'derived', 2), layer('dust_tail', 'artistic', 5)],
  };
}

/** Decode a PNG to luminance in a blank page (no dependencies in Node). */
async function decode(page: Page, png: Buffer): Promise<Rgb> {
  // Plain string: the e2e tsconfig has no DOM lib, and this runs in the browser.
  const out = (await page.evaluate(`(async () => {
    const img = new Image();
    img.src = 'data:image/png;base64,${png.toString('base64')}';
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let s = '';
    for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
    return { w: c.width, h: c.height, rgba: btoa(s) };
  })()`)) as { w: number; h: number; rgba: string };
  return { width: out.w, height: out.h, rgba: Uint8Array.from(Buffer.from(out.rgba, 'base64')) };
}

for (const kind of kinds) {
  test(`golden frames: ${kind}`, async ({ page, context }, info) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));

    await openViewer(page);
    const status = page.getByTestId('renderer-status');
    await expect(status).not.toHaveAttribute('data-status', 'starting', { timeout: 30_000 });
    test.skip((await status.getAttribute('data-status')) === 'unavailable', 'no 3D backend');
    await page.waitForFunction(() => '__sxViewer' in globalThis && '__sxShow' in globalThis);
    const canvas = viewerCanvas(page);
    const decoder = await context.newPage();
    mkdirSync(GOLDEN_DIR, { recursive: true });

    const states = [
      ...HONESTY.map((honesty) => ({ honesty, tier: 'low' })),
      ...(TIER_STATES[kind] ?? []),
    ];
    for (const { honesty, tier } of states) {
      if (SKIP_STATES[kind]?.includes(honesty)) continue;
      // Same fixture + seed + time must give the same golden. The render-core hooks pin the quality
      // tier and the clock; without them the viewer is only waited on until it stops changing.
      const hooks = await page.evaluate(
        async ({ card, params, honesty, tier }) => {
          const g = globalThis as unknown as {
            __sxViewer: {
              setQualityTier?(t: string): void;
              freezeClock?(s: number): Promise<void>;
              whenSettled?(): Promise<void>;
              body: { drawn: string[] } | null;
            };
            __sxShow(c: unknown, p: unknown, h: string): { drawn: { id: string; tag: string }[] };
          };
          const v = g.__sxViewer;
          v.setQualityTier?.(tier);
          const plan = g.__sxShow(card, params, honesty);
          for (let i = 0; i < 400 && !v.body; i++) await new Promise((r) => setTimeout(r, 25));
          // Generated surfaces and point clouds arrive from the worker a little later.
          for (let i = 0; i < 200 && honesty === 'artistic' && !v.body?.drawn.length; i++)
            await new Promise((r) => setTimeout(r, 25));
          await v.freezeClock?.(0);
          await v.whenSettled?.();
          return {
            freeze: typeof v.freezeClock === 'function',
            settled: typeof v.whenSettled === 'function',
            layers: plan.drawn.map((d) => ({ id: d.id, tag: d.tag })),
            bodyDrawn: v.body ? [...v.body.drawn] : null,
          };
        },
        { card: read('cards', kind), params: paramsFor(kind), honesty, tier },
      );

      // The state draws only layers whose tag it shows (D-21), and a generated body draws only
      // layers the plan lists.
      for (const l of hooks.layers)
        expect(SHOWN_TAGS[honesty], `${kind}.${honesty}: layer ${l.id} is ${l.tag}`).toContain(
          l.tag,
        );
      const listed = hooks.layers.map((l) => l.id);
      for (const id of hooks.bodyDrawn ?? [])
        expect(listed, `${kind}.${honesty}: body drew ${id}, not in the plan`).toContain(id);

      // Fallback settle: two identical frames in a row (an animated body may never settle; the
      // SSIM threshold absorbs the small remaining difference).
      // A clip screenshot of the page, not canvas.screenshot(): a heavy body (the shape-model
      // asteroid) keeps the main thread so busy that Playwright's "element is stable" wait never ends.
      const box = (await canvas.boundingBox())!;
      const shoot = () => page.screenshot({ clip: box, mask: [page.getByTestId('viewer-label')] });
      let shot = await shoot();
      if (!(hooks.freeze && hooks.settled)) {
        for (let i = 0; i < 20; i++) {
          await page.waitForTimeout(150);
          const next = await shoot();
          const same = next.equals(shot);
          shot = next;
          if (same) break;
        }
      }

      const name = tier === 'low' ? `${kind}.${honesty}.png` : `${kind}.${honesty}.${tier}.png`;
      // Bottom-left corner: clear of the masked label, the scale bar and every fixture's body.
      const frame = await decode(decoder, shot);
      const at = ((frame.height - 4) * frame.width + 3) * 4;
      const corner = Array.from(frame.rgba.subarray(at, at + 3));
      SPACE_BACKGROUND_RGB.forEach((v, i) =>
        expect(
          Math.abs(corner[i]! - v),
          `${name}: background ${corner.join(',')} is not ${SPACE_BACKGROUND_RGB.join(',')}`,
        ).toBeLessThanOrEqual(BACKGROUND_TOLERANCE),
      );
      const path = `${GOLDEN_DIR}${name}`;
      await info.attach(`actual-${name}`, { body: shot, contentType: 'image/png' });
      if (UPDATE) {
        writeFileSync(path, shot);
        continue;
      }
      expect(existsSync(path), `no golden ${name}; run with SX_UPDATE_GOLDENS=1`).toBe(true);
      const expected = readFileSync(path);
      await info.attach(`expected-${name}`, { body: expected, contentType: 'image/png' });
      const sc = scoreFrames(await decode(decoder, expected), frame);
      const line = `luma ${sc.luma.toFixed(5)} channelMin ${sc.channelMin.toFixed(5)} colourDelta ${sc.colourDelta.toFixed(4)}`;
      await info.attach(`score-${name}.txt`, { body: line, contentType: 'text/plain' });
      if (process.env.SX_GOLDEN_SCORES) console.log(`ssim ${name} ${line}`);
      expect(sc.luma, `${name}: ${line}`).toBeGreaterThanOrEqual(GOLDEN_MIN_SSIM);
      expect(sc.channelMin, `${name}: ${line}`).toBeGreaterThanOrEqual(GOLDEN_MIN_CHANNEL_SSIM);
      expect(sc.colourDelta, `${name}: ${line}`).toBeLessThanOrEqual(GOLDEN_MAX_COLOUR_DELTA);
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });
}

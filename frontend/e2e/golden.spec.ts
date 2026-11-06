// 10.6 gates 2 and 6: golden frames. Every fixture that has a 3D view is drawn at each of the three
// honesty states (D-21) through the panel's own path (window.__sxShow, as shaderKinds.spec.ts does)
// and compared with the committed golden by SSIM, not exact pixels. Headless Chromium has no GPU, so
// this is the WebGL2 fallback (SwiftShader): it catches a changed picture, it is not a look review
// (that is docs/rendering/reference/checklist.md).
//   SX_UPDATE_GOLDENS=1 npx playwright test golden   writes the goldens (review the diff, then commit).
//
// Excluded states: `asteroid_shape` is only checked at Measured only. Once its shape-model mesh is
// drawn (+ Estimated and up), SwiftShader never finishes a frame (page.screenshot hangs for minutes),
// so no golden can be taken there; it needs a real GPU. [verify] re-check after the render-core merge.
// Excluded fixture: `candidate` has no 3D view (R5/D-21: a candidate has no measured size, so nothing is
// drawn and the panel shows the "nothing to draw" message). A fixture whose body draws nothing at
// every state would give three identical black goldens, which test nothing.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { GOLDEN_MIN_SSIM } from './golden';
import { lumaFromRgba, ssim, type Luma } from './ssim';

const EXCLUDED = new Set(['candidate']);
const HONESTY = ['measured', 'derived', 'artistic'] as const;
const SKIP_STATES: Record<string, readonly string[]> = {
  asteroid_shape: ['derived', 'artistic'],
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

/** Decode a PNG to luminance in a blank page (no dependencies in Node). */
async function decode(page: Page, png: Buffer): Promise<Luma> {
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
  return lumaFromRgba(out.w, out.h, Uint8Array.from(Buffer.from(out.rgba, 'base64')));
}

for (const kind of kinds) {
  test(`golden frames: ${kind}`, async ({ page, context }, info) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/');
    const status = page.getByTestId('renderer-status');
    await expect(status).not.toHaveAttribute('data-status', 'starting', { timeout: 30_000 });
    test.skip((await status.getAttribute('data-status')) === 'unavailable', 'no 3D backend');
    await page.waitForFunction(() => '__sxViewer' in globalThis && '__sxShow' in globalThis);
    const canvas = page.locator('canvas[aria-label]');
    const decoder = await context.newPage();
    mkdirSync(GOLDEN_DIR, { recursive: true });

    for (const honesty of HONESTY) {
      if (SKIP_STATES[kind]?.includes(honesty)) continue;
      // Same fixture + seed + time must give the same golden. The render-core hooks pin the quality
      // tier and the clock; until they exist the viewer is only waited on until it stops changing.
      const hooks = await page.evaluate(
        async ({ card, params, honesty }) => {
          const g = globalThis as unknown as {
            __sxViewer: {
              setQualityTier?(t: string): void;
              freezeClock?(s: number): Promise<void>;
              whenSettled?(): Promise<void>;
              body: { drawn: string[] } | null;
            };
            __sxShow(c: unknown, p: unknown, h: string): unknown;
          };
          const v = g.__sxViewer;
          v.setQualityTier?.('low');
          g.__sxShow(card, params, honesty);
          for (let i = 0; i < 400 && !v.body; i++) await new Promise((r) => setTimeout(r, 25));
          // Generated surfaces and point clouds arrive from the worker a little later.
          for (let i = 0; i < 200 && honesty === 'artistic' && !v.body?.drawn.length; i++)
            await new Promise((r) => setTimeout(r, 25));
          await v.freezeClock?.(0);
          await v.whenSettled?.();
          return {
            freeze: typeof v.freezeClock === 'function',
            settled: typeof v.whenSettled === 'function',
          };
        },
        { card: read('cards', kind), params: read('params', kind), honesty },
      );

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

      const name = `${kind}.${honesty}.png`;
      const path = `${GOLDEN_DIR}${name}`;
      await info.attach(`actual-${name}`, { body: shot, contentType: 'image/png' });
      if (UPDATE) {
        writeFileSync(path, shot);
        continue;
      }
      expect(existsSync(path), `no golden ${name}; run with SX_UPDATE_GOLDENS=1`).toBe(true);
      const expected = readFileSync(path);
      await info.attach(`expected-${name}`, { body: expected, contentType: 'image/png' });
      const score = ssim(await decode(decoder, expected), await decode(decoder, shot));
      await info.attach(`score-${name}.txt`, {
        body: `ssim ${score.toFixed(5)} (min ${GOLDEN_MIN_SSIM})`,
        contentType: 'text/plain',
      });
      if (process.env.SX_GOLDEN_SCORES) console.log(`ssim ${name} ${score.toFixed(5)}`);
      expect(score, `${name}: ssim ${score.toFixed(5)}`).toBeGreaterThanOrEqual(GOLDEN_MIN_SSIM);
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });
}

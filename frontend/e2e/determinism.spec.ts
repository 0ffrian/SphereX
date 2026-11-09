// R5.7 / R11: same card, seed and time give the same frame on one device, also on a temporal
// (TAAU) tier. The goldens run at the low tier (SMAA), so this covers medium: a body drawn straight
// away must match the same body drawn after another one, once the clock is frozen and settled.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { openViewer, viewerCanvas } from './viewer';

const read = (dir: string, k: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../shared/fixtures/${dir}/${k}.json`, import.meta.url)),
      'utf8',
    ),
  ) as unknown;

/** Half-float accumulation rounds differently run to run by up to 1 level; anything more is real. */
const MAX_LEVEL_DIFF = 2;

/** Largest per-channel difference of two PNGs, decoded in a page (no dependencies in Node). */
async function maxChannelDiff(page: Page, a: Buffer, b: Buffer): Promise<number> {
  // Plain string: the e2e tsconfig has no DOM lib, and this runs in the browser.
  return (await page.evaluate(`(async () => {
    const load = async (b64) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, c.width, c.height).data;
    };
    const x = await load('${a.toString('base64')}');
    const y = await load('${b.toString('base64')}');
    if (x.length !== y.length) return 255;
    let m = 0;
    for (let i = 0; i < x.length; i++) if ((i & 3) !== 3) m = Math.max(m, Math.abs(x[i] - y[i]));
    return m;
  })()`)) as number;
}

async function draw(page: Page, kinds: string[]): Promise<Buffer> {
  await openViewer(page);
  const status = page.getByTestId('renderer-status');
  await expect(status).not.toHaveAttribute('data-status', 'starting', { timeout: 30_000 });
  test.skip((await status.getAttribute('data-status')) === 'unavailable', 'no 3D backend');
  await page.waitForFunction(() => '__sxViewer' in globalThis && '__sxShow' in globalThis);
  for (const kind of kinds) {
    await page.evaluate(
      async ({ card, params }) => {
        const g = globalThis as unknown as {
          __sxViewer: {
            setQualityTier(t: string): void;
            freezeClock(s: number): Promise<void>;
            body: { drawn: string[] } | null;
          };
          __sxShow(c: unknown, p: unknown, h: string): unknown;
        };
        g.__sxViewer.setQualityTier('medium');
        g.__sxShow(card, params, 'artistic');
        for (let i = 0; i < 400 && !g.__sxViewer.body?.drawn.length; i++)
          await new Promise((r) => setTimeout(r, 25));
        await g.__sxViewer.freezeClock(0);
      },
      { card: read('cards', kind), params: read('params', kind) },
    );
  }
  // The frame governor (R5.7: one level down after 2 s of frames over 33 ms) can lower the tier
  // while SwiftShader is slow. A frame drawn at Low is not a TAAU frame, and comparing it with a
  // Medium one is not a determinism check, so pin Medium again and settle until it holds.
  const tier = await page.evaluate(async () => {
    const v = (
      globalThis as unknown as {
        __sxViewer: {
          setQualityTier(t: string): void;
          freezeClock(s: number): Promise<void>;
          renderStats(): { tier: string };
        };
      }
    ).__sxViewer;
    for (let i = 0; i < 3 && v.renderStats().tier !== 'medium'; i++) {
      v.setQualityTier('medium');
      await v.freezeClock(0);
    }
    return v.renderStats().tier;
  });
  expect(tier, 'the governor kept lowering the quality level').toBe('medium');
  const box = (await viewerCanvas(page).boundingBox())!;
  return page.screenshot({ clip: box, mask: [page.getByTestId('viewer-label')] });
}

test('TAAU tier: the settled frame does not depend on what was shown before', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const direct = await draw(await browser.newPage(), ['gas_giant']);
  const after = await draw(await browser.newPage(), ['planet_water', 'gas_giant']);
  const diff = await maxChannelDiff(await browser.newPage(), direct, after);
  // Measured on SwiftShader: 1 level with the history reset, 31 without it.
  expect(diff, 'TAAU history leaked across bodies').toBeLessThanOrEqual(MAX_LEVEL_DIFF);
});

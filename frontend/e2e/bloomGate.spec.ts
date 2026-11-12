// Issue #50 / render-performance roadmap 1.3: the bloom pass is skipped for a plan that cannot pass
// its threshold (`planMayBloom`). That must change no pixel. For every fixture at every honesty
// state, the settled frame is taken with bloom forced on and forced off (`setBloomMode`); wherever the
// gate skips bloom ('auto' gives bloom: false), the two frames must be byte-identical. SwiftShader
// WebGL2 at the low level (SMAA), as the goldens. The medium level (TAAU) is not checked here: on
// SwiftShader two settles of the same state after a chain rebuild differed by up to 126 levels with
// bloom off both times (12 Nov 2026), so a TAAU comparison cannot tell bloom from noise.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { openViewer, viewerCanvas } from './viewer';

/** Largest per-channel difference of two PNGs, decoded in a page. */
async function maxChannelDiff(page: Page, a: Buffer, b: Buffer): Promise<number> {
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

const FIXTURES = fileURLToPath(new URL('../../shared/fixtures/', import.meta.url));
const HONESTY = ['measured', 'derived', 'artistic'] as const;
const TIERS = ['low'] as const;
const kinds = readdirSync(`${FIXTURES}cards`)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -5))
  .filter((k) => k !== 'candidate')
  .sort();
const read = (dir: string, k: string) =>
  JSON.parse(readFileSync(`${FIXTURES}${dir}/${k}.json`, 'utf8')) as unknown;

for (const kind of kinds) {
  test(`bloom gate changes no pixel: ${kind}`, async ({ page, context }) => {
    test.setTimeout(240_000);
    await openViewer(page);
    const status = page.getByTestId('renderer-status');
    await expect(status).not.toHaveAttribute('data-status', 'starting', { timeout: 30_000 });
    test.skip((await status.getAttribute('data-status')) === 'unavailable', 'no 3D backend');
    await page.waitForFunction(() => '__sxViewer' in globalThis && '__sxShow' in globalThis);
    const canvas = viewerCanvas(page);
    const decoder = await context.newPage();
    let skipped = 0;
    for (const tier of TIERS) {
      for (const honesty of HONESTY) {
        const shot = async (mode: 'auto' | 'on' | 'off') => {
          const gate = await page.evaluate(
            async ({ card, params, honesty, tier, mode }) => {
              const g = globalThis as unknown as {
                __sxViewer: {
                  setQualityTier(t: string): void;
                  setBloomMode(m: string): void;
                  freezeClock(s: number): Promise<void>;
                  whenLoaded(): Promise<void>;
                  renderStats(): { bloom: boolean };
                };
                __sxShow(c: unknown, p: unknown, h: string): unknown;
              };
              const v = g.__sxViewer;
              v.setQualityTier(tier);
              v.setBloomMode('auto');
              g.__sxShow(card, params, honesty);
              await v.whenLoaded();
              const auto = v.renderStats().bloom;
              v.setBloomMode(mode);
              await v.freezeClock(0);
              return auto;
            },
            { card: read('cards', kind), params: read('params', kind), honesty, tier, mode },
          );
          const box = (await canvas.boundingBox())!;
          const png = await page.screenshot({
            clip: box,
            mask: [page.getByTestId('viewer-label')],
          });
          return { gate, png };
        };
        // Up to three on/off pairs; the smallest difference counts. Bloom adds the same light to every
        // frame of a state, so a real bloom contribution shows in every pair. The shape models settle
        // once more in the background at + Estimated, at a varying point: on asteroid_shape and
        // asteroid_shape_bennu one frame in a sequence of eight differed from the one before by 6 and
        // 4 levels, and every bloom-on/off pair after that step was byte-identical (probe, 12 Nov
        // 2026). That step is not bloom, and one pair may straddle it.
        let diff = Infinity;
        let gate = false;
        for (let attempt = 0; attempt < 3 && diff > 0; attempt++) {
          const on = await shot('on');
          const off = await shot('off');
          gate = on.gate;
          if (gate) break;
          const d = off.png.equals(on.png) ? 0 : await maxChannelDiff(decoder, on.png, off.png);
          diff = Math.min(diff, d);
        }
        if (gate) continue; // the gate keeps bloom here: nothing to prove
        skipped++;
        expect
          .soft(
            diff,
            `${kind}.${honesty}.${tier}: the gate skips bloom, but bloom changed the frame by ${diff} levels`,
          )
          .toBe(0);
      }
    }
    test.info().annotations.push({ type: 'skipped-bloom-states', description: String(skipped) });
  });
}

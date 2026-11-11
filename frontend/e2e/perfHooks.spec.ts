// Issue #16, R11.4: the fixtures app has `__sxPerf.record`. Headless Chromium has no GPU (WebGL2 on
// SwiftShader), so this checks the wiring and the result shape only, never a frame-time verdict.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { openViewer } from './viewer';

const read = (dir: string, k: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../shared/fixtures/${dir}/${k}.json`, import.meta.url)),
      'utf8',
    ),
  ) as unknown;

test('__sxPerf.record returns a summary from the fixtures build', async ({ page }) => {
  test.setTimeout(120_000);
  await openViewer(page);
  const status = page.getByTestId('renderer-status');
  await expect(status).not.toHaveAttribute('data-status', 'starting', { timeout: 30_000 });
  test.skip((await status.getAttribute('data-status')) === 'unavailable', 'no 3D backend');
  await page.waitForFunction(() => '__sxViewer' in globalThis && '__sxPerf' in globalThis);

  const result = await page.evaluate(
    async ({ card, params }) => {
      const g = globalThis as unknown as {
        __sxShow(c: unknown, p: unknown, honesty: string): unknown;
        __sxPerf: { record(s?: number): Promise<Record<string, unknown>> };
      };
      if (typeof g.__sxPerf.record !== 'function') throw new Error('no record');
      g.__sxShow(card, params, 'artistic');
      return await g.__sxPerf.record(1);
    },
    { card: read('cards', 'star'), params: read('params', 'star') },
  );
  expect(result.samples as number).toBeGreaterThan(0);
  for (const key of [
    'summary',
    'verdict',
    'tierStart',
    'tierEnd',
    'backend',
    'dropsAbsolute',
    'viewerFrames',
  ])
    expect(result).toHaveProperty(key);
});

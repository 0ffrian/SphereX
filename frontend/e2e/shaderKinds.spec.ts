// R7.7, D-01: each shader-generated kind renders from its synthetic fixture card + params. Headless
// Chromium has no GPU, so this runs on the WebGL2 fallback (SwiftShader): it proves the TSL shaders
// compile and draw something, not that they look right on a real GPU (that stays a manual check).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// Honesty: the D-21 default (+ Estimated) hides artistic layers, so the render tests ask for all.
const ALL_TAGS = ['measured', 'derived', 'model_dependent', 'inferred_from_analog', 'artistic'];
const KINDS = ['planet_rocky', 'planet_water', 'gas_giant', 'nebula', 'nova'] as const;
const read = (dir: string, k: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../shared/fixtures/${dir}/${k}.json`, import.meta.url)),
      'utf8',
    ),
  ) as unknown;

for (const kind of KINDS) {
  test(`${kind} renders from its fixture`, async ({ page }, info) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/');
    const status = page.getByTestId('renderer-status');
    await expect(status).not.toHaveAttribute('data-status', 'starting', { timeout: 30_000 });
    test.skip((await status.getAttribute('data-status')) === 'unavailable', 'no 3D backend');
    await page.waitForFunction(() => '__sxViewer' in globalThis);

    const canvas = page.locator('canvas[aria-label]');
    const before = await canvas.screenshot();
    const result = await page.evaluate(
      async ({ card, params, tags }) => {
        const v = (
          globalThis as unknown as {
            __sxViewer: { setBody(c: unknown, p: unknown, x: unknown): Promise<unknown> };
          }
        ).__sxViewer;
        const body = (await v.setBody(card, params, { visibleTags: tags })) as {
          drawn: string[];
          missing: string[];
        } | null;
        return body ? { drawn: body.drawn, missing: body.missing } : null;
      },
      { card: read('cards', kind), params: read('params', kind), tags: ALL_TAGS },
    );
    expect(result).not.toBeNull();
    expect(result!.drawn.length).toBe(1);
    // The field and the nebula / nova points come from the Web Worker (D-12, N8). A worker that was
    // created but failed would fall back to the main thread, so count what actually served.
    const stats = await page.evaluate(
      () =>
        (globalThis as unknown as { __sxFieldStats?: { worker: number; main: number } })
          .__sxFieldStats,
    );
    expect(stats, 'field stats hook (fixtures mode)').toBeDefined();
    expect(stats!.main, 'served on the main thread (worker fallback)').toBe(0);
    expect(stats!.worker).toBeGreaterThan(0);

    await expect
      .poll(async () => !(await canvas.screenshot()).equals(before), { timeout: 20_000 })
      .toBe(true);
    const shot = await canvas.screenshot();
    await info.attach(`${kind}.png`, { body: shot, contentType: 'image/png' });
    // SX_SHOT_DIR=<dir> keeps the screenshots for a manual look.
    const dir = process.env.SX_SHOT_DIR;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}/${kind}.png`, shot);
    }
    expect(errors, errors.join('\n')).toEqual([]);

    // A12 reference screenshot: the deterministic fixture must keep drawing the same picture.
    // SwiftShader (software WebGL2) is stable on one machine; the tolerance absorbs rasteriser
    // rounding between versions. Update with `npx playwright test shaderKinds --update-snapshots`
    // after a deliberate look change and review the diff.
    await expect(canvas).toHaveScreenshot(`${kind}.png`, {
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
    });
  });
}

test('honesty default: with no tags passed, artistic layers are hidden and the status says so', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const status = page.getByTestId('renderer-status');
  await expect(status).not.toHaveAttribute('data-status', 'starting', { timeout: 30_000 });
  test.skip((await status.getAttribute('data-status')) === 'unavailable', 'no 3D backend');
  await page.waitForFunction(() => '__sxViewer' in globalThis);
  const out = await page.evaluate(
    async ({ card, params }) => {
      const v = (
        globalThis as unknown as {
          __sxViewer: {
            setBody(c: unknown, p: unknown): Promise<{ drawn: string[]; hidden: string[] }>;
            bodyInfo: { status: { state: string } } | null;
          };
        }
      ).__sxViewer;
      const body = await v.setBody(card, params);
      return { drawn: body.drawn, hidden: body.hidden, state: v.bodyInfo?.status.state };
    },
    { card: read('cards', 'gas_giant'), params: read('params', 'gas_giant') },
  );
  expect(out).toEqual({ drawn: [], hidden: ['surface'], state: 'hidden' });
  // The panel shows the plain-words status and the canvas label follows the body (N6, N7).
  await expect(page.getByText(/plain grey sphere/)).toBeVisible();
  await expect(page.locator('canvas[aria-label]')).toHaveAttribute('aria-label', /grey sphere/);
});

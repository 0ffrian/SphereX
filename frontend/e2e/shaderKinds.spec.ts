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

// Review NF-7: reference views chosen so that the parameters a regression is likely to touch are
// actually visible. The default planet_water view is mostly night side and cloud, and the gas giant
// fixture has all its storms on the night side or at the limb (sun_dir +x), so two extra views
// light the body from the camera side: the gas giant turned 60 degrees so storms 2, 4 and 5 face the
// camera in full light, and the water world without clouds, tilted 45 degrees toward the pole, so the coastline and the ice show.
interface View {
  name: string;
  kind: string;
  lightDir?: number[];
  overrides?: Record<string, number>;
  rotateLeft?: number;
  rotateUp?: number;
  /** Per-pixel colour tolerance; default 0.05. */
  threshold?: number;
}
const VIEWS: View[] = [
  ...KINDS.map((kind) => ({ name: kind as string, kind: kind as string })),
  {
    name: 'gas_giant_storms',
    kind: 'gas_giant',
    lightDir: [-0.8, 0.4, 0.5],
    rotateLeft: 4,
    threshold: 0.01,
  },
  {
    name: 'planet_water_surface',
    kind: 'planet_water',
    lightDir: [0.3, 0.3, 1],
    overrides: { cloud_cover: 0 },
    rotateUp: 3,
  },
];

for (const view of VIEWS) {
  const { name, kind, lightDir, overrides, rotateLeft, rotateUp } = view;
  test(`${name} renders from its fixture`, async ({ page }, info) => {
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
      async ({ card, params, tags, lightDir, overrides, rotateLeft, rotateUp }) => {
        const v = (
          globalThis as unknown as {
            __sxViewer: {
              setBody(c: unknown, p: unknown, x: unknown): Promise<unknown>;
              rotate(d: 'left' | 'up'): void;
            };
          }
        ).__sxViewer;
        const body = (await v.setBody(card, params, {
          visibleTags: tags,
          lightDir,
          overrides,
        })) as {
          drawn: string[];
          missing: string[];
        } | null;
        for (let i = 0; i < (rotateLeft ?? 0); i++) v.rotate('left');
        for (let i = 0; i < (rotateUp ?? 0); i++) v.rotate('up');
        return body ? { drawn: body.drawn, missing: body.missing } : null;
      },
      {
        card: read('cards', kind),
        params: read('params', kind),
        tags: ALL_TAGS,
        lightDir,
        overrides,
        rotateLeft,
        rotateUp,
      },
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
    await info.attach(`${name}.png`, { body: shot, contentType: 'image/png' });
    // SX_SHOT_DIR=<dir> keeps the screenshots for a manual look.
    const dir = process.env.SX_SHOT_DIR;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}/${name}.png`, shot);
    }
    expect(errors, errors.join('\n')).toEqual([]);

    // A12 reference screenshot: the deterministic fixture must keep drawing the same picture.
    // SwiftShader (software WebGL2) is stable on one machine; the tolerance absorbs rasteriser
    // rounding between versions. Update with `npx playwright test shaderKinds --update-snapshots`
    // after a deliberate look change and review the diff.
    // NF-7: the DOM status overlay sits on the canvas box, so it is masked; the body is compared
    // tightly enough that a changed storm count, band warp, seed, sea level or ice extent shows.
    await expect(canvas).toHaveScreenshot(`${name}.png`, {
      mask: [page.getByTestId('body-status')],
      maxDiffPixelRatio: 0.002,
      threshold: view.threshold ?? 0.05,
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

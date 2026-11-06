// R7.7, D-01: each shader-generated kind renders from its synthetic fixture card + params. Headless
// Chromium has no GPU, so this runs on the WebGL2 fallback (SwiftShader): it proves the TSL shaders
// compile and draw something, not that they look right on a real GPU (that stays a manual check).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

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

    let workers = 0;
    page.on('worker', () => workers++);

    await page.goto('/');
    const status = page.getByTestId('renderer-status');
    await expect(status).not.toHaveAttribute('data-status', 'starting', { timeout: 30_000 });
    test.skip((await status.getAttribute('data-status')) === 'unavailable', 'no 3D backend');
    await page.waitForFunction(() => '__sxViewer' in globalThis);

    const canvas = page.locator('canvas[aria-label]');
    const before = await canvas.screenshot();
    const result = await page.evaluate(
      async ({ card, params }) => {
        const v = (
          globalThis as unknown as {
            __sxViewer: { setBody(c: unknown, p: unknown): Promise<unknown> };
          }
        ).__sxViewer;
        const body = (await v.setBody(card, params)) as {
          drawn: string[];
          missing: string[];
        } | null;
        return body ? { drawn: body.drawn, missing: body.missing } : null;
      },
      { card: read('cards', kind), params: read('params', kind) },
    );
    expect(result).not.toBeNull();
    expect(result!.drawn.length).toBe(1);
    // Planets and gas giants get their field from the Web Worker (D-12); point clouds need none.
    if (kind !== 'nebula' && kind !== 'nova') expect(workers).toBeGreaterThan(0);

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
  });
}

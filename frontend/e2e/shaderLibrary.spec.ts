// Issue #39 WP2: the shared TSL shader library compiles and draws on the WebGL2 fallback
// (headless SwiftShader) through the dev-only /shaderlab.html harness.
import { expect, test, type Page } from '@playwright/test';

interface Lab {
  ready: boolean;
  error?: string;
  tiles: { name: string; cx: number; cy: number; r: number }[];
}

async function load(page: Page, seed: number, t: number, errors: string[]) {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/shaderlab.html?seed=${seed}&t=${t}`);
  await page.waitForFunction(() => '__shaderlab' in globalThis, undefined, { timeout: 60_000 });
  const lab = (await page.evaluate(
    () => (globalThis as unknown as { __shaderlab: Lab }).__shaderlab,
  ))!;
  expect(lab.error).toBeUndefined();
  expect(lab.ready).toBe(true);
  const shots = new Map<string, Buffer>();
  for (const tile of lab.tiles) {
    const d = Math.floor(tile.r * 0.5);
    shots.set(
      tile.name,
      await page.screenshot({
        clip: { x: tile.cx - d, y: tile.cy - d, width: 2 * d, height: 2 * d },
      }),
    );
  }
  return { lab, shots };
}

test('library tiles compile, are not blank, and are deterministic per seed', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const a = await load(page, 7, 0, errors);
  expect(errors).toEqual([]);
  expect(a.lab.tiles.length).toBeGreaterThanOrEqual(6);

  // Not blank: each tile's PNG is far larger than a flat colour's.
  const sizes = [...a.shots.values()].map((b) => b.length);
  const minSize = Math.min(...sizes);
  expect(minSize).toBeGreaterThan(1500);

  const page2 = await (await browser.newContext()).newPage();
  const b = await load(page2, 7, 0, errors);
  for (const [name, buf] of a.shots) expect(b.shots.get(name)!.equals(buf), name).toBe(true);

  const page3 = await (await browser.newContext()).newPage();
  const c = await load(page3, 8, 0, errors);
  for (const name of ['fbm', 'ridged', 'domainWarp', 'animatedCells'])
    expect(c.shots.get(name)!.equals(a.shots.get(name)!), name).toBe(false);
  expect(errors).toEqual([]);
});

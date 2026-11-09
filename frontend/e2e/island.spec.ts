// Issue #66 on the SYNTHETIC fixtures: the rail in the mock-up's style (its own icons, a highlight
// that slides to the hovered tool) and the island at the top centre: a circle at rest, "Thinking"
// while the object is found, then it grows into the object panel where it sits today, and goes back
// up when the panel is closed.
import { expect, test, type Page } from '@playwright/test';

async function search(page: Page, text: string) {
  const input = page.getByTestId('search-input');
  await input.fill(text);
  await input.press('Enter');
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
const box = async (page: Page, testId: string): Promise<Box> =>
  (await page.getByTestId(testId).boundingBox())!;

/** Holds the frames reply, so the island has time to think. */
async function slowFrames(page: Page, ms: number) {
  await page.route('**/v1/objects/*/frames', async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.fallback();
  });
}

test('at rest the island is a circle at the top centre, over the header, taking no clicks', async ({
  page,
}) => {
  await page.goto('/');
  const island = page.getByTestId('island');
  await expect(island).toHaveAttribute('data-mode', 'idle');
  const b = await box(page, 'island');
  const bezel = (await page.locator('.sx-bezel').boundingBox())!;
  expect(b.width).toBe(52);
  expect(b.height).toBe(52);
  expect(Math.abs(b.x + b.width / 2 - (bezel.x + bezel.width / 2))).toBeLessThan(1.5);
  expect(b.y - bezel.y).toBeLessThan(12);
  // Decorative: a click through it reaches what is under it.
  await expect(island).toHaveCSS('pointer-events', 'none');
  // Still: nothing for a screen reader at rest.
  await expect(page.getByRole('status').filter({ hasText: 'Thinking' })).toHaveCount(0);
});

test('the rail draws the mock-up icons and its highlight slides to the hovered tool', async ({
  page,
}) => {
  await page.goto('/');
  for (const id of ['sky', 'flipbook', 'spectrum', 'viewer'])
    await expect(page.getByTestId(`tool-${id}`).locator('svg.ai-draw')).toHaveCount(1);
  const hl = page.locator('.sx-hl');
  // At rest the highlight is behind the active tool (Sky).
  await expect(hl).toHaveCSS('opacity', '1');
  const near = async (testId: string) => {
    const t = await box(page, testId);
    await expect
      .poll(async () => {
        const h = (await hl.boundingBox())!;
        return Math.max(Math.abs(h.x - t.x), Math.abs(h.y - t.y));
      })
      .toBeLessThan(2);
  };
  await near('tool-sky');
  await page.getByTestId('tool-spectrum').hover();
  await near('tool-spectrum');
  await page.getByTestId('tool-viewer').hover();
  await near('tool-viewer');
  // Off the rail it goes back to the active tool.
  await page.mouse.move(700, 400);
  await near('tool-sky');
});

test('a search: Thinking, then the island grows into the panel; close sends it back up', async ({
  page,
}) => {
  await slowFrames(page, 2000);
  await page.goto('/');
  const island = page.getByTestId('island');
  const idle = await box(page, 'island');
  await search(page, 'Epsilon Indi B');

  // Thinking: a pill with the loading sentence (what the panel's loading box used to say).
  await expect(island).toHaveAttribute('data-mode', 'thinking');
  await expect(page.getByRole('status').filter({ hasText: 'Thinking' })).toBeVisible();
  await expect(page.getByTestId('loading')).toContainText(
    'Searching the archive for SPHEREx frames at RA',
  );
  await expect(page.getByTestId('object-panel')).toHaveCount(0);
  // The circle widens by a transition, so wait for it rather than read the first frame.
  await expect.poll(async () => (await box(page, 'island')).width).toBeGreaterThan(idle.width);
  const pill = await box(page, 'island');
  expect(Math.abs(pill.y - idle.y)).toBeLessThan(1.5);

  // Done: the island moves to where the panel is, then the panel shows over it.
  await expect(island).toHaveAttribute('data-mode', 'panel', { timeout: 15_000 });
  const panel = page.getByTestId('object-panel');
  await expect(panel).toBeVisible();
  await expect(island).toHaveAttribute('data-arrived', '');
  await expect(page.getByTestId('frame-counter')).toHaveText('Frame 1 of 24');
  // The panel may still settle (a picture loads and it resizes), and the island follows it.
  await expect
    .poll(async () => {
      const p = await box(page, 'object-panel');
      const i = await box(page, 'island');
      return Math.max(
        ...(['x', 'y', 'width', 'height'] as const).map((k) => Math.abs(i[k] - p[k])),
      );
    })
    .toBeLessThan(2);
  await expect(page.getByTestId('loading')).toHaveCount(0);

  // Close: the island goes back to the top centre and is the circle again.
  await page.getByRole('button', { name: /^Close Flipbook/ }).click();
  await expect(panel).toHaveCount(0);
  await expect(island).toHaveAttribute('data-mode', 'idle');
  await expect
    .poll(async () => {
      const b = await box(page, 'island');
      return Math.max(
        Math.abs(b.x - idle.x),
        Math.abs(b.y - idle.y),
        Math.abs(b.width - idle.width),
        Math.abs(b.height - idle.height),
      );
    })
    .toBeLessThan(2);
  await expect(island).not.toHaveAttribute('data-arrived', '');
});

test('reduced motion: the panel shows at once, no travel', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await search(page, 'Epsilon Indi B');
  await expect(page.getByTestId('frame-counter')).toHaveText('Frame 1 of 24');
  await expect(page.getByTestId('object-panel')).toBeVisible();
  await expect(page.getByTestId('island')).toHaveAttribute('data-arrived', '');
});

test('a failed search opens the panel too, so the error and Try again show', async ({ page }) => {
  await page.goto('/');
  await search(page, 'Nonexistent Object 12345');
  await expect(page.getByTestId('island')).toHaveAttribute('data-mode', 'panel');
  await expect(page.getByTestId('object-panel')).toBeVisible();
  await expect(page.getByRole('alert')).toBeVisible();
  await page
    .getByRole('button', { name: /^Close/ })
    .first()
    .click();
  await expect(page.getByTestId('island')).toHaveAttribute('data-mode', 'idle');
});

test('phone width: no circle over the header text; Thinking shows over the sky, then the sheet opens', async ({
  page,
}) => {
  await slowFrames(page, 1500);
  await page.setViewportSize({ width: 400, height: 860 });
  await page.goto('/');
  const island = page.getByTestId('island');
  // At rest it is not shown (the header is full), so it covers nothing.
  await expect(island).toHaveCSS('opacity', '0');
  await search(page, 'Epsilon Indi B');
  await expect(island).toHaveAttribute('data-mode', 'thinking');
  await expect(island).toHaveCSS('opacity', '1');
  const view = (await page.locator('.sx-view').boundingBox())!;
  const pill = await box(page, 'island');
  expect(pill.y).toBeGreaterThanOrEqual(view.y);
  expect(pill.x).toBeGreaterThanOrEqual(0);
  expect(pill.x + pill.width).toBeLessThanOrEqual(400);
  await expect(page.getByTestId('object-panel')).toBeVisible({ timeout: 15_000 });
  await expect(island).toHaveAttribute('data-arrived', '');
});

test('Escape while it thinks leaves the tool; the loader is not announced', async ({ page }) => {
  await slowFrames(page, 2000);
  await page.goto('/');
  // At rest the island says nothing to a screen reader (Q-121).
  await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0);
  await search(page, 'Epsilon Indi B');
  await expect(page.getByTestId('island')).toHaveAttribute('data-mode', 'thinking');
  await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tool-sky')).toHaveAttribute('aria-pressed', 'true');
});

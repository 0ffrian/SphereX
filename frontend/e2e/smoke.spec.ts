import { expect, test } from '@playwright/test';

test('app loads: header, viewer canvas, renderer status, no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  // The sky view is the main pane; the 3D viewer is the build pane, opened here by the link's
  // `build` hash (the dock has no 3D viewer button since the D-38 redesign).
  await page.goto('/#build');
  await expect(page.getByRole('heading', { level: 1, name: 'Shift & Spectrum' })).toBeAttached();
  await expect(page.getByTestId('sky-canvas')).toHaveCount(1);
  const viewer = page.getByRole('region', { name: '3D view', exact: true });
  const canvas = viewer.locator('canvas[aria-label]');
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toHaveAttribute('aria-label', /Viewer placeholder: no object loaded/);
  await expect(
    viewer.getByText('Viewer placeholder: no object loaded', { exact: true }),
  ).toBeVisible();

  // Wait until the renderer has finished init() one way or the other.
  const status = page.getByTestId('renderer-status');
  await expect(status).not.toHaveAttribute('data-status', 'starting', { timeout: 20_000 });
  const backend = await status.getAttribute('data-status');
  test.info().annotations.push({ type: 'renderer-backend', description: backend ?? 'unknown' });
  console.log(`renderer backend in headless Chromium: ${backend}`);

  // On-screen zoom buttons exist (WCAG 2.5.7) and work when a backend is up. (The rotate buttons
  // went with Details in the redesign; drag and the arrow keys still rotate.)
  const zoomIn = page.getByRole('button', { name: /^Zoom in/ });
  await expect(zoomIn).toBeVisible();
  if (backend !== 'unavailable') {
    // Render-on-change (R5.5): a zoom must produce a new frame, so the canvas pixels change.
    const before = await canvas.screenshot();
    await zoomIn.click();
    const changed = async () => !(await canvas.screenshot()).equals(before);
    await expect.poll(changed, { timeout: 5_000 }).toBe(true);
  }

  expect(errors, errors.join('\n')).toEqual([]);
});

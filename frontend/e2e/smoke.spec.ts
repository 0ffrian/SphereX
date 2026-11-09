import { expect, test } from '@playwright/test';

test('app loads: header, viewer canvas, renderer status, no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: 'Shift & Spectrum' })).toBeAttached();

  // The sky view is the main pane; the 3D viewer opens from the tool rail (shell layout).
  await expect(page.getByTestId('sky-canvas')).toHaveCount(1);
  await page
    .getByRole('navigation', { name: 'Tools' })
    .getByRole('button', { name: '3D viewer' })
    .click();
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

  // On-screen rotate buttons exist (WCAG 2.5.7) and work when a backend is up. In the build pane
  // (issue #60) they sit under Details, so the stage stays clear at first sight.
  await viewer.getByTestId('viewer-details-toggle').click();
  const rotateLeft = viewer.getByRole('button', { name: 'Rotate left' });
  await expect(rotateLeft).toBeVisible();
  if (backend !== 'unavailable') {
    // Render-on-change (R5.5): a zoom must produce a new frame, so the canvas pixels change.
    const before = await canvas.screenshot();
    await viewer.getByRole('button', { name: 'Zoom in' }).click();
    const changed = async () => !(await canvas.screenshot()).equals(before);
    await expect.poll(changed, { timeout: 5_000 }).toBe(true);

    await rotateLeft.click();
    await viewer.getByRole('button', { name: 'Reset view' }).click();
  }

  expect(errors, errors.join('\n')).toEqual([]);
});

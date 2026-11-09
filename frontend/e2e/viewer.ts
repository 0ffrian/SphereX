// Shared steps for e2e tests that draw in the 3D viewer. In the shell layout the sky view is the main
// pane and the 3D view is the build pane (issue #60) that the tool rail's 3D viewer opens, with the
// body built at once (no animation); the sky canvas also has an aria-label, so viewer canvas lookups
// are scoped to the build pane.
import type { Locator, Page } from '@playwright/test';

/** Canvas size of the committed reference pictures (the old 4:3 viewer card at 1280×720). */
export const REFERENCE_CANVAS = { width: 574, height: 430 } as const;

/** Loads the app and opens the 3D view (the build pane) from the shell's tool rail. */
export async function openViewer(page: Page): Promise<void> {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Tools' })
    .getByRole('button', { name: '3D viewer' })
    .click();
  // Off the rail, so its hover tooltip is not over the canvas in the reference screenshots.
  await page.mouse.move(0, 0);
  // The build pane's stage fills half the view; the reference pictures (goldens, shader kinds,
  // determinism) were taken at one canvas size, so the stage is pinned to it here. Test harness
  // only: what is drawn does not change, only the canvas size.
  await page.addStyleTag({
    content: `[data-testid="viewer-stage"] { flex: none !important; width: ${REFERENCE_CANVAS.width}px !important; height: ${REFERENCE_CANVAS.height}px !important; min-height: 0 !important; }`,
  });
  await page.getByTestId('build-pane').waitFor();
}

/** The viewer's canvas (not the sky canvas behind it). */
export function viewerCanvas(page: Page): Locator {
  return page.getByTestId('build-pane').locator('canvas[aria-label]');
}

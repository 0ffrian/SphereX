// Shared steps for e2e tests that draw in the 3D viewer. In the shell layout the sky view is the main
// pane and the viewer is a panel opened from the tool rail; the sky canvas also has an aria-label, so
// viewer canvas lookups are scoped to the viewer card.
import type { Locator, Page } from '@playwright/test';

/** Loads the app and opens the 3D viewer panel from the shell's tool rail. */
export async function openViewer(page: Page): Promise<void> {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Tools' })
    .getByRole('button', { name: '3D viewer' })
    .click();
  // Off the rail, so its hover tooltip is not over the canvas in the reference screenshots.
  await page.mouse.move(0, 0);
}

/** The viewer's canvas (not the sky canvas behind it). */
export function viewerCanvas(page: Page): Locator {
  return page.getByTestId('viewer-card').locator('canvas[aria-label]');
}

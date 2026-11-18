// Shared steps for e2e tests that draw in the 3D viewer. In the shell layout the sky view is the main
// pane and the 3D view is the build pane (issue #60). The dock has no 3D viewer button since the D-38
// redesign, so the pane is opened by the link's `build` hash, which shows the body built at once (no animation); the sky canvas also has an aria-label, so viewer canvas lookups
// are scoped to the build pane.
import type { Locator, Page } from '@playwright/test';

/** Canvas size of the committed reference pictures (the old 4:3 viewer card at 1280×720). */
export const REFERENCE_CANVAS = { width: 574, height: 430 } as const;

/** Loads the app and opens the 3D view (the build pane) through the `#build` link. */
export async function openViewer(page: Page): Promise<void> {
  await page.goto('/#build');
  // Off the dock, so a hover tooltip is not over the canvas in the reference screenshots.
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

/**
 * The DOM text that sits on the viewer's canvas box in a reference picture: the sr-only name label
 * (a visible label before the D-38 redesign) and the build pane's title and subtitle, which are drawn
 * over the top left of the stage ("3D view / No object loaded" here). Reference screenshots mask them,
 * so a picture compares the body, not the pane's copy or the rasteriser's text.
 */
export function overlayMasks(page: Page): Locator[] {
  return [
    page.getByTestId('viewer-label'),
    page.getByTestId('build-title'),
    page.getByTestId('build-subtitle'),
  ];
}

/** The honesty states of D-21 (the level the viewer and the sky show). */
export type HonestyLevel = 'measured' | 'derived' | 'artistic';

interface HonestyStore {
  useAppStore: { getState(): { honesty: string; setHonesty(h: string): void } };
}

/**
 * Sets the honesty level (D-21). The build pane has no Show control since the redesign (Q-329), so
 * the specs set it on the store the app uses, through the dev server's module URL (the same module
 * instance as the app's), the way a link or another control would.
 */
export async function setHonestyLevel(page: Page, level: HonestyLevel): Promise<void> {
  await page.evaluate(async (h) => {
    const url = '/src/state/store.ts';
    const m = (await import(/* @vite-ignore */ url)) as HonestyStore;
    m.useAppStore.getState().setHonesty(h);
  }, level);
}

/** The current honesty level. */
export function honestyLevel(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const url = '/src/state/store.ts';
    const m = (await import(/* @vite-ignore */ url)) as HonestyStore;
    return m.useAppStore.getState().honesty;
  });
}

// Helpers for the redesigned Flipbook card (D-38): the "More" row (closed at first) with its
// Overlays | About | Combine tabs. A closed row is inert, so a spec opens the row and the tab first.
import { expect, type Page } from '@playwright/test';

export type MoreTab = 'overlays' | 'about' | 'combine';

/** Opens the "More" row and the given tab (a no-op for whatever is already open). */
export async function openMore(page: Page, tab: MoreTab): Promise<void> {
  const row = page.getByTestId('more-row').getByRole('button', { name: /^More/ });
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click();
  const t = page.getByTestId(`more-tab-${tab}`);
  if ((await t.getAttribute('aria-selected')) !== 'true') await t.click();
  await expect(t).toHaveAttribute('aria-selected', 'true');
}

/**
 * Sets the playback speed (1, 2, 4 or 8 frames a second). The player has no speed control any more
 * (the D-38 redesign dropped it), so the specs that need a fast loop set it on the store the app
 * uses, through the dev server's module URL (the same module instance as the app's).
 */
export async function setFps(page: Page, fps: 1 | 2 | 4 | 8): Promise<void> {
  await page.evaluate(async (n) => {
    const url = '/src/state/store.ts';
    const m = (await import(/* @vite-ignore */ url)) as {
      useAppStore: { getState(): { skySetFps(f: number): void } };
    };
    m.useAppStore.getState().skySetFps(n);
  }, fps);
}

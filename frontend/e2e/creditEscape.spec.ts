// A21.10 on the SYNTHETIC fixtures: the sky credit popover takes Escape in the capture phase (one
// press closes it and nothing else), but never from a text field, and never while it is not drawn:
// the build pane's split view hides the credit, so opening the pane closes the popover and the
// pane's first Escape closes the pane. PR #165 review (round 1).
import { expect, test, type Page } from '@playwright/test';

async function skyReady(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('sky-pane')).toHaveAttribute('data-sky-state', /ready|no-image/, {
    timeout: 30_000,
  });
  await page.waitForFunction(() => '__sxSky' in globalThis);
}

test('the build pane opened from the keyboard with the popover open: one Escape closes the pane', async ({
  page,
}) => {
  await skyReady(page);
  await page.evaluate(() =>
    (globalThis as unknown as { __sxSky: { setView(v: object): void } }).__sxSky.setView({
      ra: 38,
      dec: -12,
      fovDeg: 30,
    }),
  );
  const marker = page.locator('[data-testid="sky-cached-marker"][data-object-id="aqua-prime"]');
  await expect(marker).toBeVisible({ timeout: 15_000 });
  await marker.click({ button: 'right' });
  await expect(page.getByTestId('build-it')).toBeVisible();
  await page.getByTestId('sky-credit-button').click();
  const box = page.getByTestId('sky-credit-box');
  await expect(box).toBeVisible();
  // Enter on "Build it": no pointer press, so nothing outside the popover closes it.
  await page.getByTestId('build-it').focus();
  await page.keyboard.press('Enter');
  const pane = page.getByTestId('build-pane');
  await expect(pane).toBeVisible();
  await expect(page.getByTestId('build-title')).toBeFocused();
  // The split hides the credit: the popover is closed with it.
  await expect(box).toBeHidden();
  await expect(page.getByTestId('sky-credit-button')).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Escape');
  await expect(pane).toHaveCount(0);
});

test('Escape in the search field with the popover open: the field keeps it and its focus', async ({
  page,
}) => {
  await skyReady(page);
  await page.getByTestId('sky-credit-button').click();
  const box = page.getByTestId('sky-credit-box');
  await expect(box).toBeVisible();
  // "/" focuses the search; typing opens its list.
  await page.keyboard.press('/');
  const input = page.getByTestId('search-input');
  await expect(input).toBeFocused();
  await input.pressSequentially('Er');
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  // As before the capture-phase listener: the list closes and focus stays in the field.
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('Er');
  await expect(box).toBeVisible();
});

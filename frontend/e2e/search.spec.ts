// Issue #68, 7a/7d: the demo search list. Runs on the fixtures dev server (recorded replies), so
// no backend is needed. The offline-pack case (SX_OFFLINE, X-SX-Asset-Status: saved) belongs to
// the pre-built demo pack (Track F).
import { expect, test } from '@playwright/test';

test('typing "HD 189733b" and pressing Enter flies the sky there', async ({ page }) => {
  await page.goto('/');
  const input = page.getByTestId('search-input');
  await input.fill('HD 189733b');
  await input.press('Enter');
  await expect.poll(() => new URL(page.url()).hash).toMatch(/^#ra=300\.18\d*&dec=22\.71\d*/);
  // The sky centre readout says the same position.
  await expect(page.getByTestId('readout-ra')).toHaveText(/^300\.18\d*°$/, { timeout: 15_000 });
  await expect(page.getByTestId('readout-dec')).toHaveText(/^\+22\.71\d*°$/);
});

test('picking "Barnard\'s Star" from the list flies there and opens the panel', async ({
  page,
}) => {
  await page.goto('/');
  const input = page.getByTestId('search-input');
  await input.focus();
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('search-list').getByRole('option')).toHaveCount(16);
  await input.pressSequentially('barnard');
  await expect(page.getByTestId('search-list').getByRole('option')).toHaveCount(1);
  await page.getByRole('option', { name: "Barnard's Star" }).click();
  await expect(page.getByTestId('search-list').getByRole('listbox')).toHaveCount(0);
  await expect(input).toHaveValue("Barnard's Star");
  await expect(input).toBeFocused();
  await expect.poll(() => new URL(page.url()).hash).toMatch(/^#ra=269\.45\d*&dec=4\.69\d*/);
  await expect(page.getByTestId('frame-counter')).toHaveText('Frame 1 of 24');
  await expect(page.getByTestId('frame-counter')).toBeVisible();
});

test.describe('phone width (400 x 860, touch)', () => {
  test.use({ viewport: { width: 400, height: 860 }, hasTouch: true, isMobile: true });

  test('the list opens above the pill without moving it; rows are 44 px; it scrolls', async ({
    page,
  }) => {
    await page.goto('/');
    const input = page.getByTestId('search-input');
    const before = await input.boundingBox();
    await input.tap();
    await expect(page.getByTestId('search-list').getByRole('option')).toHaveCount(16);
    const after = await input.boundingBox();
    expect(after).toEqual(before);
    const list = await page.getByTestId('search-list').getByRole('listbox').boundingBox();
    expect(list!.y + list!.height).toBeLessThanOrEqual(after!.y + 1);
    const row = await page.getByTestId('search-list').getByRole('option').first().boundingBox();
    expect(row!.height).toBeGreaterThanOrEqual(44);
    const scrolls = await page
      .getByRole('listbox')
      .evaluate(
        (el) =>
          (el as unknown as { scrollHeight: number; clientHeight: number }).scrollHeight >
          (el as unknown as { clientHeight: number }).clientHeight,
      );
    expect(scrolls).toBe(true);
  });
});

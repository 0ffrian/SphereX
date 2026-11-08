// Phone bottom sheet (390 px, touch): the first tap in the sheet right after a search lands where
// it was aimed. The search help shows while the field has focus; it used to take a row in the
// layout, so the tap that blurred the field hid it and moved the sheet by its height. Also: the
// sheet sits on top of the sky credit (D-35) and Stop is in view without scrolling.
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('the first tap in the sheet after a search hits its target', async ({ page }) => {
  await page.goto('/');
  const input = page.getByTestId('search-input');
  await input.fill('Synthetic progressive');
  await input.press('Enter');
  const headline = page.getByTestId('frames-progress-headline');
  await expect(headline).toContainText('Fetching SPHEREx frames');
  await expect(input).toBeFocused();

  const sheet = page.getByTestId('object-panel');
  const before = await sheet.boundingBox();
  const stop = page.getByTestId('frames-stop');
  const target = await stop.boundingBox();
  // Stop is visible in the sheet without scrolling, above the credit strip.
  const credit = await page.getByTestId('sky-credit-box').boundingBox();
  expect(target!.y + target!.height).toBeLessThanOrEqual(credit!.y);
  expect(before!.y + before!.height).toBeLessThanOrEqual(credit!.y + 1);

  // Blurring the field (what the first tap does) moves nothing.
  await input.evaluate((el: { blur(): void }) => el.blur());
  const after = await sheet.boundingBox();
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(1);
  expect(Math.abs((await stop.boundingBox())!.y - target!.y)).toBeLessThan(1);

  // And a real tap at the spot aimed at while the field had focus works.
  await input.focus();
  await page.touchscreen.tap(target!.x + target!.width / 2, target!.y + target!.height / 2);
  await expect(headline).toHaveText(/^Stopped\./);
});

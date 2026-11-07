// The flipbook draws every frame of an object on one fixed grid (app/flipbook/frameGrid.ts), so
// the picture box, the object ring and the lines below never move between frames of different
// sizes. Barnard's Star in the SYNTHETIC fixtures cycles 64×64, 63×64, 64×63, 63×63 px cutouts
// and frame 2 is clipped at a detector edge (64×40, object near the top).
import { expect, test, type Locator, type Page } from '@playwright/test';

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('not visible');
  return b;
}

async function cutoutLoaded(page: Page) {
  await expect
    .poll(() =>
      page.getByTestId('cutout').evaluate((el: { naturalWidth: number }) => el.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(page.getByTestId('object-ring')).toBeVisible();
}

for (const tint of [false, true]) {
  test(`frames of different sizes keep one box, scale and ring spot${tint ? ' (tint)' : ''}`, async ({
    page,
  }) => {
    await page.goto('/');
    const input = page.getByTestId('search-input');
    await input.fill("Barnard's Star");
    await input.press('Enter');
    const counter = page.getByTestId('frame-counter');
    await expect(counter).toHaveText('Frame 1 of 24');
    if (tint) {
      await page
        .getByRole('radiogroup', { name: 'Picture' })
        .getByRole('radio', { name: 'Colour' })
        .click();
      await expect(page.getByTestId('tint-overlay')).toBeVisible();
    }
    await cutoutLoaded(page);
    const viewer = page.getByTestId('frame-viewer');
    await expect(viewer).toHaveAttribute('data-grid', '65');

    // Focus first: it may scroll the panel, which is not a layout change.
    await viewer.focus();
    const first = {
      viewer: await box(viewer),
      ring: await box(page.getByTestId('object-ring')),
      below: await box(page.getByTestId('preload-progress')),
    };
    // Inside the 1 px border.
    const pxPerSource = (await viewer.evaluate((el) => el.clientWidth)) / 65;
    const sizes = new Set<string>();
    for (let k = 0; k < 7; k++) {
      if (k > 0) {
        await page.keyboard.press('ArrowRight');
        await expect(counter).toHaveText(`Frame ${k + 1} of 24`);
      }
      await cutoutLoaded(page);
      const place = await box(page.getByTestId('frame-place'));
      // Constant scale: the drawn frame is its own size in source pixels × one factor.
      const natural = await page
        .getByTestId('cutout')
        .evaluate((el: { naturalWidth: number; naturalHeight: number }) => [
          el.naturalWidth,
          el.naturalHeight,
        ]);
      sizes.add(natural.join('x'));
      expect(place.width).toBeCloseTo(natural[0]! * pxPerSource, 0);
      expect(place.height).toBeCloseTo(natural[1]! * pxPerSource, 0);
      if (tint) {
        const overlay = await box(page.getByTestId('tint-overlay'));
        expect(overlay).toEqual(place);
      }
      // The box, the ring and the line below stay put.
      expect(await box(viewer)).toEqual(first.viewer);
      expect(await box(page.getByTestId('object-ring'))).toEqual(first.ring);
      expect((await box(page.getByTestId('preload-progress'))).y).toBe(first.below.y);
    }
    // The steps covered every size, including the clipped frame.
    expect([...sizes].sort()).toEqual(['63x63', '63x64', '64x40', '64x63', '64x64']);
  });
}

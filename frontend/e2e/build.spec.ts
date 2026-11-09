// Issue #60 on the SYNTHETIC fixtures: select a body on the sky (brackets and the top-centre card),
// asked for with a right-click (issue #64: a left click opens the object, as the sky view does),
// Build it (the split view moulds it step by step), and close it again (Escape, ×, Back). The
// final frame of a build is the normal render of the same plan and seed: compared by SSIM with the
// body opened from the rail's 3D viewer (built at once) at the same honesty level and pose.
// "Aqua Prime" is the fixture water planet (fixtures/targets.ts): the shared planet_water card.
import { expect, test, type Page } from '@playwright/test';
import { GOLDEN_MAX_COLOUR_DELTA, GOLDEN_MIN_CHANNEL_SSIM, GOLDEN_MIN_SSIM } from './golden';
import { scoreFrames, type Rgb } from './ssim';

async function skyReady(page: Page): Promise<void> {
  await expect(page.getByTestId('sky-pane')).toHaveAttribute('data-sky-state', /ready|no-image/, {
    timeout: 30_000,
  });
  await page.waitForFunction(() => '__sxSky' in globalThis);
}

/** Looks at Aqua Prime and right-clicks its marker (selects it and shows its card). */
async function selectAquaPrime(page: Page): Promise<void> {
  await page.goto('/');
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
}

async function setHonesty(page: Page, label: RegExp): Promise<void> {
  await page
    .getByRole('group', { name: 'Honesty level' })
    .getByRole('button', { name: label })
    .click();
}

test('a left click on a marker opens it (#49); brackets, but no card', async ({ page }) => {
  await page.goto('/');
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
  await marker.click();
  await expect(page.getByTestId('object-name')).toHaveText('Aqua Prime');
  await expect(page.getByTestId('sky-selected-name')).toHaveText('Aqua Prime');
  await expect(page.getByTestId('selected-card')).toHaveCount(0);
  // Closing the panel shows the sky, not the card.
  await page
    .getByTestId('object-panel')
    .getByRole('button', { name: /^Close/ })
    .click();
  await expect(page.getByTestId('object-panel')).toHaveCount(0);
  await expect(page.getByTestId('sky-selected')).toBeAttached();
  await expect(page.getByTestId('selected-card')).toHaveCount(0);
});

test('a right-click selects: brackets, name and the card; no flipbook', async ({ page }) => {
  await selectAquaPrime(page);
  await expect(page.getByTestId('sky-selected')).toBeAttached();
  await expect(page.getByTestId('sky-selected-name')).toHaveText('Aqua Prime');
  const card = page.getByTestId('selected-card');
  await expect(card.getByTestId('selected-name')).toHaveText('Aqua Prime');
  await expect(card.getByTestId('selected-type')).toHaveText('Water planet');
  await expect(card.getByRole('button', { name: 'See fingerprint' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Build it' })).toBeVisible();
  await expect(page.getByTestId('object-panel')).toHaveCount(0);
  // Escape right after the right-click deselects: the card, the brackets
  // and the object in the link go, and focus stays on the marker.
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId('sky-selected')).toHaveCount(0);
  expect(new URL(page.url()).hash).not.toContain('aqua');
  await expect(
    page.locator('[data-testid="sky-cached-marker"][data-object-id="aqua-prime"]'),
  ).toBeFocused();
});

test('a long press (contextmenu from touch) asks for the card; a left click still opens', async ({
  page,
}) => {
  await selectAquaPrime(page);
  const card = page.getByTestId('selected-card');
  await expect(card).toBeVisible();
  const marker = page.locator('[data-testid="sky-cached-marker"][data-object-id="aqua-prime"]');
  // After the earlier right-click, a left click opens the object panel and drops the card.
  await marker.click();
  await expect(page.getByTestId('object-panel')).toBeVisible();
  await expect(card).toHaveCount(0);
  await page
    .getByTestId('object-panel')
    .getByRole('button', { name: /^Close/ })
    .click();
  await expect(page.getByTestId('object-panel')).toHaveCount(0);
  // A long press on a phone is the browser's contextmenu event on the marker.
  await marker.dispatchEvent('contextmenu', { button: 2 });
  await expect(card).toBeVisible();
});

test('x deselects, and right-clicking the same marker again brings the card back', async ({
  page,
}) => {
  await selectAquaPrime(page);
  const card = page.getByTestId('selected-card');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Close Aqua Prime' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId('sky-selected')).toHaveCount(0);
  const marker = page.locator('[data-testid="sky-cached-marker"][data-object-id="aqua-prime"]');
  await expect(marker).toBeFocused();
  await marker.click({ button: 'right' });
  await expect(card).toBeVisible();
  await expect(card.getByTestId('selected-name')).toHaveText('Aqua Prime');
  await expect(page.getByTestId('sky-selected')).toBeAttached();
});

/** Records, for the next contextmenu events, whether the page cancelled the browser's menu. */
async function watchContextMenu(page: Page): Promise<void> {
  // A plain string: the e2e tsconfig has no DOM lib. On the document, so it runs after the page's
  // own handler on the way up and sees whether the browser menu was cancelled.
  await page.evaluate(`(() => {
    window.__cm = [];
    document.addEventListener('contextmenu', (e) => window.__cm.push(e.defaultPrevented));
  })()`);
}
const contextMenus = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __cm: boolean[] }).__cm);

async function rightClickBrackets(page: Page, testId: string): Promise<void> {
  const ring = page.getByTestId(testId).locator('.sx-marker-ring');
  const b = (await ring.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
}

test('right-click on the brackets brings the card back, without the browser menu', async ({
  page,
}) => {
  await selectAquaPrime(page);
  await watchContextMenu(page);
  const card = page.getByTestId('selected-card');
  // The card steps aside (See fingerprint opens the object panel); the brackets stay.
  await page.getByRole('button', { name: 'See fingerprint' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId('sky-selected')).toBeAttached();
  await rightClickBrackets(page, 'sky-selected');
  await expect(card).toBeVisible();
  await expect(card.getByTestId('selected-name')).toHaveText('Aqua Prime');
  expect(await contextMenus(page)).toEqual([true]);
  // Build it from that card opens the pane.
  await card.getByRole('button', { name: 'Build it' }).click();
  await expect(page.getByTestId('build-pane')).toBeVisible();
});

test('right-click on a fresh marker selects it and opens its card', async ({ page }) => {
  await page.goto('/');
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
  await watchContextMenu(page);
  await marker.click({ button: 'right' });
  const card = page.getByTestId('selected-card');
  await expect(card.getByTestId('selected-name')).toHaveText('Aqua Prime');
  await expect(page.getByTestId('sky-selected')).toBeAttached();
  expect(await contextMenus(page)).toEqual([true]);
  // The keyboard way: the ContextMenu key on a focused marker does the same.
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await marker.focus();
  await page.keyboard.press('ContextMenu');
  await expect(card).toBeVisible();
});

test('right-click on a picked position: a card with no 3D model, fingerprint still works', async ({
  page,
}) => {
  await page.goto('/');
  await skyReady(page);
  await page.evaluate(() =>
    (globalThis as unknown as { __sxSky: { setView(v: object): void } }).__sxSky.setView({
      ra: 100,
      dec: 20,
      fovDeg: 30,
    }),
  );
  await watchContextMenu(page);
  const sky = (await page.getByTestId('sky-canvas').boundingBox())!;
  // A left click on empty sky picks the position (and opens the flipbook, as before).
  await page.mouse.click(sky.x + sky.width / 2, sky.y + sky.height / 2);
  await expect(page.getByTestId('object-panel')).toBeVisible();
  await expect(page.getByTestId('selected-card')).toHaveCount(0);
  // The amber dashed picked bracket, or the green one once the position has resolved.
  const picked = page.getByTestId('sky-picked');
  const selected = page.getByTestId('sky-selected');
  await expect(picked.or(selected)).toBeAttached({ timeout: 15_000 });
  const which = (await picked.count()) > 0 ? 'sky-picked' : 'sky-selected';
  await rightClickBrackets(page, which);
  const card = page.getByTestId('selected-card');
  await expect(card).toBeVisible();
  await expect(card.getByTestId('selected-name')).toContainText('RA');
  await expect(card.getByTestId('selected-type')).toHaveText('No 3D model at this position');
  await expect(card.getByRole('button', { name: /Build it/ })).toBeDisabled();
  expect(await contextMenus(page)).toEqual([true]);
  await card.getByRole('button', { name: 'See fingerprint' }).click();
  await expect(page.getByTestId('tool-spectrum')).toHaveAttribute('aria-pressed', 'true');
  // Empty sky keeps the browser's own menu.
  await page.mouse.click(sky.x + 40, sky.y + 40, { button: 'right' });
  expect((await contextMenus(page)).at(-1)).toBe(false);
});

test('See fingerprint opens the object panel at the spectrum', async ({ page }) => {
  await selectAquaPrime(page);
  await page.getByRole('button', { name: 'See fingerprint' }).click();
  await expect(page.getByTestId('object-panel')).toBeVisible();
  await expect(page.getByTestId('tool-spectrum')).toHaveAttribute('aria-pressed', 'true');
});

test('Build it: split view, steps run to done, Escape and Back close it', async ({ page }) => {
  test.setTimeout(120_000);
  await selectAquaPrime(page);
  await page.getByTestId('build-it').click();
  const pane = page.getByTestId('build-pane');
  await expect(pane).toBeVisible();
  await expect(page.getByTestId('build-title')).toHaveText('Building Aqua Prime');
  await expect(page.getByTestId('build-title')).toBeFocused();
  expect(new URL(page.url()).hash).toContain('build');
  // The sky keeps the left half and stays live; the transport steps aside.
  const view = (await page.locator('main.sx-view').boundingBox())!;
  await expect
    .poll(async () => (await page.getByTestId('sky-pane').boundingBox())!.width)
    .toBeLessThan(view.width * 0.55);
  await expect(page.locator('.sx-transport-slot')).toHaveAttribute('inert', '');
  // The generated surface is an artist's impression: + Artistic shows it, Replay builds it.
  await setHonesty(page, /Artistic/);
  await page.getByTestId('build-replay').click();
  await expect(pane).toHaveAttribute('data-phase', 'building', { timeout: 60_000 });
  const steps = page.getByTestId('build-step');
  await expect(steps).toHaveText([/Base mould/, /Terrain/, /Oceans/, /Colour/, /Clouds/]);
  await expect(steps.first()).toHaveAttribute('data-state', /active|done/);
  await expect(pane).toHaveAttribute('data-phase', 'done', { timeout: 60_000 });
  for (const s of await steps.all()) await expect(s).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('build-announcer')).toHaveText('Built Aqua Prime');
  // Escape closes, focus back on the marker, hash without `build`.
  await page.keyboard.press('Escape');
  await expect(pane).toHaveCount(0);
  expect(new URL(page.url()).hash).not.toContain('build');
  // Back closes it too.
  await page.getByTestId('build-it').click();
  await expect(pane).toBeVisible();
  await page.goBack();
  await expect(pane).toHaveCount(0);
  await expect(page.getByTestId('search-input')).toHaveValue('Aqua Prime');
});

test('reduced motion: Build it shows the built body at once', async ({ page }) => {
  test.setTimeout(90_000); // a SwiftShader build: 31 s on a CI runner, over the 30 s default
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await selectAquaPrime(page);
  await page.getByTestId('build-it').click();
  const pane = page.getByTestId('build-pane');
  await expect(pane).toHaveAttribute('data-phase', 'done', { timeout: 30_000 });
  for (const s of await page.getByTestId('build-step').all())
    await expect(s).toHaveAttribute('data-state', 'done');
  // The × closes it.
  await page.getByTestId('build-close').click();
  await expect(pane).toHaveCount(0);
});

test('a marker without a 3D model: the pane says so, nothing is drawn', async ({ page }) => {
  await page.goto('/');
  await skyReady(page);
  await page.evaluate(() =>
    (globalThis as unknown as { __sxSky: { setView(v: object): void } }).__sxSky.setView({
      ra: 76.95653,
      dec: 30.40144,
      fovDeg: 30,
    }),
  );
  await page
    .getByRole('button', { name: 'RW Aurigae on the sky: open it' })
    .click({ button: 'right' });
  await page.getByTestId('build-it').click();
  await expect(page.getByTestId('build-message')).toContainText(
    'There is no 3D model of RW Aurigae to build.',
  );
  await expect(page.getByTestId('build-pane').locator('canvas')).toHaveCount(0);
});

test('Build it from a fresh load raises the level and builds all five steps (water planet)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await selectAquaPrime(page);
  const group = page.getByRole('group', { name: 'Honesty level' });
  await page.getByTestId('build-it').click();
  const pane = page.getByTestId('build-pane');
  // The default level is + Estimated, which hides the artistic world: the build raises it, says so.
  await expect(group.getByRole('button', { name: /Artistic/ })).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 30_000 },
  );
  await expect(page.getByTestId('viewer-announcer')).toHaveText(
    "Showing artist's impression so the whole body can be built",
  );
  // The level is visible in the header without opening Details, and Show stays reachable.
  await expect(page.getByTestId('build-level')).toContainText('Default');
  await expect(page.getByTestId('build-level')).toContainText('artist');
  const steps = page.getByTestId('build-step');
  await expect(steps).toHaveText([/Base mould/, /Terrain/, /Oceans/, /Colour/, /Clouds/], {
    timeout: 60_000,
  });
  await expect(pane).toHaveAttribute('data-phase', 'done', { timeout: 90_000 });
  for (const st of await steps.all()) await expect(st).toHaveAttribute('data-state', 'done');
  // Built: the title drops "Building", the announcer says Built.
  await expect(page.getByTestId('build-title')).toHaveText('Aqua Prime');
  await expect(page.getByTestId('build-announcer')).toHaveText('Built Aqua Prime');
  // The user can drop back at any time.
  await group.getByRole('button', { name: /Measured only/ }).click();
  await expect(group.getByRole('button', { name: /Measured only/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('build-level')).toContainText('Measured');
});

test('the level changed mid-build ends the build on the new plan', async ({ page }) => {
  test.setTimeout(120_000);
  await selectAquaPrime(page);
  await page.getByTestId('build-it').click();
  const pane = page.getByTestId('build-pane');
  await expect(pane).toHaveAttribute('data-phase', 'building', { timeout: 60_000 });
  await page
    .getByRole('group', { name: 'Honesty level' })
    .getByRole('button', { name: /Measured only/ })
    .click();
  // Not after the whole 11.5 s: it ends at once, ticked, on the Measured-only picture.
  await expect(pane).toHaveAttribute('data-phase', 'done', { timeout: 6_000 });
  for (const st of await page.getByTestId('build-step').all())
    await expect(st).toHaveAttribute('data-state', 'done');
  const drawn = await page.evaluate(
    () =>
      (globalThis as unknown as { __sxViewer: { body: { drawn: string[] } | null } }).__sxViewer
        .body?.drawn.length ?? 0,
  );
  // The artistic surface is hidden at Measured only: nothing of it is drawn.
  expect(drawn).toBe(0);
});

test('phone width: the sheet reaches the search bar and the sky under it is inert', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await selectAquaPrime(page);
  await page.getByTestId('build-it').click();
  const pane = page.getByTestId('build-pane');
  await expect(pane).toBeVisible({ timeout: 15_000 }); // the pane builds on a software GPU
  await expect(page.locator('.sx-sky-slot')).toHaveAttribute('inert', '');
  // The transport slot does not keep its space: the sheet ends just above the search bar.
  const sheet = (await pane.boundingBox())!;
  const search = (await page.locator('.sx-search-slot').boundingBox())!;
  expect(search.y - (sheet.y + sheet.height)).toBeLessThan(24);
  // × closes it and the sky is live again.
  await page.getByTestId('build-close').click();
  await expect(pane).toHaveCount(0);
  await expect(page.locator('.sx-sky-slot')).not.toHaveAttribute('inert', '');
});

test('Back returns focus to the marker; × leaves no extra Back step', async ({ page }) => {
  // Two builds on SwiftShader: about 20 s alone on CI, over the 30 s default under load.
  test.setTimeout(90_000);
  await selectAquaPrime(page);
  const marker = page.locator('[data-testid="sky-cached-marker"][data-object-id="aqua-prime"]');
  await page.getByTestId('build-it').click();
  await expect(page.getByTestId('build-pane')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('build-pane')).toHaveCount(0);
  await expect(marker).toBeFocused();
  // Open again and close with ×: Back must now leave the object, not reopen the pane.
  await page
    .getByTestId('build-it')
    .click()
    .catch(() => undefined);
  if ((await page.getByTestId('build-pane').count()) === 0) {
    await page.getByRole('button', { name: 'Build it in 3D' }).click();
  }
  await expect(page.getByTestId('build-pane')).toBeVisible();
  await page.getByTestId('build-close').click();
  await expect(page.getByTestId('build-pane')).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).hash).not.toContain('build');
  await page.goBack();
  await expect(page.getByTestId('build-pane')).toHaveCount(0);
});

/** Decodes a PNG in the page (no Node image library). */
async function decode(page: Page, png: Buffer): Promise<Rgb> {
  const out = (await page.evaluate(`(async () => {
    const img = new Image();
    img.src = 'data:image/png;base64,${png.toString('base64')}';
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let s = '';
    for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
    return { w: c.width, h: c.height, rgba: btoa(s) };
  })()`)) as { w: number; h: number; rgba: string };
  return { width: out.w, height: out.h, rgba: Uint8Array.from(Buffer.from(out.rgba, 'base64')) };
}

/**
 * The settled frame at clock 0, with no view reset: the body's turn must already be the normal
 * pose (0, 0) by itself, or the compare would hide a residual turn.
 */
async function settledShot(page: Page): Promise<Buffer> {
  const turn = await page.evaluate(async () => {
    const v = (
      globalThis as unknown as {
        __sxViewer: {
          getTurn(): { x: number; y: number };
          freezeClock(s: number): Promise<void>;
        };
      }
    ).__sxViewer;
    await v.freezeClock(0);
    return v.getTurn();
  });
  expect(turn).toEqual({ x: 0, y: 0 });
  const canvas = page.getByTestId('build-pane').locator('canvas[aria-label]');
  const box = (await canvas.boundingBox())!;
  return page.screenshot({ clip: box, mask: [page.getByTestId('viewer-label')] });
}

test('the last frame of a build is the normal render of the same plan and seed', async ({
  page,
  context,
}) => {
  test.setTimeout(150_000);
  await selectAquaPrime(page);
  await page.getByTestId('build-it').click();
  const pane = page.getByTestId('build-pane');
  await expect(pane).toHaveAttribute('data-phase', /building|done/, { timeout: 60_000 });
  await setHonesty(page, /Artistic/);
  await page.getByTestId('build-replay').click();
  await expect(pane).toHaveAttribute('data-phase', 'done', { timeout: 90_000 });
  await page.mouse.move(0, 0);
  const built = await settledShot(page);

  // The same body opened from the rail: built at once, no animation.
  await page.getByTestId('build-close').click();
  await expect(pane).toHaveCount(0);
  await page.getByTestId('tool-viewer').click();
  await expect(pane).toHaveAttribute('data-phase', 'done', { timeout: 60_000 });
  await page.waitForFunction(() => {
    const v = (globalThis as unknown as { __sxViewer?: { body: { drawn: string[] } | null } })
      .__sxViewer;
    return (v?.body?.drawn.length ?? 0) > 0;
  });
  await page.mouse.move(0, 0);
  const normal = await settledShot(page);

  const decoder = await context.newPage();
  const sc = scoreFrames(await decode(decoder, normal), await decode(decoder, built));
  const line = `luma ${sc.luma.toFixed(5)} channelMin ${sc.channelMin.toFixed(5)} colourDelta ${sc.colourDelta.toFixed(4)}`;
  expect(sc.luma, line).toBeGreaterThanOrEqual(GOLDEN_MIN_SSIM);
  expect(sc.channelMin, line).toBeGreaterThanOrEqual(GOLDEN_MIN_CHANNEL_SSIM);
  expect(sc.colourDelta, line).toBeLessThanOrEqual(GOLDEN_MAX_COLOUR_DELTA);
});

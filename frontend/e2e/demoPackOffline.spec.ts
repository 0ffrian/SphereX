// Issue #68, 7d (Track F, Q-164): "Build it" on a pre-built demo-pack row with the REAL backend under
// SX_OFFLINE=1 and an empty frames cache. The page runs on the fixtures dev server, but the object
// routes (resolve, card, render-params) and /data/demo-textures are passed through to a backend
// this spec starts: its cache is a copy of backend/tests/fixtures/cache with the SPHEREx frame
// entries removed, so the only way "WISE 0855-0714" can build is its committed pack asset.
// Expect X-SX-Asset-Status: saved and the baked maps fetched from /data/demo-textures. (UNVERIFIED
// after the D-38 redesign: it needs the Python backend, which was not run here.)
// Needs `uv` and the backend's environment (`uv sync` in backend/). Run it with --workers=1.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const BACKEND_PORT = Number(process.env.SX_E2E_BACKEND_PORT ?? 8791);
const BACKEND = `http://localhost:${BACKEND_PORT}`;
const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../backend');

let server: ChildProcess | null = null;
let cacheRoot = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  cacheRoot = mkdtempSync(path.join(tmpdir(), 'sx-pack-'));
  const cache = path.join(cacheRoot, 'cache');
  cpSync(path.join(BACKEND_DIR, 'tests/fixtures/cache'), cache, { recursive: true });
  // No SPHEREx frames (the SIA lists and the cutouts) and no derived answers.
  for (const dir of readdirSync(path.join(cache, 'v1'))) {
    if (dir.startsWith('derived.') || dir === 'irsa_cutout' || dir === 'irsa_sia') {
      rmSync(path.join(cache, 'v1', dir), { recursive: true, force: true });
    }
  }
  execFileSync('uv', ['--version'], { stdio: 'ignore' });
  server = spawn(
    'uv',
    [
      '--directory',
      BACKEND_DIR,
      'run',
      'uvicorn',
      'app.main:create_app',
      '--factory',
      '--host',
      'localhost',
      '--port',
      String(BACKEND_PORT),
    ],
    {
      env: { ...process.env, SX_OFFLINE: '1', SX_CACHE_DIR: cache, SX_BAKE_TEXTURES: '0' },
      stdio: 'ignore',
    },
  );
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const res = await fetch(`${BACKEND}/v1/health`);
      if (res.ok && ((await res.json()) as { offline: boolean }).offline) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error('the backend did not start');
    await new Promise((r) => setTimeout(r, 500));
  }
});

test.afterAll(() => {
  server?.kill();
  if (cacheRoot) rmSync(cacheRoot, { recursive: true, force: true });
});

test('Build it on a pack row renders the body offline, as a saved asset', async ({ page }) => {
  const statuses: string[] = [];
  let albedoUrl = '';
  await page.route(
    (url) => /^\/v1\/(resolve|objects\/[^/]+\/(card|render-params))$/.test(url.pathname),
    async (route) => {
      const url = new URL(route.request().url());
      const res = await fetch(`${BACKEND}${url.pathname}${url.search}`);
      const status = res.headers.get('x-sx-asset-status');
      if (status && url.pathname.endsWith('/render-params')) statuses.push(status);
      const body = Buffer.from(await res.arrayBuffer());
      if (status && url.pathname.endsWith('/render-params')) {
        albedoUrl = (JSON.parse(body.toString('utf8')) as { textures: { albedo: string } }).textures
          .albedo;
      }
      await route.fulfill({
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        body,
      });
    },
  );

  await page.goto('/');
  const input = page.getByTestId('search-input');
  await input.focus();
  await input.pressSequentially('wise 0855');
  await page.getByRole('option', { name: /WISE 0855-0714/ }).click();
  await expect(page.getByTestId('object-panel')).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('panel-build-it').click();
  const pane = page.getByTestId('build-pane');
  await expect(pane).toBeVisible();
  await expect(pane).toHaveAttribute('data-phase', 'done', { timeout: 60_000 });
  await expect(page.getByTestId('build-message')).toHaveCount(0);
  // The "Built ahead of time" note (Q-164) is no longer shown in the build pane since the redesign;
  // the saved-asset status header below is what this spec checks now.
  expect(statuses).toContain('saved');
  // The pack's maps are served by the read-only mount, with no network behind it (the viewer asks
  // for them only at the honesty levels that draw them).
  expect(albedoUrl).toMatch(/^\/data\/demo-textures\//);
  expect((await fetch(`${BACKEND}${albedoUrl}`)).status).toBe(200);
});

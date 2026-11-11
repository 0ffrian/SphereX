// Issue #93 engine bench runner: opens bench pages in Playwright's Chromium on the real GPU and prints each page's
// window.__out as one JSON line. Start the Vite dev server first (from frontend/: npx vite --port 5199 --strictPort).
//
//   node scripts/engine-bench/run.js [--base URL] [--angle d3d11|vulkan|gl] [--profile DIR] [--timeout S] PAGE...
//
// PAGE is a path under scripts/engine-bench/ with its query, e.g. 'compile.html?fs=fly&v=unrolled'.
// Without --profile every page gets a fresh, empty profile (a cold shader cache: what a first open costs). With
// --profile DIR the pages share DIR, so a second run measures the warm disk cache.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  if (i < 0) return dflt;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const base = opt('--base', process.env.SX_BENCH_BASE || 'http://127.0.0.1:5199');
const angle = opt('--angle', 'd3d11');
const profile = opt('--profile', null);
const timeout = +opt('--timeout', '900') * 1000;
if (!args.length) {
  console.error(
    'usage: node run.js [--base URL] [--angle d3d11] [--profile DIR] [--timeout S] PAGE...',
  );
  process.exit(2);
}

for (const page of args) {
  const dir = profile || fs.mkdtempSync(path.join(os.tmpdir(), 'sx-bench-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: true,
    viewport: { width: 2400, height: 1000 },
    args: ['--use-angle=' + angle, '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => console.error('[page error]', e.message));
  const t0 = Date.now();
  await pg.goto(base.replace(/\/$/, '') + '/scripts/engine-bench/' + page, { waitUntil: 'commit' });
  await pg.waitForFunction(() => globalThis.__out && globalThis.__out.done, null, {
    timeout,
    polling: 250,
  });
  const res = await pg.evaluate(() => globalThis.__out);
  console.log(
    JSON.stringify({ page, angle, wall_s: +((Date.now() - t0) / 1000).toFixed(1), ...res }),
  );
  await ctx.close();
  if (!profile) fs.rmSync(dir, { recursive: true, force: true });
}

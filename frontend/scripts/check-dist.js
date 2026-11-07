// Post-build check: no fixture code, synthetic fixture data or dev-only test page may reach a
// production build.
// Runs after `vite build` (see the `build` script). Exits 1 if a marker is found in dist/.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKERS = ['SX_FIXTURE_MARKER', 'synthetic_fixture', 'synthetic-mover', 'SYNTHETIC_FLAG'];
// The dev-only haptics test page (haptics-test.html, src/hapticsTestPage/) must never ship.
const TEST_PAGE_MARKERS = ['hapticsTestPage'];
const TEST_PAGE_FILES = ['haptics-test.html'];
// Text in every file of shared/fixtures/. The flipbook's "synthetic fixture data" label must not match.
const SHARED_FIXTURE_TEXT = /synthetic fixture[:.]/i;
const dist = fileURLToPath(new URL('../dist', import.meta.url));

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(js|mjs|css|html|json|map|txt)$/.test(name)) yield path;
  }
}

const hits = [];
for (const name of TEST_PAGE_FILES) {
  if (existsSync(join(dist, name))) hits.push(`${join(dist, name)}: dev-only test page`);
}
for (const file of files(dist)) {
  const text = readFileSync(file, 'utf8');
  for (const m of MARKERS) if (text.includes(m)) hits.push(`${file}: ${m}`);
  for (const m of TEST_PAGE_MARKERS) if (text.includes(m)) hits.push(`${file}: ${m}`);
  if (SHARED_FIXTURE_TEXT.test(text)) hits.push(`${file}: ${SHARED_FIXTURE_TEXT}`);
}

if (hits.length > 0) {
  console.error(
    'check-dist: fixture or dev-only markers found in the production build:\n' + hits.join('\n'),
  );
  process.exit(1);
}
console.log('check-dist: no fixture or dev-only markers in dist/');

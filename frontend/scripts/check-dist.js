// Post-build check: no fixture code or synthetic fixture data may reach a production build.
// Runs after `vite build` (see the `build` script). Exits 1 if a marker is found in dist/.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKERS = ['SX_FIXTURE_MARKER', 'synthetic_fixture', 'synthetic-mover', 'SYNTHETIC_FLAG'];
const dist = fileURLToPath(new URL('../dist', import.meta.url));

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(js|mjs|css|html|json|map|txt)$/.test(name)) yield path;
  }
}

const hits = [];
for (const file of files(dist)) {
  const text = readFileSync(file, 'utf8');
  for (const m of MARKERS) if (text.includes(m)) hits.push(`${file}: ${m}`);
}

if (hits.length > 0) {
  console.error('check-dist: fixture markers found in the production build:\n' + hits.join('\n'));
  process.exit(1);
}
console.log('check-dist: no fixture markers in dist/');

// `npm run perf:build`: copies the shared fixture cards and render params into dist-fixtures/ so
// the frame-time procedure (docs/rendering/reference/frame-time.md) can load them under
// `vite preview`, where the fixtures dev plugin does not run. Never part of `npm run build`.
import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../dist-fixtures/', import.meta.url));
const src = fileURLToPath(new URL('../../shared/fixtures/', import.meta.url));
if (!existsSync(out)) {
  console.error(
    'copy-perf-fixtures: run `vite build --mode fixtures --outDir dist-fixtures` first',
  );
  process.exit(1);
}
for (const dir of ['cards', 'params'])
  cpSync(`${src}${dir}`, `${out}fixtures/${dir}`, { recursive: true });
console.log('copy-perf-fixtures: cards and params copied to dist-fixtures/fixtures/');

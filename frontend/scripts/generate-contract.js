// Generates src/contract/generated.ts from shared/schemas/ (D-18).
//   npm run contract:gen     rewrite the file
//   npm run contract:check   exit 1 if it differs (CI)
// The output is byte-stable: no timestamp, no paths, and Prettier runs here with the project's
// config, so regenerating reproduces the committed bytes.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';
import prettier from 'prettier';

const schemasDir = fileURLToPath(new URL('../../shared/schemas/', import.meta.url));
const outFile = fileURLToPath(new URL('../src/contract/generated.ts', import.meta.url));

const BANNER =
  '// GENERATED from shared/schemas/ by scripts/generate-contract.js (D-18). Do not edit.\n' +
  '// Hand-written helpers sit next to this file; import from "@/contract".\n';

// One root that refers to every schema, so the definitions they share are emitted once. The area
// schemas (A17.9) keep their shared definitions in area-index.schema.json; `areaError` names the
// error body so that it is emitted too.
const ROOT = {
  title: 'ContractSchemas',
  description: 'Bundle root: exists only so that every schema compiles into this one file.',
  type: 'object',
  additionalProperties: false,
  required: [
    'card',
    'params',
    'areaIndex',
    'areaSummary',
    'areaKnown',
    'areaDots',
    'areaTracks',
    'areaChecks',
    'areaSpectra',
    'areaError',
    'trackPath',
    'liveAreaPlan',
    'liveAreaJob',
  ],
  properties: {
    card: { $ref: 'object-card.schema.json' },
    params: { $ref: 'render-params.schema.json' },
    areaIndex: { $ref: 'area-index.schema.json' },
    areaSummary: { $ref: 'area-summary.schema.json' },
    areaKnown: { $ref: 'area-known.schema.json' },
    areaDots: { $ref: 'area-dots.schema.json' },
    areaTracks: { $ref: 'area-tracks.schema.json' },
    areaChecks: { $ref: 'area-checks.schema.json' },
    areaSpectra: { $ref: 'area-spectra.schema.json' },
    areaError: { $ref: 'area-index.schema.json#/definitions/AreaError' },
    trackPath: { $ref: 'track-path.schema.json' },
    liveAreaPlan: { $ref: 'area-live-plan.schema.json' },
    liveAreaJob: { $ref: 'area-job.schema.json' },
  },
};

async function generate() {
  const types = await compile(ROOT, 'ContractSchemas', {
    bannerComment: BANNER,
    cwd: schemasDir,
    additionalProperties: false,
    format: false,
  });
  const card = JSON.parse(readFileSync(`${schemasDir}object-card.schema.json`, 'utf8'));
  const area = JSON.parse(readFileSync(`${schemasDir}area-index.schema.json`, 'utf8'));
  const list = (name, type, values) =>
    `\nexport const ${name}: readonly ${type}[] = ${JSON.stringify(values)};\n`;
  const code =
    types +
    list('TAGS', 'Tag', card.definitions.Tag.enum) +
    list('OBJECT_TYPES', 'ObjectType', card.definitions.ObjectType.enum) +
    list('AREA_DOT_LABELS', 'AreaDotLabel', area.definitions.AreaDotLabel.enum) +
    list('AREA_VERDICTS', 'AreaVerdict', area.definitions.AreaVerdict.enum) +
    list('AREA_LINKERS', 'AreaLinker', area.definitions.AreaLinker.enum);
  const config = await prettier.resolveConfig(outFile);
  return prettier.format(code, { ...config, parser: 'typescript' });
}

const fresh = await generate();
if (process.argv.includes('--check')) {
  if (!existsSync(outFile) || readFileSync(outFile, 'utf8') !== fresh) {
    console.error('contract drift in src/contract/generated.ts. Run: npm run contract:gen');
    process.exit(1);
  }
  console.log('src/contract/generated.ts matches shared/schemas/');
} else {
  writeFileSync(outFile, fresh);
  console.log('wrote src/contract/generated.ts');
}

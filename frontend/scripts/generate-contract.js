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

// One root that refers to both schemas, so the definitions they share are emitted once.
const ROOT = {
  title: 'ContractSchemas',
  description: 'Bundle root: exists only so that both schemas compile into this one file.',
  type: 'object',
  additionalProperties: false,
  required: ['card', 'params'],
  properties: {
    card: { $ref: 'object-card.schema.json' },
    params: { $ref: 'render-params.schema.json' },
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
  const list = (name, type, values) =>
    `\nexport const ${name}: readonly ${type}[] = ${JSON.stringify(values)};\n`;
  const code =
    types +
    list('TAGS', 'Tag', card.definitions.Tag.enum) +
    list('OBJECT_TYPES', 'ObjectType', card.definitions.ObjectType.enum);
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

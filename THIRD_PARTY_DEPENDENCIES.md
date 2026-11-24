# Third-party dependencies and their licences

Generated on 24 Nov 2026 from the lockfiles for issue #200. It lists every npm and Python package the project installs, with the licence its metadata declares. [NOTICE.md](NOTICE.md) summarises it and explains the flags. Do not edit it by hand: regenerate it when a lockfile changes.

**How it was made**

- npm: `npm ci` in `frontend/` (npm 11.19.1, Node 24.22.1), then `npx license-checker-rseidelsohn@5.0.1 --json --excludePrivatePackages` for all packages, and the same with `--production` for the packages shipped in the app.
- Python: `uv sync --locked` in `backend/` (uv 0.12.23, the version CI pins), then `uv run --with pip-licenses==5.5.5 pip-licenses --format=json --with-urls`. Runtime packages are those in `uv export --locked --no-dev`.
- "OSI-approved" means the declared licence is approved by the Open Source Initiative, according to the SPDX licence list 3.29.0 (16 Sep 2026). Anything else is flagged in the last column.

## npm (`frontend/`): 263 packages, 17 shipped in the app

| Package | Licence | Scope | OSI |
|---|---|---|---|
| `@animate-ui/react@2.4.3` | Custom: LICENSE.md | app | **Not OSI-approved:** MIT + Commons Clause (see NOTICE.md, Q-486) |
| `@apidevtools/json-schema-ref-parser@11.9.3` | MIT | dev | OSI-approved |
| `@asamuzakjp/css-color@7.1.9` | MIT | dev | OSI-approved |
| `@asamuzakjp/dom-selector@10.0.5` | MIT | dev | OSI-approved |
| `@babel/code-frame@7.29.7` | MIT | dev | OSI-approved |
| `@babel/compat-data@7.29.7` | MIT | dev | OSI-approved |
| `@babel/core@7.29.13` | MIT | dev | OSI-approved |
| `@babel/generator@7.29.13` | MIT | dev | OSI-approved |
| `@babel/helper-compilation-targets@7.29.13` | MIT | dev | OSI-approved |
| `@babel/helper-globals@7.29.7` | MIT | dev | OSI-approved |
| `@babel/helper-module-imports@7.29.7` | MIT | dev | OSI-approved |
| `@babel/helper-module-transforms@7.29.13` | MIT | dev | OSI-approved |
| `@babel/helper-string-parser@7.29.13` | MIT | dev | OSI-approved |
| `@babel/helper-validator-identifier@7.29.7` | MIT | dev | OSI-approved |
| `@babel/helper-validator-option@7.29.7` | MIT | dev | OSI-approved |
| `@babel/helpers@7.29.13` | MIT | dev | OSI-approved |
| `@babel/parser@7.29.13` | MIT | dev | OSI-approved |
| `@babel/template@7.29.7` | MIT | dev | OSI-approved |
| `@babel/traverse@7.29.13` | MIT | dev | OSI-approved |
| `@babel/types@7.29.11` | MIT | dev | OSI-approved |
| `@bramus/specificity@2.4.3` | MIT | dev | OSI-approved |
| `@cacheable/memory@2.2.0` | MIT | dev | OSI-approved |
| `@cacheable/utils@2.5.0` | MIT | dev | OSI-approved |
| `@csstools/color-helpers@6.1.2` | MIT-0 | dev | OSI-approved |
| `@csstools/css-calc@3.4.3` | MIT | dev | OSI-approved |
| `@csstools/css-color-parser@4.2.7` | MIT | dev | OSI-approved |
| `@csstools/css-parser-algorithms@4.0.2` | MIT | dev | OSI-approved |
| `@csstools/css-syntax-patches-for-csstree@1.1.16` | MIT-0 | dev | OSI-approved |
| `@csstools/css-tokenizer@4.0.2` | MIT | dev | OSI-approved |
| `@dimforge/rapier3d-compat@0.12.0` | Apache-2.0 | dev | OSI-approved |
| `@emnapi/core@1.11.3` | MIT | dev | OSI-approved |
| `@emnapi/runtime@1.11.3` | MIT | dev | OSI-approved |
| `@emnapi/wasi-threads@1.2.3` | MIT | dev | OSI-approved |
| `@eslint-community/eslint-utils@4.10.1` | MIT | dev | OSI-approved |
| `@eslint-community/regexpp@4.12.2` | MIT | dev | OSI-approved |
| `@eslint/config-array@0.23.5` | Apache-2.0 | dev | OSI-approved |
| `@eslint/config-helpers@0.7.0` | Apache-2.0 | dev | OSI-approved |
| `@eslint/core@1.2.1` | Apache-2.0 | dev | OSI-approved |
| `@eslint/js@10.0.1` | MIT | dev | OSI-approved |
| `@eslint/object-schema@3.0.5` | Apache-2.0 | dev | OSI-approved |
| `@eslint/plugin-kit@0.7.3` | Apache-2.0 | dev | OSI-approved |
| `@exodus/bytes@1.16.0` | MIT | dev | OSI-approved |
| `@fontsource/inter@5.3.0` | OFL-1.1 | app | OSI-approved |
| `@humanfs/core@0.19.2` | Apache-2.0 | dev | OSI-approved |
| `@humanfs/node@0.16.8` | Apache-2.0 | dev | OSI-approved |
| `@humanfs/types@0.15.0` | Apache-2.0 | dev | OSI-approved |
| `@humanwhocodes/module-importer@1.0.1` | Apache-2.0 | dev | OSI-approved |
| `@humanwhocodes/retry@0.4.3` | Apache-2.0 | dev | OSI-approved |
| `@jridgewell/gen-mapping@0.3.13` | MIT | dev | OSI-approved |
| `@jridgewell/remapping@2.3.5` | MIT | dev | OSI-approved |
| `@jridgewell/resolve-uri@3.1.2` | MIT | dev | OSI-approved |
| `@jridgewell/sourcemap-codec@1.6.0` | MIT | dev | OSI-approved |
| `@jridgewell/trace-mapping@0.3.31` | MIT | dev | OSI-approved |
| `@jsdevtools/ono@7.1.3` | MIT | dev | OSI-approved |
| `@keyv/bigmap@1.3.1` | MIT | dev | OSI-approved |
| `@keyv/serialize@1.1.1` | MIT | dev | OSI-approved |
| `@napi-rs/wasm-runtime@1.2.2` | MIT | dev | OSI-approved |
| `@oxc-project/types@0.156.0` | MIT | dev | OSI-approved |
| `@playwright/test@1.64.1` | Apache-2.0 | dev | OSI-approved |
| `@rolldown/binding-linux-x64-gnu@1.2.16` | MIT | dev | OSI-approved |
| `@rolldown/pluginutils@1.0.1` | MIT | dev | OSI-approved |
| `@tailwindcss/node@4.3.4` | MIT | dev | OSI-approved |
| `@tailwindcss/oxide-linux-x64-gnu@4.3.4` | MIT | dev | OSI-approved |
| `@tailwindcss/oxide-wasm32-wasi@4.3.4` | MIT | dev | OSI-approved |
| `@tailwindcss/oxide@4.3.4` | MIT | dev | OSI-approved |
| `@tailwindcss/vite@4.3.4` | MIT | dev | OSI-approved |
| `@tweenjs/tween.js@23.1.3` | MIT | dev | OSI-approved |
| `@tybys/wasm-util@0.10.3` | MIT | dev | OSI-approved |
| `@types/chai@5.2.3` | MIT | dev | OSI-approved |
| `@types/deep-eql@4.0.2` | MIT | dev | OSI-approved |
| `@types/esrecurse@4.3.1` | MIT | dev | OSI-approved |
| `@types/estree@1.0.10` | MIT | dev | OSI-approved |
| `@types/json-schema@7.0.15` | MIT | dev | OSI-approved |
| `@types/katex@0.16.7` | MIT | dev | OSI-approved |
| `@types/lodash@4.17.27` | MIT | dev | OSI-approved |
| `@types/node@24.19.2` | MIT | dev | OSI-approved |
| `@types/react-dom@19.3.0` | MIT | dev | OSI-approved |
| `@types/react@19.3.0` | MIT | app | OSI-approved |
| `@types/stats.js@0.17.4` | MIT | dev | OSI-approved |
| `@types/three@0.187.0` | MIT | dev | OSI-approved |
| `@types/webxr@0.5.24` | MIT | dev | OSI-approved |
| `@typescript-eslint/eslint-plugin@8.72.1` | MIT | dev | OSI-approved |
| `@typescript-eslint/parser@8.72.1` | MIT | dev | OSI-approved |
| `@typescript-eslint/project-service@8.72.1` | MIT | dev | OSI-approved |
| `@typescript-eslint/scope-manager@8.72.1` | MIT | dev | OSI-approved |
| `@typescript-eslint/tsconfig-utils@8.72.1` | MIT | dev | OSI-approved |
| `@typescript-eslint/type-utils@8.72.1` | MIT | dev | OSI-approved |
| `@typescript-eslint/types@8.72.1` | MIT | dev | OSI-approved |
| `@typescript-eslint/typescript-estree@8.72.1` | MIT | dev | OSI-approved |
| `@typescript-eslint/utils@8.72.1` | MIT | dev | OSI-approved |
| `@typescript-eslint/visitor-keys@8.72.1` | MIT | dev | OSI-approved |
| `@vitejs/plugin-basic-ssl@2.3.0` | MIT | dev | OSI-approved |
| `@vitejs/plugin-react@6.2.1` | MIT | dev | OSI-approved |
| `@vitest/mocker@5.1.0` | MIT | dev | OSI-approved |
| `@vitest/spy@5.1.0` | MIT | dev | OSI-approved |
| `acorn-jsx@5.3.2` | MIT | dev | OSI-approved |
| `acorn@8.19.0` | MIT | dev | OSI-approved |
| `ajv@6.15.0` | MIT | dev | OSI-approved |
| `ajv@8.20.0` | MIT | dev | OSI-approved |
| `argparse@2.0.1` | Python-2.0 | dev | OSI-approved |
| `argparse@3.0.4` | PSF-2.0 | dev | **Not OSI-approved** (SPDX); permissive Python Software Foundation licence |
| `assertion-error@2.0.1` | MIT | dev | OSI-approved |
| `balanced-match@4.0.4` | MIT | dev | OSI-approved |
| `baseline-browser-mapping@2.11.35` | Apache-2.0 | dev | OSI-approved |
| `bidi-js@1.1.0` | MIT | dev | OSI-approved |
| `brace-expansion@5.0.12` | MIT | dev | OSI-approved |
| `browserslist@4.29.5` | MIT | dev | OSI-approved |
| `cacheable@2.5.0` | MIT | dev | OSI-approved |
| `caniuse-lite@1.0.30001820` | CC-BY-4.0 | dev | **Not OSI-approved** (a Creative Commons licence); build-tool data, not shipped |
| `chai@6.3.0` | MIT | dev | OSI-approved |
| `commander@8.3.0` | MIT | app | OSI-approved |
| `convert-source-map@2.0.0` | MIT | dev | OSI-approved |
| `cross-spawn@7.0.6` | MIT | dev | OSI-approved |
| `css-tree@3.2.1` | MIT | dev | OSI-approved |
| `csstype@3.2.3` | MIT | app | OSI-approved |
| `data-urls@8.0.0` | MIT | dev | OSI-approved |
| `debug@4.4.3` | MIT | dev | OSI-approved |
| `decimal.js@10.6.0` | MIT | dev | OSI-approved |
| `deep-is@0.1.4` | MIT | dev | OSI-approved |
| `detect-libc@2.1.2` | Apache-2.0 | dev | OSI-approved |
| `electron-to-chromium@1.5.476` | ISC | dev | OSI-approved |
| `enhanced-resolve@5.26.1` | MIT | dev | OSI-approved |
| `entities@9.0.0` | BSD-2-Clause | dev | OSI-approved |
| `es-module-lexer@2.3.2` | MIT | dev | OSI-approved |
| `escalade@3.2.0` | MIT | dev | OSI-approved |
| `escape-string-regexp@4.0.0` | MIT | dev | OSI-approved |
| `eslint-plugin-react-hooks@7.1.1` | MIT | dev | OSI-approved |
| `eslint-scope@9.1.2` | BSD-2-Clause | dev | OSI-approved |
| `eslint-visitor-keys@3.4.3` | Apache-2.0 | dev | OSI-approved |
| `eslint-visitor-keys@5.0.1` | Apache-2.0 | dev | OSI-approved |
| `eslint@10.14.0` | MIT | dev | OSI-approved |
| `espree@11.2.0` | BSD-2-Clause | dev | OSI-approved |
| `esquery@1.7.0` | BSD-3-Clause | dev | OSI-approved |
| `esrecurse@4.3.0` | BSD-2-Clause | dev | OSI-approved |
| `estraverse@5.3.0` | BSD-2-Clause | dev | OSI-approved |
| `estree-walker@3.0.3` | MIT | dev | OSI-approved |
| `esutils@2.0.3` | BSD-2-Clause | dev | OSI-approved |
| `expect-type@1.4.0` | Apache-2.0 | dev | OSI-approved |
| `fast-deep-equal@3.1.3` | MIT | dev | OSI-approved |
| `fast-json-stable-stringify@2.1.0` | MIT | dev | OSI-approved |
| `fast-levenshtein@2.0.6` | MIT | dev | OSI-approved |
| `fast-uri@3.1.9` | BSD-3-Clause | dev | OSI-approved |
| `fdir@6.5.0` | MIT | dev | OSI-approved |
| `fflate@0.8.3` | MIT | dev | OSI-approved |
| `file-entry-cache@11.1.5` | MIT | dev | OSI-approved |
| `find-up@5.0.0` | MIT | dev | OSI-approved |
| `flat-cache@6.1.23` | MIT | dev | OSI-approved |
| `flatted@3.4.4` | ISC | dev | OSI-approved |
| `framer-motion@14.10.1` | MIT | app | OSI-approved |
| `gensync@1.0.0-beta.2` | MIT | dev | OSI-approved |
| `glob-parent@6.0.2` | ISC | dev | OSI-approved |
| `globals@17.14.0` | MIT | dev | OSI-approved |
| `graceful-fs@4.2.11` | ISC | dev | OSI-approved |
| `hashery@1.5.1` | MIT | dev | OSI-approved |
| `hermes-estree@0.25.1` | MIT | dev | OSI-approved |
| `hermes-parser@0.25.1` | MIT | dev | OSI-approved |
| `hookified@1.15.1` | MIT | dev | OSI-approved |
| `hookified@2.2.0` | MIT | dev | OSI-approved |
| `html-encoding-sniffer@7.0.0` | MIT | dev | OSI-approved |
| `ignore@5.3.2` | MIT | dev | OSI-approved |
| `ignore@7.0.14` | MIT | dev | OSI-approved |
| `imurmurhash@0.1.4` | MIT | dev | OSI-approved |
| `is-extglob@2.1.1` | MIT | dev | OSI-approved |
| `is-glob@4.0.3` | MIT | dev | OSI-approved |
| `is-potential-custom-element-name@1.0.1` | MIT | dev | OSI-approved |
| `isexe@2.0.0` | ISC | dev | OSI-approved |
| `jiti@2.7.0` | MIT | dev | OSI-approved |
| `js-tokens@4.0.0` | MIT | dev | OSI-approved |
| `js-yaml@4.3.2` | MIT | dev | OSI-approved |
| `js-yaml@5.5.0` | MIT | dev | OSI-approved |
| `jsdom@30.1.3` | MIT | dev | OSI-approved |
| `jsesc@3.1.0` | MIT | dev | OSI-approved |
| `json-schema-to-typescript@16.0.0` | MIT | dev | OSI-approved |
| `json-schema-traverse@0.4.1` | MIT | dev | OSI-approved |
| `json-schema-traverse@1.0.0` | MIT | dev | OSI-approved |
| `json-stable-stringify-without-jsonify@1.0.1` | MIT | dev | OSI-approved |
| `json5@2.2.3` | MIT | dev | OSI-approved |
| `katex@0.16.11` | MIT | app | OSI-approved |
| `keyv@5.6.0` | MIT | dev | OSI-approved |
| `levn@0.4.1` | MIT | dev | OSI-approved |
| `lightningcss-linux-x64-gnu@1.33.0` | MPL-2.0 | dev | OSI-approved |
| `lightningcss@1.33.0` | MPL-2.0 | dev | OSI-approved |
| `locate-path@6.0.0` | MIT | dev | OSI-approved |
| `lodash@4.18.1` | MIT | dev | OSI-approved |
| `lru-cache@11.5.3` | BlueOak-1.0.0 | dev | OSI-approved |
| `lru-cache@5.1.1` | ISC | dev | OSI-approved |
| `magic-string@1.4.5` | MIT | dev | OSI-approved |
| `mdn-data@2.27.1` | CC0-1.0 | dev | Not an OSI licence; public-domain dedication (no restriction) |
| `meshoptimizer@1.1.1` | MIT | dev | OSI-approved |
| `minimatch@10.2.6` | BlueOak-1.0.0 | dev | OSI-approved |
| `minimist@1.2.8` | MIT | dev | OSI-approved |
| `motion-dom@14.10.1` | MIT | app | OSI-approved |
| `motion-utils@14.7.0` | MIT | app | OSI-approved |
| `motion@14.10.1` | MIT | app | OSI-approved |
| `ms@2.1.3` | MIT | dev | OSI-approved |
| `nanoid@3.3.20` | MIT | dev | OSI-approved |
| `natural-compare@1.4.0` | MIT | dev | OSI-approved |
| `node-releases@2.0.63` | MIT | dev | OSI-approved |
| `obug@3.0.0` | MIT | dev | OSI-approved |
| `optionator@0.9.4` | MIT | dev | OSI-approved |
| `p-limit@3.1.0` | MIT | dev | OSI-approved |
| `p-locate@5.0.0` | MIT | dev | OSI-approved |
| `parse5@8.1.0` | MIT | dev | OSI-approved |
| `path-exists@4.0.0` | MIT | dev | OSI-approved |
| `path-key@3.1.1` | MIT | dev | OSI-approved |
| `picocolors@1.1.1` | ISC | dev | OSI-approved |
| `picomatch@4.0.7` | MIT | dev | OSI-approved |
| `playwright-core@1.64.1` | Apache-2.0 | dev | OSI-approved |
| `playwright@1.64.1` | Apache-2.0 | dev | OSI-approved |
| `postcss@8.5.32` | MIT | dev | OSI-approved |
| `prelude-ls@1.2.1` | MIT | dev | OSI-approved |
| `prettier@3.9.10` | MIT | dev | OSI-approved |
| `punycode@2.3.1` | MIT | dev | OSI-approved |
| `qified@0.10.1` | MIT | dev | OSI-approved |
| `react-dom@19.3.1` | MIT | app | OSI-approved |
| `react@19.3.1` | MIT | app | OSI-approved |
| `require-from-string@2.0.2` | MIT | dev | OSI-approved |
| `rolldown@1.2.16` | MIT | dev | OSI-approved |
| `saxes@6.0.0` | ISC | dev | OSI-approved |
| `scheduler@0.28.0` | MIT | app | OSI-approved |
| `semver@6.3.2` | ISC | dev | OSI-approved |
| `semver@7.8.6` | ISC | dev | OSI-approved |
| `shebang-command@2.0.0` | MIT | dev | OSI-approved |
| `shebang-regex@3.0.0` | MIT | dev | OSI-approved |
| `source-map-js@1.2.2` | BSD-3-Clause | dev | OSI-approved |
| `std-env@4.3.0` | MIT | dev | OSI-approved |
| `tailwindcss@4.3.4` | MIT | dev | OSI-approved |
| `tapable@2.3.3` | MIT | dev | OSI-approved |
| `three-mesh-bvh@0.9.18` | MIT | app | OSI-approved |
| `three@0.187.0` | MIT | app | OSI-approved |
| `tinybench@6.2.3` | MIT | dev | OSI-approved |
| `tinyexec@1.3.1` | MIT | dev | OSI-approved |
| `tinyglobby@0.2.17` | MIT | dev | OSI-approved |
| `tldts-core@7.4.20` | MIT | dev | OSI-approved |
| `tldts@7.4.19` | MIT | dev | OSI-approved |
| `tough-cookie@6.0.2` | BSD-3-Clause | dev | OSI-approved |
| `tr46@7.0.0` | MIT | dev | OSI-approved |
| `ts-api-utils@2.5.0` | MIT | dev | OSI-approved |
| `tslib@2.8.1` | 0BSD | dev | OSI-approved |
| `tslib@2.9.1` | 0BSD | app | OSI-approved |
| `type-check@0.4.0` | MIT | dev | OSI-approved |
| `typescript-eslint@8.72.1` | MIT | dev | OSI-approved |
| `typescript@6.0.3` | Apache-2.0 | dev | OSI-approved |
| `undici-types@7.24.6` | MIT | dev | OSI-approved |
| `undici@8.12.3` | MIT | dev | OSI-approved |
| `update-browserslist-db@1.3.4` | MIT | dev | OSI-approved |
| `uri-js@4.4.1` | BSD-2-Clause | dev | OSI-approved |
| `vite@8.3.5` | MIT | dev | OSI-approved |
| `vitest@5.1.0` | MIT | dev | OSI-approved |
| `w3c-xmlserializer@6.0.0` | MIT | dev | OSI-approved |
| `webidl-conversions@8.0.1` | BSD-2-Clause | dev | OSI-approved |
| `whatwg-mimetype@5.0.0` | MIT | dev | OSI-approved |
| `whatwg-url@17.3.0` | MIT | dev | OSI-approved |
| `which@2.0.2` | ISC | dev | OSI-approved |
| `why-is-node-running@3.2.1` | MIT | dev | OSI-approved |
| `word-wrap@1.2.5` | MIT | dev | OSI-approved |
| `xml-name-validator@5.0.0` | Apache-2.0 | dev | OSI-approved |
| `xmlchars@2.2.0` | MIT | dev | OSI-approved |
| `yallist@3.1.1` | ISC | dev | OSI-approved |
| `yocto-queue@0.1.0` | MIT | dev | OSI-approved |
| `zod-validation-error@4.0.2` | MIT | dev | OSI-approved |
| `zod@4.6.7` | MIT | dev | OSI-approved |
| `zustand@5.0.16` | MIT | app | OSI-approved |

## Python (`backend/`): 54 packages, 31 runtime

| Package | Version | Licence | Scope | OSI |
|---|---|---|---|---|
| `annotated-doc` | 0.0.5 | MIT | runtime | OSI-approved |
| `annotated-types` | 0.8.0 | MIT | runtime | OSI-approved |
| `anyio` | 4.15.1 | MIT | runtime | OSI-approved |
| `argcomplete` | 3.7.2 | Apache Software License | dev | OSI-approved |
| `ast_serialize` | 0.13.1 | MIT | dev | OSI-approved |
| `astropy` | 8.0.2 | BSD-3-Clause | runtime | OSI-approved |
| `astropy-iers-data` | 0.2026.11.2.0.34.55 | BSD-3-Clause | runtime | OSI-approved |
| `attrs` | 26.1.0 | MIT | runtime | OSI-approved |
| `black` | 26.10.1 | MIT | dev | OSI-approved |
| `certifi` | 2026.10.23 | Mozilla Public License 2.0 (MPL 2.0) | runtime | OSI-approved |
| `click` | 8.5.0 | BSD-3-Clause | runtime | OSI-approved |
| `datamodel-code-generator` | 0.89.0 | MIT | dev | OSI-approved |
| `fastapi` | 0.161.1 | MIT | runtime | OSI-approved |
| `genson` | 1.4.0 | MIT License | dev | OSI-approved |
| `h11` | 0.16.0 | MIT License | runtime | OSI-approved |
| `httpcore` | 1.0.9 | BSD-3-Clause | runtime | OSI-approved |
| `httpx` | 0.28.1 | BSD License | runtime | OSI-approved |
| `idna` | 3.20 | BSD-3-Clause | runtime | OSI-approved |
| `inflect` | 7.6.0 | MIT | dev | OSI-approved |
| `iniconfig` | 2.3.1 | MIT | dev | OSI-approved |
| `isort` | 8.0.1 | MIT | dev | OSI-approved |
| `jaraco.functools` | 4.6.0 | MIT | dev | OSI-approved |
| `Jinja2` | 3.1.6 | BSD License | dev | OSI-approved |
| `jsonschema` | 4.26.0 | MIT | runtime | OSI-approved |
| `jsonschema-specifications` | 2025.9.1 | MIT | runtime | OSI-approved |
| `librt` | 0.16.0 | MIT | dev | OSI-approved |
| `MarkupSafe` | 3.0.4 | BSD-3-Clause | dev | OSI-approved |
| `more-itertools` | 11.2.1 | MIT | dev | OSI-approved |
| `mypy` | 2.4.0 | MIT | dev | OSI-approved |
| `mypy_extensions` | 1.2.0 | MIT | dev | OSI-approved |
| `numpy` | 2.5.4 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 | runtime | OSI-approved parts plus CC0-1.0 parts (public-domain dedication) |
| `opentelemetry-api` | 1.45.2 | Apache-2.0 | runtime | OSI-approved |
| `packaging` | 26.3 | Apache-2.0 OR BSD-2-Clause | runtime | OSI-approved |
| `pathspec` | 1.1.1 | Mozilla Public License 2.0 (MPL 2.0) | dev | OSI-approved |
| `pillow` | 13.0.0 | MIT-CMU | runtime | **Not OSI-approved** (SPDX); permissive |
| `platformdirs` | 4.14.5 | MIT | dev | OSI-approved |
| `pluggy` | 1.7.0 | MIT License | dev | OSI-approved |
| `pydantic` | 2.14.1 | MIT | runtime | OSI-approved |
| `pydantic-settings` | 2.16.1 | MIT | runtime | OSI-approved |
| `pydantic_core` | 2.50.1 | MIT | runtime | OSI-approved |
| `pyerfa` | 2.0.1.5 | BSD License | runtime | OSI-approved |
| `Pygments` | 2.21.0 | BSD-2-Clause | dev | OSI-approved |
| `pytest` | 9.1.1 | MIT | dev | OSI-approved |
| `python-dotenv` | 1.2.4 | BSD-3-Clause | runtime | OSI-approved |
| `pytokens` | 0.4.1 | MIT License | dev | OSI-approved |
| `PyYAML` | 6.0.3 | MIT License | runtime | OSI-approved |
| `referencing` | 0.37.0 | MIT | runtime | OSI-approved |
| `rpds-py` | 2026.9.1 | MIT | runtime | OSI-approved |
| `ruff` | 0.17.1 | MIT | dev | OSI-approved |
| `starlette` | 1.10.0 | BSD-3-Clause | runtime | OSI-approved |
| `typeguard` | 4.6.0 | MIT | dev | OSI-approved |
| `typing-inspection` | 0.4.5 | MIT | runtime | OSI-approved |
| `typing_extensions` | 4.16.0 | PSF-2.0 | runtime | **Not OSI-approved** (SPDX); permissive Python Software Foundation licence |
| `uvicorn` | 0.54.0 | BSD-3-Clause | runtime | OSI-approved |

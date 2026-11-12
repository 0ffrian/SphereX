# Engine bench (issue #93)

Scripts that measure the D-37 engines: cold shader compile on Chrome's Windows graphics path (ANGLE D3D11), the
background compile, fly-view frame time and picture stability, and CPU costs. They are research tools, not tests:
nothing here runs in CI.

## Setup

From `frontend/`, start the Vite dev server on a free port (the pages import the engine straight from `src/`):

```sh
npx vite --port 5199 --strictPort --host 127.0.0.1
```

`run.js` drives Playwright's Chromium (`@playwright/test`, already a dev dependency; `npx playwright install chromium`
once) on the real GPU and prints one JSON line per page. Options: `--base URL` (default `http://127.0.0.1:5199`, or
`SX_BENCH_BASE`), `--angle d3d11|vulkan|gl` (default `d3d11`), `--profile DIR` (share one browser profile: a warm
shader cache; without it every page gets a fresh, empty profile, which is what a first open costs),
`--timeout S` (default 900) and `--save DIR` (writes the PNG data URLs a page leaves in `__out.png` to `DIR/<name>.png`
and leaves them out of the printed line).

## Pages

| Page                            | Measures                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `compile.html?fs=fly&v=cur`     | Cold compile of one world program. `fs` = `fly`, `world`, `adv`, `gas`; `v=unrolled` restores the constant loop bounds (before #93 1.1).                                                                                                                                                                                                                                                                           |
| `async.html?role=fly`           | A `WorldEngine` waiting for `whenReady()`: time to ready, programs submitted (3 for `role=globe`), and the longest main-thread gap meanwhile.                                                                                                                                                                                                                                                                      |
| `engines.html?which=star-globe` | Cold compile of every program the star engine (`star-globe`, `star-closeup`) or the rock engine (`rock`) builds, timed from `compileShader` to the return of the `LINK_STATUS` read.                                                                                                                                                                                                                               |
| `fly.html?id=t1f&alt=3`         | The fly view from a fixed camera: frame time, and `scale_corr`, the picture at resolution scale 1 against the picture after the resolution scaler shrank to about 0.5 (upsampled; `all` = luminance, `detail` = its high-pass part). With `ref=<module folder>` it also draws with a second copy of the engine and reports the pixel difference (`mean_level`, `over8_pct` of channels off by more than 8 levels). |

Issue #93 W1 (the star, before and after; needs `.bench-ref/stars` for the engine and `.bench-ref/viewer` for the
three.js star, see the comments at the top of each page):

- `star-engine.html?what=compile&src=cur` (or `src=ref`): cold compile of a star engine: how long the constructor
  blocks the main thread, the time until the star draws, and the longest main-thread gap.
- `star-engine.html?what=shots&png=1`: this engine against `/.bench-ref/stars/` for Procyon, eps Eri and Barnard's
  Star in four views (Observatory after a flare, true colour, the surface close-up, the flare close-up): differing
  bytes of the composited picture, the median frame cost and the GL contexts used.
- `tsl-star.html?what=shader&png=1`: the three.js star surface shader against `/.bench-ref/viewer/` (raw half-float
  read-back, so any difference counts); `what=still` draws the star close-up directly and through `StillStarCache`.

Issue #93 phase 2 (repeating patterns):

- `patterns.html?what=corr&kind=world&ref=1`: N card objects of one kind (`world`, `gas`, `star`, `rock`) that differ
  only in their id, drawn by this engine and (with `ref=1`) by the copy in `/.bench-ref/` with the seed it used.
  Reports the pairwise correlation of the pictures (luminance `all`, high-pass `detail`), `shared` (the share of the
  detail's variance common to all pictures: 1 when the seed changes nothing, about 1/N for independent patterns) and
  `mad` (mean absolute luminance difference of a pair). `what=collide` draws two Earth-like card worlds whose old seeds
  collided (FNV-1a mod 997). `what=presets` compares the prototype's presets (worlds on the globe, star rows, rock
  bodies) with the copy in `/.bench-ref/` pixel by pixel; they must not differ. Needs `.bench-ref/worlds`, `stars`
  and `rocks` (the engine folders of the older commit).
- `flypath.html?id=t1f&alt=3&ref=/.bench-ref/worlds/`: the fly camera steps sideways (`step` km, `n` frames); for each
  pair of frames, 32 x 32 ground tiles are matched within +-8 px. A planet-fixed texture moves rigidly and matches
  well (`mean`, `p10` of the best matches); keep `step` so the ground moves fewer than 8 px a frame.

Issue #93 wave 1 (rocks):

- `rocks.html?body=proc|eros|comet`: one rock body from the shared fixture cards (`asteroid_procedural`,
  `asteroid_shape` with the Eros model, `comet`). Reports the main-thread build, the `attach()` call, the time until
  the programs are linked, the longest main-thread task from attach to the first picture, the frame time (median of 40
  draws each followed by a 1-pixel read), the GPU time of a draw (`EXT_disjoint_timer_query_webgl2`, both contexts
  with `two=1`), a draw right after a new height map (`rebake_ms`), and a Surface age sweep (20 changes 16 ms apart:
  longest task, blocked time, settle time). Keeps the canvas in `__out.png` (and `png2`). Switches: `impl=<folder>`
  (an older copy, e.g. `/.bench-ref/before/engine/rocks/` with `seed.ts` one level up), `bake=0` (the prototype's
  per-pixel `ROCK_FS`), `bakeN=<texels>`, `cull=0`, `two=1` (a second canvas, the close-up pane), `share=0` (each
  canvas draws), `w`/`h` (CSS px; run at device scale 1). The Eros model is read from `/.bench-ref/eros.glb` (copy
  `backend/assets/shapes/eros-gaskell.glb`) and the cards from `/.bench-ref/<kind>.json` (copy
  `shared/fixtures/cards/`).

Issue #93 regression fix (mountain heights):

- `relief.html?id=t1f&alts=3,40,400&base=/.bench-ref/<copy>/&ref=/.bench-ref/<other>/`: one preset on the globe and in
  the fly view at several altitudes from the same camera, per engine copy. Reports `relief`, the standard deviation of
  the luminance's high-pass part, and keeps each picture as a PNG data URL in `__out.png` for the driver to save. The
  metric is dominated by fine detail; compare the pictures for the mountains themselves.

Examples:

```sh
node scripts/engine-bench/run.js 'compile.html?fs=fly&v=cur' 'compile.html?fs=fly&v=unrolled'
node scripts/engine-bench/run.js 'engines.html?which=star-globe' 'engines.html?which=rock'
```

To compare against an older engine, copy its files into a folder the dev server can serve (inside `frontend/`, not
committed), then pass it as `ref`:

```sh
mkdir -p .bench-ref/worlds
for f in core.js helpers.js shaders.js presets.js terrain.js gas.js; do
  git show <commit>:frontend/src/engine/worlds/$f > .bench-ref/worlds/$f
done
# patterns.html also needs the older stars/ and rocks/ folders and the worlds' .ts files, whole:
for d in worlds stars rocks; do mkdir -p .bench-ref/$d
  for f in $(git ls-tree --name-only <commit> src/engine/$d/ | grep -v test); do git show <commit>:./$f > .bench-ref/$d/$(basename $f); done
done
node scripts/engine-bench/run.js --profile /tmp/sx-fly 'fly.html?id=t1f&alt=3&ref=/.bench-ref/worlds/'
```

`bench-cpu.js` runs in Node with a stub WebGL context (no browser):

```sh
node scripts/engine-bench/bench-cpu.js t1f                  # this engine
node scripts/engine-bench/bench-cpu.js t1f .bench-ref/worlds # an older copy
```

It prints `createCore`, the first and the second engine's `setPreset` (the shared terrain of #93 1.5) and per-step
costs.

## Notes

- A fresh profile is not always a cold driver cache: one `async.html?role=globe` run reported ready in 50 ms where
  others took 1.6 s. Run each measurement more than once.
- Measure on the A15 too: these numbers come from an RTX 4060 Ti desktop.

Issue #114 (sound, fly height):

- `flyheight.html?worlds=earth,t1f+card,lava` compares the CPU port of FLY_FS `hKm` (`src/engine/worlds/flyHeight.ts`)
  with the GPU over 64 directions per world, for HQ (Catmull-Rom) and bilinear. It reports four errors, each as RMS,
  max and worst direction: `total`, `filter` (the CPU grid read at the GPU's uv against the GPU's `e`), `uv_texels` and
  `noise` (the CPU hKm from the GPU's `e`). It leaves `__out.fixture`, the GPU values `flyHeight.test.ts` replays in CI (bars: noise RMS 0.005 km; filter RMS 0.01, max 0.05 km, Q-434);
  save it to `src/engine/worlds/__fixtures__/flyHeight.gpu.json` when the terrain or the ported GLSL changes.

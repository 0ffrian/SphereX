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
shader cache; without it every page gets a fresh, empty profile, which is what a first open costs) and
`--timeout S` (default 900).

## Pages

| Page                            | Measures                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `compile.html?fs=fly&v=cur`     | Cold compile of one world program. `fs` = `fly`, `world`, `adv`, `gas`; `v=unrolled` restores the constant loop bounds (before #93 1.1).                                                                                                                                                                                                                                                                           |
| `async.html?role=fly`           | A `WorldEngine` waiting for `whenReady()`: time to ready, programs submitted (3 for `role=globe`), and the longest main-thread gap meanwhile.                                                                                                                                                                                                                                                                      |
| `engines.html?which=star-globe` | Cold compile of every program the star engine (`star-globe`, `star-closeup`) or the rock engine (`rock`) builds, timed from `compileShader` to the return of the `LINK_STATUS` read.                                                                                                                                                                                                                               |
| `fly.html?id=t1f&alt=3`         | The fly view from a fixed camera: frame time, and `scale_corr`, the picture at resolution scale 1 against the picture after the resolution scaler shrank to about 0.5 (upsampled; `all` = luminance, `detail` = its high-pass part). With `ref=<module folder>` it also draws with a second copy of the engine and reports the pixel difference (`mean_level`, `over8_pct` of channels off by more than 8 levels). |

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

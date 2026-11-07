# File layout, acceptance tests and open items

> **Part of:** Rendering & haptics spec ([index](README.md)) · **Sections:** R10, R11, R12 · **Implements:** D-11, D-17, D-18, D-21 ([decisions](../decisions.md))

## R10. File layout and ownership

```
backend/app/core/render/            (Atish)
  card_to_params.py   # §6.2 rules + tags; pipeline stage 7 (A4.7), issue #5, built
  blackbody.py        # §7.5 Teff -> display colour, issue #5
  noise.py craters.py height.py normals.py palette.py bake.py   # issue #6, built
  params.py           # §6.2 generator parameters (BakeParams, BakeRefusal); card_to_params adds the tags
  __main__.py         # python -m app.core.render <card.json> --seed N --out DIR
  gemini_paint.py     # stretch, behind the admin token
  spherex_rgb.py      # §5.2 channel extraction, issue #5, built
backend/app/core/classify/           (Atish)  # pipeline stage 3 (A4.3), issue #5: rules.py (R3.3, R12 #12 thresholds block)
backend/app/core/card/               (Kevin)  # pipeline stages 4 and 5 (A4.4, A4.5), issue #5: catalogue.py, build.py,
                                              # assets.py (A5.4 store), validate.py (jsonschema, Q-40), service.py
backend/assets/                               # A5.4 pre-baked assets, <type>/<id>.json (none yet)
backend/app/api/                     (Kevin)  # D-16 endpoints; resolve.py; objects.py: /frames, /cutouts, /card, /render-params (issue #5)
backend/app/adapters/                (Kevin)  # IRSA SIA + cutouts, SIMBAD, SBDB, Horizons, SkyBoT (A3), all through the cache
backend/app/cache/                   (Kevin)  # D-25 read-through disk cache
backend/app/core/find/               (Kevin)  # pipeline stage 1 (A4.1): resolver, proper motion, WCS, frames, cutout PNG
backend/app/contract/                (generated, D-18)  # Pydantic models generated from shared/schemas/ by
                                                        # scripts/generate_contract.py; follows the owner of shared/schemas/
backend/app/core/measure/            (Moon)  # pipeline stage 2 (A4.2), issue #2: config, flags, aperture,
                                                            # solid_angle, photometry, spectrum; endpoint in app/api/spectrum.py
frontend/src/viewer/                 (Moon)
  ViewerApp.ts lighting.ts modes.ts honesty.ts scaleBar.ts altText.ts
  planTypes.ts planCommon.ts renderPlan.ts   # pure RenderPlan: types, shared helpers, planRender (no GPU)
  renderers/AsteroidMesh.ts AsteroidProcedural.ts Comet.ts BrownDwarf.ts Star.ts   # per-type plan functions
  renderers/build.ts        # turns a RenderPlan into three.js objects
  renderers/ShaderBody.ts   # browser-shader kinds (§7.7, D-01, D-12); name [verify]
  renderers/bodyRenderer.ts # BodyRenderer contract (field, status, onChange) of the generated body
  renderers/shaderPlan.ts   # plan function of the shader kinds (honesty, Q-45 plain sphere, missing)
  renderers/shaderSpec.ts shaderPalette.ts pointClouds.ts   # card -> what to draw, palettes and lava thresholds, nebula / nova point sets
  sliders.ts          # D-26 / D-27 slider registry and overrides
  render/             # render core (issue #39): pipeline.ts (RenderChain: HDR pass, bloom, highlight clip, TAAU or SMAA),
                      # quality.ts (quality tiers low/medium/high, FrameGovernor), clock.ts (SimClock, pause reasons),
                      # workerPool.ts (WorkerPool), fanout.ts (card and render-params fan-out loader, asset prefetch)
  shaders/            # TSL helpers on three r187 (issue #39): noise.ts (seeded fbm, ridged, domainWarp, animatedCells,
                      # OCTAVES per quality tier), sphere.ts (latLon, tangentFrame, differential rotation); index.ts re-exports
  fields/             (Atish)  # field generator for shader kinds (§7.7, D-12): fieldGenerator.ts (pure, FieldSampler), noise.ts,
                               # fieldWorker.ts (field and point requests) [verify], fieldClient.ts (main-thread side, falls back)
frontend/src/haptics/                (Atish: design D-13, all haptics D-17)
  haptics.ts          # R8.8 HapticEngine: honesty gate, rate cap, multiplier, trains (Q-71), createHaptics; issue #9
  audioContext.ts     # the one shared AudioContext, created only by a click (R8.9); shared unlock state
  audioGraph.ts       # one master bus and limiter per AudioContext; the shared bell (playBell)
  settings.ts         # R8.7 settings, own Zustand store, one localStorage key; bindEngine
  calibration.ts      # R8.7 calibration: types, offset rule (#9); levels, tap-along maths, validated persistence (#10)
  platform.ts pitch.ts spectrumMapping.ts   # default outputs and deviceVibrates (Q-73), pitch from λ (Q-70), spectrum → sample (R8.6)
  tuning.ts           # every tuning constant, marked CREATIVE placeholder (D-13) or [verify on phones]
  drivers/webVibrate.ts drivers/audio.ts drivers/tauri.ts (stub, B-01)
  sources/heightMap.ts meshNormal.ts field.ts terrain.ts flow.ts spectrum.ts lightcurve.ts
  sources/types.ts relief.ts dataPulse.ts   # TouchSample, TrainSlot; R8.4 peak rule; teq, flux and binary pulses (#11)
  profiles.ts         # R8.5 buildHaptics per ObjectType + TouchHaptics (move, hold-still poll, scrub); issue #11
  probe.ts            # pointer → ray → analytic ellipsoid → body direction, UV, normal, distance, ring radius, pan (#11)
  ui/                 # PulseIndicator (D-20), UnlockButton (#9); CalibrationWizard, HapticsSettings, SpectrumHapticsPad (#10)
  sound/              # listenSweep.ts (A8 Listen sweep, issue #11); imagined drive not built yet
frontend/src/hapticsTestPage/        (Atish)  # dev-only test page behind frontend/haptics-test.html; not a build input;
                                              # panels/SpectrumPanel.tsx (#10), panels/TexturePanel.tsx (#11)
frontend/src/shaderlab/                       # dev-only shader harness behind frontend/shaderlab.html (one sphere per
                                              # viewer/shaders function, ?seed= and ?t= from the URL); not a build input, not in dist/
frontend/src/contract/               (generated, D-18)  # generated.ts comes from shared/schemas/ by json-schema-to-typescript;
                                                        # hand-written helpers such as assertTagged() and TV<T> sit next to it;
                                                        # the R8.8 runtime types stay hand-written in haptics.ts for now (Q-19)
frontend/src/state/                  (Moon)  # Zustand store: card, params, honesty, overrides (A10, D-02);
                                             # store.ts also holds the `sky` slice (flipbook session: search, frames,
                                             # playback, view mode, spectrum, link problems; A1.1, A4.1, A4.2)
frontend/src/app/                    (Moon)  # React shell: App, ViewerPanel, StatusLine, FixtureBanner, LiveAnnouncer,
                                             # Badge, StatusBoxes (loading and error boxes), urlHash.ts + useHashSync.ts
                                             # (A10 hash routing), format.ts (numbers, dates), messages.ts (user-facing
                                             # error and `missing` texts), refusals.ts (groups `missing` by reason),
                                             # RefusalList (grouped refusals with frame IDs behind a disclosure),
                                             # ui.ts (shared class names)
  api/                # M1 API client (D-16): client, config, errors, validate; types.ts is hand-written until D-18 generation
  search/             # SearchBar, parseQuery (name, or RA, Dec in decimal degrees), testTargets (the five A1.1 targets)
  flipbook/           # Flipbook player, playback, keys, cutout preloading, RainbowTrails + wavelengthColor (D-28)
  spectrum/           # SpectrumPanel, SVG SpectrumChart, scale (displays the A4.2 output)
frontend/src/test/                           # test-only helpers (fixtureFetch.ts, sharedFixtures.ts: loads shared/fixtures;
                                             # fakeHaptics.ts, fakeAudio.ts: fake clock, drivers and AudioContext;
                                             # hapticRecorder.ts: recording sink and TouchSample helpers, issue #11)
frontend/src/fixtures.test.ts                # fixtures are deterministic, pass the API validators, never imported by app code
frontend/e2e/                                # Playwright tests (smoke, flipbook) against the fixture server
frontend/fixtures/                           # dev and test only: SYNTHETIC fixture server, a Vite dev-server plugin
                                             # enabled by `npm run dev:fixtures`; never part of a build
frontend/scripts/                            # check-dist.js: ends `npm run build`, fails if a fixture marker is in dist/
shared/schemas/object-card.schema.json  render-params.schema.json   (Moon)
shared/fixtures/                     (Moon)  # cards/ and params/: one synthetic pair per ObjectType; invalid/: rejected cases
```

Owners follow D-17 (Munazir is Moon). `frontend/src/contract/` is generated code and follows the owner of `shared/schemas/`.

| Owner (D-17) | Also owns, outside the paths above |
|---|---|
| Kevin | Backend scaffold, data adapters (including Gaia and WISE), pipeline stages 1, 4 and 5, local hosting (D-24) |
| Moon (Munazir) | The flipbook UI, the shader kinds, the overlay UI; pipeline stage 2 (brightness and spectrum), the physics layer (architecture spec §7) |
| Atish | Pipeline stage 3 (classify), stage 7 (`card_to_params`), the texture baker, the Gemini layer |

`contract/`, `state/` and `app/` were added when the frontend was scaffolded (4 Nov 2026). See the [frontend README](../../frontend/README.md#layout). `contract/` is generated from `shared/schemas/` (D-18); CI fails if regenerated files differ from the committed ones. The generated types replaced the hand-written scaffold types in issue #4.

The `app/` subfolders (`api/`, `search/`, `flipbook/`, `spectrum/`), the `sky` slice, `src/test/`, `fixtures/` and `scripts/` were added by the flipbook and spectrum view (M1, issue #3, 5 Nov 2026). The fixture server answers `/v1` with synthetic data and marks every reply with `X-SX-Fixture: synthetic`; see the [fixtures README](../../frontend/fixtures/README.md). D-17 names no owner for `src/test/`, `fixtures/` and `scripts/`; they are dev and test tooling for the flipbook UI.

`viewer/render/`, `viewer/shaders/`, `src/shaderlab/` and `shaderlab.html` were added by the viewer render core (issue #39). Motion and quality tiers follow R5.7 and D-34; how the viewer implements them is [Q-66](../decisions.md). `shaderlab.html` is served by the dev server only; Vite builds `index.html` alone, so it never reaches `dist/`. D-17 names no owner for the harness.

---

## R11. Acceptance tests

- **Determinism:** the same card and seed give the same SHA-256 for every texture.
- **Seam:** the mean absolute height difference between column 0 and column W−1 is less than the median neighbour difference.
- **Normals:** every decoded normal has length 1 ± 0.02.
- **Honesty:** the toggle starts at + Estimated. In Measured only, no layer with a tag other than `measured` is drawn, and procedural texture haptics are silent (D-21).
- **Refusal:** removing `diameter_km` from an asteroid card puts the mesh in `missing`, with no crash.
- **Performance:** ≥30 fps rotating `asteroid_procedural` at 1024×512 on the realme 14 Pro.
- **Haptics:**
  - no more than 40 events per second under fast drags
  - the vibrate driver is a silent no-op on iPhone, and the audio driver still plays
  - the calibration values (`minMs`, level set, `avOffsetMs`) persist
  - both Android phones feel the 8 ms tick after calibration
  - after calibration, the audio–vibration offset is under a threshold (threshold: **[verify]**)
  - in Measured only, gas giant and planet texture haptics are silent; the `teq_pulse` plays only when `teq_K` is `measured` (D-21)
- **Shared field:** on a gas giant, band-boundary ticks line up with the drawn band edges, so the shader and the field agree.
- **Spectrum haptics:** dragging across a known absorption dip gives at least 3 consecutive quiet steps.
- **Comet:** toggling Aug/Dec changes the CO and H₂O shells. No tail is drawn for August.

---

## R12. Open items [verify]

1. Fallback behaviour of `WebGPURenderer` from `three/webgpu` (r187) on both phones; check via `chrome://gpu`.
2. Normal map green-channel convention ([§6.5](surface-generation.md#r65-normals-from-height-sobel-equirectangular-aware)). Baker side verified numerically (6 Nov 2026); the viewer check (north-facing slopes brighten with light from the north) is still open.
3. The Gemini image model name and its supported aspect ratios.
4. The 3I/ATLAS nucleus size limit and coma radius values, with exact citations.
5. Eps Indi Ba/Bb orbit numbers; WISE 0855 class details.
6. Barnard's Star Teff/radius, and the RW Aur disc inclination source.
7. The realme 14 Pro's minimum perceptible pulse ([§8.7](haptics/calibration.md#r87-calibration-and-settings)).
8. Whether Chrome on Android offers any amplitude control for `navigator.vibrate` ([§8.3](haptics/platform-encoding.md#r83-encoding-web-driver-d-09), D-09).
9. Chrome's pattern-length cap, believed about 99 entries ([§8.3](haptics/platform-encoding.md#r83-encoding-web-driver-d-09)).
10. `AudioContext.outputLatency` support in Android Chrome, and the "high latency" threshold ([§8.9](haptics/audio-pairing.md#r89-audio-pairing-d-10)).
11. Whether battery saver suppresses vibration on both phones.
12. Exoplanet type thresholds for `planet_rocky` / `planet_water` / `gas_giant` ([§3.3](data-contract.md#r33-type-selection-backend)). Teq is now `teq_K` in [§3.2](data-contract.md#r32-objectcard-produced-by-the-backend-get-v1objectsidcard) (D-12); any other ObjectCard fields for exoplanets are not yet defined.
13. Whether the pulse-width whisper (e.g. `[4, 4, 4, 4, 4]`) is felt as distinct on each phone ([§8.3](haptics/platform-encoding.md#r83-encoding-web-driver-d-09), [§8.7](haptics/calibration.md#r87-calibration-and-settings)).
14. The gas giant jet pulse rate, clamp(k · |zonal wind| / max |zonal wind|, 2, 20) Hz, felt on both phones ([§8.4](haptics/sources.md#r84-event-sources), D-12). The field's channel packing and lava-crack channel are settled by D-12 ([§7.7](renderers/shader-kinds.md#r77-shader-generated-kinds-planet_rocky-planet_water-gas_giant-nebula-nova)).
15. Brown dwarf `flux_45um` normalisation reference (`BROWN_DWARF_CONFIG.flux45Reference`, null): without it the `emissive` layer is not drawn ([§7.4](renderers/brown-dwarf.md)).
16. SPHEREx time span for the star proper-motion trail (`STAR_CONFIG.spherexBaselineYears`, null): without it `motion_trail` is not drawn.
17. Which `FLAGS` bit means saturation in the SPHEREx light curve. The viewer excludes any point with non-zero `flags` until this is known.
18. Mauritius length in the scale bar (R5.4, ~65 km): the comparison is not offered while `COMPARISONS` holds `null`.

# File layout: the rest of the repository

> **Part of:** Rendering & haptics spec ([index](README.md)) · **Sections:** R10.1 · **Implements:** [D-11, D-17](../decisions/scope-process.md), [D-18](../decisions/contract.md) · **Read with:** [layout.md](layout.md) (R10), [../uml/04-package.md](../uml/04-package.md), [../../frontend/README.md](../../frontend/README.md#layout)

### R10.1 Rest of the repository (interim)

The paths below are not rendering code. They stay here until the architecture spec takes over the repo-wide layout (D-11 still points at this spec). Owners follow D-17; "proposed" or "provisional" owners wait for the named decision.

```
backend/app/core/classify/           (Atish)  # pipeline stage 3 (A4.3), issue #5: rules.py (R3.3, R12 #12 thresholds block)
backend/app/core/card/               (Kevin)  # pipeline stages 4 and 5 (A4.4, A4.5), issue #5: catalogue.py, build.py,
                                              # assets.py (A5.4 store), validate.py (jsonschema, Q-40), service.py
                                              # (ObjectPipeline: the object job, first/partial/final answers, issue #41)
backend/app/core/jobs.py             (Kevin, proposed: Q-111)  # JobRegistry: one background job per object, progress (issue #41)
backend/app/core/warm.py             (Kevin, proposed: Q-111)  # start-up warm cache for demo targets (D-25, issue #41)
backend/assets/                               # A5.4 pre-baked assets, <type>/<id>.json
backend/app/api/                     (Kevin)  # D-16 endpoints; resolve.py; objects.py: /frames, /cutouts, /card, /render-params;
                                              # sky.py: /v1/sky/... (Q-87; /v1/sky/cached, Q-98); composite.py (Q-92);
                                              # overlays.py: /overlays, /flags/{frame_id}.png, /combine.png (A4.9, Q-50);
                                              # gemini.py: admin repaint and /albedo-ai(.webp) (A6.2, Q-122);
                                              # deps.py: require_admin (X-SX-Admin-Token, Q-122), require_object
backend/app/adapters/                (Kevin)  # IRSA SIA + cutouts, SIMBAD, SBDB, Horizons, SkyBoT, Gaia and CatWISE2020 over TAP (A3), all through the cache
backend/app/cache/                   (Kevin)  # D-25 read-through disk cache
backend/app/core/find/               (Kevin)  # pipeline stage 1 (A4.1): resolver, proper motion, WCS, frames, cutout PNG;
                                              # overlays, flagmask, combine (A4.9, issue #12)
backend/app/contract/                (generated, D-18)  # Pydantic models from shared/schemas/ (scripts/generate_contract.py)
backend/app/core/sky/                (no D-17 owner yet)  # sky view (Q-87, Q-88): surveys.py, healpix.py, bake.py; scripts/sky_mirror.py, sky_bake.py
backend/app/core/composite/          (no D-17 owner yet)  # SPHEREx false-colour composite (Q-92, Q-94); tag `derived` (Q-27)
backend/app/core/measure/            (Moon)   # pipeline stage 2 (A4.2), issue #2: config, flags, aperture, solid_angle,
                                              # photometry, spectrum; endpoint in app/api/spectrum.py; pool.py (issue #41, Q-112)
frontend/src/state/                  (Moon)   # Zustand store: card, params, honesty, overrides (A10, D-02); the `sky` slice
frontend/src/physics/                (Moon)   # A7 physics layer (A4.6, issue #13): constants, tagging, planets, gasGiants,
                                              # brownDwarfs, asteroids, snr, index (derivePhysics, selectPhysics)
frontend/src/app/                    (Moon)   # React shell (A10 hash routing, messages, refusals, Badge, Segmented, ViewerPanel)
  api/ search/ flipbook/ spectrum/   # M1 (issue #3) and the flipbook additions (Q-93, Q-95, Q-97, Q-102)
  shell/ sky/                        # the shell and sky pane (A21; provisional, Q-89)
  build/                             # R5.8, listed in R10
  island/                            # the island and its loader (A21.5; Q-121, Q-123)
frontend/src/test/                            # test-only helpers (fixtureFetch, sharedFixtures, fakeHaptics, fakeAudio, hapticRecorder)
frontend/src/fixtures.test.ts                 # fixtures are deterministic, pass the API validators, never imported by app code
frontend/e2e/                                 # Playwright tests against the fixture server (R11 lists the rendering gates)
frontend/fixtures/                            # dev and test only: SYNTHETIC fixture server (`npm run dev:fixtures`); never in a build;
                                              # also serves /data/textures (shared/fixtures/textures) and /data/shapes (Q-114)
frontend/scripts/                             # check-dist.js: ends `npm run build`, fails if a fixture marker is in dist/
```

**History.** `contract/`, `state/` and `app/` were added when the frontend was scaffolded (4 Nov 2026); the generated types replaced the hand-written scaffold types in issue #4, and CI fails if regenerated files differ. The flipbook and spectrum view (M1, issue #3, 5 Nov) added `app/api/`, `search/`, `flipbook/`, `spectrum/`, the `sky` slice, `src/test/`, `fixtures/` and `scripts/`; the fixture server marks every reply with `X-SX-Fixture: synthetic` ([fixtures README](../../frontend/fixtures/README.md)). The sky-view prototype (7 Nov) added `app/shell/`, `app/sky/`, `viewer/sky/`, `backend/app/core/sky/`, the composite and `/v1/sky/cached` (data: A3.11; licence: D-35). The render core (issue #39) added `viewer/render/`, `viewer/shaders/` and `shaderlab/` (Q-66). D-17 names no owner for `src/test/`, `fixtures/`, `scripts/`, `core/sky/` and `core/composite/` (whose constants are Atish's creative call, Q-94).

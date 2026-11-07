# Fixtures (dev and test only)

**Everything served from here is synthetic.** Frame times, wavelengths, pixel positions, fluxes, errors, flags and cutout pixels are invented to exercise the flipbook and spectrum UI. They do not imitate the real objects and are not SPHEREx data.

## Switching them on

| Command                                         | `/v1` goes to                                                                                |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `npm run dev`                                   | the backend, through the Vite proxy (`http://localhost:8000`, override with `SX_API_TARGET`) |
| `npm run dev:fixtures` (`vite --mode fixtures`) | these synthetic fixtures; no backend needed                                                  |
| `npm run test:e2e`                              | always the fixtures (Playwright starts `dev:fixtures`)                                       |

## Why a normal build can never show them

1. `vitePlugin.ts` is a dev-server plugin (`apply: 'serve'`), added only in `--mode fixtures`. `vite build` and `vite preview` never run it.
2. No app module under `src/` imports `fixtures/`. `src/fixtures.test.ts` checks this.
3. `npm run build` ends with `scripts/check-dist.js`, which fails if a fixture marker string is found in `dist/`.
4. Every fixture reply carries `X-SX-Fixture: synthetic`. The UI then shows a page-wide "Fixture data" banner, "Fixture" badges instead of "Measured", and a SYNTHETIC label on the image.

## What is in them

| Item        | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Targets     | The five A1.1 targets (Barnard's Star, Epsilon Indi B, WISE 0855-0714, RW Aurigae, R Draconis), plus `synthetic-mover` (to test Rainbow Trails) and `synthetic-refused-mover` (empty frames with `missing: ["frames:moving_object_search"]`, as the M1 backend does for Solar System movers).                                                                                                                                                                                                                                                                                                          |
| Coordinates | ICRS J2000 RA/Dec of the five targets from SIMBAD, checked 5 Nov 2026 against the backend's recorded SIMBAD replies. The synthetic objects have made-up positions.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Frames      | 24 per target (16 for the mover), 64×64 PNG cutouts, `data_release: "synthetic_fixture"`. The five targets use `north_up: false` with a synthetic `north_angle_deg`, so the star field rotates between frames. The mover uses `north_up: true` with per-frame `ra`/`dec`.                                                                                                                                                                                                                                                                                                                              |
| Spectrum    | Generic smooth curve plus seeded noise, `flux_unit: "synthetic units (fixture)"`. Each listed frame is a point or a refusal `<reason>:<frame_id>` in `missing`, like the backend (A4.2). The shapes, not the numbers, mirror the real backend on the full cache (6 Nov 2026): Barnard's Star and R Draconis have no points (mostly `saturated`), Epsilon Indi B and WISE 0855-0714 have 22 points (3 flagged, 2 `aperture_flags`), RW Aurigae has 4 short-wavelength points (the rest mostly `saturated`). `spectrum:saturated` is added only when every listed frame is saturated (none of the five). |
| Refusal     | R Draconis frame `r-dra-f005` is listed but its cutout returns 404; it is in the frames' `missing` as `cutout:` and refused in the spectrum (a fixture-only path). `outside_cutout:r-dra-f024` is a Stage 1 refusal of a frame that is not listed, passed through to the spectrum's `missing`.                                                                                                                                                                                                                                                                                                         |
| Sky         | `/v1/sky/index.json` lists one SYNTHETIC all-sky image (`sky.ts`) at 512×256 and 1024×512 (equirect, ICRS convention as the backend's). It is not a survey: red = 16 + 120·RA/360°, green = 16 + 120·(Dec + 90°)/180°, with a 30° grid, so `e2e/sky.spec.ts` can read the orientation back from the screen.                                                                                                                                                                                                                                                                                            |
| Determinism | Seeded (mulberry32). Same target → byte-identical JSON and PNG.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Files

- `targets.ts`: the targets, aliases and name/coordinate matching.
- `synthetic.ts`: frame, spectrum and cutout generators.
- `png.ts`: small grayscale and RGB PNG encoders (stored deflate, no zlib).
- `sky.ts`: the synthetic all-sky image and the sky index.
- `handler.ts`: answers `/v1/resolve`, `/frames`, `/cutouts/{frame_id}.png` and `/spectrum` with the D-16 shapes and error bodies.
- `vitePlugin.ts`: mounts the handler on the dev server.

When the backend (#1, #2) records real responses, they can replace these for tests (D-25), but that is not wired up in M1.

# `missing` and refusal codes

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A4.12 · **Implements:** [D-25, Q-328](../decisions/data-sources.md), [D-31](../decisions/data-sources.md), [D-32](../decisions/contract-tags.md), [Q-38](../decisions/contract-tags.md), [Q-111](../decisions/pipeline-jobs.md), [Q-139](../decisions/moving-objects.md), [Q-144](../decisions/moving-objects.md), [Q-21, Q-125](../decisions/moving-frames.md) · **Read with:** [endpoints.md](endpoints.md) (A4.11), [honesty-policy.md](honesty-policy.md) (A11)

### A4.12 `missing` and refusal codes

A value the backend cannot compute is never guessed: the reply leaves it out (or `null`) and names it in its `missing` list (R1, D-25). Since D-32 a RenderParams layer first falls back a tier and is listed only when no tier can answer. This table is the one list of codes; a new code is added here in the same PR as the code that emits it. HTTP errors are a different thing: see the error envelope in [A4.11](endpoints.md#a411-endpoint-register).

**Format.** A code is `<reason>`, `<namespace>:<reason>` or `<reason>:<frame_id>`. A frame code names one frame; the others describe the whole reply. Order follows the stages, so a reply lists Stage 1's codes before its own.

**UI.** `frontend/src/app/refusals.ts` groups codes by reason (frame codes counted, whole-reply codes as notes) and `frontend/src/app/messages.ts` holds the plain-English line for each known code. A code with no wording is shown as is, never hidden (A11). `backendReasons.test.ts` checks that `FRAME_REASONS` matches the backend's Stage 1 and Stage 2 reasons. **Proposed (Q-196):** extend that test to every code in this table, so a new backend code without wording fails CI.

#### Stage 1 (`/frames`, A4.1)

| Code | Meaning |
|---|---|
| `cutout:<frame_id>` | the cutout is not in the cache and could not be downloaded (also skipped for `SX_LIVE_FAILURE_TTL_S` after a failed live try, or dropped at shutdown). Also used by Stage 2, overlays and the composite when a cutout is not cached. |
| `outside_cutout:<frame_id>` | the object's position at the frame time falls outside the cutout |
| `wavelength:<frame_id>` | no wavelength could be read at the object's pixel (`WCS-WAVE`) |
| `cutout_stretch:<frame_id>` | the display stretch could not be computed for the cutout |
| `frames:truncated` | the SIA answer hit `SX_SIA_MAXREC` (`QUERY_STATUS=OVERFLOW`); the list is incomplete and not stored |
| `cutouts:deferred:<n>` | `n` cutouts are not downloaded yet; ask again (progressive loading, A4.10) |
| `reference:not_a_spherex_target` | a reference object (the Sun, Jupiter, Saturn, Titan; `resolver: reference`) is a solar-system body that is not a SPHEREx target, so the frame list is empty ([Q-258, Q-328](../decisions/data-sources.md)) |

Moving objects only: the path search of A4.1 (`backend/app/core/find/moving.py`, issue #26, [Q-125](../decisions/moving-frames.md)). The codes marked "incomplete" keep the list out of the cache (it is asked for again); the others are deterministic for the settings in the cache key, so a list with only those is stored. Which of them Track treats as incomplete: A19.10 ([moving-objects/track-contract.md](moving-objects/track-contract.md#a1910-refusal-codes)).

| Code | Meaning |
|---|---|
| `frames:ephemeris` | no Horizons ephemeris for the path, or for one of its windows (no SPK id, Horizons unavailable, empty); the windows that did answer are still searched. Incomplete |
| `frames:moving_window` | a configured search window is shorter than one ephemeris step, so it is not searched |
| `frames:cone_cap:<n>` | the path needs more than `SX_MOVING_MAX_CONES` cones; the cap is spread evenly over the path and `n` cones were left out, so frames between the kept cones can be missed |
| `frames:cone_maxrec:<n>` | `n` cone answers hit `SX_MOVING_SIA_MAXREC`. A fixed object's own cut-off answer stays `frames:truncated` |
| `frames:sparse_path:<n>` | at `n` cones the rate asked for a step below `SX_MOVING_MIN_STEP_H`, so the cones there are further apart than R / rate and a frame between them can be missed |
| `frames:cone_failed:<n>` | `n` cones could not be fetched (not cached offline, or failed live). Incomplete |
| `frames:search_deferred:<n>` | `n` Horizons or SIA calls are left to the object's job (Q-111); ask again, as for `cutouts:deferred`. Incomplete |
| `frames:outside_window:<n>` | `n` frames found by the cones have a midpoint outside the ephemeris windows, so the object's position there is unknown |
| `no_footprint:<frame_id>` | the frame has no usable `s_region`, so it could not be checked against the path (not the overlays' `footprint:<frame_id>`) |
| `ephemeris:<frame_id>` | the exact position at that frame's midpoint could not be fetched. Incomplete |

`frames:moving_object_search` (M1: a mover's frames refused) is no longer emitted (issue #26, Q-21).

#### Stage 2 (`/spectrum`, A4.2)

Per frame, `<reason>:<frame_id>`: `saturated` (core `OVERFLOW`, or a NaN core with `OVERFLOW`/`SUR_ERROR` in the aperture; worded without a cause, A11), `aperture_flags` (a rejected flag within 1.5 px of the object), `aperture_edge` (the aperture leaves the cutout), `background` (no usable annulus), `unit` (`BUNIT` is not MJy/sr), `extension` (no `IMAGE`, `FLAGS` or `VARIANCE`), `flags_header` (the `FLAGS` header does not define `OVERFLOW` and `SUR_ERROR`), `pixel_area` (no pixel solid angle from the WCS), `measure` (the photometry failed), `cutout_unreadable` (the cached FITS cannot be read), `cutout` (not cached).

| Code | Meaning |
|---|---|
| `spectrum:saturated` | every listed frame was refused as `saturated` (D-31) |
| `spectrum:extended_source` | **To build** ([Q-144](../decisions/moving-objects.md)): a comet whose coma fills the aperture; otherwise the aperture brightness is shown with "aperture, not total flux". Per-frame form `extended_source:<frame_id>`: A19.8 and A19.10 ([moving-objects/track-contract.md](moving-objects/track-contract.md)) |

Not a refusal: a point kept with dropped pixels is `flagged`, with `dropped_flags` and `flag_reasons` (incl. `no_proper_motion`). For moving objects, `OUTLIER` on the core will be a flag, not a refusal: the point is `flagged` and `flag_reasons` gains `outlier_core` ([Q-139](../decisions/moving-objects.md), A19.7; to build, ticket T4). Until then the core `OUTLIER` refuses the frame as `aperture_flags` for movers too (15 of 16 Eros frames, A4.2).

#### Card and RenderParams (A4.3 to A4.7)

| Code | Where | Meaning |
|---|---|---|
| `catalogue` | card, params | no catalogue answered for the object (SIMBAD or SBDB) |
| `exoplanet_archive` | card, params | a SIMBAD `Pl` object with no Exoplanet Archive row; the type becomes `candidate` |
| `lighting` | card, params | Horizons could not give the phase angle and Sun vector (Q-62); the asset is not saved |
| `spectrum` | params | no measured spectrum for a layer that needs one |
| `type:exoplanet_thresholds` | card, params | a Q-63 threshold is set to `None` (withdrawn), so the planet is `candidate`. The rule is on since issue #68, so this is not emitted today |
| `type:exoplanet_radius`, `type:exoplanet_mass`, `type:exoplanet_envelope`, `type:exoplanet_water_model_range`, `type:exoplanet_mass_range` | card, params | the Q-63 rule cannot place the planet (meanings in Q-63) |
| `<layer_id>` | params | a layer or haptic source no tier can answer, for example `mesh`, `textures`, `visible`, `spherex_ir`, `field`, `flux_pulse`, `teq_pulse`, `heartbeat`, `dimming`, `motion`; since issue #62 also the gas giant's `bands`, `flattening`, `colour`, `storms`, `turbulence` (a `null` typical constant refuses its layer, Q-115) and the brown dwarf's `limb_darkening` (Q-116) (full set: `backend/app/core/render/card_to_params.py`; layer ids: R3.4). The viewer adds its own reasons for layers the backend did not send (`backend`) or that the quality level cannot draw (`quality`, the asteroid `displacement` on the phone tier, Q-117); those are viewer plan reasons (`MissingReason`, `viewer/planTypes.ts`), not backend codes |
| `dynamics:<key>` | params | a D-32 rate no rung can answer. Fixtures only: live params carry no `dynamics` yet (A4.7) |
| `measuring:spectrum`, `measuring:<layer>` | params | intermediate answer: waits for the spectrum (A4.10). In the card, the field's `source` starts `measuring:` instead |
| `measuring:frames` | params | partial answer: more frames are coming (A4.10) |

#### Overlays (`/overlays`, A4.9)

| Code | Meaning |
|---|---|
| `overlay:gaia`, `overlay:wise` | the catalogue cannot be served (failed cone, remembered `catalog_failure_ttl_s`), or the object moves (cones for movers: Q-143, to build); a mover's frames still get flag masks and cutout boxes ([Q-125](../decisions/moving-frames.md)) |
| `overlay:<cat>:pending` | the cone is still running after `overlay_wait_s`; a later request has it |
| `overlay:<cat>:truncated` | the cone hit the 5000-row cap (brightest first) |
| `footprint:<frame_id>` | no usable `s_region` for the frame; for a mover, every frame, because its frame record does not carry `s_region` (Q-125; Track changes this, A19.3) |
| `flags_mask:<frame_id>` | no FLAGS mask for the frame (`flags.png` answers 404 `flags_unavailable`) |

#### Composite (`/composite`)

Owner of the rules: [backend/README.md#composite](../../backend/README.md#composite) (Q-92, Q-94). Refusals: `composite:moving_object`, `composite:<channel>:no_frame`, `composite:<channel>:saturated`, `composite:<channel>:no_usable_frame`, `composite:too_few_bands`, `composite:saturated`, `composite:no_common_pass`, `composite:<channel>:stretch`, `composite:pixel_scale`, `cutout:<id>`. Notes on a built image: `composite:<channel>:skipped:<reason>:<frame_id>`, `composite:no_proper_motion`, `composite:flags_unmasked:<id>`; `frames:truncated` and `cutouts:deferred:<n>` pass through. `<channel>` is `blue`, `green` or `red`.

#### Gemini layer and baker (A6.2)

The repaint status body's `missing` starts with `albedo_ai`, followed by the reason; the reasons are listed in [A6.2](generators.md#a62-optional-gemini-artistic-layer). A bake that cannot use an input bakes flat and lists it in `BakeParams.missing` (`albedo_map`, `gaia_rgb`, `brightness`, `bands`), which a Gemini `bake_refused` reply passes on.

#### Planned (Track and Area search)

| Code | Spec | Status |
|---|---|---|
| `path:deferred`, `path:ephemeris`, `path:observer`, `path:not_cached`, `path:window` (`/path`); `extended_source:<frame_id>` (`/spectrum`); `imagery:<survey>`, `track:not_moving` (frontend) | A19.10 ([moving-objects/track-contract.md](moving-objects/track-contract.md#a1910-refusal-codes)), which says whether each marks a result incomplete; the meanings of the `/path` codes are in A19.5 ([moving-objects/track.md](moving-objects/track.md#a195-path-endpoint)) | to build (Track, Q-141, Q-144) |
| `area:not_prepared` (a square outside the precomputed areas), `area:visits` (fewer than 2 visits), `stars:<cat>:<visit>` (a visit's star cone failed), `skybot:<visit>` (a visit's SkyBoT cone failed), `horizons:<designation>` (a candidate's Horizons call failed), `stamp:<dot_id>` (stamp cutout not cached) | [A17.8](moving-objects/area-contract.md#a178-endpoints), which owns their meanings | to build (D1, D2) |

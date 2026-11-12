# Decisions: Haptics and sound: design

> **Part of:** the decision log ([index](README.md)) · **Holds:** haptics design rules, creative ownership, the haptics API, the shared field on shader kinds, texture and data sources per type (audio pairing, pitch, the body tone and the path sound are in [haptics-sound.md](haptics-sound.md)) · **Authority:** highest; an entry here wins over [rendering/](../rendering/README.md) and [architecture/](../architecture/README.md) (see the index for precedence)

> **D-39 (12 Nov 2026):** haptics are cut and the haptics code is deleted. D-08, D-09 and D-20 and the purely haptic questions here are superseded; D-12 and D-13 keep only their sound and ownership parts. Entries stay for history ([sound-ambience.md](sound-ambience.md)).

## D-08 Haptics run on the web, not in a native app

**Superseded by:** D-39 (12 Nov 2026).

- **Decision:** For the event, haptics use `navigator.vibrate` in Android Chrome. iPhone, iPad and desktop get audio only. No Tauri build.
- **Why:**
  - The challenge requires a web tool, and judges will not sideload an APK.
  - `navigator.vibrate` covers every pattern in rendering doc §8.3.
  - The `HapticDriver` interface lets `drivers/tauri.ts` be added later (B-01) without touching the event sources.
- **Amended by:** Q-132 (9 Nov 2026: at the event there is no `navigator.vibrate` and no Android build; the engine plays through the audio driver only, in desktop Chrome on the A15; Android Chrome vibration and Tauri, B-01, are after the event). Spec: [R8.1](../rendering/haptics/platform-encoding.md#r81-platform-reality).

## D-09 Haptic strength is quantised

**Superseded by:** D-39 (12 Nov 2026).

- **Context:** `navigator.vibrate` takes durations only. There is no amplitude control in Chrome as far as we know **[verify]**.
- **Decision:**
  - The web driver maps `strength` to **3–4 discrete levels** (soft, medium, firm, plus an optional pulse-width "whisper" if the phone can render it). It does not use a continuous scale.
  - Fine detail is carried by **rhythm, rate and spacing**, and by the paired audio (D-10).
  - Calibration measures both the faintest pulse each phone can render (`minMs`) and how many levels can be told apart, stored per device.
- **Amended by:** Q-132 (deferred: quantised vibration levels and per-device calibration apply after the event; [R8.3](../rendering/haptics/platform-encoding.md#r83-encoding-web-driver-d-09), [R8.7](../rendering/haptics/calibration.md#r87-calibration-and-settings)).

## D-12 Haptics on gas giants, water worlds and other shader-generated bodies

**Amended by:** D-39 (12 Nov 2026).

- **Status:** Accepted, signed off by Atish (D-13) on 5 Nov 2026. Moon's confirmation of the shader-kind architecture (the shared field and its packing) was requested in PR #18 and is pending. The jet pulse rate stays **[verify on phones]**.
- **Context:** These kinds are drawn by browser shaders (D-01), so there is no baked height map for a finger to sample. For exoplanets there is also no measured surface at all, so every texture haptic is `artistic`.
- **Decision:**
  - **One shared field per body.** When a body loads, a Web Worker generates an equirectangular field at 512×256 from the same seed and functions as the shader. It does this once, not per frame. The field has channels for height, band index, ocean mask, ice mask and storm id.
  - The shader samples the field as a `DataTexture`, and the haptic sources sample the same array. This keeps rendering doc principle 6 ("one height map drives everything") true for these kinds.
  - The shader may add finer visual noise below the field's resolution. That detail is seen but not felt.

  | Kind | Texture haptics (`artistic`) | Data haptics |
  |---|---|---|
  | `gas_giant` | No surface, so the finger feels the **flow**: a soft tick crossing each band boundary (strength = band contrast); inside a jet, a pulse train whose rate ∝ the zonal wind speed at that latitude; on a storm, a firm tick at its edge and a pulse rate that rises towards its centre (a "swirl"); dragging across rings gives a tick at each gap | Holding still gives a steady pulse, rate ∝ normalised `Teq` (`derived`, 2–12 Hz), as for brown dwarfs |
  | `planet_water` | Open ocean: near-silent slow swell (1–2 Hz, lowest level); coastline: one firm tick; land: height-map ticks as for `asteroid_procedural`; polar ice: dense, fine, soft ticks; clouds: not felt (optional "feel clouds" toggle) | As for `gas_giant` (`Teq` pulse) |
  | `planet_rocky` | Height-map ticks; lava cracks give a double tick | As for `gas_giant` |
  | `nebula`, `nova` | Field source as for the comet (§8.4): pulse rate ∝ local point density | — |

  - **Audio pairing (D-10):**
    - Gas giant bands: a tone whose pitch follows latitude.
    - Ocean: filtered noise, a "surf" sound.
    - Land: clicks, as for asteroids.
    - Every texture sound uses the `artistic` timbre.
  - **Honesty:** in "Measured only" all texture haptics on these kinds are silent, because nothing about their surfaces is measured. The data pulse remains only when `teq_K` is `measured` (Exoplanet Archive `pl_eqt`); a `derived` pulse plays from "+ Estimated" (D-21).
  - **HapticProfile:** `texture` gains `'terrain'` (height plus ocean and ice masks) and `'flow'` (bands, jets, storms). `data` gains `'teq_pulse'`.
  - **Field channels and packing.** There are six channels, packed into two RGBA `Float32` `DataTexture`s. The haptics read the same `Float32Array`s.
    - Texture A: R = height, G = band index, B = storm id, A = unused.
    - Texture B: R = ocean mask, G = ice mask, B = lava-crack mask, A = unused.
  - **Jet pulse rate:** clamp(k · |zonal wind| / max |zonal wind|, 2, 20) Hz **[verify on phones]**.
  - **New ObjectCard field:** `teq_K?: TV` (planet equilibrium temperature, from Exoplanet Archive `pl_eqt` when present, tagged `measured`, otherwise `derived` from architecture spec §7.1). `teq_pulse` is refused and listed in `missing` when it is null.
  - `nebula` and `nova` have no catalogue rule. They are slider-only showcase bodies, and every value is tagged `artistic`.
  - **Strength quantisation (D-09):** split 0–1 into equal bins as a starting point. Calibration may move the bin edges per device.
  - **Amendment (issue #43, Q-103; Atish's sign-off pending, D-13, D-17):** the nebula and the nova are now drawn as volumes and have **no haptics**. The `nebula`, `nova` row of the table above ("pulse rate ∝ local point density") no longer applies, because that pulse read a point set that is no longer drawn: you would feel density where nothing is shown, which breaks principle 6 and D-34 (what is felt matches what is seen). The nebula decision is Moon's (7 Nov 2026). The nova follows the review of PR #51 (the reviewer's alternative: `data: none` until a CPU twin of the noise cube can be sampled). The 3D view says so in plain words ("Nebulae have no touch feedback"). This note records the change; Atish accepts or reverses it.
- **Amended by:** Q-359 (issue #93, 11 Nov 2026): a catalogue `teq_K` (archive `pl_eqt`) is `derived` with its albedo assumption, not `measured`, so in "Measured only" the `teq_pulse` plays only for a `teq_K` that is really measured ([physics-fixes](physics-fixes.md)).
- **Amended by:** Q-133 (9 Nov 2026: the audio bullet "Land: clicks, as for asteroids" is replaced by the body tone, [R8.9.1](../rendering/haptics/audio-pairing.md#r891-body-tone-from-the-height-map-q-133); gas giants keep the flow cues and the ocean holds the tone at sea level, Q-191; sustained timbre by tag, Q-190). The "[verify on phones]" on the jet rate now reads "[verify by ear on the A15; by touch after the event]" (Q-132, R12 #14). For `gas_giant`, Texture A R holds the band profile (Q-48).
- **Status note (9 Nov 2026):** "generates … once" disagrees with D-34's "Haptic field is recomputed at 4 Hz or less"; the code follows neither (moving storms are sampled analytically at the scene's t). Open in Q-105 (Q-68 asks the same).

## D-13 Creative ownership of haptics

**Amended by:** D-39 (12 Nov 2026).

- **Decision:** The haptic feedback concept is Atish's idea, and **Atish owns its creative direction**: what each body and data type feels like, the patterns and metaphors, and how sound pairs with touch. Atish signs off haptics design decisions, including D-12 and Q-11.
- **How it applies:**
  - Teammates' prototypes, such as the mock-up's `SphereXHaptics`, and agent suggestions are input, not decisions.
  - Agents implement the design as written. Where it is open, they use a neutral placeholder marked `CREATIVE: placeholder — Atish to decide`.
  - Engineering choices stay with the implementer: drivers, timing, rate limits, buffering and testability.
- Recorded 4 Nov 2026.

---

Decisions D-14 to D-29 were recorded on 5 Nov 2026. They answer Q-01 to Q-14 and add the hosting, caching and milestone decisions.

## D-20 Haptics API (answers Q-11)

**Amended by:** D-39 (12 Nov 2026): the vibration parts are cut; the event API stays as the sound engine's.

- **Decision (Atish, D-13):** the merge proposed in Q-11.
  - Rendering doc R8.8's discrete `HapticEvent` is the core API. It carries the provenance `tag`, which the honesty rule and the audio timbre need.
  - `HapticEvent` gains an optional `sharpness`. The web driver ignores it; a future Tauri driver (B-01) uses it.
  - The mock-up's native and iOS bridges are dropped for the event (D-08). The `HapticDriver` interface keeps the door open.
  - The mock-up's `spherex:haptic` DOM event stays as a debug hook. It also drives an on-screen pulse indicator, so an audience watching the laptop can see what the phone feels.
  - Nebulae and novae get the D-12 field pulse, not a refusal.
  - **Amended (issue #43, Q-103; Atish's sign-off pending):** no longer. Nebulae and novae are drawn as volumes and have no haptics; they are neither refused nor given a pulse, and the view says so in plain words. See the amendment note under D-12.
  - Tick lengths follow R8.3: 8–25 ms with the calibrated `minMs`.
- **Amended by:** Q-132 (at the event the on-screen pulse indicator shows what is heard, not what a phone feels).

## Questions

Status, owner and full text as recorded. The [index](README.md) lists every ID with its file.

| ID | Question | Owner | Status |
|---|---|---|---|
| Q-11 | The mock-up's Haptics tool (commit `4629305`, `mockup/spherex-ui.html`, `SphereXHaptics`) differs from rendering doc R8.8. See the differences listed below this table. Which one becomes the app API? Possible merge: keep R8.8's `HapticEvent`, add `sharpness` for the native path, and keep the mock-up's `spherex:haptic` event for debugging. **Atish decides (D-13)**; Moon gives input. | Atish | Answered: D-20 |
| Q-17 | Rendering doc R8.4 tags the comet field source `measured` + `model_dependent`, but a `HapticEvent` carries one `tag` (R8.8), and under D-21 "Measured only" hides `model_dependent`. Which tag does the comet field pulse carry, and does it play in "Measured only"? Blocks the haptics sources implementation. | Atish | Open |
| Q-19 | Once `frontend/src/contract/` is generated from `shared/schemas/` (D-17, D-18), where do the frontend-only R8.8 types live (`HapticKind`, `HapticEvent`, `HapticDriver`)? They are not sent by the backend, and `HapticDriver` has methods that JSON Schema cannot express. Options: hand-written next to the generated types (like `assertTagged()`), or in `frontend/src/haptics/`. **Status note (9 Nov 2026):** built as the first option: hand-written in `frontend/src/contract/haptics.ts`, re-exported by `haptics/haptics.ts`; R8.8 and R10 name the path, so the row reads as Open (built). | Atish, Moon | Open |
| Q-37 | `HapticProfile` against R8.5. R8.5 and D-12 list the nebula and nova field source under texture haptics, and the comet's nucleus tick too, but R8.8 has `field` only in `data`, and `texture` has no matching value. The fixtures use `texture: "none"`, `data: "field"`. `texture_tag` and `data_tag` are required even when the channel is `none`; the fixtures use `artistic`, the tag that claims least. The comet's `data_tag` waits on Q-17; the fixture uses `model_dependent`, the safer choice. `teq_pulse` when refused gives `data: "none"`. Confirm. **Amended by:** Q-103 (nebulae and novae are drawn as volumes and have no haptics; Atish's acceptance pending), so the nebula and nova field-source items no longer apply. | Atish | Open (implemented as described) |
| Q-68 | Field-worker interface (issue #39, D-12, D-13, D-17, R5.7 "touch matches sight"). Proposed to Atish; nothing under `viewer/fields/` has changed. **Conflict with D-12:** D-12 says the haptic field is "generated once, not per frame". This proposal regenerates it at 4 Hz or less, and only for a body whose surface moves while the clock runs. A still body keeps the field generated once. D-12 would need that amendment. **Request:** `{ objectId, seed, type, coefficients, octaves, t, grid: [w, h], seq }`. `t` is the `SimClock` sim time, and `octaves` comes from the quality level. **Response:** `{ seq, t, grid, height: Float32Array, flow?: Float32Array }`, with the buffers transferred. `t` echoes the time the arrays are valid for. **Rate:** about 4 requests a second, only while the body is visible. A newer request replaces one still in flight, by `seq` and abort. **Time:** `SimClock` is the only source of `t`. The shader and haptics read the latest field at its `t`, so touch and sight stay in step (D-13). **Determinism:** the output depends only on (card, seed, octaves, t, grid), with no worker state, so any worker in the pool (`viewer/render/workerPool.ts`) gives identical bytes. **Shared functions (D-12):** the sphere helpers in `viewer/shaders/sphere.ts` have CPU twins, but the noise in `viewer/shaders/noise.ts` does not yet. A CPU twin must exist before the worker uses that noise. **Shader time:** `t` grows without bound. At ×1000 a float32 `t` starts to step visibly after about 17 minutes, so wrap it per period or split it into high and low parts before the shaders read it. **Status note (9 Nov 2026):** same question as Q-105: the code samples moving storms analytically at the scene's t, with no 4 Hz worker. Answer both together, with D-34's "Haptic field is recomputed at 4 Hz" bullet. | Atish | Open |
| Q-78 | Texture haptics without the data channel they need (issue #11; R8.4, R8.5, D-21). (1) Crater rims on procedural asteroids: R8.4 asks for a double tick inside a crater rim band and silence on crater floors, "from a crater mask channel". The bake ships `height.bin` with height only (`backend/app/core/render/bake.py`); the crater floor mask the baker computes (`craters.craters`) is used for the albedo and not exported. Implemented: the rim double tick and the silent floor are **refused** and listed in `missing` as `crater_rims`; the plain R8.4 height ticks still play. Proposal: the baker writes a crater mask (rim band and floor) next to `height.bin`, for example `craters.bin` as uint8 W×H, and RenderParams.textures gains its URL. (2) Mesh normals on real shape models (review M1): the `three-mesh-bvh` raycast is not built, and a bounding sphere's normal turns more than 12° near its limb and its limb is not the silhouette, so it would invent `measured` ticks that play in Measured only. Implemented: `texture: mesh` is **refused** (`mesh_normals` in `missing`) unless the caller passes `meshNormals: true`, meaning it fills `TouchSample.normal` from a real mesh raycast (M5). The angle rule and the limb tick are built and tested on synthetic normals. **Amended by:** Q-133 (sound superseded by the body tone); the ticks are vibration after the event (Q-192). | Atish, Kevin | Superseded by D-39 |
| Q-79 | Gas giant band-boundary strength (issue #11; R8.4 flow item 2, R8.5, D-12). R8.5 says "strength = band contrast", but the gas field has no per-boundary contrast: every boundary is a crossing of the same 0–1 band profile (`gasBandAt`), and the drawn contrast comes from the artistic palette. Implemented: the band-boundary tick uses the soft-tick strength (`STRENGTH_SOFT`, a CREATIVE placeholder in `tuning.ts`), voice `tone`, pitch from latitude. Options for Atish (D-13): keep a fixed soft tick, or take the luminance step between the palette colours either side of the boundary. Brown dwarfs do have a band contrast, `clamp(2 · ch4_depth_33, 0.1, 0.8)`, but see Q-82. **Amended by:** Q-133 (sound superseded by the body tone); the ticks are vibration after the event (Q-192). | Atish | Superseded by D-39 |
| Q-80 | T Tauri "dropped beats ∝ dimming depth" (issue #11; R8.5). The engine's train (Q-71) plays every pulse of its rate, and sources own no timers, so single beats cannot be dropped. Implemented: on each scrub step, depth = the dust-screen opacity `clamp(1 − flux/median, 0, 0.9)` (Star.ts `screenOpacity`), rate = `TTAURI_PULSE_HZ` × (1 − depth) and strength = `DATA_PULSE_STRENGTH` × (1 − depth): the fraction of beats lost per second equals the depth, but the remaining beats are regular, not a stutter. A true stutter needs a per-pulse drop in the engine train (for example `TrainParams.dropFraction` with a seeded RNG), which is an engine (#9) change. Confirm the regular thinning or ask for the engine change. | Atish | Superseded by D-39 |
| Q-81 | Tags of data haptics that encode a value other than the one `data_tag` describes (issue #11; R8.2, R8.5, D-21). (1) `brown_dwarf_binary`: the backend sets `data: flux_pulse` with `data_tag` = the tag of `flux_45um`, but R8.5's binary pulse encodes the temperature class. Implemented: the binary pulse carries the tag of `spectral_class` (what its rate encodes), as `teq_pulse` carries `teq_K`'s tag; the classes are ordered O B A F G K M L T Y, warmer faster (`BINARY_WARM_HZ`, `BINARY_COOL_HZ`); classes that cannot be ordered (one class, equal, unparseable) refuse it as `binary_pulse`. The pulse plays while the finger is on a body, not after holding still ("tapping each body"). (2) The comet nucleus tick belongs to the field source and carries `profile.data_tag`, the same as the field pulse (Q-17 stays open). Confirm both. | Atish | Superseded by D-39 |
| Q-82 | Brown dwarf band-boundary ticks (issue #11; R8.5 `bands`). The band pattern exists only inside the baked `albedo.webp` (a latitude-stretched fbm, `height.band_field`, R7.4); `height.bin` is flat for these bodies, and the client has no band index to tick on. Implemented: `texture: bands` is **refused** and listed in `missing` as `band_ticks` (not `bands`, which is the drawn layer's id). Options: the baker exports the band field (for example as `height.bin`, which is unused for brown dwarfs) so a boundary is a sign change of the field, with strength = the R7.4 band contrast; or the client reads the decoded albedo. **Amended by:** Q-133 (sound superseded by the body tone); the ticks are vibration after the event (Q-192). | Atish, Kevin | Superseded by D-39 |
| Q-85 | Texture/data channel hint on `HapticEvent` (issue #9; R8.2, D-20, Q-19). R8.2 labels haptics as texture or data in the UI, and the D-20 on-screen pulse indicator should show it to an audience watching the laptop, but a `HapticEvent` does not say which it is. Added to the hand-written contract: optional `channel?: 'texture' \| 'data'` on `HapticEvent` and on `TrainParams`, display only; every driver ignores it and the engine passes it through to the `spherex:haptic` debug event. The pulse indicator's visible caption shows the last event's kind, its D-02 badge (Measured, Estimated, or Default (artist's choice)) and "Texture" or "Data" when the event carries the hint. Sources (#10, #11) set it. | Atish | Superseded by D-39 |
| Q-86 | `detections` data haptics for `candidate` (issue #11; R8.5 "in the flipbook: one tick per frame where it's detected"). The flipbook `Frame` (`app/api/types.ts`) carries no detection field, so a frame where the candidate is detected cannot be told from one where it is not. Implemented: `data: detections` is **refused** and listed in `missing` as `detections`; nothing ticks. Proposal: the frames endpoint adds a per-frame `detected: boolean` (or a detection SNR) from stage 2, and the flipbook source ticks on it. | Atish, Kevin | Superseded by D-39 |

## Notes

**Q-11 differences between the mock-up and R8.8:**

1. **Event shape.** The mock-up streams continuous `sample({intensity, sharpness, speed, roughness, height, material})` plus `tick()`. R8.8 uses discrete `HapticEvent`s (`kind`, `strength`, `rateHz`, `tag`, `pitch`, `pan`). The mock-up has no provenance tag.
2. **Bridges.** The mock-up tries `window.SphereXNative.haptic` and an iOS `webkit.messageHandlers.sphereXHaptic` bridge before `navigator.vibrate`. D-08 is web only for the event.
3. **Nebulae and novae.** The mock-up refuses them ("no surface to feel"). D-12 gave them a field pulse; issue #43 removed it again (Q-103), so they have no haptics.
4. **Tick length.** The mock-up uses 6–22 ms. R8.3 uses 8–25 ms with calibrated `minMs`.

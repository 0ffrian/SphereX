# Display levels and shared 3D view rules

> **Part of:** Rendering & haptics spec ([index](README.md)) · **Sections:** R4, R5, R5.1–R5.7 · **Implements:** [D-05, Q-15, Q-64, Q-132](../decisions/platform-hosting.md), [D-21, Q-27](../decisions/contract-tags.md), [D-23, Q-36](../decisions/contract.md), [D-34, Q-66](../decisions/rendering-motion.md), [Q-104](../decisions/rendering-kinds.md), [D-28](../decisions/moving-objects.md), [Q-113](../decisions/shell-surfaces.md) · **Read with:** [build-mould.md](build-mould.md) (R5.8), [data-contract.md](data-contract.md) (R3.4), [accessibility.md](accessibility.md) (R9)

## R4. Display levels

1. **Sky patch (2D flipbook).** Real SPHEREx pixels. Sources are points with clickable rings plus Gaia/WISE overlay markers. This is the only fully measured view.
   - As built in M1 (issue #3): the cutout pixels, frame time and wavelength are `measured`; time and wavelength wear the Measured badge. The display stretch is `derived` (Estimated badge; the tooltip gives the stretch kind and parameters), as are the pixel positions `x`, `y` ([architecture spec §4.1](../architecture/pipeline.md#a41-stage-1-find-the-object)). How "Measured only" treats the stretched picture and the ring: Q-28.
   - Rainbow Trails (D-28), a flipbook view mode: the dot colour is a false colour, hue = wavelength, tagged `derived` with that formula (Estimated badge). In "Measured only" (D-21) the dots are drawn in one colour. Tag question: Q-27.
   - Colour views (sky-view prototype): Raw (the grey frames) or Colour, either the **wavelength tint** (each grey frame multiplied by the Rainbow Trails colour of its own wavelength; `derived`, Estimated badge) or the **SPHEREx composite** (one RGB picture the backend builds from three aligned frames, north up, east left; `derived` with the reply's formula). In "Measured only" both fall back to the grey frames with a note. The transport bar does not drive the composite (Q-95). Tag questions: Q-27, Q-93; composite endpoint and constants: Q-92, Q-94.
2. **Object panel.** Spectrum with σ, light curve or motion, the ObjectCard with tags, Listen, and **spectrum haptics** ([§8.6](haptics/profiles.md#r86-spectrum-haptics-every-object-the-most-useful-for-blind-and-low-vision-users)).
3. **3D view (Sky Sculptor).** One view, the build pane of the split view, opened by *Build it* (object card or object panel) or the rail's 3D viewer (R5.8, Q-113 as amended by Q-120). The renderer is chosen by `type`. For `candidate` there is no *Build it*; the panel shows "Not enough data for a 3D model".
4. **Track tool and Area search** (known objects only, [Q-131, Q-146](../decisions/moving-objects.md)). Track shows a known body's path over its SPHEREx frames; Area search starts from a square drawn on the sky. They are specified in A19 ([track.md](../architecture/moving-objects/track.md)), A20 ([track-ui.md](../architecture/moving-objects/track-ui.md)) and A16–A18 ([area-search.md](../architecture/moving-objects/area-search.md)). This doc owns only Track's sound (R8.9.2).

---

## R5. Rules shared by every 3D view

### R5.1 Lighting

- **Solar-system bodies:** a single `DirectionalLight` placed at `phase_angle_deg` from the view direction. Use Horizons quantity 24 (Sun–Target–Observer angle) with observer `500@-163182` at the observation epoch. A tiny ambient light (intensity ≤ 0.03) keeps the night side legible. Tag: `measured` (Q-62 item 4, still to confirm; conflict: [Q-181](../decisions/contract-tags.md)).
- **Stars and brown dwarfs:** self-luminous (emissive). No external light.

### R5.2 View modes

- **Visible (estimated):** the colour basis depends on the type. Badge: "Estimated visible colour", except where the table says otherwise.

  | Type | Colour basis | Tag | `source` today |
  |---|---|---|---|
  | `asteroid_shape`, `asteroid_procedural` | `gaia_rgb`, otherwise the class palette ([§6.4](surface-generation.md#r64-colour-no-ai-default)); brightness from `albedo` | `derived` / `inferred_from_analog` | `gaia_rgb` / `class_palette` |
  | `brown_dwarf`, `brown_dwarf_binary` | class palette T or Y ([§6.2](surface-generation.md#r62-card--generator-parameters-deterministic-rules)); no palette (L) → refused | `inferred_from_analog` | `class_palette` |
  | `star`, `star_mira`, `star_ttauri` | Teff blackbody colour (R7.5) | the weaker of `teff_K`'s tag and `derived` | `class_palette` (no `teff` value yet, Q-36) |
  | shader kinds (R7.7) | neutral grey (0.5, 0.5, 0.5); badge "Default (artist's choice)" | `artistic` | `class_palette` (Q-36) |
  | `comet`, `candidate` | none: `visible` is refused and listed in `missing` | — | — |

- **SPHEREx infrared (measured):** tint = `spherex_rgb`, computed by the backend from the object's own spectrum. **Q-27 is open:** Rainbow Trails and the wavelength tint (R4) are tagged `derived`, while this mode is `measured`; both stand until Q-27 is answered (Atish, Moon).
  - Asteroids and comets: R = 3.0 µm, G = 2.0 µm, B = 1.0 µm. Each channel is the median flux in ±0.05 µm, normalised by the maximum channel.
  - Brown dwarfs: R = 4.5 µm, G = 3.3 µm, B = 1.25 µm.
  - Stars and shader kinds have no IR mode: the `spherex_ir` key is omitted, which is not a refusal (`CHANNELS_BY_TYPE`, `card_to_params.py`).
  - Badge: "SPHEREx infrared, whole-body average (false colour)".
  - If fewer than 2 points fall in a channel window, the mode is disabled and listed in `missing`.
- The fields of both modes are in [§3.4](data-contract.md#r34-renderparams-produced-by-the-backend-get-v1objectsidrender-params) (D-23).

### R5.3 Honesty toggle (3 states)

One state per badge (D-21):

| State | Shows tags | Examples |
|---|---|---|
| Measured only | `measured` | Real mesh or a plain sphere at measured size, flat measured tint, measured lighting. The body is kept only when its size value is `measured`; the `ellipsoid` layer is `model_dependent`, so Measured only shows a sphere |
| + Estimated (starting state) | adds `derived`, `model_dependent`, `inferred_from_analog` | Class palette, derived colours, brightness from Teff/flux |
| + Artistic | adds `artistic` | Procedural relief, AI paint, band patterns, orbit drawings |

- The toggle starts at **+ Estimated**: everything shown on load is backed by data or a stated formula.
- **Build exception (proposed, Q-113 item 7; Moon to confirm, with Q-49):** *Build it*, *Replay* and *New seed* raise the level to + Artistic when the plan has hidden layers, and say so. Rules in R5.8.
- Each visible layer shows a small tag chip in the legend.
- Haptics and sounds use the same filter. The rule is owned by [§8.2](haptics/platform-encoding.md#r82-two-kinds-of-haptics-both-labelled-in-the-ui).

### R5.4 Scale bar
The scale bar shows the physical size plus one familiar comparison:

| Comparison | Size |
|---|---|
| Le Morne Brabant | 556 m tall |
| Mauritius | ~65 km long **[verify]**; not offered until verified (R12 #18) |
| Earth | 12,742 km diameter |
| Jupiter | 139,820 km diameter |
| Sun | 1.39 million km diameter |

### R5.5 Performance budget (D-05)

Targets, as amended by Q-132 (which answers Q-15):

| Target | Hardware | When |
|---|---|---|
| Demo machine | Atish's Asus TUF A15, desktop Chrome. Sound only, no vibration. Which GPU Chrome uses for WebGPU: **[verify]** (R12 #1) | the event |
| Phones | realme 14 Pro and a Samsung, both Android 16 with Chrome. Vibration needs these | after the event |
| Zenbook 14X (Intel Iris Xe) | no longer the demo screen (Q-132) | — |

- ≥30 fps while rotating. Render when the view changes, or every frame while a simulation clock runs (D-34, [§5.7](#r57-motion-and-time-lapse)).
- `renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))`.
- Textures: 2048×1024 on desktop. After the event, 1024×512 on phones. Serve as WebP for albedo; normal maps as lossless PNG or KTX2.
- Meshes ≤ 50k triangles. Decimate NASA GLBs offline.
- Points ≤ 60k (comet shells; the nebula and the nova no longer use points).
- **Volumes** (issue #43: nebula, nova, comet coma, dust and tails; method in [§7.7](renderers/shader-kinds.md#r77-shader-generated-kinds-planet_rocky-planet_water-gas_giant-nebula-nova)). This section owns the budget: one box mesh each, ray-marched with `TIERS[..].volumeSteps` samples (96, 64, 40 on High, Medium, Low) over one shared 48³ RGBA8 noise cube (about 442 KB per seed, freed with the volume). A scene has at most 4 volumes (coma, dust cone, ion tail, dust tail). The cube is baked once per seed on the CPU (about 180 ms on the CI machine; a December comet bakes two seeds) and cached. Self-shadowing uses one 2048² shadow map on High and Medium (about 16 MB of 32-bit depth) and 1024² on Low (about 4 MB), freed whenever the light is replaced.
- Displacement on desktop only.
- **Never compute noise per frame for baked kinds.** Their procedural maps are baked by the backend ([§6](surface-generation.md#r6-surface-generation-backend-cpu)). The shader-generated kinds follow [architecture spec §6](../architecture/generators.md); their shared field is generated once per body, not per frame ([§7.7](renderers/shader-kinds.md#r77-shader-generated-kinds-planet_rocky-planet_water-gas_giant-nebula-nova)).

### R5.6 Interaction

- **Default mode:** mouse drag or one finger rotates, wheel or pinch zooms. Keyboard: arrows rotate, +/− zoom, `R` resets. In the build pane, while a build runs, a drag turns the body instead (R5.8).
- Rotate buttons must also exist on screen. WCAG 2.5.7 requires an alternative to dragging. This applies to every 3D view; the sky view's recorded exception (Q-123) is shell behaviour (A21, [sky-shell.md](../architecture/sky-shell.md)).
- **Feel mode (desktop, the event; Q-113 item 5, Q-132, Q-133). Proposed (Q-173):**
  - The build pane's Feel toggle turns it on and off. Hovering plays nothing.
  - While Feel is on, a primary-button drag on the body plays the body tone (R8.9.1) for the point under the pointer and does not rotate: orbit controls are off while the button is down. The wheel still zooms.
  - The arrows and the on-screen rotate buttons still rotate. With the canvas focused, a held arrow key plays the tone for the surface point at the centre of the body's disc, so a keyboard user hears the relief pass under a fixed probe.
  - Leaving the body, releasing the button, turning Feel off or hiding the page stops the tone.
- **Touch mode (phones, after the event; Q-132):** toggle button, also key `T`. One finger *feels* (body tone, and vibration once the vibrate driver ships) and two fingers rotate and zoom. Implement this by disabling the orbit controls whenever exactly one pointer is down.
- **Not built yet:** Feel is not wired (`frontend/src/app/build/BuildPane.tsx:203-208`), and Touch mode and the `T` key are not implemented (`frontend/src/viewer/ViewerApp.ts:6, 185`).

### R5.7 Motion and time-lapse

Proposed in D-34 (pending team confirmation). Rates come from `RenderParams.dynamics` ([R3.4](data-contract.md#r34-renderparams-produced-by-the-backend-get-v1objectsidrender-params)) and follow the tier chain (D-32).

- **Clock:** one `SimClock`. Each frame is a pure function of (card, seed, t), with no state between frames. Same inputs, same frame.
- **Speed-up:** shown next to every animated process, from `dynamics.speedup` (like "×1000" in R7.1). It is a display choice, not a claim. Nothing pretends to be real time. Spin is capped at 1 revolution per real second and flare onsets at 0.5 per real second; a capped speed-up shows the lowered factor (Q-104, Q-108).
- **No `dynamics` yet:** until pipeline stage 6 exists, the viewer states the motion layers itself from the card (`viewer/motion/planMotion.ts`, Q-104 item 1), with the same tags and tiers. With nothing to state, the body stays still, except the R7.1 asteroid spin.
- **Default:** animate on load, calm and slow. Start paused when `prefers-reduced-motion` is set ([R9](accessibility.md#r9-accessibility-tie-ins)).
- **Pause:** hidden tab, canvas off screen, and the user's pause. The pause button is always visible and keyboard reachable. After the event, phones also auto-pause after 60 s without interaction and resume on touch **[verify on phones]** (R12 #39); the code already does this on a coarse pointer (Q-66).
- **Settle burst (Q-66):** after each change the viewer renders 32 frames for TAAU (one Halton cycle) or 2 for SMAA, then stops. Under reduced motion SMAA replaces TAAU.
- **Touch matches sight:** the shared field is generated once per body (D-12). Moving storms are sampled from the shared model at the scene's t (`fields/flowModel.ts`, `FieldSampler.setStorms`), so the felt storm is the drawn one (Q-105, open). **Not built:** D-34's 4 Hz field recompute (Q-68); the code follows Q-105. Atish and Moon settle it (D-13).

| Body | What moves | `dynamics` key | Tier source |
|---|---|---|---|
| Star | rotation (equator faster), mottling, spots, flares with limb loops | `spin_period_h`, `diff_rotation`, `spot_lifetime_d`, `flare_rate_per_d` | measured spin; typical by class (tier 4) for the rest |
| Mira | pulsation | `pulsation_period_d` | measured light curve; amplitude art |
| Brown dwarf | banded rotation, weather | `spin_period_h`, `jet_speed_ms` | measured spin; physics rule or typical |
| Gas giant | counter-flowing jets, drifting spinning storms | `jet_speed_ms`, `spin_period_h` | physics rule for winds (A7.2) |
| Rocky or water planet | spin, terminator, clouds on latitude winds | `spin_period_h`, `jet_speed_ms` | physics rule; art for cloud shapes |
| Asteroid | spin about the real pole (×1000, R7.1) | `spin_period_h` | measured |
| Comet | jets turn with the nucleus; tail sway | `spin_period_h` | measured or typical; sway is art |
| `nebula`, `nova` | no idle motion | none | n/a |
| Variable star | light-curve scrub (done) | none | measured |

**Quality levels (the battery mechanism).** Called levels, not tiers, so they are not confused with the provenance tiers 1–5 (D-32). The start rule is `initialTier` in `frontend/src/viewer/render/quality.ts`.

| Level | Starts on | Frame rate |
|---|---|---|
| High | never automatically; opt-in with `?quality=high` or `setQualityTier` (r187 gives no reliable high-end signal) | 60 fps target |
| Medium | desktop WebGPU, which includes the A15 at the event | 60 fps target |
| Low | the WebGL2 fallback, or a coarse pointer (phones, after the event) | 30 fps; capped at 30 only on a coarse pointer (Q-66) |

- Pixel ratio stays capped at 1.5 (D-05). A governor drops one level when frames take more than 33 ms for 2 s, and says so on screen. It only ever lowers. Reduced motion pauses every clock. See Q-64 for the frame-rate row of D-05.
- After the event: a 15-minute session on either phone uses at most 10% battery at demo brightness **[verify on phones]** (R12 #39).

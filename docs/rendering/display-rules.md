# Display levels and shared 3D view rules

> **Part of:** Rendering & haptics spec ([index](README.md)) · **Sections:** R4, R5, R5.1–R5.7 · **Implements:** D-05, D-21, D-23, D-34 ([decisions](../decisions.md))

## R4. Display levels

1. **Sky patch (2D flipbook).** Real SPHEREx pixels. Sources are points with clickable rings plus Gaia/WISE overlay markers. This is the only fully measured view.
   - As built in M1 (issue #3): the cutout pixels, frame time and wavelength are `measured`; time and wavelength wear the Measured badge. The display stretch is `derived` (Estimated badge; the tooltip gives the stretch kind and parameters), as are the pixel positions `x`, `y` ([architecture spec §4.1](../architecture/pipeline.md#a41-stage-1-find-the-object)). How "Measured only" treats the stretched picture and the ring: Q-28.
   - Rainbow Trails (D-28), a flipbook view mode: the dot colour is a false colour, hue = wavelength, tagged `derived` with that formula (Estimated badge). In "Measured only" (D-21) the dots are drawn in one colour. Tag question: Q-27.
   - Colour views (sky-view prototype): Raw (the grey frames) or Colour, either the **wavelength tint** (each grey frame multiplied by the Rainbow Trails colour of its own wavelength; `derived`, Estimated badge) or the **SPHEREx composite** (one RGB picture the backend builds from three aligned frames, north up, east left; `derived` with the reply's formula). In "Measured only" both fall back to the grey frames with a note. The transport bar does not drive the composite (Q-95). Tag questions: Q-27, Q-93; composite endpoint and constants: Q-92, Q-94.
2. **Object panel.** Spectrum with σ, light curve or motion, the ObjectCard with tags, Listen, and **spectrum haptics** ([§8.6](haptics/profiles.md#r86-spectrum-haptics-every-object-the-most-useful-for-blind-and-low-vision-users)).
3. **3D view (Sky Sculptor).** Opened with "View in 3D". The renderer is chosen by `type`. For `candidate` there is no button; the panel shows "Not enough data for a 3D model".

---

## R5. Rules shared by every 3D view

### R5.1 Lighting

- **Solar-system bodies:** a single `DirectionalLight` placed at `phase_angle_deg` from the view direction. Use Horizons quantity 24 (Sun–Target–Observer angle) with observer `500@-163182` at the observation epoch. A tiny ambient light (intensity ≤ 0.03) keeps the night side legible. Tag: `measured`.
- **Stars and brown dwarfs:** self-luminous (emissive). No external light.

### R5.2 View modes

- **Visible (estimated):** colour from `gaia_rgb`, otherwise a class palette ([§6.4](surface-generation.md#r64-colour-no-ai-default)), with brightness from `albedo`. Badge: "Estimated visible colour".
- **SPHEREx infrared (measured):** tint = `spherex_rgb`, computed by the backend from the object's own spectrum.
  - Asteroids and comets: R = 3.0 µm, G = 2.0 µm, B = 1.0 µm. Each channel is the median flux in ±0.05 µm, normalised by the maximum channel.
  - Brown dwarfs: R = 4.5 µm, G = 3.3 µm, B = 1.25 µm.
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
- Each visible layer shows a small tag chip in the legend.
- The haptics use the same filter ([§8.2](haptics/platform-encoding.md#r82-two-kinds-of-haptics-both-labelled-in-the-ui)). Only `measured` haptics stay in Measured only: `teq_pulse` stays there only when `teq_K` is `measured` (Exoplanet Archive `pl_eqt`); when it is `derived` it is silent there and plays from + Estimated. `artistic` texture haptics play only in + Artistic.

### R5.4 Scale bar
The scale bar shows the physical size plus one familiar comparison:

| Comparison | Size |
|---|---|
| Le Morne Brabant | 556 m tall |
| Mauritius | ~65 km long **[verify]** |
| Earth | 12,742 km diameter |
| Jupiter | 139,820 km diameter |
| Sun | 1.39 million km diameter |

### R5.5 Performance budget (D-05)

Two targets. Where their budgets differ, take the tighter one.

| Target | Hardware |
|---|---|
| Demo laptop | Intel Iris Xe (Zenbook 14X) |
| Phones | realme 14 Pro and a Samsung, both Android 16 with Chrome. Haptics can only be shown here |

- ≥30 fps while rotating. Render when the view changes, or every frame while a simulation clock runs (D-34, [§5.7](#r57-motion-and-time-lapse)).
- `renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))`.
- Textures: 2048×1024 on desktop, 1024×512 on mobile. Serve as WebP for albedo; normal maps as lossless PNG or KTX2.
- Meshes ≤ 50k triangles. Decimate NASA GLBs offline.
- Points ≤ 60k (comet shells; the nebula and the nova no longer use points).
- **Volumes** (issue #43: nebula, nova, comet coma, dust and tails): one box mesh each, ray-marched with `TIERS[..].volumeSteps` samples (96, 64, 40 on High, Medium, Low) over one shared 48³ RGBA8 noise cube (about 442 KB per seed, freed with the volume). A scene has at most 4 volumes (coma, dust cone, ion tail, dust tail). The cube is baked once per seed on the CPU (about 180 ms on the CI machine; a December comet bakes two seeds) and cached. Self-shadowing uses one 2048² shadow map on High and Medium (about 16 MB of 32-bit depth) and 1024² on Low (about 4 MB), freed whenever the light is replaced.
- Displacement on desktop only.
- **Never compute noise per frame for baked kinds.** Their procedural maps are baked by the backend ([§6](surface-generation.md#r6-surface-generation-backend-cpu)). The shader-generated kinds follow [architecture spec §6](../architecture/README.md); their haptic field is generated once per body, not per frame ([§7.7](renderers/shader-kinds.md#r77-shader-generated-kinds-planet_rocky-planet_water-gas_giant-nebula-nova)).

### R5.6 Interaction

- **Default mode:** one finger or mouse drag rotates, pinch or wheel zooms. Keyboard: arrows rotate, +/− zoom, `R` resets.
- **Touch mode** (toggle button, also key `T`): one finger *feels* (haptics) and two fingers rotate/zoom. Implement this by disabling the orbit controls whenever exactly one pointer is down.
- Rotate buttons must also exist on screen. WCAG 2.5.7 requires an alternative to dragging.

### R5.7 Motion and time-lapse

Decided in D-34. Rates come from `RenderParams.dynamics` ([R3.4](data-contract.md#r34-renderparams-produced-by-the-backend-get-v1objectsidrender-params)) and follow the tier chain (D-32).

- **Clock:** one `SimClock`. Each frame is a pure function of (card, seed, t), with no state between frames. Same inputs, same frame.
- **Speed-up:** shown next to every animated process, from `dynamics.speedup` (like "×1000" in R7.1). It is a display choice, not a claim. Nothing pretends to be real time.
- **Default:** animate on load, calm and slow. Start paused when `prefers-reduced-motion` is set ([R9](accessibility.md#r9-accessibility-tie-ins)).
- **Pause:** hidden tab, canvas off screen, and the user's pause. The pause button is always visible and keyboard reachable. On phones, auto-pause after 60 s without interaction and resume on touch **[verify on phones]**.
- **Touch matches sight:** the haptic field worker uses the same t (D-12) and recomputes at 4 Hz or less. Atish to confirm (D-13).
- **No `dynamics`:** the body stays still, except the R7.1 asteroid spin.

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

**Quality levels (the battery mechanism).** Called levels, not tiers, so they are not confused with the provenance tiers 1–5 (D-32).

| Level | Target | Frame rate |
|---|---|---|
| High | desktop | 60 fps |
| Medium | Zenbook, A15 (integrated GPU) | 60 fps |
| Low | Android phones | 30 fps |

- Pixel ratio stays capped at 1.5 (D-05). A governor drops one level when frames take more than 33 ms for 2 s, and says so on screen. Reduced motion pauses every clock. See Q-64 for the frame-rate row of D-05.
- Battery target: 15 minutes on either phone uses at most 10% battery at demo brightness **[verify on phones]**.

# File layout, acceptance tests and open items

> **Part of:** Rendering & haptics spec ([index](README.md)) · **Sections:** R10, R11, R12 · **Implements:** D-11 ([decisions](../decisions.md))

## R10. File layout and ownership

```
backend/app/core/render/            (Atish)
  card_to_params.py   # §6.2 rules + tags; unit-tested
  noise.py craters.py height.py normals.py palette.py bake.py
  gemini_paint.py     # stretch, behind the admin token
  spherex_rgb.py      # §5.2 channel extraction
backend/app/api/objects.py           (Kevin)  # /card, /render-params, texture URLs
frontend/src/viewer/                 (Moon)
  ViewerApp.ts lighting.ts modes.ts honesty.ts scaleBar.ts altText.ts
  renderers/AsteroidMesh.ts AsteroidProcedural.ts Comet.ts BrownDwarf.ts Star.ts
  fields/             # Web Worker field generator for shader kinds (§7.7, D-12)
frontend/src/haptics/                (Moon, with Atish for sources)
  haptics.ts calibration.ts
  drivers/webVibrate.ts drivers/audio.ts drivers/tauri.ts (stub, B-01)
  sources/heightMap.ts meshNormal.ts field.ts terrain.ts flow.ts spectrum.ts lightcurve.ts
shared/schemas/object-card.schema.json  render-params.schema.json
```

---

## R11. Acceptance tests

- **Determinism:** the same card and seed give the same SHA-256 for every texture.
- **Seam:** the mean absolute height difference between column 0 and column W−1 is less than the median neighbour difference.
- **Normals:** every decoded normal has length 1 ± 0.02.
- **Honesty:** in Measured only, no layer tagged `artistic` or `inferred_from_analog` is drawn, and procedural texture haptics are silent.
- **Refusal:** removing `diameter_km` from an asteroid card puts the mesh in `missing`, with no crash.
- **Performance:** ≥30 fps rotating `asteroid_procedural` at 1024×512 on the realme 14 Pro.
- **Haptics:**
  - no more than 40 events per second under fast drags
  - the vibrate driver is a silent no-op on iPhone, and the audio driver still plays
  - the calibration values (`minMs`, level set, `avOffsetMs`) persist
  - both Android phones feel the 8 ms tick after calibration
  - after calibration, the audio–vibration offset is under a threshold (threshold: **[verify]**)
  - in Measured only, gas giant and planet texture haptics are silent; the `teq_pulse` still plays
- **Shared field:** on a gas giant, band-boundary ticks line up with the drawn band edges, so the shader and the field agree.
- **Spectrum haptics:** dragging across a known absorption dip gives at least 3 consecutive quiet steps.
- **Comet:** toggling Aug/Dec changes the CO and H₂O shells. No tail is drawn for August.

---

## R12. Open items [verify]

1. Fallback behaviour of `WebGPURenderer` from `three/webgpu` (r187) on both phones; check via `chrome://gpu`.
2. Normal map green-channel convention ([§6.5](surface-generation.md#r65-normals-from-height-sobel-equirectangular-aware)).
3. The Gemini image model name and its supported aspect ratios.
4. The 3I/ATLAS nucleus size limit and coma radius values, with exact citations.
5. Eps Indi Ba/Bb orbit numbers; WISE 0855 class details.
6. Barnard's Star Teff/radius, and the RW Aur disc inclination source.
7. The realme 14 Pro's minimum perceptible pulse ([§8.7](haptics/calibration.md#r87-calibration-and-settings)).
8. Whether Chrome on Android offers any amplitude control for `navigator.vibrate` ([§8.3](haptics/platform-encoding.md#r83-encoding-web-driver-d-09), D-09).
9. Chrome's pattern-length cap, believed about 99 entries ([§8.3](haptics/platform-encoding.md#r83-encoding-web-driver-d-09)).
10. `AudioContext.outputLatency` support in Android Chrome, and the "high latency" threshold ([§8.9](haptics/audio-pairing.md#r89-audio-pairing-d-10)).
11. Whether battery saver suppresses vibration on both phones.
12. Exoplanet type thresholds for `planet_rocky` / `planet_water` / `gas_giant` ([§3.3](data-contract.md#r33-type-selection-backend)). Also the ObjectCard fields for exoplanets (e.g. `Teq`), which are not yet defined in [§3.2](data-contract.md#r32-objectcard-produced-by-the-backend-get-v1objectsidcard).
13. Whether the pulse-width whisper (e.g. `[4, 4, 4, 4, 4]`) is felt as distinct on each phone ([§8.3](haptics/platform-encoding.md#r83-encoding-web-driver-d-09), [§8.7](haptics/calibration.md#r87-calibration-and-settings)).
14. The field's channel packing and a lava-crack channel ([§7.7](renderers/shader-kinds.md#r77-shader-generated-kinds-planet_rocky-planet_water-gas_giant-nebula-nova), [§8.4](haptics/sources.md#r84-event-sources)). D-12 itself needs team sign-off.

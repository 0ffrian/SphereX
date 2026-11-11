# Surface generation (backend, CPU)

> **Part of:** Rendering & haptics spec ([index](README.md)) · **Sections:** R6, R6.1–R6.7 · **Implements:** [D-01, Q-47, Q-210, Q-326](../decisions/rendering-bodies.md), [D-07, Q-122](../decisions/gemini.md), [Q-35](../decisions/contract.md) · **Read with:** [data-contract.md](data-contract.md) (R3.4), [renderers/brown-dwarf.md](renderers/brown-dwarf.md) (R7.4)

## R6. Surface generation (backend, CPU)

### R6.1 Strategy: height first, colour second
Generate the **height field procedurally from the RenderParams**, then derive the normals from it. Colour comes from a deterministic palette, optionally repainted by Gemini using the height render as its reference. The relief is then exactly known: it is seamless, the normals match, and the haptics are consistent.

**Map format:** equirectangular, sampled from **3D noise on the unit sphere**. That makes it seamless at u=0/1 by construction. Pixel-to-direction mapping must match three.js `SphereGeometry` (with `flipY = true`, image row 0 is the north pole):

```python
# row r in [0,H), col c in [0,W)
theta = (r + 0.5) / H * np.pi          # 0 at north pole
phi   = (c + 0.5) / W * 2 * np.pi
dir_x = -np.cos(phi) * np.sin(theta)
dir_y =  np.cos(theta)
dir_z =  np.sin(phi) * np.sin(theta)
```

### R6.2 Card → generator parameters (deterministic rules)

| Generator param | Rule | Tag |
|---|---|---|
| `style` | D < 1 km → `rubble` (Bennu/Ryugu-like); 1–50 km → `cratered`; > 50 km → `large_cratered` (Vesta-like) | inferred_from_analog |
| `ellipsoid_axes` | from `lightcurve_amp_mag` A: a/b = 10^(0.4·A); c = b. If A is missing → sphere | model_dependent |
| `noise_octaves`, `noise_freq` (fine detail layer only, since D-36) | rubble: 7, 6.0; cratered: 6, 3.0; large: 6, 2.0 | artistic |
| `lump` = h/R (D-36, Q-210, Q-326) | by `structure`. **Rubble:** slope-limited at the angle of repose, `tan 35° / (3 × 0.7837)` = 0.298 (the 3-sigma slope of the shape layer, whose rms slope is 0.7837 per unit lump; 35° **[verify]** for low gravity), independent of size. **Solid, fractured:** `clamp(Y / (ρ g R), 0.03, 0.3)`, `g = (4/3)πGρR`, `Y` = 1e6 Pa **[verify]**. ρ by class analog (C: Bennu 1190, Lauretta et al. 2019; S: Eros 2670 kg/m³; else 1500 **[verify]**) | model_dependent (assumed ρ, Y, repose angle) |
| `structure` | `solid` if the spin period is below `sqrt(3π/(Gρ))` or D < 0.15 km; `rubble` below 40 km (the prototype's cut, no source, **[verify]**); else `fractured` | model_dependent |
| `roughness` | `rocky` always, until a card field carries radar roughness or thermal inertia (Q-212); `smooth` is switched on in code only | inferred_from_analog |
| `crater_coverage` | `0.05 + 0.27·age/100` with age 70 (artistic default; smooth: 0.012) | artistic |
| `boulder_density` | by structure: solid 0.45, rubble 1.0, fractured 0.25; 0 when smooth | artistic |
| `relief_amp` (fraction of radius) | peak-to-peak design range of the height field; the displacement scale (R7.2) and the scale of `height.png` | artistic |
| `base_rgb` | `gaia_rgb` if present (derived), else the class palette ([§6.4](#r64-colour-no-ai-default)) | derived / inferred |
| `brightness` | display L = clamp(0.12 + 1.6·albedo, 0.12, 0.8) | derived (display mapping) |
| `hydration` | `band_depth_3um` > 0.05 → darker by 15%, contrast ×0.7 | derived (stretch feature) |
| `redness` | `slope_075_25` → shift tint toward red, clamped ±0.08 | derived |
| `roughness` | 0.95 (regolith) | inferred_from_analog |

**Brown dwarf bands** (`brown_dwarf`, `brown_dwarf_binary`; `Kind "bands"` in `backend/app/core/render/params.py`). The look rules are R7.4; the bake is:

| Generator param | Rule | Tag |
|---|---|---|
| palette | by the first letter of `spectral_class` (the primary of a binary such as `T1+T6`): T = (0.50, 0.24, 0.14), Y = (0.30, 0.26, 0.36) with haze 0.2 towards (0.80, 0.82, 0.90). Placeholder values (Q-47) | inferred_from_analog |
| refusal | no class letter with a palette (L, or no class) → the bake is refused (`BakeRefusal`, reason `spectral_class`) | — |
| `band_contrast` | clamp(2·`ch4_depth_33`, 0.1, 0.8); without `ch4_depth_33` it is 0 and `bands` is listed in `missing` | derived |
| band field | latitude-stretched fbm (direction × (1.5, 10, 1.5), 5 octaves, seed + 200), about [−1, 1] (`height.band_field`) | artistic |

The albedo is palette × (1 + `band_contrast` · band). The drawn `bands` layer is tagged `artistic` as a whole (`card_to_params.py`), and its `texture_tag` too. The height map is flat (`bands_height`): there is no relief, so a brown dwarf has no body tone (R8.9.1).

### R6.3 Height field

```python
import numpy as np

def _rand(ix, iy, iz, seed):
    h = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 144665) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return (h ^ (h >> 16)) / 4294967295.0

def value_noise3(p, seed):                  # p: (..., 3) float64
    i = np.floor(p).astype(np.int64); f = p - i
    u = f * f * (3 - 2 * f)
    out = 0.0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (np.where(dx, u[..., 0], 1 - u[..., 0]) *
                     np.where(dy, u[..., 1], 1 - u[..., 1]) *
                     np.where(dz, u[..., 2], 1 - u[..., 2]))
                out = out + w * _rand(i[..., 0] + dx, i[..., 1] + dy, i[..., 2] + dz, seed)
    return out * 2 - 1                      # [-1, 1]

def fbm(dirs, seed, octaves, freq, lacunarity=2.0, gain=0.5):
    total, amp = 0.0, 1.0
    for o in range(octaves):
        total = total + amp * value_noise3(dirs * freq * lacunarity**o, seed + o)
        amp *= gain
    return total
```

**Seed.** `seed_for` (`backend/app/core/render/card_to_params.py`) makes the seed: SHA-256 of `id + "
" + generator_version` in UTF-8, first 4 bytes big-endian, so a 32-bit integer ≥ 0. This is an `ASSUMPTION` until Q-35 is answered. The baker hashes the seed again with SHA-256 to a 32-bit value for the noise (every bit of the integer counts) and gives the integer itself to the crater and boulder generator. The shader field uses the low 32 bits ([§7.7](renderers/shader-kinds.md#r77-shader-generated-kinds-planet_rocky-planet_water-gas_giant-nebula-nova)).

**Layers (D-36, Q-211).** The height is the sum of four layers, added at the end, all in fractions of the local radius:

1. `shape`: 26 sine waves with amplitude k^-1.5 (k from 1.3 to 8.8), rms = 0.45·`lump`. Independent of every other layer.
2. `craters`: radii r = r_min·(1−0.985U)^(−1/2) (N(>D) ∝ D⁻²), r_min 0.014, r_max = r_min/√0.015 = 0.1143 (mean radii; the largest radius the sampler can reach, Q-326; the prototype's 0.38 was never reached), drawn until Σr² reaches 4 × `crater_coverage` or 1500 (saturation). Profile with d = distance / r: bowl `−depth(1−d²) + 0.2·depth·d⁴` for d < 1, rim `0.2·depth·d⁻⁵` out to d = 2.4 (the d⁻⁵ falloff is `artistic`; measured ejecta thickness falls about as r⁻³, McGetchin et al. 1973); depth = 0.33·r·freshness (0.35 to 1), so a fresh crater's rim-to-floor is 1.2 depth = 0.198 D, Pike's d/D 0.196 for fresh simple craters (Pike 1977; Q-326, was 0.42). Distances are 3D distances between points of the ellipsoid (a/b = 10^(0.4A), c = b), so craters are round on an elongated body. **Erosion** (a newer crater wears older relief inside its bowl by 0.45 + 0.55d) acts on this layer only; it never multiplies the shape.
3. `fine`: `fine_amp`·normalise(fbm), `fine_amp` 0.012 (0.003 smooth).
4. `boulders`: Gaussian bumps (σ 0.008 to 0.022, height 0.7σ), count 600 × `boulder_density`, round on the ellipsoid.

Only evaluate pixels inside each feature's bounding box. `height = shape + craters + fine + boulders`. Store it as:

- `height.png`: 8-bit, for display and fallback haptics. Asteroids: `0.5 + h / relief_amp`, clipped (fixed scale, so the viewer's displacement `relief_amp`, bias `−relief_amp/2`, reproduces h). Other kinds: min-max scaled
- `height.bin`: `float16` little-endian, W×H, used by the haptics and the body tone (R8.9.1) for precision

### R6.4 Colour (no AI, default)

Class palettes (linear RGB, used only when Gaia is missing; tag `inferred_from_analog`): S (0.62, 0.55, 0.47), C (0.26, 0.25, 0.24), V (0.70, 0.62, 0.55), X (0.45, 0.44, 0.43). Brown dwarf palettes are in [§6.2](#r62-card--generator-parameters-deterministic-rules).

Albedo map = `base_rgb · brightness` × (1 + 0.05·fbm_lowfreq) × (1 − 0.15·crater_floor_mask). The two variation terms are `artistic`. Apply the hydration and redness rules from [§6.2](#r62-card--generator-parameters-deterministic-rules).

### R6.5 Normals from height (Sobel, equirectangular-aware)

```python
def normals_from_height(h, radius_m, strength=1.0):
    H, W = h.shape
    theta = (np.arange(H) + 0.5) / H * np.pi
    coslat = np.clip(np.sin(theta), 0.05, None)[:, None]   # sin(theta) = cos(latitude)
    dx = 2 * np.pi * radius_m * coslat / W                  # metres per pixel along u
    dy = np.pi * radius_m / H                               # metres per pixel along v
    hm = h * radius_m
    dh_du = (np.roll(hm, -1, axis=1) - np.roll(hm, 1, axis=1)) / (2 * dx)   # wraps in longitude
    hp = np.pad(hm, ((1, 1), (0, 0)), mode='edge')
    dh_drow = (hp[2:] - hp[:-2]) / (2 * dy)                 # +row = southward
    nx = -strength * dh_du
    ny = +strength * dh_drow       # tangent-space +Y points north (uv.y up)
    nz = np.ones_like(nx)
    n = np.stack([nx, ny, nz], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return np.rint((n * 0.5 + 0.5) * 255).astype(np.uint8)   # rint, not truncation: flat = (128, 128, 255)
```

**[verify]** (R12 #2) With the light from the north, north-facing slopes must brighten. If they darken, set `material.normalScale.y = -1`; don't change the generator.

**Status (6 Nov 2026):** the baker side is checked (`tests/test_render_baker.py::test_normal_green_channel_is_opengl_y_up`: the green channel is +north, OpenGL +Y up). The viewer check stays open (issue #7, R12 #2).

### R6.6 Optional paths

**Gemini repaint (stretch goal; tag `artistic`).**

1. Render a hillshade of the height map (equirectangular, no colour) and send it as the reference image together with a prompt built from RenderParams.
2. Prompt: "Paint albedo only. Keep the exact equirectangular layout and every terrain feature in place. No lighting, no shadows, no stars, no text. Palette: <base_rgb as words>, <hydration/redness notes>."
3. Model: `gemini-nano-banana-2.1` **[verify name and supported aspect ratios]** (listed in Google's docs on 9 Nov 2026; 2:1 not among the named ratios; R12 #3). Resample the output to 2:1.
4. **Alignment check:** compute the correlation between Sobel edges of the hillshade and of the output luminance. Below 0.3 → reject and keep the [§6.4](#r64-colour-no-ai-default) colour.
5. Seam fix: `np.roll` by W/2, blend a 32 px band across the old seam, roll back.

**Status (issue #14, 7 Nov 2026):** built server-side in `backend/app/core/render/gemini_paint.py` (routes in `backend/app/api/gemini.py`), behind the admin token. The code bake runs first and its colour loads first; the hillshade is taken from `height.bin`; the call goes through the D-25 cache. The AI files live outside the `/data/textures` static mount ([§6.7](#r67-output-and-caching)). Any failure keeps the [§6.4](#r64-colour-no-ai-default) colour and lists `albedo_ai` in `missing`. Endpoints, settings and reason codes: [A6.2](../architecture/generators.md#a62-optional-gemini-artistic-layer); the contract is not decided (Q-122). Step 3's model name and aspect ratios, and the REST request/response shape, are still **[verify]** ([R12 #3](open-items.md#r12-open-items-verify)).

**Image-first (only for images not generated from a height map).**

1. Run Depth Anything V2 Small (Python on the laptop/server, or Transformers.js `onnx-community/depth-anything-v2-small` in the browser). Its output is relative *inverse* depth: invert it, then normalise by the 2nd–98th percentiles.
2. Feed the result to [§6.5](#r65-normals-from-height-sobel-equirectangular-aware). Tag `artistic`.
3. Known failure: albedo variations get misread as relief. Compare against a plain luminance→height map and keep whichever looks right.

**Marigold v1-1 (fallback, laptop only).** fp16 + TAESD + `batch_size=1` + `processing_resolution=768` + 4 steps. Camera-space normals must be converted before use. Not on the critical path.

### R6.7 Output and caching

- Backend writes `/data/textures/{id}/{generator_version}/{seed}/{width}x{height}/{albedo.webp, height.png, height.bin, normal.png}`. The size directory keeps two sizes of one object apart (Q-47). The committed fixture textures (`shared/fixtures/textures/{id}/{version}/{seed}/`, 512×256, baked by `backend/scripts/bake_fixtures.py` with the real baker; `--check` fails on drift) have no size directory, because the fixture URLs have none (Q-114).
- Beside the four maps the baker writes `bake.json`: a hash of the generator parameters, the map size and the baker rules version (Q-47). A directory whose hash differs is rebaked, so a changed card or size is never served stale.
- The cache key includes `generator_version`. Bump the version whenever any rule in [§6.2](#r62-card--generator-parameters-deterministic-rules)–6.5 changes. Today it is `p1-b4` (`BAKER_RULES_VERSION` 4, with `ASSET_VERSION` 11; Q-326, PR #89 review): the crater and relief changes moved every seed and texture path, and the demo pack, the reference objects and the fixtures were re-baked.
- The Gemini layer ([§6.6](#r66-optional-paths), issue #14, Q-122) writes `albedo_ai.webp` and then `gemini.json` (stamp: generator version, baker rules, seed, size, bake key, paint version; tag `artistic`, label "AI-made", model, prompt, edge correlation, hashes) **outside** this tree, under `SX_TEXTURES_AI_DIR` (default `<SX_CACHE_DIR>/textures-ai`), at the same relative path as the size directory. `SX_TEXTURES_DIR` (default `<SX_CACHE_DIR>/textures`, an assumption) is served at `/data/textures` as static files with no status check, so the AI files must never sit there; the backend refuses to start if they would. They are served only by `GET /v1/objects/{id}/albedo-ai.webp`, which answers only while the stamp matches the bake the viewer shows and `bake.json` still has the key the image was checked against (else `stale`). Only the 2048×1024 size is painted.

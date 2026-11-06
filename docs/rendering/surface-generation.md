# Surface generation (backend, CPU)

> **Part of:** Rendering & haptics spec ([index](README.md)) · **Sections:** R6, R6.1–R6.7 · **Implements:** D-01, D-07 ([decisions](../decisions.md)) · **Read with:** [data-contract.md](data-contract.md)

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
| `noise_octaves`, `noise_freq` | rubble: 7, 6.0; cratered: 6, 3.0; large: 6, 2.0 | artistic |
| `relief_amp` (fraction of radius) | rubble 0.04, cratered 0.03, large 0.02 | inferred_from_analog |
| `crater_count` | rubble 40, cratered 250, large 500 | artistic |
| `boulder_density` | rubble 1.0, cratered 0.2, large 0.05 | inferred_from_analog |
| `base_rgb` | `gaia_rgb` if present (derived), else the class palette ([§6.4](#r64-colour-no-ai-default)) | derived / inferred |
| `brightness` | display L = clamp(0.12 + 1.6·albedo, 0.12, 0.8) | derived (display mapping) |
| `hydration` | `band_depth_3um` > 0.05 → darker by 15%, contrast ×0.7 | derived (stretch feature) |
| `redness` | `slope_075_25` → shift tint toward red, clamped ±0.08 | derived |
| `roughness` | 0.95 (regolith) | inferred_from_analog |

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

**Craters.** Radii follow a power law, r = r_min·(1−U)^(−1/2), truncated at r_max. Centres are uniform on the sphere. Profile as a function of x = angular distance / crater angular radius:

- bowl: x < 1 → −d·(1 − x²), with d = 0.2·r
- rim: 1 ≤ x < 1.6 → +0.25·d·exp(−((x−1)/0.18)²)

Only evaluate pixels inside each crater's lat/lon bounding box. Otherwise 500 craters × 2M pixels is far too slow.

**Boulders (rubble style only).** Small positive Gaussian bumps at density `boulder_density`.

`height = relief_amp · normalise(fbm) + craters + boulders`, in units of the body's radius. Store it as:

- `height.png`: 8-bit, for display and fallback haptics
- `height.bin`: `float16` little-endian, W×H, used by the haptics for precision

### R6.4 Colour (no AI, default)

Class palettes (linear RGB, used only when Gaia is missing; tag `inferred_from_analog`):

- S: (0.62, 0.55, 0.47)
- C: (0.26, 0.25, 0.24)
- V: (0.70, 0.62, 0.55)
- X: (0.45, 0.44, 0.43)

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

**[verify]** With the light from the north, north-facing slopes must brighten. If they darken, set `material.normalScale.y = -1`; don't change the generator.

**Status (6 Nov 2026):** the baker side is checked. `tests/test_render_baker.py::test_normal_green_channel_is_opengl_y_up` rebuilds the true normals of the displaced sphere from the R6.1 pixel mapping (u = +φ, north = −θ) and compares them with the baked map: the green channel is +north (OpenGL, +Y up), and flipping it is clearly worse. What stays open is the visual check in the viewer (issue #7).

### R6.6 Optional paths

**Gemini repaint (stretch goal; tag `artistic`).**

1. Render a hillshade of the height map (equirectangular, no colour) and send it as the reference image together with a prompt built from RenderParams.
2. Prompt: "Paint albedo only. Keep the exact equirectangular layout and every terrain feature in place. No lighting, no shadows, no stars, no text. Palette: <base_rgb as words>, <hydration/redness notes>."
3. Model: `gemini-nano-banana-2.1` **[verify name and supported aspect ratios]**. Resample the output to 2:1.
4. **Alignment check:** compute the correlation between Sobel edges of the hillshade and of the output luminance. Below 0.3 → reject and keep the [§6.4](#r64-colour-no-ai-default) colour.
5. Seam fix: `np.roll` by W/2, blend a 32 px band across the old seam, roll back.

**Image-first (only for images not generated from a height map).**

1. Run Depth Anything V2 Small (Python on the laptop/server, or Transformers.js `onnx-community/depth-anything-v2-small` in the browser).
2. Its output is relative *inverse* depth: invert it, then normalise by the 2nd–98th percentiles.
3. Feed the result to [§6.5](#r65-normals-from-height-sobel-equirectangular-aware). Tag `artistic`.
4. Known failure: albedo variations get misread as relief. Compare against a plain luminance→height map and keep whichever looks right.

**Marigold v1-1 (fallback, laptop only).** fp16 + TAESD + `batch_size=1` + `processing_resolution=768` + 4 steps. Camera-space normals must be converted before use. Not on the critical path.

### R6.7 Output and caching

- Backend writes `/data/textures/{id}/{generator_version}/{seed}/{albedo.webp, height.png, height.bin, normal.png}`.
- The cache key includes `generator_version`. Bump the version whenever any rule in [§6.2](#r62-card--generator-parameters-deterministic-rules)–6.5 changes.

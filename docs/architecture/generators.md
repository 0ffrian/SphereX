# Generators

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A6–A6.3 · **Implements:** D-01, D-07, D-12

## A6 Generators

Generators split by type (D-01). See the Surface Lab tab of the [mock-up](../../mockup/spherex-ui.html) for what the browser shaders look like.

**A. Baked on the backend (rendering-doc types).** These follow the rendering doc. Procedural maps are baked by the backend in Python on the CPU, as equirectangular images, never computed per frame (rendering doc §6). Per-type rules are in rendering doc §7.

| Type | Spec | Notes |
|---|---|---|
| `asteroid_shape` | Rendering doc §7.1 | Real mesh, scaled to the measured diameter. No procedural detail by default. |
| `asteroid_procedural` | Rendering doc §6, §7.2 | Baked height, normal, albedo and roughness maps. |
| `comet` | Rendering doc §7.3 | Gas shells as point clouds, sized from published values. |
| `brown_dwarf`, `brown_dwarf_binary` | Rendering doc §7.4 | Banded texture, contrast from the methane depth. |
| `star`, `star_mira`, `star_ttauri` | Rendering doc §7.5 | Blackbody colour, limb darkening. |
| `candidate` | Rendering doc §7.6 | No 3D body. |

**B. Browser shaders (types from this doc).** These run in the browser with three.js and triplanar mapping. Their haptics use a shared CPU field (D-12, [section 9](haptics.md#a9-haptics)).

| Type | Generator | Technique | Main settings |
|---|---|---|---|
| `planet_rocky`, `planet_water` | `terra-planet` | Fractal terrain on the sphere with a sea level, polar ice, lava cracks, cloud shell, atmosphere glow. | temperature, radius, ocean coverage, atmosphere, cloud cover, relief, continent size, land colour |
| `gas_giant` | `banded-giant` | Latitude bands warped by noise, counter-flowing jets, seeded storms, haze, optional rings. | temperature, radius, flattening, bands, turbulence, storms, haze, rings |
| `nebula` | `gas-cloud` | Point cloud sampled from filamentary 3D noise. Additive glow layer plus dark dust layer plus stars. | size, hydrogen, oxygen, dust, filaments, clumpiness, stars, brightness |
| `nova` | `shell-remnant` | Point shell with filaments, hot inner gas, core glow, expansion by age. | age, hydrogen, oxygen, hot gas, lopsidedness, shell thickness, filaments, core glow |

Superseded mock-up generators:

- **Brown dwarfs** now follow rendering doc §7.4, not the `banded-dwarf` shader.
- **Asteroids** now follow the baked asteroid path (rendering doc §6, §7.1, §7.2). The `rock-body` shader is superseded. It remains in the mock-up only.

### A6.1 Why triplanar mapping (browser shaders only)

A flat image wrapped on a stretched shape pinches at the poles and smears along the long axis. Triplanar mapping reads the texture from three axes using the 3D position, so grain keeps the same size everywhere. The Surface Lab test grid shows both modes side by side.

The baked types do not use triplanar mapping. Their maps are sampled from 3D noise on the unit sphere, so they are seamless by construction (rendering doc §6.1).

### A6.2 Optional Gemini artistic layer

For the baked types, follow **rendering doc §6.6** (D-07): Gemini repaints albedo using a hillshade of the baked height map as its reference. Output whose edge correlation is below 0.3 is rejected.

For the browser-shader types only, the tile method below applies:

| Step | Behaviour |
|---|---|
| Trigger | User switches on "Ask Gemini for an artistic version". |
| Request | Server-side call (the API key must never be in the browser). Ask for a seamless, top-down close-up of the surface, with no horizon and no lighting. |
| Timeout | If no answer in a set time, keep the code version and show "Failed, using code". |
| On success | Use the image as a colour tile, fitted by triplanar mapping. Relief stays procedural. |
| Label | Always "AI-made". |

Both methods: server-side only, labelled "AI-made", tag `artistic`. Gemini only produces images. It cannot produce a mesh or a relief map.

### A6.3 Offline jobs (not on the demo laptop)

| Job | Where | Note |
|---|---|---|
| Depth Anything V2 Small (Apache-2.0) to turn an image into a height map | Any laptop, or Colab | Small model. Only for images not generated from a height map (rendering doc §6.6). |
| Marigold (albedo, roughness, metallic from one image) | A GPU with about 8 GB, or a free Colab T4 | Trained on indoor scenes, so quality on rock is unknown. Optional experiment, not on the critical path. |

Image-to-3D (TRELLIS, TripoSR) is out of scope for the event (B-04).

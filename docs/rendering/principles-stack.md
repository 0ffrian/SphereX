# Principles and pinned stack

> **Part of:** Rendering & haptics spec ([index](README.md)) · **Sections:** R0, R1, R2 · **Implements:** D-03, D-06, D-24 ([decisions](../decisions/README.md))

## R0. How to use this document

- This is the single source of truth for **how a celestial object is shown, how its surface is generated, and how it feels under a finger**.
- Claude Code: implement exactly what is specified here. If something is missing or ambiguous, stop and ask. Do **not** invent physical values, fields, or library APIs.
- Every visual or haptic element must trace back to a field in the **ObjectCard** ([§3](data-contract.md#r3-data-contract)) and carry a **provenance tag**.

### Scope

- In scope:
  - the 3D object view ("Sky Sculptor")
  - surface/texture generation for procedural bodies
  - per-type rendering
  - the haptic engine and per-type haptic mappings
  - spectrum haptics
  - audio pairing: every haptic event also plays as sound ([§8.9](haptics/audio-pairing.md#r89-audio-pairing-d-10), D-10)
  - haptics for the shader-generated kinds: gas giants and planets (nebulae and novae are drawn as volumes and have none, Q-103) ([§7.7](renderers/shader-kinds.md#r77-shader-generated-kinds-planet_rocky-planet_water-gas_giant-nebula-nova), [§8.4](haptics/sources.md#r84-event-sources), [§8.5](haptics/profiles.md#r85-per-type-haptic-profile); D-12)
  - the honesty layers
- Out of scope (covered elsewhere): the SPHEREx data pipeline, the flipbook, and spectrum extraction. This document consumes their outputs.
- The *look* of the shader-generated kinds is specified in [architecture spec §6](../architecture/README.md), not here (D-01).

### Non-goals (D-06)

- No photoreal claims. The SPHEREx pixel is 6.15″, so it never resolves any of these bodies. Surface detail is always derived or artistic, and is labelled as such.
- These are post-event backlog, not event scope:
  - Tauri Android app (B-01; see D-08)
  - Gemini Live voice control (B-02)
  - ElevenLabs and other AI sound clips (B-03)
  - image-to-3D models: TRELLIS, Hunyuan3D, TripoSR (B-04)

---

## R1. Principles (non-negotiable)

1. **Data first.** Measured values set the parameters. Code converts measurements into parameters deterministically. An LLM never produces a number.
2. **Provenance on everything.** Each field and each render layer carries one tag:
   - `measured`: from an observation (SPHEREx, Gaia, JPL SBDB, DAMIT, spacecraft)
   - `derived`: computed from measured values by a stated formula
   - `model_dependent`: needs an assumption, which is stated
   - `inferred_from_analog`: chosen by similarity to a known body
   - `artistic`: decorative and unconstrained by data
3. **Fall back a tier, don't invent (D-32).** When a layer or motion rate lacks its measured input, it falls to the next tier (formula, formula with a stated typical input, typical for its kind, art) and its tag says which tier answered. It is refused (not drawn, listed in `missing`, the UI says "not enough data for X") only when no tier can answer, and always for physical size and for ObjectCard values.
4. **Whole-body honesty.** SPHEREx spectra are disc-integrated averages. They can set global surface properties, never spatial patterns.
5. **Determinism.** The same ObjectCard plus the same seed must give byte-identical textures. Seed = hash of (object id + generator version).
6. **One height map drives everything.** The same height field feeds the normal map, the displacement, the haptics and the surface sound. They must never disagree.

---

## R2. Pinned stack

| Layer | Package | Version | Notes |
|---|---|---|---|
| 3D | `three` | **0.187.0** (r187) | Use `three/webgpu` `WebGPURenderer`; it falls back to WebGL2 automatically **[verify on both phones]** |
| Raycast acceleration | `three-mesh-bvh` | pin at install | Only for real shape-model meshes |
| Build | Vite + TypeScript | pin at install | Record exact versions in `package.json` and lockfile |
| Browser ML (optional) | `@huggingface/transformers` | pin at install | Only for the image-first path ([§6.6](surface-generation.md#r66-optional-paths)) |
| Backend texture gen | Python 3.12, `numpy`, `scipy`, `opencv-python-headless`, `Pillow` | pin in `uv.lock` | CPU only; no GPU is needed. The event build runs locally on the team's Asus A15 (D-24) |
| Optional ML (laptop) | `transformers` + `depth-anything/Depth-Anything-V2-Small-hf` | pin in `uv.lock` | Apache-2.0. Only the Small size is permissively licensed |
| Optional heavy ML (laptop) | `diffusers==0.38.0` + Marigold v1-1 fp16 + `madebyollin/taesd` | — | Fallback only; RTX 3050 4 GB works with fp16 + tiny VAE + batch 1 |

**Rule:** never use "latest". If Claude Code proposes an API that this version doesn't have, it must check the r187 docs first.

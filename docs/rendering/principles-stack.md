# Principles and pinned stack

> **Part of:** Rendering & haptics spec ([index](README.md)) · **Sections:** R0, R1, R2 · **Implements:** [D-01](../decisions/rendering-bodies.md), [D-03, D-24, Q-132](../decisions/platform-hosting.md), [D-37](../decisions/rendering-engines.md), [D-06](../decisions/scope-process.md), [D-08, D-12](../decisions/haptics-design.md), [D-10](../decisions/haptics-sound.md), [D-32](../decisions/contract-tags.md) · **Read with:** [data-contract.md](data-contract.md) (R3), [../decisions/README.md](../decisions/README.md)

## R0. How to use this document

- This is the single source of truth for **how a celestial object is shown, how its surface is generated, and how it sounds (and, after the event, feels)**.
- Claude Code: implement exactly what is specified here. If something is missing or ambiguous, make the smallest reasonable choice, record it as a `Q-` entry in the matching [decisions](../decisions/README.md) topic file and as an `ASSUMPTION` comment in the code, and continue. Never invent physical values, ObjectCard fields, endpoints or library APIs.
- Every visual or haptic element must trace back to a field in the **ObjectCard** ([§3](data-contract.md#r3-data-contract)) and carry a **provenance tag**.

### Scope

- In scope:
  - the 3D object view ("Sky Sculptor"), including the Build split view and its moulding (R5.8)
  - surface/texture generation for procedural bodies
  - per-type rendering
  - the haptic engine and per-type haptic mappings. At the event the engine plays through the audio driver only; the vibrate driver is post-event (Q-132)
  - spectrum haptics
  - audio pairing: every haptic event also plays as sound ([§8.9](haptics/audio-pairing.md#r89-audio-pairing-d-10), D-10); the body tone (R8.9.1, Q-133) and the Track path sound (R8.9.2, Q-134)
  - haptics and sound for the shader-generated kinds: gas giants and planets ([§7.7](renderers/shader-kinds.md#r77-shader-generated-kinds-planet_rocky-planet_water-gas_giant-nebula-nova), [§8.4](haptics/sources.md#r84-event-sources), [§8.5](haptics/profiles.md#r85-per-type-haptic-profile); D-12). Nebulae and novae have none ([§8.5](haptics/profiles.md#r85-per-type-haptic-profile))
  - the honesty layers
- Out of scope (covered elsewhere): the SPHEREx data pipeline, the flipbook, spectrum extraction, the app shell and sky view (A21, [sky-shell.md](../architecture/sky-shell.md)), and the Track tool's picture (A19 [track.md](../architecture/moving-objects/track.md), A20 [track-ui.md](../architecture/moving-objects/track-ui.md)). This document consumes their outputs.
- The *look* of the shader-generated kinds is specified in [architecture spec §6](../architecture/generators.md), not here (D-01).

### Non-goals (D-06)

- No photoreal claims. The SPHEREx pixel is 6.15″, so it never resolves any of these bodies. Surface detail is always derived or artistic, and is labelled as such.
- These are post-event backlog, not event scope:
  - Tauri Android app (B-01; see D-08)
  - Gemini Live voice control (B-02)
  - ElevenLabs and other AI sound clips (B-03)
  - image-to-3D models: TRELLIS, Hunyuan3D, TripoSR (B-04)
  - phones and `navigator.vibrate` (Q-132)

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
5. **Determinism.** The same ObjectCard plus the same seed must give byte-identical textures (on one machine; committed PNG maps checked across machines: Q-204). Seed = hash of (object id + generator version); the hash is in [§6.3](surface-generation.md#r63-height-field). Frames drawn by the D-37 engines are exempt (wall-clock spin-up, adaptive resolution; Atish, 11 Nov 2026); their baked inputs and the cards are not ([R5.9](engines.md#r59-prototype-engines-d-37)).
6. **One height map drives everything.** The same height field feeds the normal map, the displacement, the haptics and the surface sound, including the body tone (R8.9.1). They must never disagree.

---

## R2. Pinned stack

| Layer | Package | Version | Notes |
|---|---|---|---|
| 3D | `three` | **0.187.0** (r187) | Use `three/webgpu` `WebGPURenderer`; it falls back to WebGL2 automatically **[verify on the A15]** (`chrome://gpu`); phones after the event (R12 #1). The D-37 engines (world, star, rock) are the prototype's code on raw WebGL2 beside it, at + Artistic only; three.js stays the viewer and the fallback (D-37 amends D-03, [R5.9](engines.md#r59-prototype-engines-d-37)) |
| Raycast acceleration | `three-mesh-bvh` | **0.9.18** | Only for real shape-model meshes (mesh haptics and the mesh body tone, R8.4) |
| Build | Vite + TypeScript | **Vite 8.3.5, TypeScript 6.0.3** | Exact versions in `package.json` and the lockfile (full list: [frontend/README.md](../../frontend/README.md#pinned-versions)) |
| Browser ML (optional) | `@huggingface/transformers` | pin at install | Only for the image-first path ([§6.6](surface-generation.md#r66-optional-paths)) |
| Backend texture gen | Python 3.12, `numpy`, `scipy`, `opencv-python-headless`, `Pillow` | pin in `uv.lock` | CPU only; no GPU is needed. The event build runs locally on Atish's Asus TUF A15 (D-24, Q-132) |
| Optional ML (laptop) | `transformers` + `depth-anything/Depth-Anything-V2-Small-hf` | pin in `uv.lock` | Apache-2.0. Only the Small size is permissively licensed |
| Optional heavy ML (laptop) | `diffusers==0.38.0` + Marigold v1-1 fp16 + `madebyollin/taesd` | — | Fallback only; an RTX 3050 4 GB works with fp16 + tiny VAE + batch 1. Whether the A15 has that GPU, and which GPU Chrome uses for WebGPU, is **[verify]** (R12 #1) |

**Rule:** never use "latest". If Claude Code proposes an API that this version doesn't have, it must check the r187 docs first.

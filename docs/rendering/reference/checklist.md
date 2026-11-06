# Visual review checklist

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Section:** R11 · Plan gates 3, 4 and 6 (10.6) · **Implements:** D-02, D-21

A person and the `design-reviewer` agent run this against the [reference frames](README.md), using the seed, time and fixture convention in that README. Mark each line pass, fail or n/a, with a screenshot for every fail. A renderer does not merge with an open fail.

## 1. Per body type (gate 3)

**All bodies**

- [ ] No banding in smooth gradients (limb, glow, sky, terminator).
- [ ] No seams (longitude wrap, poles, tile edges).
- [ ] No flicker over 10 s at fixed seed and time; no shimmer under slow rotation.
- [ ] Silhouette is the shape the card says (axis ratio, flattening), not a plain circle by default.
- [ ] Looks at least as good as its reference frame in the same lighting.

**Star** ([star.jpg](star.jpg))

- [ ] Crisp limb.
- [ ] No visible geometric shapes (no polygons, rings or tiling in the mottling).
- [ ] Sunspots: dark umbra with a filamentary penumbra.
- [ ] Prominences made of uneven strands, not a smooth arch.

**Supernova remnant / nebula** ([supernova_remnant.jpg](supernova_remnant.jpg))

- [ ] No dots (no visible points or sprites).
- [ ] Thin filaments.
- [ ] Smooth core, no step bands from the ray-march.

**Asteroid with a shape model** ([eros.jpg](eros.jpg))

- [ ] Silhouette matches the model's reference views from the same direction.
- [ ] Dark airless rock; terminator is sharp, no atmosphere.

**Gas giant, brown dwarf, hot Jupiter** ([gas_giant.jpg](gas_giant.jpg), [hot_jupiter.jpg](hot_jupiter.jpg))

- [ ] Bands run along latitude with sheared edges; storms are inside bands; flattened limb.
- [ ] Hot Jupiter: no rings unless the card has them.

**Rocky and water worlds** ([water_world.jpg](water_world.jpg), [cold_rocky.jpg](cold_rocky.jpg))

- [ ] Ice at the poles when the equilibrium temperature says so; no lava on a cold world.
- [ ] Ocean glint on the lit side; atmosphere rim only where the card has an atmosphere.

**Neutron star** ([neutron_star.jpg](neutron_star.jpg))

- [ ] Hot surface, dipole field lines and beams are separate readable layers.

## 2. Accuracy checks (gate 4)

- [ ] Eros's long axis renders at its measured length and the scale bar agrees (measure on screen against the bar).
- [ ] Star colour matches its Teff (compare with the blackbody colour for the card's Teff; a cool star is not white).
- [ ] Each moving process shows its speed-up on screen (the label text, not only the motion). A process with no stated speed-up is not animated.

## 3. Honesty states (gate 6; D-02, D-21)

Run each body at **Measured only**, **+ Estimated** and **+ Artistic**.

- [ ] Measured only shows only `measured` layers; nothing artistic or estimated is drawn.
- [ ] + Estimated adds derived, model-dependent and analogue layers; artistic layers are still absent.
- [ ] + Artistic adds the artistic layers (these are what the reference frames show).
- [ ] Hiding a layer removes it completely (no ghost, no leftover glow or shadow) and the legend says what is hidden and why.
- [ ] A layer with missing data is not drawn and is listed in `missing` with a plain-words reason; the panel is never blank.
- [ ] The three states match the golden frames (`frontend/e2e/__goldens__/<fixture>.<state>.png`).

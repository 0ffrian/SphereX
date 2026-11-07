# Reference frames

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Section:** R11 (acceptance tests: the render-core quality gates of issue #39, R5.7) · **Implements:** D-21

These are the team's target previews ("the quality bar", issue #39). Every renderer is reviewed against them before it merges, with [checklist.md](checklist.md). Frame times are checked with [frame-time.md](frame-time.md). Golden-frame tests are a separate thing (below).

**What they are not.** They are the team's concept previews (6 Nov 2026), 240 x 240 JPEG. They are a visual **target**, not output of the app and not measured data. They carry the `artistic` tag: a look to aim for, never evidence about a real object. Do not compare them pixel by pixel.

| File                                           | Body                                   | What the frame shows (the concept caption)                      |
| ---------------------------------------------- | -------------------------------------- | --------------------------------------------------------------- |
| [eros.jpg](eros.jpg)                           | Asteroid with a shape model (433 Eros) | Real NEAR shape, to scale, lit by the Sun                       |
| [star.jpg](star.jpg)                           | Star                                   | Sunspot groups, faculae, flare ribbons, plasma arch, crisp limb |
| [water_world.jpg](water_world.jpg)             | Water world                            | Ocean glint, ice, clouds on latitude winds, atmosphere rim      |
| [gas_giant.jpg](gas_giant.jpg)                 | Gas giant                              | Shearing jets, drifting storm, flattened                        |
| [supernova_remnant.jpg](supernova_remnant.jpg) | Supernova remnant                      | Emission volume: smooth core glow, thin filaments               |
| [hot_jupiter.jpg](hot_jupiter.jpg)             | Hot Jupiter                            | Measured colour, wide bands, no rings                           |
| [cold_rocky.jpg](cold_rocky.jpg)               | Cold rocky world                       | Teq rules: no lava, polar ice                                   |
| [neutron_star.jpg](neutron_star.jpg)           | Neutron star                           | Concept: hot surface, dipole field, beams                       |

Comets have no reference frame yet (no concept preview exists for them); add one the first time a comet look is agreed.

## Seed and time convention for app renders

When you put an app render beside a reference, use the same conditions every time:

- **Fixture**: the card and params in `shared/fixtures/` for the body type (no live data).
- **Seed**: the seed in the fixture's RenderParams, unchanged.
- **Time**: simulation time 0 with the clock frozen (`__sxViewer.freezeClock(0)`), so animated bodies are at the same phase.
- **Quality level**: `low` for CI frames (the WebGL2 fallback), the device's own tier for a device review.
- **Honesty**: `+ Artistic` for a look review (the art layers are what the references show); the three states are covered by the golden frames.
- **Size**: the same canvas size and framing; reference frames are square, crop to match.

## Golden frames (automated, not these files)

`frontend/e2e/golden.spec.ts` renders each fixture at each honesty state and compares with `frontend/e2e/__goldens__/` by SSIM. Goldens are app output on SwiftShader and say "the picture did not change", not "the picture is right". Regenerate after a deliberate look change: `SX_UPDATE_GOLDENS=1 npx playwright test golden`, look at the diff, commit.

## Adding a reference frame

1. Save it here as JPEG or PNG, named `<body_type>.<ext>` in snake case, keeping its original format and size.
2. Add a row to the table above with its caption and what it targets.
3. Add its body type to [checklist.md](checklist.md) if the type is new.
4. Add the file to the section map if you add a new fragment (see [../../README.md](../../README.md) editing rules).

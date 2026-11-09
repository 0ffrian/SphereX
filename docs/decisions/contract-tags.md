# Decisions: Provenance tags and honesty

> **Part of:** the decision log ([index](README.md)) · **Holds:** provenance tags and badges, the honesty toggle, tier fallback, the policy for unverified constants (Q-110), "which tag does X get" (the data contract, endpoints and schemas are in [contract.md](contract.md)) · **Authority:** highest; an entry here wins over [rendering/](../rendering/README.md) and [architecture/](../architecture/README.md) (see the index for precedence)

## D-02 Data model and provenance tags

- **Context:** The architecture spec used a "settings file" with 3 sources (measured / estimated / default). The rendering doc uses `ObjectCard` + `RenderParams` with 5 tags.
- **Decision:**
  - `ObjectCard` and `RenderParams` (rendering doc §3) are the data contract. The settings-file schema (architecture spec §5) is retired.
  - Internally every value carries one of the 5 tags. The UI shows 3 badges:

    | Tag | Badge |
    |---|---|
    | `measured` | **Measured** |
    | `derived`, `model_dependent`, `inferred_from_analog` | **Estimated** (tooltip shows the formula, assumption or analog) |
    | `artistic` | **Default** (artist's choice) |

  - A fourth, dev-only "Fixture" badge for synthetic fixture data is proposed as an exception, not decided: see Q-32.
  - User slider edits live in a client-side `overrides` map, separate from the card, so Reset restores the data values. See Q-03 for sliders on baked bodies.
- **Status note (9 Nov 2026):** "See Q-03" means D-26, which answers Q-03.

## D-21 Honesty toggle follows the three badges (answers Q-08)

- **Context:** Rendering doc R5.3's states did not line up with the D-02 badges: "Measured only" still showed `derived` layers, and "+ Derived" split the Estimated badge.
- **Decision:** The toggle has three states, one per badge:

  | State | Shows tags |
  |---|---|
  | **Measured only** | `measured` |
  | **+ Estimated** (starting state) | adds `derived`, `model_dependent`, `inferred_from_analog` |
  | **+ Artistic** | adds `artistic` |

- Haptics use the same filter. `teq_pulse` plays in "Measured only" only when Teq comes from Exoplanet Archive `pl_eqt` (`measured`); when it is `derived` it is silent there.
- **Why start at + Estimated:** everything shown on load is backed by data or a stated formula. Moving up to Artistic and down to Measured is the demo of the honesty story.
- **Status note (9 Nov 2026):** Q-113 item 7 (built: Build it, Replay and New seed raise the global level to + Artistic) and Q-49 (should the showcase kinds start at + Artistic?) depart from the + Estimated start; open in Q-180.

## D-32 Tier fallback chain (partly answers Q-38)

> From the block "7 Nov 2026: tiers, accuracy and motion (issue #38)": Source: the team plan "Physics-backed Sky Sculptor" (6 Nov 2026). D-32 to D-34 were proposed by Moon as M2 owner (D-30). D-32 is accepted (Atish, PR #44); D-33 and D-34 are **pending team confirmation**.

- **Context:** D-02 gives every value one of 5 tags, and CLAUDE.md said "refuse rather than invent". A missing input then removed a whole layer, although a typical value for the kind of body, clearly labelled, is honest and more useful. `Layer` also had no field for its formula or assumption (Q-38).
- **Decision:** the 5 tags are also 5 **tiers**, and a layer or rate that lacks its measured input falls down the chain and says which rung answered:

  | Tier | Tag | Meaning |
  |---|---|---|
  | 1 | `measured` | measured value (SBDB, SIMBAD, SPHEREx, shape model) |
  | 2 | `derived` | formula whose inputs are all measured |
  | 3 | `model_dependent` | same formula with at least one input set to a typical class value (stated) |
  | 4 | `inferred_from_analog` | typical for this kind of body, no formula |
  | 5 | `artistic` | look only |

  - **Chain, in order:** step 0 a measured whole-body model (shape model) drawn as is (R7.1); 1 measured; 2 formula of measured inputs; 3 same formula with one typical input; 4 typical for its kind; 5 art. The first rung that can answer wins. The result carries its tier, its formula and the assumed input.
  - **Never fall back upward.** A tier 4 value is never shown as tier 2.
  - "Refuse rather than invent" becomes "fall back a tier and label it" for `RenderParams` layers and dynamics rates. A refusal (`missing`) stays only when no rung can answer.
  - **Refusal stays for** physical size (`scale_m` and the scale bar; Q-33 stands) and for **ObjectCard values**: the card never guesses and `value: null` stays. The fallback lives in stage 6 and `RenderParams`, not in the card.
  - **Toggle:** unchanged (D-02, D-21). Measured only = tier 1; + Estimated adds tiers 2 to 4; + Artistic adds tier 5.
  - **Contract:** `Layer` gains `tier` (required), `formula` (required for tiers 2 and 3) and `assumed` (required for tier 3). `DynamicsValue` carries the same fields, with the tier fixed by the tag in the schema. A rate no rung can answer is omitted and listed in `missing` as `dynamics:<key>`. See R3.4.
  - **Haptics** on a fallen-back layer carry the same tag and follow D-21.
- **Why:** the viewer stays useful on a body with little data, and the badge still tells the truth.
- **Status:** Accepted, in effect from the merge of PR #44. Proposed by Moon (M2 owner, D-30) on 7 Nov 2026. Atish approved PR #44, which adopts it, as stage 7 owner (D-17) on 7 Nov 2026 and asked for this record. Kevin's confirmation (stage 6, Q-60) and Atish's sign-off of the haptics point (D-13) are pending and will be recorded here. Any teammate may reopen it.
  - **Slider values are not tier 3.** A value the visitor sets with a physics slider is their choice, not a typical class value, so what it feeds keeps the tag Q-58 (b) gives it (`artistic` today); D-32's tier 3 is only for a typical value the code states.

## Questions

Status, owner and full text as recorded. The [index](README.md) lists every ID with its file.

| ID | Question | Owner | Status |
|---|---|---|---|
| Q-08 | Honesty toggle: what is the starting state? In "Measured only", do `derived` data haptics (e.g. the D-12 `teq_pulse`) stay on? The toggle table hides only `artistic` and `inferred_from_analog`, but D-12 treats the derived pulse as kept. | Atish, Moon | Answered: D-21 (the store now starts at `derived`, the + Estimated state) |
| Q-25 | How should user-typed coordinates be tagged? They are input, not an observation, and none of the five tags fits exactly. The backend (issue #1) tags them `derived` with the formula "the coordinates typed in the query (user input, not an observation)", so they show as **Estimated** and stay visible in the starting honesty state (D-21). Frame positions of a typed-coordinate object reuse that tag. | Atish, Kevin | Open (implemented as described) |
| Q-27 | Tag of false-colour encodings. Rainbow Trails (D-28), as built in issue #3, colours each dot with hue = wavelength and tags that colour `derived` (formula "false colour: hue = wavelength", Estimated badge), so in "Measured only" (D-21) the dots are drawn in one colour. Rendering doc R5.2 calls the SPHEREx infrared mode "(measured)", although its tint is also a false-colour mapping computed from measured values, and R5.3 keeps a "flat measured tint" in "Measured only". Should both false-colour encodings carry the same tag, and which one? **Status note (9 Nov 2026):** Area search's dot colours (A16.5, A18.2) and Track's ticks and points (A20.3, A20.7) use the same hue = wavelength scale and follow this answer; built as `derived`, one colour in Measured only. Q-88 item 1 and Q-93 ask the same tag question; answer them with this row. | Atish, Moon | Open (Rainbow Trails implemented as `derived`) |
| Q-28 | The flipbook in "Measured only". D-21 shows only `measured` layers in that state, and rendering doc R4 calls the flipbook "the only fully measured view". But the cutout pixels are drawn through a display stretch tagged `derived` (A4.1; Estimated badge in the UI), and the ring on the object sits at `x`, `y`, also `derived`. A picture cannot be shown without some stretch. As built in M1 (issue #3), the picture and the ring are always shown; the M1 UI has no honesty toggle yet. In "Measured only", keep the stretched picture and the ring as a stated exception, or hide them? | Atish, Moon | Open |
| Q-32 | A fourth, dev-only badge. D-02 says the UI shows 3 badges. The M1 flipbook (issue #3, PR #21) shows a **Fixture** badge instead of Measured, a page-wide "Fixture data" banner and a SYNTHETIC label on images whenever a reply carries `X-SX-Fixture: synthetic`. Those replies come only from the dev-only fixture server; `scripts/check-dist.js` fails a production build that contains a fixture marker ([UML 08](../uml/08-sequence-search-flipbook.md#notes), [A11](../architecture/honesty-policy.md#a11-honesty-policy-user-facing)). Proposal: record it in D-02 as a dev-only exception that sits outside the 5 tags and never appears in a production build. Accept? | Atish, Moon | Open (implemented as proposed, dev only) |
| Q-38 | `Layer` (R3.4) has one `tag` and no `formula` or `assumption`, while R3.1 requires them on values, and no spec lists the layer ids or the format of `missing` entries for RenderParams. The fixtures put the formula or assumption in `description`, take ids from the renderer docs (`mesh`, `spin`, `nucleus`, `gas_shells`, …) and list a refused layer or view mode by its bare id (`teq_pulse`, `mesh`, `spherex_ir`, `visible`). The viewer renderers (issue #7) use these ids: `mesh`, `spin`, `material`, `ellipsoid`, `albedo_map`, `relief`, `body`, `emissive`, `bands`, `orbit`, `nucleus`, `gas_shells`, `dust`, `tail`, `colour`, `limb_darkening`, `motion_trail`, `brightness_curve`, `radius_pulsation`, `disc`, `dust_screen` (comet: `dust`, `tail`; brown dwarf: `body`). Layers with two tags in the specs carry the one that claims less: gas shells `model_dependent` (R7.3), dust screen `artistic` (R7.5). R5.3 lists band patterns as `artistic` while R7.4 calls band contrast `derived`; the fixture `bands` layer is `artistic`. Should `Layer` gain `formula` and `assumption`, and should the layer ids become an enum? | Atish, Moon | Partly answered by D-32: `formula`, `assumed` and `tier` are now on `Layer` (R3.4). Open: the layer-id enum and the `missing` entry format. |
| Q-91 | Tag of a picked sky position (extends Q-25). A clicked position is user input, tagged `derived` with the formula "the position under the pointer, computed from the view direction (user input, not an observation)" (Estimated badge). The start view (RA 266.4°, Dec −28.9°, FOV 60°) is a display choice and is not shown as data. | Atish, Moon | Open (implemented as described) |
| Q-93 | Tags of the flipbook colour views (extends Q-27). The Raw ↔ Colour toggle offers a wavelength tint (each grey frame multiplied by `wavelengthColor` of its own λ; "false colour: hue = wavelength" plus the stretch) and a SPHEREx composite (three aligned frames as B, G, R; the backend's `formula` names the wavelengths, dates, stretch and grid). Both are tagged `derived` (Estimated) and fall back to the grey frames with a note in Measured only (D-21); the composite is then not requested. R5.2 calls the SPHEREx infrared tint "(measured)" and R5.3 keeps a "flat measured tint" in Measured only. If Q-27 settles on `measured`, change `COLOUR_TAG` and `effectiveColour` in `frontend/src/app/flipbook/colourMode.ts`. | Atish, Moon | Open (implemented as `derived`, hidden in Measured only) |
| Q-110 | **Policy for [verify] constants (issue #42; D-32, R5.7, R7.7; PR #52 review).** Status: **proposed, for Moon (architect) to confirm.** A constant marked **[verify]** may be used only if the layer it feeds is tagged at its tier (`inferred_from_analog` or `artistic`, tier 4 or 5), shows its formula and `assumed`, and names its source or says there is none. The class-typical rung `MOTION_CONFIG.typical` (`frontend/src/viewer/motion/motion.ts`) is filled with such tier-4 analogues, each with a `// [verify]` comment and a source, never silently. Current cases: `regionCount` (star surface regions, `starModel.ts`), `JUPITER_FLATTENING` and `FLATTENING_MAX` (`shaderSpec.ts`, the analogue and the display cap), and `MOTION_CONFIG.typical`. No code change in this PR. | Moon | Proposed |
| Q-180 | **Conflict: the honesty start state (D-21) against Build it raising the level (Q-113 item 7) and the showcase kinds (Q-49).** D-21 (Accepted) starts the toggle at + Estimated and leaves the moves to the user ([R5.3](../rendering/display-rules.md#r53-honesty-toggle-3-states)). Q-113 item 7 (Proposed, built) makes **Build it**, **Replay** and **New seed** raise the stored, global level to + Artistic, because a generated world's surface is `artistic` and would otherwise show as a plain sphere. Q-49 (Open) asks the same for the shader showcase kinds: is + Estimated their intended first view, or should they start at + Artistic? Proposed default, as written in [R5.8](../rendering/build-mould.md#r58-build-split-view-and-moulding): a "Proposed exception (Q-113 item 7, Moon to confirm; the same question as Q-49)": the three build actions raise the level only when the plan has layers the level hides; the rail's 3D viewer and a plain level change do not; the live region says "Showing artist's impression so the whole body can be built"; every revealed layer keeps its tag chip. R5.3 does not mention the exception. To settle once, as a D-21 amendment covering Q-49 and Q-113 item 7, then state the exception in R5.3. Spec: [R5.3](../rendering/display-rules.md#r53-honesty-toggle-3-states), [R5.8](../rendering/build-mould.md#r58-build-split-view-and-moulding). **Status note (9 Nov 2026):** R5.3 now states it as a proposed exception ("Build exception (proposed, Q-113 item 7; Moon to confirm, with Q-49)"), so "R5.3 does not mention the exception" no longer holds; the D-21 amendment is still to settle. | Atish, Moon | Open |
| Q-181 | **Conflict: two outputs of the same Horizons orbit solution get different tags.** Q-62 item 4 (Open, built) tags the Horizons phase angle `measured` ("rendering wins", R5.1) and the Sun vector `derived`. Q-134 (Answered, Atish) and Q-141 (Open, Kevin) tag the Horizons path `model_dependent`; [A3.4](../architecture/data-sources.md#a34-jpl-horizons) tags Horizons positions as predictions, `model_dependent`, and PR #53 tags mover RA/Dec `model_dependent` too. As written in the specs: the [A3.4](../architecture/data-sources.md#a34-jpl-horizons) Lighting row says "one rule for Horizons-derived tags is still to decide (Q-62 item 4)", and [R5.1](../rendering/display-rules.md#r51-lighting) says "Tag: `measured` (Q-62 item 4, still to confirm)". No default is proposed in either spec. To settle: one rule for every Horizons-derived quantity, recorded as a D- entry, then A3.4, R5.1 and [A19.11](../architecture/moving-objects/track-contract.md#a1911-provenance-per-value) follow it. Spec: [A3.4](../architecture/data-sources.md#a34-jpl-horizons), [R5.1](../rendering/display-rules.md#r51-lighting), [A19.11](../architecture/moving-objects/track-contract.md#a1911-provenance-per-value). | Atish (lighting), Kevin (adapter) | Open |

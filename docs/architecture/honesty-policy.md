# Honesty policy

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A11–A11.1 · **Implements:** [D-02, D-21, Q-27, Q-32, Q-93](../decisions/contract-tags.md), [D-31](../decisions/data-sources.md), [D-35](../decisions/sky-shell.md), [Q-135, Q-139, Q-144, Q-146](../decisions/moving-objects.md) · **Read with:** [data-contract.md](data-contract.md) (A5.2), [refusals.md](refusals.md) (A4.12), [../rendering/display-rules.md](../rendering/display-rules.md) (R5.3)

## A11 Honesty policy (user-facing)

Every rule below has a status: **Built** (in `frontend/src`), **To build** (with its owner or ticket) or **Mock-up only**. Status as of 9 Nov 2026.

| # | Rule | Status |
|---|---|---|
| 1 | Show the Measured, Estimated or Default badge next to every value ([A5.2](data-contract.md#a52-provenance-tags-and-badges)). The Estimated tooltip shows the formula, assumption or analog. | Built (`app/Badge.tsx`) |
| 2 | **Flipbook (M1, issue #3):** frame time and wavelength wear Measured, and the cutout pixels are `measured`; the display stretch wears Estimated (`derived`, tooltip with the stretch kind and parameters); the Rainbow Trails colour wears Estimated (`derived`, "false colour: hue = wavelength") and is drawn in one colour in "Measured only". The colour views are false colour and wear Estimated: the wavelength tint (`derived`, the same formula plus the stretch) and the SPHEREx composite (`derived`, the backend's `formula`); in "Measured only" both fall back to the grey frames with a note, and a refused composite says why in plain words (Q-93). See [A4.1](pipeline.md#a41-stage-1-find-the-object), rendering doc R4, Q-27 and Q-28. | Built (#3, #47) |
| 3 | **Fixture data:** synthetic fixture data on the dev-only fixture server wears "Fixture" and a page-wide banner instead, never Measured; a production build cannot contain it ([UML 08](../uml/08-sequence-search-flipbook.md)). The Fixture badge is a proposed dev-only exception to the 3 badges of D-02 (Q-32, open). | Built |
| 4 | **Refusals** (`missing`, every code in [A4.12](refusals.md#a412-missing-and-refusal-codes)) are shown grouped by reason, one plain-English line with a count each ("239 frames where the detector flagged the object’s centre as saturated or unusable."), with the frame IDs behind a disclosure. A code the UI has no wording for is still listed, never hidden, but as generic plain text ("Some data for this object is not available."; for frames "N frames not used for another reason."), not as the raw code, which stays only in a `data-code` attribute for debugging ([Q-477](../decisions/contract.md), accepted; amends Q-196). When a spectrum has no points, the panel says why; when some frames are refused, it states where the measured points lie, any large gap between them, and the frames' span (issue #24). The `saturated` reason is worded without a cause: it also covers a blank centre pixel with a saturation flag nearby, so the UI never says the object is too bright. | Built (#24; `app/refusals.ts`, `app/messages.ts`) |
| 5 | **Demo-object caveats** (D-31) in plain words next to the spectrum. TWA 27: "This is 2M1207 A and its planet b blended into one point; it is not the planet's own spectrum. A fainter star inside the aperture adds about 7–11 %." IRAS 04302+2247: "This object is extended (a disk seen edge-on), so the flux is what falls in the aperture, neither a point-source nor a total flux. Every point is flagged because SIMBAD gives no proper motion." SIMP 0136: "This object varies in brightness as it rotates (a few percent in hours), and each point comes from a different visit, so part of the spectrum's shape can be that variation." (Q-24). Evidence: [A3.12](targets.md#a312-test-and-demo-targets). | **To build** with the demo quick picks (#15, M5); none of these strings is in `frontend/src` |
| 6 | **Honesty toggle:** 3 states, one per badge: Measured only, + Estimated, + Artistic (D-21), starting at + Estimated. It applies to layers, haptics and sound alike. What each state shows, including the `teq_pulse` rule, is owned by [R5.3](../rendering/display-rules.md) and D-21. Build it, Replay and New seed raise the level to + Artistic only when the plan has hidden layers (Q-113 item 7, proposed; conflict [Q-200](../decisions/contract-tags.md)). | Built |
| 7 | **Labels on generated things:** every rendering is labelled an artist's impression; imagined sounds "Imagined"; AI images "AI-made". | Artist's impression built (`app/build/BuildPane.tsx`, `ViewerPanel.tsx`); "Imagined" and "AI-made" to build with the imagined drive and the Gemini swap-in (A6.2) |
| 8 | **New objects** are labelled "Sketch from SPHEREx only" (asset status `sketch`, [A4.4](pipeline-card.md#a44-stage-4-check-for-a-saved-asset)). | **To build** (Moon): the backend sends `X-SX-Asset-Status: sketch`, the UI shows no such label yet |
| 9 | Real spacecraft photos are used only to compare against our output, never as textures. | Rule (nothing to build) |
| 10 | **State limits in plain words**, for example: SPHEREx cannot resolve an asteroid, so shape detail is not in the data. | To build (copy per object type, Moon) |
| 11 | **Sky credit:** the survey credit (the `credit` string of `backend/app/core/sky/surveys.py`) is always shown next to the sky (D-35); the sky is labelled as not SPHEREx data (Q-88). | Built (`app/shell/Panels.tsx`); exact credit line **[verify]** |

**Track tool labels** (A19, [moving-objects/track.md](moving-objects/track.md); all **to build**, Atish):

- A frame kept with `OUTLIER` on a moving object's core is drawn as a hollow point with the note "flagged OUTLIER", and its `flags` column says so in the export ([Q-139](../decisions/moving-objects.md)).
- The spin slider ("Colour or Clock?") is tagged `artistic`, shown only at + Artistic, and labelled "Synthetic rock, not Eros's data"; it is never exported and never sonified as data ([Q-135](../decisions/moving-objects.md)).
- A comet's spectrum shows the fixed caption "aperture, not total flux" ([Q-144](../decisions/moving-objects.md)).
- The Horizons path and its sound are `model_dependent` (Estimated) and silent or hidden in Measured only (Q-134, Q-138).

**Area search wording** ("unexplained track", never "an asteroid", "new" or "a discovery"; "found blind = (designation)"; "possible"): owned by [A16.5](moving-objects/area-search.md) (Q-146).

### A11.1 Blind test (optional demo)

Give the pipeline only the data a normal object would have, then show our result next to real spacecraft images, with a scorecard. Not scheduled for the event. **Proposed (Q-199):** owner Atish; object 433 Eros, built as `asteroid_procedural` from its SBDB values with the registered Gaskell shape model withheld, compared with NEAR Shoemaker images (Bennu has no registered model; its shape is part of issue #68).

| Compare | Expectation |
|---|---|
| Size, rough elongation | Should match |
| Colour class and brightness | Should match for known asteroids |
| Craters, ridges, boulders | Will not match |
| Concave or unusual shapes | Will not match |

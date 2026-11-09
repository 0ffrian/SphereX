# Build split view and moulding

> **Part of:** Rendering & haptics spec ([index](README.md)) · **Sections:** R5.8 · **Implements:** [Q-113, Q-120](../decisions/shell-surfaces.md), [D-21](../decisions/contract-tags.md), [Q-49](../decisions/rendering-bodies.md), [D-34](../decisions/rendering-motion.md) · **Read with:** [display-rules.md](display-rules.md) (R5.3, R5.6, R5.7), [accessibility.md](accessibility.md) (R9), [sky-shell.md](../architecture/sky-shell.md) (A21, the shell around the pane)

### R5.8 Build split view and moulding

These are the presentation rules of the one 3D view (Q-113, as amended by Q-120). How a user reaches it from the sky (marker click, card, brackets, rail) is shell behaviour, specified in A21 ([sky-shell.md](../architecture/sky-shell.md)). Every R5 rule applies inside the pane.

**One 3D view and the split**

- There is one 3D view. The old floating viewer card is gone.
- Ways in (Q-120 item 4): *Build it* on the object card, *Build it in 3D* in the object panel, and the rail's 3D viewer. The rail opens the body already built, with no moulding. A left click on a sky marker opens the object panel, not the pane (Q-120 item 1).
- *Build it* splits the view. The sky moves to the left half and stays live. The build pane takes the right half. At phone width (640 px or less) the pane is a full-height sheet over the sky. The flipbook transport and the quick picks step aside while the pane is open.
- The link holds `#…&build` while the pane is open. Back, Escape and the × button close it.
- The pane header holds the title, the honesty level with its D-02 badge, the Show control, and the tools: Feel, Replay, New seed, Close. A numbered strip shows the moulding steps.
- The body comes from `/card` and `/render-params` (D-16) when the card is asked for or the pane opens, not on every marker click (Q-120 item 5).
- A 404 is final: the pane says "There is no 3D model of <name> to build" and draws nothing. A timeout, network or server error says so with *Try again*, and the next *Build it* asks again (Q-113 item 8).

**The moulding is a presentation of the real plan**

- The moulding is never a second model. The body is planned and fully loaded first (card, params, plan, meshes, textures and the generated field, `ViewerApp.whenLoaded`) behind a loading state ("Looking up its 3D model…"). Only then do the steps play.
- Each body type has the mock-up's steps (`viewer/mould/mouldSteps.ts`, `mouldKindOf`). A step reveals plan layers. `PlanContext.hold` holds the layers of later steps: they are not drawn and not listed in `missing`. The `tint` hold shows the colour as plain grey until its step.
- Knobs run from their start value to 1, and value 1 is the normal render:
  - whole-body scale from 0.55 to 1, and a wireframe scaffold;
  - sphere-to-shape morph of mesh bodies, on a CPU copy of the geometry (the cached model never changes);
  - volume growth;
  - the generated worlds' terrain, sea, colour and cloud knobs (`ShaderBody.setMould`, switched with `select` at 1, so the final pixels are the normal ones).
- The scale and the scaffold are presentation only. They carry no value, appear in no legend and are removed at the end.
- A step with no drawn layer and no knob is left out. Drawn layers that no step names come with the last step.
- The base mould of a type whose shape is a layer (`ellipsoid`, mesh) is the plain body at the size on the card, as the plan draws it when that layer is refused.
- The last stage is the normal plan, and the pose is cleared (`MouldRig.restore`). The final frame is the normal render of the same card and seed; `frontend/e2e/build.spec.ts` compares them by SSIM (R11).
- The moulding never shows a layer the honesty level hides, and never adds one the plan does not have.

**Timing and motion**

- 2.3 s per step (`STAGE_S`), smoothstep easing x²(3 − 2x), steps one after another. The pane says "Built" 0.3 s after the last step (`DONE_AFTER_S`).
- While building, the body turns at 0.28 rad/s from the start turn (0.28, 0.6). A drag turns the body (0.008 rad per pixel, tilt within ±1.2 rad) instead of orbiting the camera. Wheel, pinch, keys and the on-screen buttons work as in R5.6. `R` or Reset view returns the turn to 0.
- *Replay* plays the moulding again on the same plan.
- *New seed* adds 1 to the render params' seed in the browser. It changes only what the browser generates from the seed (generated worlds, the star surface, jets, volumes), not baked textures. It is disabled where nothing is generated from the seed (baked asteroids) and says "This body's surface is baked, so a new seed would look the same". Whether New seed should ask the backend for a new bake is open (R12 #32).
- A polite live region says "Building <name>" when a build starts and "Built <name>" when it ends.

**Reduced motion (R9)**

- With `prefers-reduced-motion`, there is no moulding animation and no auto-turn: the built body shows at once. The live region still says what was built. The Replay icon does not spin.

**Honesty while moulding**

- The level and its badge are in the pane header, and the Show control (Measured only / + Estimated) stays in the pane.
- D-21 starts the toggle at + Estimated. A generated world's surface is `artistic`, so at that level a build would show only a plain sphere. **Proposed exception (Q-113 item 7, Moon to confirm; the same question as Q-49):** *Build it*, *Replay* and *New seed* raise the stored level to + Artistic when the plan has layers that the level hides. The rail's 3D viewer and a plain level change do not. The live region says "Showing artist's impression so the whole body can be built". The change is global: the flipbook and the rest of the page see it too (`app/ViewerPanel.tsx`, `LEVEL_RAISED_ANNOUNCEMENT`).
- The user can lower the level at any time. A level change during a build ends the build at once, on the new level's plan.
- Every revealed layer keeps its tag chip (R5.3). The body tone (R8.9.1) follows the same filter, so after the raise an `artistic` relief is heard as well as seen.

**Feel**

- The Feel toggle (Q-113 item 5) switches the pane to desktop Feel mode, specified in R5.6. While a build runs, a drag turns the body; Feel takes effect once the body is built (at once under reduced motion). **Proposed (Q-173).**
- **Not built yet:** the toggle only shows the note "Touch feedback arrives with the phone build." (`frontend/src/app/build/BuildPane.tsx:203-208`). Under Q-132 the event Feel is sound, so the note changes when Atish wires Feel (D-13, M5).

**As built (issue #60).** `frontend/src/app/build/` (`BuildPane`, `SelectedCard`, `MouldStrip`, `useMould`, `selectedBody`), `frontend/src/viewer/mould/` (`mouldSteps.ts`, `MouldRig.ts`) and `ViewerApp.setDragTurnsBody`. Sequence diagram: [UML 21](../uml/21-sequence-build-mould.md). Q-113 is proposed, pending Moon's confirmation.

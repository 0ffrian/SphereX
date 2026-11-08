# Band-Hop Linker: in the sky view

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A18–A18.10 · **Overview:** [linker.md](linker.md) (A16) · **Backend:** [linker-backend.md](linker-backend.md) (A17)

Status: **proposal, not built** (Q-113). The sky view, shell and transport are the sky-view prototype (Q-89). The linker adds to them; it changes nothing they already do for a searched object.

## A18 Linker in the sky view

**Principle: one sky.** The linker is folded into the sky as two **layers** (Detections, Chains), one **tool** in the left rail, and **cards** in the existing floating panel. Target markers, cached markers, the picked position, the survey credit and click-to-pick all keep working while the linker is open. A clickable prototype of this design is in the mock-up (`mockup/spherex-ui.html`, Linker tool, key 5) on a local branch; it is not part of this spec's PR.

### A18.1 Shell and tool

- `ToolId` in `frontend/src/app/shell/shellStore.ts` gains `'linker'`. `ToolRail.tsx` gains a **Linker** button (chain icon in `icons.tsx`, hint "Linked moving objects in a field").
- `Panels.tsx` renders `LinkerPanel` for `tool === 'linker'`, in a `PanelCard` like the object panel (a bottom sheet at ≤ 640 px). The panel has three views, one at a time:

| View | Contents |
|---|---|
| **Field** (default) | Field picker (the precomputed fields, `GET /v1/link/fields`), `computed_at`, the two layer switches, the **Show the linked chains** button, the chain list (one row per chain: id, hops, SED score, residual, match chip), **Open the completeness atlas** |
| **Chain** (A18.5) | One chain's evidence |
| **Atlas** (A18.6) | The completeness curve and its tiles |

- Choosing another tool hides the panel; the layers stay on until switched off, so the chains can still be seen over the sky with the object panel open.
- **Before the reveal**, the Chains layer is off and the list shows each chain greyed out with "waiting". The reveal switches the Chains layer on and fills the list one chain at a time (650 ms apart; at once under reduced motion). The rows are rendered from the start so the panel does not change height.

### A18.2 Sky layers (`frontend/src/app/sky/linker/LinkerLayer.tsx`)

- **One 2D canvas** inside `SkyPane`, stacked above the SkyView WebGL canvas and below the DOM markers and the credit. `pointer-events: none` except while the Chains layer is on (see picking).
- **Drawn from the SkyPane render listener**, as the markers are: positions from `raDecToScreen` (`viewer/sky/skyMath.ts`) on every camera change or frame change, written straight to the canvas with no React re-render. The canvas follows the device pixel ratio capped at 1.5 (D-05).
- **Detections layer** (current frame only): each orphan as a ring of radius 6 CSS px in the colour of its wavelength (`wavelengthColor.ts`, `artistic`). With chains shown, orphans that belong to no chain drop to 35 % opacity. Static detections are not drawn.
- **Chains layer:** for each revealed chain, a dotted polyline through its hops with `time ≤` the current frame time, small dots at past hops, a filled dot with a white edge at the current hop, and a label at the last drawn hop (wording A16.5). Known chains use a solid line and unmatched chains a dashed line, so colour is never the only cue (R9). The selected chain is drawn in the accent colour with the four-corner bracket used for the selected object.
- **Labels** are clamped inside the pane (measured text width), and hidden when the field of view is wider than 30° (they would overlap).
- **Picking.** A click (pointer moved < 5 px, as now) first tests chains when the Chains layer is on: the nearest drawn hop or segment within 12 CSS px selects that chain and opens the Chain view. Otherwise the click falls through to the existing pick (coordinates search). Target and cached markers are DOM buttons above the canvas and keep priority.
- **Text alternative** (`aria-describedby` on the sky canvas): "Field F1, frame 5 of 12, 1.30 µm: 87 detections, 4 linked chains, 2 match known objects."

### A18.3 Time and transport

- The transport bar (`app/shell/Transport.tsx`) drives the **field's** frames while the Linker tool is open and a field is loaded, and the object flipbook's frames otherwise. Each keeps its own index, so switching tools does not lose a place.
- A linker playback session mirrors `flipbook/session.tsx` (timer, speed, "can play"), but it preloads nothing: the layers draw from JSON, and stamps load only in the Chain view.
- The readout shows `day d of D · λ µm · frame k/N`, with `d` counted from the first frame of the pass. The wavelength shown is the frame's range midpoint; each detection carries its own wavelength.
- The reveal jumps to the last frame so the whole tracks show; the user can then scrub back.

### A18.4 Camera

- Opening a field flies the camera (the existing fly, 700 ms) to the field centre with a field of view of 2.5 × the field diameter, at least 1°.
- The fly puts the field's chains clear of the panel: the field centre goes at 70 % of the pane height on desktop (the card is top-centre in the mock-up layout) and at `PHONE_OBJECT_Y` on phones.
- Selecting a chain from the list flies to that chain's last hop if it is off screen. Under reduced motion every fly is a jump.

### A18.5 Chain view

- **Header:** chain id; subtitle "matches a known object" or "matches nothing known".
- **Chips:** `Known match: <designation>`, `Unmatched · candidate` or `Low confidence`; the dev-only Fixture badge when relevant.
- **SED:** flux against wavelength, one point per hop coloured by wavelength with its error bar, the quadratic fit dashed, `sed_jump` hops ringed in amber with "SED jumps here". Built on the existing spectrum chart code in `app/spectrum/`.
- **Stamp strip:** up to 8 stamps from `/stamps/{det_id}.png`, evenly spread in time, each with its wavelength under it. A missing stamp shows the refusal text, not a grey box.
- **Facts** with badges (A16.5): hops and span in days, channels, rate and position angle, fit residual, SED score, known match and separation, verdict.
- **Buttons:** for a known chain, **Open (designation)**, which runs the normal search for that designation; **Back to the field**; **Atlas**.

### A18.6 Atlas view

- **Chart:** recovered fraction against injected magnitude; bins with Wilson bars, the logistic curve and its band, a dashed line at the 50 % magnitude. The region fainter than the measured per-exposure limit is shaded "below the limit, not counted"; with no measured limit there is no shading, and the refusal is listed.
- **Conditions:** a switch for 0.3 mag rotation and a segmented control for the slow or fast rate band. They choose among the four precomputed curves (A17.6); nothing is computed in the browser.
- **Tiles:** recall above the limit, 50 % magnitude, false links in the shuffled control (`n_chains / n_permutations`), median fit residual; each with its design target in small text, never as a result.
- **Export:** links to `export.ecsv` and `export.ades.psv`, with the "not submittable" note next to the ADES link.
- The atlas is a panel view, not a separate page; the sky stays visible next to it.

### A18.7 State and API client

- A `linker` slice in `frontend/src/state/store.ts`: `fields`, `fieldId`, `field`, `detections`, `chains`, `completeness` (each `idle | loading | ready | error`), `layers {detections, chains}`, `revealed[]`, `frameIndex`, `playing`, `selectedChain`, `view: 'field' | 'chain' | 'atlas'`.
- API functions in `frontend/src/app/api/` for the routes of A17.8, validated at runtime in `validate.ts` against the generated contract types (D-18). A newer field choice aborts older requests, as `skySearch` does.
- Loading order: field list, then field summary and chains, then detections for the current frame plus neighbours, then completeness when the Atlas view opens.
- URL hash (`useHashSync`): `link=<field_id>` and `chain=<chain_id>`, so a chain can be shared.
- Copy lives in `app/messages.ts`; refusals go through `refusals.ts` and `RefusalList.tsx`.

### A18.8 Accessibility (R9)

- Every chain is reachable without the canvas: the chain list rows are buttons, and each opens the Chain view and flies to the chain.
- Layer switches are labelled checkboxes. The reveal announces "4 chains linked: 2 match known objects, 2 are unmatched candidates" through `LiveAnnouncer`.
- Known and unmatched differ by line style and label, not colour alone. Wavelength colours use the existing palette and contrast rules.
- Reduced motion: no staggered reveal, no fly animation, no pulsing bracket.

### A18.9 Performance and haptics

- D-05: at most a few thousand detections per frame and a few dozen chains are drawn, far under the 60k point budget. Only the current frame's detections are drawn.
- D-34: the layer redraws on change only (camera, frame, layer switch, selection); a still sky runs no frame loop.
- **Haptics (optional, Atish, M3, D-13):** while scrubbing with a chain selected, a short tick at each hop; on the SED, the Listen sweep of [A8](sound-voice.md#a8-sound-and-voice) over the hop fluxes. Not needed for the linker to work.

### A18.10 Testing

| Layer | Tests |
|---|---|
| Backend | Determinism (two runs, byte-identical outputs); static removal on recorded frames; linking recovers injected movers on synthetic frames; the shuffled control yields no chains on pure noise; known match against a recorded SkyBoT reply; ECSV and ADES writers; offline 404 for an absent field |
| Frontend unit | Hit-testing and label clamping; RA wrap-around in the layer; the store slice (loading, abort, views); validation of every fixture |
| Components | Linker panel views; the reveal with and without reduced motion; refusal display |
| e2e (Playwright) | On fixtures: open Linker, reveal, click a track, open the atlas, follow a shared `link=` link. On the real cache (L3): the same flow under `SX_OFFLINE=1` |

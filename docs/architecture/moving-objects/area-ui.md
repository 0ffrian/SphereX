# Area search: in the sky view

> **Part of:** Architecture spec ([index](../README.md)) · **Sections:** A18 to A18.10 · **Implements:** [Q-146](../../decisions/moving-objects.md), [Q-120, Q-121, Q-123, Q-124](../../decisions/sky-shell.md), [Q-132](../../decisions/platform-hosting.md), D-21 ([contract](../../decisions/contract.md)) · **Read with:** [area-search.md](area-search.md) (A16), [area-backend.md](area-backend.md) (A17), [sky-shell.md](../sky-shell.md) (A21, with A21.8 to A21.13 in [sky-shell-behaviour.md](../sky-shell-behaviour.md)), [track-ui.md](track-ui.md) (A20)

Status: **agreed plan, not built** ([Q-146](../../decisions/moving-objects.md)). Owner: Moon (ticket D2; `frontend/src/app/` and `state/` are Moon's, D-17). Area search uses the shell as [A21](../sky-shell.md) specifies it (layout, rail, surfaces, sky interaction, split pane, keys, hash) and changes nothing it already does for a searched object. Where A21 marks an extension point **To build (proposed, Q-NEW-SHELL-n)**, Area search depends on it and names it; those placeholders are A21's, not this fragment's. Track's own screen is [A20](track-ui.md); this fragment only opens it.

Mock-up: `mockup/spherex-ui.html`, mock-up tool 5 (the app adds no number keys, Q-121). How to run it: CLAUDE.md "Layout". Visual input only (D-01).

## A18 Area search in the sky view

**Principle: one sky.** Area search is one **tool** in the left rail, a **square** drawn on the sky, two **layers** (Dots, Tracks) and **feature cards** (A21.5). Target markers, cached markers, the picked position and click-to-pick keep working outside the drawing step.

### A18.1 Tool and drawing

- **New tool** by the A21.13 checklist ([A21](../sky-shell.md)): `ToolId` in `frontend/src/app/shell/shellStore.ts` gains `'area'` (A21.4); `ToolRail.tsx` gains an **Area search** button with the hint "Draw a square, then follow known objects or look for movers"; its icon is a `SHAPES` entry in `shell/railIcons.tsx` (the compiler requires one per `ToolId`); `shell/icons.tsx` only if a card header needs it. Choosing another tool leaves Area search and keeps its state in the store, so choosing it again restores the square and the card.
- Choosing the tool opens the **Area** card ("Drag a square over the part of the sky you want to search") and switches the sky's pointer mode to `draw` (A21.6, Q-NEW-SHELL-5): crosshair cursor; a drag draws the square instead of panning; the wheel still zooms. Buttons: **Use a square in the middle** and, when there is one, **Keep the last square**.
- The square is drawn in the accent colour (dashed while dragging, solid after) with its size in degrees above its top-left corner. A square under 30 CSS px on a side is refused with "Drag a bigger square".
- On release the frontend picks the prepared area holding the square from the `GET /v1/areas` index (A16.4). None: the card says "This part of the sky is not prepared" (`area:not_prepared`) and lists the prepared areas with **Fly there**, which uses `skyFlyTo` (A21.6, Q-NEW-SHELL-5) and respects reduced motion.
- Escape leaves drawing mode and keeps the square, at rank 3 of the Escape order in A21.10 (Q-NEW-SHELL-1). The pointer mode returns to `pan`.

### A18.2 Sky layers (`frontend/src/app/sky/area/AreaLayer.tsx`)

- **One 2D canvas** in the **sky layer slot** of A21.2 (after the edge fades, before the markers, cards and panel), `pointer-events: none`. Hits go through the layer hit-test chain of A21.6 (Q-NEW-SHELL-5), run after marker buttons and before the sky's own pick; the A21.13 sky-layer checklist applies.
- **Drawn from the SkyPane render listener**, as the markers are: positions from `raDecToScreen` on every camera, visit or step change, written straight to the canvas with no React re-render. Device pixel ratio capped at 1.5 (D-05). RA wraps at 0/360.
- **Dots layer** (current visit only): before the stars step, star and fixed dots are white rings; after it, a faint cross. Glitches are rings in their wavelength colour until the glitch step, then hidden. Movers-to-be are rings in their wavelength colour (`wavelengthColor.ts`, tag `derived` as Rainbow Trails is built, Q-27 open). Dots with `OUTLIER` are drawn like the others (A16.5).
- **Tracks layer** (after the join step): each tracklet as a short line through its exposures with a dot per frame, and a dashed line joining the two visits. `found_blind` uses a short dash and the accent label; `unexplained` a long dash in amber; `unchecked` a dotted line in grey; `possible` has no join line. Colour is never the only cue (R9). The selected track gets the four-corner bracket used for the selected object.
- **Known positions** (Known card open): a small diamond per frame time at the Horizons position, joined by a thin line, tag `model_dependent`.
- **Honesty toggle (D-21):** "Measured only" keeps the dots (measured centroids placed through the frame WCS), drawn in one colour as Rainbow Trails does; it hides track lines, labels, verdicts and Known positions and shows the note "Tracks and known paths are Estimated". "+ Estimated" (the starting state) shows everything. Nothing in Area search is `artistic`.
- **Labels** at the last dot: "T1 · found blind = 433 Eros", "T2 · unexplained track", "T3 · possible · 1 visit", "T4 · not checked" (A16.5). Clamped inside the safe rectangle of A21.2 (insets, credit, open card; `skySafeRect()`, Q-NEW-SHELL-5); hidden when the view is wider than 30°.
- **Picking.** With the Tracks layer on, a click within 20 CSS px of a track's dot opens its Result card (A18.7). A marker button wins over a track hit; a track dot under a marker is reached from the results list. Otherwise the click falls through to the sky's own pick or the marker's left click, which leave Area search for the object panel while the tool keeps its state (A21.13 item 4, Q-NEW-SHELL-6). Right-click keeps its Q-120 meaning (the object card).
- **Text alternative:** a second id appended to the sky canvas's `aria-describedby`, never replacing the shell's instructions (A21.12): "Area 1.05° by 0.63°, visit 2 of 2: 4 movers, 1 found blind as 433 Eros, 1 unexplained, 1 not checked, 1 possible."

### A18.3 Visits and blink

- Discovery shows one **visit** at a time, chosen in the Discovery card with a segmented control "Visit 1 · date, time UTC | Visit 2 · …". The transport belongs to the flipbook, has no modes and is not used (A21.9, Q-NEW-SHELL-6).
- **Blink the 2 visits** is a toggle button (`aria-pressed`) in the same card. While pressed it switches visits every 750 ms (under 3 Hz), the classic way to spot a mover by eye: stars stay put, movers jump. It stops when pressed again, when the Discovery card closes, when the Track pane opens and when the tool changes (WCAG 2.2.2). Under reduced motion it is off by default and each press steps one visit.

### A18.4 Cards and minimise

- **Surface.** Every Area card is a **feature card** of A21.5 (Q-NEW-SHELL-3): it renders in the object card's slot (top centre, 340 px, z 25), shown only while `tool` is `area`, so it never meets the object card. A wider card needs a width token decided with it; the mock-up's 408 px is not used. Area cards never use the object panel.
- **Header:** title, **Minimise** and ×. × ends the current card and returns to the previous Area card, or to the sky from the Area card; focus goes to the Area rail button (A21.5).
- **Minimise** (Q-146 item 3; mechanism A21.5, Q-NEW-SHELL-3, amending Q-121 item 2): the card hides and the island takes its `progress` mode, a pill that is a button named "Show <card title>" and keeps showing progress ("Discovery · Step 3 of 5 · Drop stars", then "3 movers found · 1 is 433 Eros"), so the whole square stays visible while the steps play. A click, Enter or Space restores the card as it is now and focuses its heading. The progress text changes no more than once per step.
- Right-click keeps its Q-120 meaning (the object card for a marker); it never restores an Area card.
- While the Track pane is open the Area card is hidden; **Back to the area** brings it back (A18.8).
- Cards: Area (A18.1), Options (A18.5), Known (A18.5), Discovery (A18.6), Result (A18.7).

### A18.5 Options and Known objects

- **Options card:** title "Area · w° × h°", subtitle "n SPHEREx frames in v visits · dates". Two large buttons: **Known objects** ("Follow asteroids and comets already on file that crossed this square") and **Discovery** ("Look for dots that move and match nothing on file"). **Draw again** under them.
- **Known card:** one row per object from `/known` (A17.8): number and name, kind, frames and visits, and an action:
  - **Track it** when `track_available`: opens the Track pane for `object_id` ([A20.1](track-ui.md#a201-where-track-lives)).
  - **Open** otherwise: searches the object as a left click on its marker does (Q-120), so the object panel opens and Area search is left while the tool keeps its state (A21.13 item 4, Q-NEW-SHELL-6). The row says why Track is missing ("Track not prepared for this object offline").
- Each row has its provenance badge (Estimated: SkyBoT and Horizons, A16.5) and the date of the SkyBoT answer.

### A18.6 Discovery card

- **Note** (amber while fixtures are in use; in the event build replaced by `computed_at`): what is demo and what is real.
- **Five steps**, each a row with a check, a name and its count from `steps` (A17.8): Find dots · Drop one-exposure glitches · Drop stars and fixed dots (Gaia DR3, CatWISE) · Join what moves across visits · Check known objects (SkyBoT, Horizons). **Look for movers** replays them one second apart (at once under reduced motion), turns both layers on and fits the camera so the square sits in the safe rectangle below the card (A21.2; `skyFlyTo`, A21.6, Q-NEW-SHELL-5). Afterwards the button reads **Run again**. The blink stays off until the user presses it (A18.3).
- **Results list:** one row per track or possible, rendered from the start (greyed "waiting") so the card does not change height: id, "Moves across both visits" or "Seen in 1 visit", frames, and a chip: `433 Eros` (green), `unexplained` (amber), `not checked` (grey) or `possible`. A row is a button that opens the Result card.
- The reveal is announced through the shell's `announce(text)` action (A21.12, Q-NEW-SHELL-7; today `LiveAnnouncer` reads only `sky.announcement`): "4 movers: 1 is 433 Eros, found blind; 1 unexplained; 1 not checked; 1 seen in one visit".

### A18.7 Result card

The card for one Discovery result (called "Track card" before; renamed so "Track" on screen means only the Track tool, **Proposed (Q-NEW-MOV-5)**). The result itself is a "Discovery track" in the docs; its on-screen labels stay as Q-146 wrote them.

- Header: the id; subtitle "Matches a known object", "Matches nothing known", "Not checked" or "Seen in one visit". Chips: `Known: <designation>`, `Unexplained track`, `Not checked` or `Possible · one visit`, plus the dev-only Fixture badge.
- One sentence per verdict:
  - found blind: "The search was not given Eros's position. We chose this area because Eros crossed it; the known-object check then named it 433 Eros."
  - unexplained: "Moves steadily across both visits and matches nothing known to SkyBoT as of <date>. A lead for follow-up, not a discovery."
  - unchecked: "Moves across both visits. It could not be checked against known objects (<reason>)."
  - possible: "Moves within one visit only. It needs a second visit before it counts as a track."
- Facts with badges: visits, frames, glitch check, star check, known object and separation (Estimated), apparent rate and direction between visits, labelled "apparent, seen from SPHEREx" (`derived`; the rate inside a visit is not shown, Q-134), and the dots with flags (`OUTLIER` named, Measured).
- Buttons: **Open in Track** (found blind only), **Back to Discovery**.

### A18.8 Hand-off to Track

- **Open in Track** and **Track it** call `openPane({ kind: 'track', objectId, from: { area: areaId, card } })` (A21.8, Q-NEW-SHELL-2), never `setTool`, so the tool stays `area`. The pane is the only occupant: Track replaces Build in place and the reverse. Its width is the shell's per-kind `--sx-split-w` (A21.8; Track's value is proposed in [A20.1](track-ui.md#a201-where-track-lives)).
- The hash gains `track=<object id>` with its own history entry (A21.11, Q-NEW-SHELL-4).
- The pane header has **Back to the area**: it closes Track, reopens the card the user came from and focuses its heading (A21.8 focus return for `from: area`). × and Escape close it too; Escape closes the pane before anything else of Area search (A21.10, Q-NEW-SHELL-1).
- Track's path, frames, zoom, spectrum and sound are [A19](track.md) and [A20](track-ui.md). The sky marker for the mover follows Track's time slider through the marker feed the Track layer registers (A21.13, [A20.3](track-ui.md#a203-time)).

### A18.9 State, API client, accessibility, performance

- An `area` slice in `frontend/src/state/store.ts`: `index`, `areaId`, `square`, `summary`, `known`, `dots`, `tracks` (each `idle | loading | ready | error`), `layers {dots, tracks}`, `step`, `visit`, `blink`, `selectedResult`, `card`, `minimised`.
- API functions in `frontend/src/app/api/` for A17.8, validated at runtime in `validate.ts` against the generated contract types (D-18). A newer square aborts older requests.
- **URL hash** (A21.11, Q-NEW-SHELL-4): `area=<area_id>` (sets the tool to `area` and opens that area's card; an unknown area is a link problem), plus `atrack=<T-id>` for an open Result card (`track=` belongs to the Track pane). A hash with only tool keys is valid. A new area pushes; choosing a result or a step replaces.
- Copy in `app/messages.ts`; refusals through `refusals.ts` and `RefusalList.tsx`.
- **Keys (A21.10):** no number keys (Q-121). The square is its own focusable element (`role="group"`, label "Search square, w by h degrees"); while it has focus, the arrow keys move it and Shift + arrows resize it, with `preventDefault`. On the sky canvas the arrows still pan (Q-123).
- **Accessibility (R9):** every result is reachable without the canvas (the results rows are buttons); the square can be set without a drag (**Use a square in the middle**, then the keys above); layer switches are labelled checkboxes; the blink has a visible stop.
- **Performance:** D-05 budget; only the current visit's dots are drawn. D-34: redraw on change only, except while the blink runs.
- **Sound:** Track owns the sound for a known object (Q-134). Discovery adds none for the event build. Desktop only (Q-132).

### A18.10 Testing

| Layer | Tests |
|---|---|
| Frontend unit | Square drawing and the minimum size; the square's keys only while it has focus; hit-test order (marker before track); label clamping to the safe rectangle; RA wrap; the store slice (loading, abort, steps); hash read and write of `area` and `atrack`; validation of every fixture |
| Components | Options, Known (Track it and Open), Discovery and Result cards; every verdict's sentence; the step replay with and without reduced motion; the blink toggle stops; minimise and restore during the replay; "Measured only" hides lines, labels and Known positions; refusal display |
| e2e (Playwright) | On fixtures: choose the tool, draw a square, Discovery, run, minimise, restore, open T1, Open in Track, Back to the area; Known, Track it; Escape order (Track, then drawing, then the card). On the real cache (D3): the same flow on the Eros area under `SX_OFFLINE=1` |
| Backend | In [A17](area-backend.md) and ticket D1: determinism; glitch, star and fixed labels on recorded frames; the Eros test (one `track`); the 4 fixture movers; an ambiguous pair stays possible; the match against recorded SkyBoT and Horizons replies; `unchecked` on a failed SkyBoT reply; ECSV; offline 404 |

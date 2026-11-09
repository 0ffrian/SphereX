# Area search: in the sky view

> **Part of:** Architecture spec ([index](../README.md)) · **Sections:** A18–A18.10 · **Overview:** [linker.md](area-search.md) (A16) · **Backend:** [linker-backend.md](area-backend.md) (A17)

Status: **agreed plan, not built** ([Q-146](../../decisions/moving-objects.md)). The sky view, shell and island are the sky-view prototype (Q-89) and the rail and island of the mock-up (#66). Area search adds to them; it changes nothing they already do for a searched object. Track's own screen is Atish's (Q-131); this fragment only opens it.

Mock-up: `mockup/spherex-ui.html`, Area search tool (key 5). Serve the `mockup/` folder over http so the Track pane can load `chase-the-rock.html` next to it.

## A18 Area search in the sky view

**Principle: one sky.** Area search is one **tool** in the left rail, a **square** drawn on the sky, two **layers** (Dots, Tracks), and **cards** in the island. Target markers, cached markers, the picked position and click-to-pick keep working outside the drawing step.

### A18.1 Tool and drawing

- `ToolId` in `frontend/src/app/shell/shellStore.ts` gains `'area'`. `ToolRail.tsx` gains an **Area search** button (square-with-dots icon in `icons.tsx`, hint "Draw a square, then follow known objects or look for movers").
- Choosing the tool opens the **Area** card ("Drag a square over the part of the sky you want to search") and puts the sky in drawing mode: crosshair cursor; a drag draws the square instead of panning; the wheel still zooms. Buttons: **Use a square in the middle**, and **Keep the last square** when there is one.
- The square is drawn in the accent colour (dashed while dragging, solid after) with its size in degrees above its top-left corner. A square under 30 CSS px on a side is refused with "Drag a bigger square".
- On release the frontend finds the precomputed area holding the square (A16.4). None: the card says "This part of the sky is not prepared" and lists the prepared areas with **Fly there**. Escape or another tool leaves drawing mode and keeps the square.

### A18.2 Sky layers (`frontend/src/app/sky/area/AreaLayer.tsx`)

- **One 2D canvas** inside `SkyPane`, above the SkyView WebGL canvas and below the DOM markers. `pointer-events: none` except for picking tracks.
- **Drawn from the SkyPane render listener**, as the markers are: positions from `raDecToScreen` on every camera, visit or step change, written straight to the canvas with no React re-render. Device pixel ratio capped at 1.5 (D-05).
- **Dots layer** (current visit only): before the stars step, star dots are white rings; after it, a faint cross. Glitches are rings in their wavelength colour until the glitch step, then hidden. Movers-to-be are rings in their wavelength colour (`wavelengthColor.ts`, `artistic`).
- **Tracks layer** (after the join step): each tracklet as a short line through its exposures with a dot per exposure in its wavelength colour, and a dashed line joining the two visits. `found_blind` uses a short dash and the accent label; `unexplained` a long dash in amber; `possible` has no join line. Colour is never the only cue (R9). The selected track gets the four-corner bracket used for the selected object.
- **Labels** at the last dot: "T1 · found blind = 433 Eros", "T2 · unexplained track", "T3 · possible · 1 visit" (A16.5). Clamped inside the pane; hidden when the view is wider than 30°.
- **Picking.** With the Tracks layer on, a click within 20 CSS px of a track's dot opens its Track card (A18.7). Otherwise the click falls through to the existing pick.
- **Text alternative** (`aria-describedby` on the sky canvas): "Area 1.05° by 0.63°, visit 2 of 2: 3 movers, 1 found blind as 433 Eros, 1 unexplained, 1 possible."

### A18.3 Visits and blink

- Discovery shows one **visit** at a time. **Blink the 2 visits** switches between them every 750 ms, the classic way to spot a mover by eye: stars stay put, movers jump. Under reduced motion the blink is off by default and the button steps one visit per press.
- While Area search has the sky, the transport bar shows `visit v of V · date, time UTC` instead of the flipbook frame. The flipbook keeps its own index.

### A18.4 Island cards and minimise

- Every Area card opens in the island (as the object card does) at 408 px wide; the island's **close** and **minimise** buttons work on all of them.
- **Minimise** shrinks the card to the island pill, which keeps showing progress ("Discovery · Step 3 of 5 · Drop stars", then "3 movers found · 1 is 433 Eros"), so the whole square is visible while the steps play. A click on the pill, or a right-click, brings the card back as it is now.
- Cards: Area (A18.1), Options (A18.5), Known (A18.5), Discovery (A18.6), Track card (A18.7).

### A18.5 Options and Known objects

- **Options card:** title "Area · w° × h°", subtitle "n SPHEREx frames in v visits · dates". Two large buttons: **Known objects** ("Follow asteroids and comets already on file that crossed this square") and **Discovery** ("Look for dots that move and match nothing on file"). **Draw again** under them.
- **Known card:** one row per object from `/known` (A17.8): number and name, kind, frames and visits, and a chip **Track it** when `track_available`, else **Open** (the object card). **Track it** opens Track (A18.8).

### A18.6 Discovery card

- **Note** (amber, always shown while fixtures are in use; in the event build replaced by `computed_at`): what is demo and what is real.
- **Five steps**, each a row with a check, a name and its count from `steps` (A17.8): Find dots · Drop one-exposure glitches · Drop stars (Gaia DR3, CatWISE) · Join what moves across visits · Check known objects (SkyBoT). **Look for movers** replays them one second apart (at once under reduced motion), turns both layers on, starts the blink and fits the camera so the square sits below the card. Afterwards the button reads **Run again**.
- **Results list:** one row per track or possible, rendered from the start (greyed "waiting") so the card does not change height: id, "Moves across both visits" or "Seen in 1 visit", exposures, and a chip: `433 Eros` (green), `unexplained` (amber) or `possible`. A row opens the Track card.
- The reveal announces "3 movers: 1 is 433 Eros, found blind; 1 unexplained; 1 seen in one visit" through `LiveAnnouncer`.

### A18.7 Track card

- Header: the track id; subtitle "Track · matches a known object" or "Track · matches nothing known". Chips: `Known: <designation>`, `Unexplained track` or `Possible · one visit`, plus the dev-only Fixture badge.
- One sentence: found blind ("Found without being told where to look. SkyBoT then confirmed it is 433 Eros."), unexplained ("Moves steadily across both visits and matches nothing in SkyBoT. A lead for follow-up, not a discovery."), possible ("Moves within one visit only. It needs a second visit before it counts as a track.").
- Facts with badges: visits, exposures, glitch check, star check, known object and separation, rate and direction.
- Buttons: **Open in Track** (found blind only), **Back to Discovery**.

### A18.8 Hand-off to Track

- **Open in Track** and **Track it** open Atish's Track view for that object (Q-131) in the split pane used by Build (the sky moves left, the pane takes the right side; about 62 % in the mock-up). The pane header has **Back to the area**, which closes Track and reopens the card the user came from, and a close button.
- Track's path, frames, zoom, spectrum and sound are specified by Q-131 to Q-145, not here. The sky marker for the mover follows Track's time slider (Q-142).

### A18.9 State, API client, accessibility, performance

- An `area` slice in `frontend/src/state/store.ts`: `areas`, `areaId`, `square`, `summary`, `known`, `dots`, `tracks` (each `idle | loading | ready | error`), `layers {dots, tracks}`, `step`, `visit`, `blink`, `selectedTrack`, `card`, `minimised`.
- API functions in `frontend/src/app/api/` for A17.8, validated at runtime in `validate.ts` against the generated contract types (D-18). A newer square aborts older requests.
- URL hash (`useHashSync`): `area=<area_id>` and `track=<track_id>`.
- Copy in `app/messages.ts`; refusals through `refusals.ts` and `RefusalList.tsx`.
- **Accessibility (R9):** every track is reachable without the canvas (the results rows are buttons); the square can be set without a drag (**Use a square in the middle**, then arrow keys move it and Shift + arrows resize it); layer switches are labelled checkboxes.
- **Performance:** D-05 budget; only the current visit's dots are drawn. D-34: redraw on change only, except while the blink runs.
- **Sound:** Track owns the sound for a known object (Q-134). Discovery adds none for the event build. Desktop only (Q-132).

### A18.10 Testing

| Layer | Tests |
|---|---|
| Backend | Determinism (two runs, byte-identical outputs); glitch, star and fixed labels on recorded frames; joining recovers the 3 fixture movers and labels them track, track and possible; an ambiguous pair stays possible; SkyBoT match against a recorded reply; ECSV writer; offline 404 for an absent area |
| Frontend unit | Square drawing and the minimum size; hit-testing and label clamping; RA wrap-around; the store slice (loading, abort, steps); validation of every fixture |
| Components | Options, Known, Discovery and Track cards; the step replay with and without reduced motion; minimise and restore during the replay; refusal display |
| e2e (Playwright) | On fixtures: draw a square, Discovery, run, minimise, restore, open T1, Open in Track, Back to the area; Known, Track it. On the real cache (D3): the same flow on the Eros area under `SX_OFFLINE=1` |

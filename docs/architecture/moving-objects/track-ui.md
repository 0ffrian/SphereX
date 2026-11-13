# Track: the screen

> **Part of:** Architecture spec ([index](../README.md)) · **Sections:** A20 to A20.15 · **Implements:** [Q-131, Q-135, Q-136, Q-138, Q-139, Q-142, Q-144](../../decisions/moving-objects.md), [Q-134](../../decisions/haptics-sound.md), [Q-132](../../decisions/platform-hosting.md), D-21 ([contract-tags](../../decisions/contract-tags.md)), D-35 ([sky-shell](../../decisions/sky-shell.md)) · **Read with:** [track.md](track.md) (A19), [track-contract.md](track-contract.md) (A19.9 to A19.15), [sky-shell.md](../sky-shell.md) (A21, with A21.8 to A21.13 in [sky-shell-behaviour.md](../sky-shell-behaviour.md)), [area-ui.md](area-ui.md) (A18), [audio-pairing.md](../../rendering/haptics/audio-pairing.md) (R8.9.2), [accessibility.md](../../rendering/accessibility.md) (R9), [uml/23](../../uml/23-track.md)

Status: **agreed in parts, not built** (every section is **To build**). Owner: Atish (Q-131). The files live in `frontend/src/app/track/`, inside `frontend/src/app/`, which D-17 gives to Moon; Track's screen and sound are Atish's by **Proposed (Q-183)**, a D-17 amendment like Q-135's for the spin slider.

**Mock-up approximations, never ported** (`mockup/chase-the-rock.html`, D-01):

- Star masks are bright peaks found in each frame; the app places them from Gaia DR3 and CatWISE ([A19.6](track.md#a196-star-list-for-movers)).
- Brightness uses Stage 2's radii without its sub-pixel weights or clipping; the app uses Stage 2 itself ([A19.7](track.md#a197-photometry-for-movers)).
- Its hollow dots mean "hardware flags". In the app, frames with hardware flags on the core are refused and listed, and a hollow point means a kept, flagged point such as `OUTLIER` on the core (Q-139, A20.7).
- Its path is hourly plus the exposure times; the app uses 10-min samples and exact TLIST positions ([A19.4](track.md#a194-positions)).
- Its note that DSS2 would sharpen the backdrop is out of date: DSS2 adds nothing (Q-136, A20.5).
- Its own honesty toggle and rail button "Track (new)": the app has one global toggle (D-21) and no Track rail button (A20.1).

## A20 Track in the sky view

### A20.1 Where Track lives

- Track is the `track` kind of the shell's **split pane** (A21.8, pane kinds proposed as Q-171): opened with `openPane({ kind: 'track', objectId, from })`, never `setTool`; the sky moves left and stays live, the pane takes the other side. It is not a rail tool and has no `ToolId` (**Proposed (Q-181)**, Atish's answer to A21.8's open point on a Track rail button).
- **Width:** `--sx-split-w` for `track` is 50 %, as Build (**Proposed (Q-181)**; the mock-up's 62 % is not used). At 1920 px that leaves the pane about 940 px, enough for the detail view, zoom and spectrum stacked.
- **Opened from** ([A19.2](track.md#a192-entry-points)): the Area Known card's **Track it**, a found-blind Result card's **Open in Track**, the object panel's **Track it** for a `moving = true` object, and a link with `track=<id>`.
- **One occupant:** Track replaces Build in place and the reverse (A21.8). The hash holds `track=<id>` while it is open, with a history entry marked `{ sxPane: 'track' }` (A21.8, Q-171 item 4; hash key A21.11, Q-173).
- **Closed by** × in the pane header, Escape (rank 2 in A21.10, after a focused text field; Q-170), the browser's Back, and **Back to the area** (shown when `from` is an area; reopens the Area card the user came from). Focus returns by `from` as A21.8 sets it: the Area card's heading for `area`; the object's marker for `panel`; the sky canvas for `link`.
- Desktop only (Q-132): the phone-width sheet of A21.8 is not designed for the event.

### A20.2 Layout

Top to bottom in the pane; the pane scrolls and the time bar stays at its bottom.

1. **Header:** the object chip (number and name, class, and SBDB facts such as the rotation period, each with its badge as the ObjectCard tags it), the direction caption (A20.4), **Back to the area** when relevant, ×.
2. **Detail view** (A20.5): the path near the frames on a sharper backdrop.
3. **Zoom** (A20.6): one SPHEREx frame at the current time.
4. **Spectrum** (A20.7): built hop by hop, with the spin slider at "+ Artistic" (A20.8).
5. **Time bar** (A20.3): play, previous and next exposure, the slider with exposure ticks, the UTC clock, the sound controls (A20.9).

The honesty toggle is the app's global one (D-21); Track adds no second toggle. The path and marker on the main sky are drawn by the Track layer (A20.4).

### A20.3 Time

- **Frame and exposure.** A **frame** is one detector's image. An **exposure** is the frames taken at one midpoint: 2 on Eros, D1 and D4 at once ([A17.1](area-backend.md#a171-area-and-frames-framespy), A16.6). Eros has 4 exposures per visit, so its window holds 8 exposures and 16 frames. The slider steps and snaps per exposure; the spectrum, the zoom facts and the refusals count frames.
- **Range:** the Track window (A19.3; Eros: 20 Mar 2026 00:00 to 21 Mar 2026 12:00 UTC, Proposed (Q-184)).
- **Exposure ticks** on the slider, one per exposure, made of one mark per frame (the marks share a time, so they are stacked), each in its frame's wavelength colour (`derived`, Q-27); a refused frame's mark is a grey cross.
- **Play/pause:** inside a visit, 1 min of data per second (a 6.4 min visit takes about 6 s); the gap between visits is jumped with the note "Next visit, 24.4 h later". **Previous** and **next exposure** buttons. Releasing the slider within 4 px of a tick snaps to that exposure.
- **Clock:** date and time UTC of the slider.
- **Marker** (Q-142): the mover's marker on the sky and in the detail view follows the slider, from the 10-min samples between exposures and the exact TLIST at an exposure ([A19.4](track.md#a194-positions)). On the sky it is fed through the marker feed the Track layer registers (`{ key, ra, dec }`, A21.13), not through `sky.resolved`; the resolve-epoch marker for the object is hidden while Track is open.

### A20.4 Path on the sky

- A **Track layer** (`frontend/src/app/track/TrackLayer.tsx`), one 2D canvas in the sky layer slot of A21.2 (Q-174), `pointer-events: none`, drawn from the SkyPane render listener with `raDecToScreen`; RA wraps at 0/360; device pixel ratio capped at 1.5 (D-05). It follows the A21.13 sky-layer checklist and takes no clicks.
- Draws: the path so far (solid) and still to come (dashed), the marker, each frame's cutout box (`derived`) with the current one highlighted, and each frame's footprint (`measured`) when served (A19.3).
- On open the camera fits the window's path inside the safe rectangle of the sky's half (A21.2) with `skyFlyTo({ box })` (A21.6, Q-174), at once under reduced motion.
- **"Measured only"** hides the path, marker and cutout boxes, keeps the footprints, and shows "Path hidden: it comes from the Horizons orbit model (Estimated)."
- **Direction caption** in the pane header, because R8.9.2 never gives the direction by pan alone: "Moving <compass direction> at <rate>°/day between visits (apparent, seen from SPHEREx)", the rate and direction between visits of A19.11 (`derived`; the rate inside a visit is not shown, Q-134). Shown from "+ Estimated"; with one visit it reads "Seen in one visit: no direction between visits".

### A20.5 Detail view and imagery

- A north-up, east-left view of the path near the frames (Eros: about 2° wide), with the same path, marker and boxes as A20.4, and a zoom-in around the current frame.
- **High-resolution imagery only here** (Q-136), never on the sky background: Pan-STARRS DR1 colour where Dec > −30°, else Legacy Surveys DR10 colour where it covers, both HiPS up to order 11 (about 0.2″ per pixel), at the order the view needs; the 2MASS colour mirror (D-35) as the fallback. DSS2 is not used.
- **Served locally only**, as the sky tiles are ([A3.11](../object-sources.md#a311-sky-background-irsa-hips)); nothing is fetched at request time. **Gate:** until CDS agrees to a local partial copy (Q-136 **[verify]**), only the 2MASS mirror is used and the view notes `imagery:<survey>` ("Sharper imagery not available offline").
- The survey credit line is always shown (D-35), with the backdrop's tag per Q-88 (open) and the note "Taken years before SPHEREx; the object is not in it."

### A20.6 Zoom

- The current frame's cutout (`/cutouts/{frame_id}.png`), rotated north-up from `north_angle_deg` and `mirrored` ([A4.1](../pipeline.md#a41-stage-1-find-the-object)); when they are absent it stays in native orientation with the note "Not rotated: orientation unknown". The stretch from the frames reply is stated. A scale bar of 6.15″ per pixel.
- **Toggles** (labelled checkboxes): **Mask stars** (A19.6, `derived`), **Predicted position** (a ring of the 3 px aperture, `model_dependent`), **Path** (the segment through the cutout, `model_dependent`), **Flagged pixels** (`/flags/{frame_id}.png`, `measured`, [A4.9](../overlays.md#a49-overlays-flag-mask-and-combine)).
- **Facts:** frame id, detector, time UTC, exposure 113.58 s, wavelength and bandwidth, flux ± error or the refusal reason, flags, contamination.

### A20.7 Spectrum, hop by hop

- Wavelength (µm) against flux (µJy) with error bars, one point per frame (A20.3). An exposure's points appear when the slider passes it; the current exposure's points are ringed. A count reads "n of N frames".
- **Flagged points are hollow** with the note naming the reason: "flagged OUTLIER" for `outlier_core` (Q-139). On Eros all 14 points are hollow: 13 for `outlier_core`, and the 14th because it also carries `OUTLIER` and `PERSIST` dropped off the core (flagged, no `outlier_core`); checked offline on the recorded frames (issue #72, [Q-459](../../decisions/moving-objects.md)).
- **Refused frames** are listed under the plot with their reasons ("2 frames not measured: hardware flags NONFUNC, SUR_ERROR, TRANSIENT on the object"), never drawn.
- **Caption:** "Each point is one frame. Points mix wavelength with time: the two visits are a day apart and Eros spins every 5.27 h, so a dip is not automatically chemistry." The period comes from SBDB; without one the sentence drops it.
- **3I/ATLAS** (stretch): the caption "aperture, not total flux; background taken from inside the coma" (A19.8).
- Point colour is the wavelength colour (`derived`, Q-27 open); in "Measured only" one colour.

### A20.8 Spin slider

- "Colour or Clock?" (Q-135, Atish): a synthetic rock with a flat spectrum, sampled at the real exposure times with a seeded lightcurve (seed from the object id, so it is the same every time), drawn as a dashed grey series on the spectrum plot.
- Shown only at "+ Artistic" (tag `artistic`, D-21), labelled "Synthetic rock, not Eros's data". The amplitude is set by the user (0 to 0.5 mag, default 0); the period is the SBDB rotation period when there is one, else the slider is not shown.
- Never exported ([A19.9](track-contract.md#a199-export)) and never sonified. File `frontend/src/app/track/SpinSlider.tsx`.

### A20.9 Sound

Track's path sound (Q-134: one tick per exposure, wavelength to pitch, drawn x to pan, the path voice, the reference click, the mute, the desktop unlock gesture, direction never by pan alone) is specified in **R8.9.2** ([audio-pairing.md](../../rendering/haptics/audio-pairing.md)) and not repeated here. A20 only places its controls in the time bar: a **Sound** toggle (off until pressed; the press unlocks audio on desktop) and the visible **mute** for the reference click.

### A20.10 Honesty toggle

| D-21 state | Shown | Heard (R8.9.2) |
|---|---|---|
| **Measured only** | Zoom pixels, flagged-pixel mask, footprints, spectrum points in one colour, facts that are measured, refused-frame list | Exposure ticks; the reference click (`measured`, unless muted) |
| **+ Estimated** (starting state) | Adds path, marker, ring, path segment, cutout boxes, star masks, contamination, wavelength colours, direction caption, backdrop and imagery (per Q-88) | Adds the path voice |
| **+ Artistic** | Adds the spin slider and its series | Nothing more (spin is never sonified) |

### A20.11 States

- **Never blank:** the pane opens at once with the header; each panel has its own state.
- **Loading:** the frames poll while `frames:search_deferred` or `cutouts:deferred` is listed and the path while `path:deferred` is (Q-97 loop: one request in flight, backing off); the spectrum waits for a complete frame list (Q-97).
- **Partial:** frames and ticks appear as they arrive; the spectrum says "Waiting for all frames".
- **Refused:** wording from `refusals.ts` ([A19.10](track-contract.md#a1910-refusal-codes)), in `RefusalList`.
- **Empty window:** "SPHEREx caught no frames of this object between <start> and <end>."
- **Not prepared offline:** `path:not_cached` or no cached frames: "Track was not prepared for this object offline."
- **Error:** the message and **Try again**.

### A20.12 Accessibility (R9)

- **Text alternatives:** the Track layer appends an id to the sky canvas's `aria-describedby` (A21.12) ("Path of 433 Eros, 20 to 21 Mar 2026, 16 frames in 8 exposures, now at exposure 3"); the zoom has alt text from its facts; the spectrum has **Show as table**.
- **Keys** only on Track's own controls (A21.10); no number keys (Q-121).
- **Slider:** a native range input with `aria-valuetext` ("20 Mar 2026 08:35:10 UTC, exposure 2 of 4, visit 1"). Left and Right step to the previous or next exposure, Page Up and Page Down jump a visit, Home and End go to the ends.
- **Motion:** Play is a toggle with `aria-pressed`; under reduced motion it does not auto-play and the camera moves at once.
- **Live region:** the clock is not live; a polite announcement through the shell's `announce(text)` (A21.12, Q-176) is made only when the exposure changes, at most once per second; on a change of visit it adds the direction caption (A20.4).
- Colour is never the only cue (hollow points, labels, tick shapes); the sound has a visible mute; controls are at least 24 px.

### A20.13 State, API and files

- A `track` slice in `frontend/src/state/store.ts` (Moon's file; the slice is Atish's): `id`, `from` (opener, for focus return and Back), `path`, `frames`, `overlays`, `spectrum` (each `idle | loading | ready | error`), `time`, `playing`, `frameIndex`, `zoomLayers {masks, ring, path, flags}`, `spinAmplitude`, `sound {on, clickMuted}`.
- API: `getPath` in `frontend/src/app/api/track.ts`, validated in `validate.ts` against the generated `track-path` types (D-18); frames, spectrum and overlays reuse the existing functions. Closing the pane aborts its requests.
- Files in `frontend/src/app/track/`: `TrackPane.tsx`, `TrackHeader.tsx`, `DetailView.tsx`, `Zoom.tsx`, `SpectrumHops.tsx`, `TimeBar.tsx`, `SpinSlider.tsx`, `TrackLayer.tsx`, `trackTime.ts` (interpolation and snapping). Copy in `app/messages.ts`.

### A20.14 Performance

- D-34: redraw on change only; a frame loop runs only while playing. D-05 budget on the A15.
- Imagery: at most 64 tiles in memory **[verify]**, the order the view needs, local tiles only.
- One cutout PNG and one flag mask at a time; cutouts cached by URL in the browser.

### A20.15 Tests and tickets

| Ticket | Owner | Milestone |
|---|---|---|
| **T2 Track screen** (A20.1 to A20.14) | Atish | M4 Extras, P1 (**Proposed (Q-187)**) |
| **T3 Track sound** (R8.9.2, A20.9) | Atish | M3 (renamed "Sound", Q-132) |

| Layer | Tests |
|---|---|
| Unit | Interpolation between samples and the snap at exposures (`trackTime.ts`); slider and marker in sync; the hash `track=<id>`; Escape closes Track before any other surface (a focused text field keeps it, Q-170) |
| Components | Eros fixture: 14 points, 13 hollow, 2 refused frames listed; "Measured only" hides the path and keeps the footprints; spin slider only at "+ Artistic" and absent from the export; every refusal code has wording; the imagery gate note |
| e2e (Playwright) | On the Eros cache under `SX_OFFLINE=1`: Area search, Known, Track it, scrub, play, step, Back to the area; the object panel's Track it; Build then Track (one occupant) |
| Review | `/sx-design-review` for honesty labels, R9 and copy |

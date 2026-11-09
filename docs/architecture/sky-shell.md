# App shell and sky view

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A21–A21.7 (A21.8–A21.13 in [sky-shell-behaviour.md](sky-shell-behaviour.md)) · **Implements:** [Q-89](../decisions/sky-shell.md), [Q-113](../decisions/sky-shell.md) (Select, Build it), [Q-120](../decisions/sky-shell.md), [Q-121](../decisions/sky-shell.md), [Q-123](../decisions/sky-shell.md), [Q-124](../decisions/sky-shell.md), [D-35](../decisions/sky-shell.md#d-35-local-copy-of-sky-survey-tiles-for-the-sky-background), [Q-87](../decisions/sky-shell.md), [Q-88](../decisions/sky-shell.md), [Q-90](../decisions/sky-shell.md), [Q-98](../decisions/sky-shell.md), [Q-91](../decisions/contract.md) · **Read with:** [frontend-platform.md](frontend-platform.md), [../rendering/accessibility.md](../rendering/accessibility.md)

## A21 App shell and sky view

The shell is the frame of the app: the bezel, the tool rail, the island, the sky view, the object panel, the object card, the split pane, the transport and the search pill. This fragment describes it **as built** on main (9 Nov 2026), precise enough to change or extend it without reading the code. Decisions win where they speak; where they disagree with each other or with the code, the latest decision's rule is stated and the clash is listed in [Open conflicts](sky-shell-behaviour.md#open-conflicts). Text marked **To build (proposed, Q-150 to Q-157)** is not decided and not built.

Code paths are under `frontend/src/`. CSS is `index.css`. "Desktop" means wider than 640 px; "phone" means 640 px or less (A21.3).

**Names.** One name per surface, used in every spec and decision from now on:

| Name | What it is | Component | CSS | Do not confuse with |
|---|---|---|---|---|
| **island** | The orb at the top centre: idle circle, Thinking pill, then the box that travels into the object panel | `app/island/Island.tsx`, `islandStore.ts` | `.sx-orb-wrap`, `.sx-orb`, `.sx-orb-in` | The mock-up's `.island`, which is also a card container ("island card") |
| **object panel** | The floating panel that the Flipbook and Spectrum tools open (frames, spectrum, Build it in 3D) | `app/shell/Panels.tsx` (`ObjectPanel`) in `app/shell/PanelCard.tsx` | `.sx-panel` | "panel card" (the generic component), the mock-up's island card |
| **object card** | The top-centre card asked for with a right-click (See fingerprint, Build it) | `app/build/SelectedCard.tsx` | `.sx-island-wrap`, `.sx-island` (class names kept from the mock-up) | **ObjectCard** |
| **ObjectCard** | The data record from `GET /v1/objects/{id}/card` (D-02, D-16) | `contract/` types, `app/build/selectedBody.ts` | none | the object card |
| **split pane** | The layout where the sky takes the left side and a pane the right | `app/App.tsx` (`data-split`) | `[data-split]` | |
| **build pane** | The only occupant of the split pane today: the 3D view that moulds the body | `app/build/BuildPane.tsx` | `.sx-bp` | the removed floating viewer card (Q-113 item 2) |
| **feature card** (proposed) | A tool's own card in the object card's slot, such as the Area cards of A18 | none yet | none yet | the object card (A21.5) |

Other names: **rail** (`app/shell/ToolRail.tsx`, `.sx-rail`), **transport** (`app/shell/Transport.tsx`, `.sx-player`), **search pill** (`app/search/SearchBar.tsx`, `.sx-search`), **readout** (`app/shell/Readout.tsx`), **credit** (`.sx-sky-credit` in `app/sky/SkyPane.tsx`), **markers** and **brackets** (A21.6).

### A21.1 Status and sources

| Source | Status | What it settles |
|---|---|---|
| [Q-89](../decisions/sky-shell.md) | Open (implemented as described) | Shell follows the mock-up; the sky is the default pane; what was left out |
| [Q-113](../decisions/sky-shell.md) (Select, Build it) | Proposed, pending Moon; items 1, 6, 8 superseded by Q-120 | Split pane, build pane, moulding, the object card, right-click |
| [Q-120](../decisions/sky-shell.md) | Decided (Moon) | Left click on a marker opens the object; the object card only when asked for; when the body loads |
| [Q-121](../decisions/sky-shell.md) | Proposed, pending Moon | Rail look, island states, travel, no number keys |
| [Q-123](../decisions/sky-shell.md) | Decided (Moon) | No on-screen pan and zoom buttons; smoothui grid loader (`motion` 14.10.1) |
| [Q-124](../decisions/sky-shell.md) | Decided (Moon) | Full-bleed sky, edge fades, insets, camera centre |
| [D-35](../decisions/sky-shell.md#d-35-local-copy-of-sky-survey-tiles-for-the-sky-background), [Q-87](../decisions/sky-shell.md), [Q-88](../decisions/sky-shell.md), [Q-90](../decisions/sky-shell.md), [Q-98](../decisions/sky-shell.md) | Accepted; Open (implemented) | Sky image, credit, sky endpoints, texture budget, cached markers |
| [Q-91](../decisions/contract.md), [Q-95](../decisions/sky-shell.md), [Q-97](../decisions/sky-shell.md) | Open (implemented) | Picked position is `derived`; `colour=` link key; progressive frames |
| [Q-146](../decisions/moving-objects.md), [Q-131](../decisions/moving-objects.md), [Q-142](../decisions/moving-objects.md) | Answered | Area search and Track reuse the shell; their shell hooks are proposed in A21.13 |

- Code roots: `app/App.tsx`, `app/shell/`, `app/island/`, `app/sky/`, `app/build/`, `app/search/`, `app/urlHash.ts`, `app/useHashSync.ts`, `app/LiveAnnouncer.tsx`, `viewer/sky/`, `index.css`. Owner: Moon (D-17); haptics in the build pane: Atish.
- **Rule:** a change to the shell's behaviour needs a decision row in [decisions/sky-shell.md](../decisions/sky-shell.md) and an edit to this fragment in the same PR.

### A21.2 Layout, insets, safe rectangle, z-order

- **Screen and bezel** ([Q-89](../decisions/sky-shell.md)): `.sx-screen` is fixed to the viewport with 14 px padding. `.sx-bezel` has a 28 px radius and a 1 px border. Tokens: `--sx-rail: 64px`, `--sx-top: 60px`, `--sx-bot: 64px`. Grid columns `rail | 1fr | minmax(0, 24rem) | 16px`, rows `top | 1fr | bot`, areas `'rail top top top' 'rail view view .' '. transport search .'`: transport bottom left, search pill bottom right.
- **DOM and Tab order** (`app/App.tsx`): `header.sx-top` (sr-only h1 "Shift & Spectrum", fixture banner, readout) → `.sx-search-slot` → rail → `main.sx-view[aria-label="Sky view"]` (`.sx-sky-slot` > SkyPane; then the build pane when open) → `.sx-transport-slot` → island. `LiveAnnouncer` sits outside the bezel.
- **Full-bleed sky** ([Q-124](../decisions/sky-shell.md), desktop only): `.sx-view` spans the whole bezel (`grid-area: 1 / 1 / -1 / -1`, no radius). Header, rail, search slot and transport slot get `position: relative; z-index: 2` and float over the sky. The header has no brand, only the sr-only h1.
- **Insets** (desktop only, set on `.sx-bezel`): `--sx-in-t: 60px`, `--sx-in-l: 64px`, `--sx-in-b: 64px`, `--sx-in-r: 16px`. The object panel, the credit, the object card, the sky status and the build pane are placed with them (A21.5, A21.7, A21.8). Markers, picking, the readout, the fly-to target and the camera centre do **not** use them: the camera centre is the centre of the sky slot (the bezel, or its left half in the split pane), and a marker can sit under a floating bar.
- **Edge fades** (`.sx-sky-shade`, four `<i>` strips, `pointer-events: none`, `aria-hidden`): left strip `rail + 130px` wide (`#050507f0` to `#050507a8` at 0.9 × rail, then transparent), top strip `top + 100px`, bottom strip `bot + 100px`, right strip 90 px (hidden in the split pane). Plus a radial vignette (transparent to 55 %, `#000a` at the edge). Strips, not full-size gradients, so the blend stays cheap without a GPU.
- **Safe rectangle.** The part of the sky that no bar, card or credit covers: left `--sx-in-l`, top `--sx-in-t`, right `--sx-in-r`, bottom `--sx-in-b` + `--sx-credit-h`, minus the box of an open object panel or card. On a phone every inset is 0 and the credit strip is at the bottom. Today only DOM overlays respect it. **To build (proposed, [Q-154](sky-shell-behaviour.md#open-conflicts)):** a helper `skySafeRect()` in `app/sky/` that returns this rectangle in canvas pixels; sky layers clamp labels to it, `skyFlyTo` (A21.6) centres on it, and markers outside it fade.
- **Z-order (desktop).** `.sx-sky-slot` and `.sx-sky-pane` set `container: … / inline-size`; layout containment makes each a stacking context, so every z-index inside the sky is local and the whole sky sits under the bars.

| Level | Element | z | Notes |
|---|---|---|---|
| Sky slot (own stacking context) | in paint order: canvas, focus ring, vignette, `.sx-sky-shade`, sky status, markers `<ul>` | auto | Markers paint above the canvas and below everything with a positive z |
| | object panel `.sx-panel` | 20 | local to the sky |
| | object card `.sx-island-wrap`, credit `.sx-sky-credit` | 25 | local; the credit is never covered (D-35) |
| Bezel | header, rail, search slot, transport slot | 2 | floating bars; the search pop (z 30) and the rail tooltip (z 60) are local to them |
| Bezel | build pane `.sx-bp` | 6 | above the bars; it stops at the insets so it does not overlap them |
| Bezel | island `.sx-orb-wrap` | 40 | above everything; takes no clicks |

**Sky layer slot** (proposed, Q-154): a tool's sky layer (A18.2) is a child of SkyPane placed after `.sx-sky-shade` and before `{children}` (object card, object panel), at z auto, so it paints over the fades and under the markers, panel, card and credit.

### A21.3 Phone width (≤ 640 px)

- **One breakpoint.** `(max-width: 640px)` in `app/App.tsx` (`usePhoneWidth`), `app/island/Island.tsx` (`COMPACT`), `app/sky/SkyPane.tsx` (`PHONE_QUERY`) and CSS (`@media (max-width: 640px)`, desktop rules under `min-width: 641px`). Change all of them together. Code note: one exported constant would remove the copies. Coarse pointer is a separate test: 44 px targets (`@media (pointer: coarse)`) and the 4096 px sky cap (A21.7).
- **Layout** ([Q-89](../decisions/sky-shell.md); Q-124 keeps it stacked): screen padding 0, bezel without radius or border, one column, rows `'top' 'rail' 'view' 'transport' 'search'` with a 6 px gap. No insets, no edge fades, no floating bars. The sky view has a 6 px side margin and a 14 px radius.
- **Rail** becomes a tab bar: a row of 72 × 52 px buttons with 11 px captions under the icons, the active pip a 3 px bar under the button; the "TOOLS" label is hidden.
- **Search:** the quick picks and notes stack above the field in the flow; the chips scroll sideways in one row with a 28 px fade at the right; the help floats above the field (click-through) so focusing the field does not move the sky. `.sx-hide-s` items are hidden (the transport's wavelength, the credit's renderer line).
- **Credit** is a full-width strip at the bottom of the sky (`border-radius: 0 0 14px 14px`). **Object panel** is a bottom sheet docked on the credit: `bottom: var(--sx-credit-h)`, full width, `max-height: calc(72% - var(--sx-credit-h))`, radius `20px 20px 0 0`.
- **Island** is hidden at rest (opacity 0); the Thinking pill shows over the top of the sky, 8 px below the top of `.sx-view` ([Q-121](../decisions/sky-shell.md) item 7).
- **Split pane** is a full-height sheet over the sky view (`.sx-bp` 100 % wide, slides up 48 px); the sky slot keeps its full width and is `inert`; the transport row is `display: none` so the sheet reaches the search pill ([Q-113](../decisions/sky-shell.md) item 2).
- **Fly-to** always moves the found object to 22 % of the sky's height from the top, clear of the bottom sheet (A21.6).
- The event is desktop only ([Q-132](../decisions/platform-hosting.md)); the phone layout is kept working but not demoed. The long press relies on the browser's `contextmenu` event, which iOS Safari does not fire.

### A21.4 Tool rail and ToolId

- `ToolId = 'sky' | 'flipbook' | 'spectrum' | 'viewer'` (`app/shell/shellStore.ts`). Labels and hints (`app/shell/ToolRail.tsx`, `TOOLS`): Sky "The sky view alone", Flipbook "SPHEREx frames of the object", Spectrum "Spectrum of the object", 3D viewer "3D view of a loaded body". Start tool: `sky`.
- **Icons** are in `app/shell/railIcons.tsx` (`SHAPES: Record<ToolId, ReactNode>`): a new ToolId without a shape fails the typecheck. Every stroke has `pathLength="1"` so it draws itself again on hover (`.ai-draw`). `app/shell/icons.tsx` is a different set (`IconName`) for panel headers and buttons.
- **Look** ([Q-121](../decisions/sky-shell.md) item 1): 44 × 44 px buttons; one highlight pill (`.sx-hl`) slides to the hovered button and back to the active one, placed from the button's own box (so the phone tab bar works too) and re-placed on resize; a green pip grows in on the active tool; a tooltip (z 60) shows the label to the right. No number keys; no buttons for unbuilt tools (Haptics, Comet Breath, Area search).
- **Buttons:** `nav[aria-label="Tools"]`; each `button` has `aria-label` (the label), `aria-description` (the hint), `data-testid="tool-<id>"`. `aria-pressed` is `build.open` for 3D viewer and `tool === id && !build.open` for the others.
- **`setTool(id)`** (`shellStore.ts`): sets `tool`; adds 1 to `focusSeq` (the panel scrolls to its section again); `flipbook` and `spectrum` drop `cardRequested`; `viewer` opens the build pane built (`animate: false`, `seq + 1`, `seedOffset: 0`) even when it is already open; **any other tool closes an open build pane** (`seedOffset` back to 0). `openTool('spectrum')` (`ToolRail.tsx`) also starts the spectrum load when frames are ready and the spectrum is idle. `closePanel()` sets `tool: 'sky'`.
- **What a search does to the tool** (`useOpenPanelOnSearch`, `app/App.tsx`), on every new `sky.query`: (1) a query not from the sky drops `cardRequested`; (2) a sky query with the card requested (a right-click that selects) changes nothing more; (3) with the build pane open nothing changes; (4) else the tool becomes `flipbook` unless it is `flipbook` or `spectrum`. A sky pick and a left click on a marker drop the card request where they are made (SkyPane), so they open the object panel ([Q-120](../decisions/sky-shell.md) item 1).
- **Shell states as built.** Invariant: `build.open` implies `tool` is `sky` or `viewer`. At most one of object panel, object card and build pane shows; the island's Thinking pill can show with the object card or the build pane.

| Shows | When |
|---|---|
| Object panel | `tool` is `flipbook` or `spectrum`, and the island is not thinking |
| Object card | `cardRequested`, `tool === 'sky'`, `!build.open`, and there is a subject (a selection by name, or a requested coordinates query) |
| Build pane | `build.open` |
| Island Thinking pill | `sky.status` is `resolving` or `loading_frames` and no panel is mounted |

### A21.5 Overlay surfaces (island, object panel, object card)

**Island** ([Q-121](../decisions/sky-shell.md), [Q-123](../decisions/sky-shell.md) item 2; `app/island/`). Modes (`data-mode`):
- `idle`: a 52 px circle 4 px below the bezel top, centred on the bezel's width; the smoothui `GridLoader` (vendored `GridLoader.tsx`) lit and still (`IDLE_LOOK`: heartbeat, `static`); a green glow at 0.35 opacity, still. Decorative: `pointer-events: none`, the loader wrapped `aria-hidden`.
- `thinking`, while `sky.status` is `resolving` or `loading_frames` (`islandText.ts`): a pill sized to its text (inner box at most 340 px, padding 12/18/12/15 px, radius min(h/2, 24)). A `role="status"` line: "Thinking", then "Finding “<query>”…" or the archive search sentence (`framesSearchingText`), the retry line (`framesRetryText`) and "Still waiting (N s)…" after 5 s. The loader plays `THINKING_LOOK` (ripple-out, breathing, ripple-in, twinkle, slow) and the glow breathes (2.6 s).
- `panel`: when a panel mounts after the island thought (`travels`), the island takes the panel's box (reported by the panel in bezel coordinates, `islandStore.ts`, radius 22) in one 0.6 s CSS move (`--sx-ease`, cubic-bezier(0.22, 1, 0.36, 1)). After 700 ms (`TRAVEL_MS`) it has `arrived`: the island fades out (0.25 s) and the panel fades in (0.25 s). Until then the panel is `pending`: laid out, opacity 0, `inert`. A panel opened from the rail with nothing loading shows at once; the island stays idle. Closing the panel sends the island back to the circle. `travels` turns on when thinking starts and off when it stops with no panel tool (a right-click search).
- **Reduced motion:** the loader stays `IDLE_LOOK`, the panel is `arrived` at once, and the global rule sets every transition to 0.01 ms. **Phone:** see A21.3. Transitions start only after the first measurement (`data-ready`).

**Object panel** ([Q-89](../decisions/sky-shell.md), [Q-121](../decisions/sky-shell.md) items 3 to 5; `app/shell/Panels.tsx`, `PanelCard.tsx`). A non-modal `section` labelled by its `h2` ("Flipbook" or "Spectrum"; subtitle the object's name, coordinates, "Looking up <q>" or "No object yet"). Desktop: `top: in-t + 8px`, `right: in-r + 52px`, width `min(440px, 100% - 64px)`, `max-height: calc(100% - in-t - in-b - 16px - max(56px, credit-h + 8px))`, radius 22, z 20. Content: the empty hint, Flipbook, SpectrumPanel, "There is no spectrum without frames." and **Build it in 3D** (`openBuild(true)`) when there is a selection. The Spectrum tool scrolls to the spectrum section; Flipbook to the top. × or Escape inside it calls `closePanel()` and focuses `[data-testid="tool-<tool>"]` on the next frame. If focus was lost to `body` while the island thought, the title takes focus when the panel stops pending. `.sx-panel-wide` and the `wide` prop have no caller (the removed viewer card).

**Object card** ([Q-113](../decisions/sky-shell.md) items 1, 8, 9 as amended by [Q-120](../decisions/sky-shell.md); `app/build/SelectedCard.tsx`). Top centre: `left: 50%`, `top: in-t + 8px` (8 px on a phone), width `min(340px, 100% - 24px)`, radius 26, z 25; it enters in 0.45 s (from 8 px up, scale 0.96). Shown only under the A21.4 condition. Subject: the selection (title the name; subtitle the type from the loaded render params, "Looking up its 3D model…", "No 3D model", "Moving object" or "Object on the sky"; "Could not load it just now. Press Build it to try again." after a transient failure) or a requested position (title the coordinates; "No 3D model at this position"; Build it disabled with that reason in its name). Actions: **See fingerprint** (`openTool('spectrum')`), **Build it** (retries a transient body failure, then `openBuild(true)`). × or Escape from anywhere except a text field deselects (`deselectObject`: `skyReset`, the hash cleared with `replaceState`, focus to the marker or the canvas). The wrapper is `aria-live="polite"`.

**Feature cards. To build (proposed, [Q-152](sky-shell-behaviour.md#open-conflicts)), amends Q-121 item 2:**
- A tool that needs a card (Area search, A18.4) renders it in the object card's slot (`.sx-island-wrap` place and z), shown only while `tool` is that tool, so it never meets the object card (which needs `tool === 'sky'`). Width 340 px as the object card; a wider card needs a width token decided with it (A18's 408 px is a mock-up value).
- Header: title, ×, and **Minimise** (`aria-expanded="true"`, `aria-controls` the card). × ends what the card is for and returns to its previous card or the sky; focus goes to the rail button of the tool.
- **Minimise** hides the card and gives the island a new mode, `progress`: a pill at the island's rest place showing the card's one-line progress text. Only in this mode the island takes clicks: it is a `button` named "Show <card title>" with `aria-expanded="false"`; a click, Enter or Space restores the card and focuses its heading; minimising focuses the pill. The progress text changes in a polite status no more than once per step. Precedence: `thinking` > `progress` > `idle`. Right-click on the sky keeps its Q-120 meaning (the object card), so it does not restore a feature card. Reduced motion: no animation. Phone: the pill shows over the top of the sky, as Thinking does.

### A21.6 Sky interaction

- **View** (`viewer/sky/SkyView.ts`, `viewer/sky/skyMath.ts`): seen from inside, north up, east (higher RA) to the left. Default view `{ ra: 266.4, dec: -28.9, fovDeg: 60 }` (towards the Galactic centre, a display choice). FOV clamped to 2° to 120°; the view centre's Dec to ±89.5°. Render on demand; markers and the readout follow each render through `view.onRender(listener)` with no React render.
- **Pointer** (listeners on the canvas, `app/sky/SkyPane.tsx`): a primary-button drag pans (`panByPixels`; at high Dec RA moves by dx / max(cos δ, 0.2)); a press that moved less than `CLICK_SLOP_PX` (5 px) is a click and picks; the wheel zooms at the pointer (FOV × exp(deltaY × s × 0.0015), s = 1 for pixels, 16 for lines, 400 for pages); two fingers pinch-zoom and pan by their midpoint; a pinch is never a click; lifting one finger keeps panning with the other. Non-primary mouse buttons do nothing. `data-dragging` switches the cursor from grab to grabbing; `setInteracting` holds texture swaps until the drag ends.
- **Pick** (`pickAt`): the RA/Dec under the point (`screenToRaDec`, from the camera ray), 6 decimals (`pickQuery`), amber brackets at that place, the card request dropped, then `skySearch({ kind: 'coords', origin: 'sky' })`. The position is `derived` with `PICK_FORMULA` ([Q-91](../decisions/contract.md)). Any later search that is not a sky pick removes the pick.
- **Keys on the focused canvas** ([Q-123](../decisions/sky-shell.md) item 1; Alt, Ctrl and Meta are ignored, Shift is not): arrows pan by 10 % of the FOV; `+` `=` zoom in and `-` `_` zoom out by 1.25; `R` resets to the default view; **Enter and Space** pick the centre. 600 ms after the last key the new view is said in `sky-view-announcer` ("View centre RA …°, Dec …°, … across."). No on-screen pan or zoom buttons.
- **Markers** (`<ul aria-label="Targets on the sky">`, click-through, each `li` placed by `translate3d` from the render listener, visible only when in front and within the canvas ±8 px; a new one stays hidden until its first placement):
  - `t:` target markers: the five quick-pick names resolved with `/v1/resolve` after 2000 ms and an idle moment, never while a search runs (`useTargetMarkers.ts`); a name that fails is listed in the credit. Button label "<name> on the sky: open it".
  - `c:` cached markers, lilac dots from `GET /v1/sky/cached` ([Q-98](../decisions/sky-shell.md)), after the targets, skipping a target with the same id or within 2″; reloaded 500 ms after a frame list completes (`useCachedMarkers.ts`, `cachedMarkers.ts`). Label on hover or focus; legend in the credit.
  - `sel:` brackets: green L-shaped corners (34 px) and the name round the resolved object, `role="img"` "Selected: <name>"; the selected marker's own label hides.
  - `pick:` picked brackets (amber), `role="img"` "Picked position: <coords>", hidden within 1″ of the resolved object.
- **Left click on a target or cached marker opens the object** ([Q-120](../decisions/sky-shell.md) item 1): the card request is dropped and the object is searched by name (`origin: 'sky'`), so the object panel opens (A21.4).
- **Object card on request** ([Q-120](../decisions/sky-shell.md) item 3, [Q-113](../decisions/sky-shell.md) item 9): a right-click, a long press (the browser's `contextmenu`, no timer), or the ContextMenu key or Shift+F10 on a focused marker. The handler is on the sky pane; it ignores events inside `.sx-island-wrap, .sx-panel, .sx-sky-credit, input`. It takes the marker under the event, else the nearest visible marker (any of `t:`, `c:`, `sel:`, `pick:`) whose position is within a 44 px square (`MARKER_HIT_PX`). None: the browser menu stays. Found: the menu is suppressed, an unselected `t:` or `c:` object is searched with the card requested, then `requestCard()` (tool `sky` unless the build pane is open, where the card waits until it closes).
- **Fly-to** on each new `resolved` (`SkyPane.tsx`): desktop, only when the object is more than 0.35 × FOV from the centre, to the object with FOV = min(current, 20°); phone, always, with the object 22 % from the top. 700 ms, ease-out cubic (`interpolateView`); instant under reduced motion. A pointer-down, wheel or key move cancels it. No other code can move the camera.
- **To build (proposed, [Q-154](sky-shell-behaviour.md#open-conflicts)), the extension points a sky tool needs:**
  - **Pointer mode** `'pan' | 'draw'` in the shell store, read by the canvas handlers. In `draw` a primary drag goes to the registered draw handler (start, move, end, in canvas pixels and RA/Dec) instead of panning, a click goes to it too (not a pick), the cursor is a crosshair; wheel and pinch still zoom. Leaving the tool or Escape (A21.10) sets `pan`.
  - **Layer hit-test chain**: a sky layer registers `hitTest(x, y)` and an optional `contextHit(x, y)`. On a click, marker buttons win first (they are DOM buttons above the canvas); then layers, topmost first; the first hit consumes the click; else `pickAt`. On a right-click, the marker rule above runs first; a layer's `contextHit` only when no marker is within 44 px. Hit radii are the layer's (A18.2 uses 20 px); a layer item under a marker button is reached from its list.
  - **`skyFlyTo({ ra, dec, fovDeg? } | { box })`**: one camera command in a store that SkyPane subscribes to, using the fly-to timing above, centring on the safe rectangle (A21.2), instant under reduced motion and cancelled the same way. The `resolved` fly-to becomes one caller of it.
  - A layer adds its text alternative by **appending** an id to the canvas's `aria-describedby`, never replacing the instructions (A21.12).

### A21.7 Sky image, credit, never blank

- **Never blank** ([Q-89](../decisions/sky-shell.md)): the shell and the search render first; the canvas then shows a coordinate grid (every 30°) until an image is drawn; picking and the search work in every state. States (`data-sky-state` on the pane) and the status box text (top centre, `in-t + 16px` on desktop, click-through):

| State | Cause | Text |
|---|---|---|
| `starting`, `loading` | renderer starting; index or first image loading | "Loading the sky image…" (green pulse) |
| `ready` | an image is on screen | no box |
| `none` | index lists no survey, or the endpoint answers 404 or 501 | "No sky image is installed, so only a coordinate grid is shown. Click to pick a position, or type a name or coordinates in the search." |
| `unusable` | no ICRS survey with a 2:1 image ("The installed sky images are not in ICRS equirectangular form."), or none fits the GPU ("No sky image fits this device.") | the reason, then "Only a coordinate grid is shown; picking positions and the search still work." |
| `error` | index failed ("The list of sky images could not be loaded.") or the first image failed ("The sky image could not be loaded.") | the message, then the same sentence |
| `no_renderer` | no WebGPU or WebGL2 | "This browser has no WebGPU or WebGL2, so the sky cannot be drawn. The search still works." |

- **Image plan** ([Q-87](../decisions/sky-shell.md), [Q-90](../decisions/sky-shell.md); `viewer/sky/surveys.ts`): `GET /v1/sky/index.json`; the first survey with frame `icrs` and a usable 2:1 equirect; the smallest image that fits the GPU's max texture size loads first; then the largest image up to the cap (8192 px, or 4096 px on a coarse pointer or with Save-Data, never above the max texture size) replaces it. A failed upgrade keeps the first image.
- **Credit** ([D-35](../decisions/sky-shell.md#d-35-local-copy-of-sky-survey-tiles-for-the-sky-background), [Q-88](../decisions/sky-shell.md)): always shown, z 25, never covered. Desktop: `left: in-l + 12px`, `bottom: in-b + 8px`, `max-width: min(36rem, 60%)`, 11 px mono on `#050507eb`. Lines: survey title with its badge (Estimated with the index formula for `derived`, else the tag's badge), "SYNTHETIC" on a fixture index, and the credit string; "Picked <coords>" with the Estimated badge (`PICK_FORMULA`); "Not shown on the sky (lookup failed): …. Search them by name instead."; the lilac-dot legend "Lilac dots: already downloaded, open instantly."; the image size and backend (hidden on a phone).
- **`--sx-credit-h`** is the credit's height, written on the sky pane by a ResizeObserver and again in a layout effect when it changed, so the panel and the phone sheet move in the same frame as the credit.
- **Canvas label** by state: "All-sky image: <title>.", "All-sky view, loading.", "Sky view with a coordinate grid; no sky image is installed." or "Sky view with a coordinate grid; the sky image is not shown." (A21.12).

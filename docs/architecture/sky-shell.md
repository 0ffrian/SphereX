# App shell and sky view

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A21–A21.4 (A21.5–A21.7 in [sky-shell-surfaces.md](sky-shell-surfaces.md), A21.8–A21.13 in [sky-shell-behaviour.md](sky-shell-behaviour.md)) · **Implements:** [Q-89](../decisions/sky-shell.md), [Q-113](../decisions/sky-shell.md) (Select, Build it), [Q-120](../decisions/sky-shell.md), [Q-121](../decisions/sky-shell.md), [Q-123](../decisions/sky-shell.md), [Q-124](../decisions/sky-shell.md), [D-35](../decisions/sky-shell.md#d-35-local-copy-of-sky-survey-tiles-for-the-sky-background), [Q-87](../decisions/sky-shell.md), [Q-88](../decisions/sky-shell.md), [Q-90](../decisions/sky-shell.md), [Q-98](../decisions/sky-shell.md), [Q-91](../decisions/contract.md) · **Read with:** [frontend-platform.md](frontend-platform.md), [../rendering/accessibility.md](../rendering/accessibility.md)

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

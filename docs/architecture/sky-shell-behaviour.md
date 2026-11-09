# App shell and sky view: behaviour

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A21.8–A21.13 (A21–A21.4 in [sky-shell.md](sky-shell.md), A21.5–A21.7 in [sky-shell-surfaces.md](sky-shell-surfaces.md)) · **Implements:** [Q-113](../decisions/shell-surfaces.md) (Select, Build it), [Q-120](../decisions/shell-surfaces.md), [Q-121](../decisions/shell-surfaces.md), [Q-123](../decisions/shell-surfaces.md), [Q-89](../decisions/sky-shell.md), [Q-95](../decisions/sky-shell.md), [Q-97](../decisions/sky-shell.md), [Q-146](../decisions/moving-objects.md), [Q-131](../decisions/moving-objects.md), [Q-161](../decisions/moving-objects-review.md) · **Read with:** [frontend-platform.md](frontend-platform.md), [../rendering/accessibility.md](../rendering/accessibility.md)

Names (island, object panel, object card, ObjectCard, split pane, build pane, feature card) are defined in [A21](sky-shell.md#a21-app-shell-and-sky-view). Code paths are under `frontend/src/`. Text marked **To build (proposed, Q-150 to Q-156)** is neither decided nor built (Q-157 records built keyboard facts); the placeholders are listed in [Open conflicts](#open-conflicts).

### A21.8 Split pane

**As built** ([Q-113](../decisions/shell-surfaces.md) item 2, [Q-120](../decisions/shell-surfaces.md) items 4 and 5; `app/shell/shellStore.ts`, `app/build/BuildPane.tsx`, `app/build/focus.ts`, `app/App.tsx`). The build pane is the only occupant. State: `build: { open, animate, seq, seedOffset }`.

| Way in | Call | Result |
|---|---|---|
| **Build it** on the object card | `loadBodyFor(id)`, `openBuild(true)` | `tool: 'sky'`, the body is moulded |
| **Build it in 3D** in the object panel | `openBuild(true)` | same |
| Rail **3D viewer** | `setTool('viewer')` | `tool: 'viewer'`, built at once, `seedOffset: 0`; again while open rebuilds |
| A link or Forward with `build` | `openBuild(false)` | `tool: 'viewer'`, built at once |

- Every open adds 1 to `seq` and sets `seedOffset: 0`. **Replay** sets `animate: true`, `seq + 1`; **New seed** also adds 1 to `seedOffset` ([Q-113](../decisions/shell-surfaces.md) item 4). The body (`/card`, `/render-params`) loads while the pane is open or the card is asked for (`useSelectedBodyLoader`, Q-120 item 5); a transient failure is asked for again by Build it, Try again in the pane, or a new `resolved` of the same object; a real 404 is final.
- **Ways out:** × (`build-close`), Escape (A21.10), Back (the hash loses `build`), and any other rail tool. `closeBuild()` sets `open: false`, `seedOffset: 0` and turns `tool: 'viewer'` into `'sky'`. A search does not close it: the object changes under the pane and its body loads.
- **Focus:** on mount the pane's `h2` takes focus. On close (×, Escape, Back alike) `focusAfterBuildClose(tool before closing)`: the rail's 3D viewer button when that tool was `viewer` or no object is resolved; else the object's target or cached marker; else the sky canvas.
- **Layout:** `data-split` on `.sx-bezel` and `.sx-view`. Desktop: the sky slot gets `right: 50%` (0.75 s, cubic-bezier(0.34, 1.2, 0.64, 1)); the pane is `top: in-t`, `bottom: in-b`, `right: in-r`, `width: calc(50% - in-r)`, radius 18, z 6, a left border. The sky stays live in the left half (drag, zoom, markers, picking); its camera centre is that half's centre. Phone: A21.3.
- **What steps aside:** the transport (`inert`, opacity 0, 14 px down, 0.35 s and 0.6 s), the quick picks (`display: none`), the right edge fade, the object panel (opening sets the tool to `sky` or `viewer`) and the object card (hidden; a request made meanwhile shows when the pane closes).
- **Content:** title "Building <name>", then "<name>" when built (or "3D view" with no object); subtitle type, "Looking up its 3D model…", "No 3D model" or "No object loaded", plus the honesty level badge; tools **Feel** (`aria-pressed`; shows "Touch feedback arrives with the phone build."), **Replay**, **New seed** (disabled when the surface is baked), **Close**; the viewer or a "no 3D model" message with **Try again** for transient failures; the status line. How the moulding is presented: R5.8 in [display-rules.md](../rendering/display-rules.md).

**To build (proposed, [Q-151](#open-conflicts)): pane kinds, so Track can share the split with Build** ([Q-146](../decisions/moving-objects.md) item 2, A18.8, Track UI A20 in [moving-objects/track-ui.md](moving-objects/track-ui.md)):
- **State:** `build` becomes `pane: null | { kind: 'build', animate, seq, seedOffset, from } | { kind: 'track', objectId, from }`, where `from` is `'rail' | 'card' | 'panel' | 'link' | { area: areaId, card }`. `data-split` follows `pane !== null`; `data-pane="<kind>"` lets CSS differ per kind.
- **One occupant, mutual exclusion:** opening a kind while another is open replaces it in place (the sky does not slide back and forth; the old kind's close runs without its focus return). Only one pane-kind hash key is ever written.
- **Width:** `--sx-split-w` on the bezel, per kind: build 50 % (as built); track 50 % (**Proposed ([Q-161](../decisions/moving-objects-review.md))**; the mock-up's 62 % is not used). The sky slot uses `right: var(--sx-split-w)`.
- **Hash and history:** build keeps `build`; track writes `track=<object id>`. Opening pushes one entry marked `{ sxPane: '<kind>' }` (generalising `sxBuild`); replacing a kind uses `replaceState` on that entry; closing goes `history.back()` when the current entry carries the mark, else `replaceState` (A21.11).
- **Rail and tools:** a rail tool other than the pane's own closes the pane (as built). Area search opens Track with `openPane({ kind: 'track', … })`, never `setTool`, so its tool stays `area`; its card is hidden while the pane is open. Track has no rail tool and no `ToolId` (**Proposed ([Q-161](../decisions/moving-objects-review.md))**, amending [Q-131](../decisions/moving-objects.md)). `aria-pressed`: the 3D viewer button while `pane.kind === 'build'`; other tools when `tool === id` and the pane is null or came from that tool.
- **Close and focus return by `from`:** `rail` the tool's rail button; `card` or `panel` the object's marker; `link` the sky canvas; `area` **Back to the area** reopens that Area card and focuses its heading. Escape closes the pane first (A21.10).
- **What steps aside** is the same for every kind (transport, quick picks, right fade, object panel, object card, the opening tool's card). Track's time slider lives in its pane, not in the transport (A21.9). Its sky marker follows that slider ([Q-142](../decisions/moving-objects.md)) through a marker feed the Track layer registers (A21.13).

### A21.9 Transport, session, search pill

- **Transport** ([Q-89](../decisions/sky-shell.md), [Q-95](../decisions/sky-shell.md); `app/shell/Transport.tsx`): `role="region"` "Playback controls": Previous frame, Play/Pause, Next frame, the frame scrubber (`aria-valuetext` the frame description), "Frame n/N", the wavelength with the data badge (hidden on a phone) and a speed select (fps). It belongs to the **flipbook**: it drives the flipbook store actions and reads the shared session; it is there with or without the object panel. Disabled with no frames ("No frames loaded"); Play waits until the current and next 3 cutouts settle ("Play starts once the next frames have loaded."). Under the SPHEREx composite every control is disabled with the composite note. The readout follows the shown frame; the scrubber the requested one ([Q-101](../decisions/sky-shell.md)). Hidden in the split pane (A21.8).
- **Session** (`app/flipbook/session.tsx`, `FlipbookSessionProvider` round the whole bezel): cutout preload, playback timer and `canPlay`, above the object panel and the transport, so closing the panel neither stops playback nor restarts the preload.
- **Search pill** (`app/search/SearchBar.tsx`): `section` "Find an object" with a `form role="search"`; field label "Object name, or RA, Dec in degrees", placeholder "Search a name or RA Dec", `aria-keyshortcuts="/"` and a "/" hint (hidden on a coarse pointer). The help ("Decimal degrees only, for example 269.452, 4.693. Search by name for moving objects.") shows while the field has focus. Quick picks: "Try:" and the five A1.1 targets (`origin: 'input'`). A bad entry shows the parser's message; link problems show above it. A search from a link or the sky writes its text into the field; a reset clears it. On desktop the pop floats above the pill (z 30 inside the slot).
- **Rule for new tools:** the transport has no modes. A tool with its own time control puts it in its own surface (Area: in the Discovery card; Track: in its pane). **To build (proposed, [Q-155](#open-conflicts)).**

### A21.10 Keyboard and Escape

| Key | Scope | Action | Code |
|---|---|---|---|
| `/` | anywhere except a text field; no Alt, Ctrl, Meta; not already handled | focus and select the search field | `app/App.tsx`, `app/shell/shortcuts.ts` |
| Arrows, `+` `=` `-` `_`, `R`, Enter, Space | focused sky canvas | pan 10 % of FOV, zoom ×1.25, reset, pick the centre | `app/sky/SkyPane.tsx` |
| ContextMenu, Shift+F10 | focused sky marker | object card (A21.6) | `app/sky/SkyPane.tsx` |
| Space, `K`, ←, →, Home, End | flipbook region, not on a control; no modifiers | play/pause, step, first, last | `app/flipbook/keys.ts`, `Flipbook.tsx` |
| Arrows, `+` `=` `-` `_`, `R` | focused 3D viewer canvas | rotate, zoom, reset | `viewer/ViewerApp.ts` (`viewerKeyAction`) |
| Escape | see below | closes one thing | |

No number keys ([Q-121](../decisions/shell-surfaces.md) item 1). A new tool takes keys only on its own focused element (for example A18's square as a labelled `role="group"` with its own keydown and `preventDefault`), never on the sky canvas.

**Escape as built** (no single owner). React handlers run at the root container, before window listeners; window listeners run in the order they were added; each handler skips an event that is already `defaultPrevented`.

| Handler | Scope | Active when | Skips text fields | Effect | preventDefault |
|---|---|---|---|---|---|
| `PanelCard` onKeyDown | focus inside the object panel | panel shown | no | `closePanel()`, focus the rail button | yes |
| `BuildPane` onKeyDown and window listener | inside the pane, or anywhere | pane open | onKeyDown no, window yes | `closeBuildPane()` | yes |
| `SelectedCard` window listener | anywhere | object card shown | yes | `deselectObject()` | yes |
| `Island` window listener | anywhere | thinking and `tool !== 'sky'` | **no** | `closePanel()` | **no** |

Known effects: with the pane opened from the rail and a search thinking under it, Escape can first set the tool to `sky` (island) and then close the pane, so focus goes to the marker instead of the rail button; Escape in the search field while thinking leaves the panel tool.

**To build (proposed, [Q-150](#open-conflicts)):** one Escape owner in the shell (`app/shell/escape.ts`): one window listener and a stack where each surface registers while it is open. One press closes exactly one thing, the highest open in this order, and calls `preventDefault`: (1) a text field keeps Escape (the search field blurs and hides its help, as the mock-up); (2) the split pane, any kind; (3) drawing mode (A18.1); (4) the object panel or a feature card; (5) the object card; (6) thinking (leave the panel tool). A surface with focus inside it still closes itself first, which matches the order. The island's handler is removed (fixes the case above).

### A21.11 URL hash and history

**As built** (A10 hash routing; [Q-95](../decisions/sky-shell.md), [Q-113](../decisions/shell-surfaces.md) item 2; `app/urlHash.ts`, `app/useHashSync.ts`):
- **Format:** `#ra=<deg, 5 dp>&dec=<deg, 5 dp>[&name=<search text>][&frame=<frame_id>][&colour=tint|composite][&build]`, keys written in that order; `build` is a bare flag; `#build` alone is the 3D view with no object. No asset id.
- **Parse:** only these keys are read; others are dropped silently. `ra` and `dec` must both be valid, else "Link coordinates ignored: <reason>". An unknown `colour` gives "Link colour view “<v>” ignored; showing the raw frames." `build` counts when the key is present.
- **Apply** (on load and on `hashchange`; a hash this hook wrote itself is skipped): the build pane follows `build` (open built, or close with focus return); an empty hash resets the sky if an object is shown; the query is `name`, else `ra,dec`; the same query with an object already resolved changes nothing more; no query but `build` changes nothing more; else `skySearch({ origin: 'hash', frameId })` or, with no query, `skyReset`. Then the colour view: `colour` turns it on with that view, else off (the last view is remembered). Problems show in the search pill; a hash with no name, coordinates or `build` shows "This link has no object name or coordinates."
- **Write:** `currentHash()` rebuilds the whole hash from the sky and build state, so a key it does not know is wiped on the next write. `frame` is the linked frame still loading, else the paused frame when it is not the first. A new object from typed input or the sky **pushes**; a link search, a pause, a step and a colour change **replace**. Opening the pane pushes `{ sxBuild: true }` with `pushState`; closing goes `history.back()` over a marked entry, else replaces. Deselecting with the object card clears the hash with `replaceState`.

**To build (proposed, [Q-153](#open-conflicts)): the extension rule for tool keys** (fixes the wiping and the false link problem; A18.9):
- Every key is declared in `HashState` in `urlHash.ts`; no feature reads or writes `location.hash` itself. New keys: `track=<object id>` (Track pane, Q-151), `area=<area_id>`, and `atrack=<track_id>` for a Discovery track (A18.9's `track=` would clash with the pane key).
- `currentHash()` merges three parts: object keys (as built), the pane key (`build` or `track`, never both), and the tool keys from the active tool's slice. Every write goes through it.
- A hash with a pane or tool key and no object is valid: no "no object" problem. `area=` sets the tool to `area` and opens that area's card; an unknown area is a link problem, never guessed.
- Push or replace: a new area or opening a pane pushes; choosing a Discovery track or a step replaces. Back closes the pane first, then leaves the area.

### A21.12 Live regions and accessibility

| Region | Where | Says |
|---|---|---|
| `announcer` (polite, atomic) | `app/LiveAnnouncer.tsx`, outside the bezel | `sky.announcement` only: found, frames loaded, paused at a frame, view mode, spectrum loaded; not frames during play |
| `sky-view-announcer` (polite) | `app/sky/SkyPane.tsx` | the view centre and FOV, 600 ms after a keyboard pan or zoom |
| island status (`role="status"`) | `app/island/Island.tsx` | "Thinking", the search sentence, retry and waiting lines |
| object card wrapper (polite) | `app/build/SelectedCard.tsx` | the card when it appears |
| `build-announcer` (polite) | `app/build/BuildPane.tsx` | "Building <name>", "Built <name>" (cleared, then set after 60 ms, so a Replay repeats) |
| Feel note, build message (`role="status"`) | `app/build/BuildPane.tsx` | the Feel note; why there is no 3D model |
| `viewer-announcer` (polite); `build-loading`, `ir-jets-hint` (`role="status"`) | `app/ViewerPanel.tsx` (in the pane) | the level raise (R5.8), the quality drop; "Loading the 3D view"; the IR jets hint |

- Errors use their own `role="alert"` boxes. The readout is **not** live (it would talk on every move).
- **Sky canvas:** `role="application"`, `aria-roledescription="sky map"`, a state label (A21.7) and `aria-describedby` the instructions ("Drag to look around, use the mouse wheel or pinch to zoom, and click or tap to pick a position…"). The text omits Space and the right-click card (open conflict 8). Markers: buttons and `role="img"` brackets with the labels of A21.6.
- `inert` is used for the pending panel, the sky under the phone sheet and the transport in the split pane. Focus moves are listed in A21.5 and A21.8.
- WCAG ([R9](../rendering/accessibility.md#r9-accessibility-tie-ins)): 2.2.2, the island is still at rest and moves only while thinking; 2.5.7, no single-pointer alternative to dragging on the sky, accepted by Moon ([Q-123](../decisions/shell-surfaces.md) item 1), a tap already picks; reduced motion: transitions and animations at 0.01 ms, no travel, instant fly-to, the body shown built; touch targets 44 px on a coarse pointer, and the 44 px marker square for the card.
- **To build (proposed, [Q-156](#open-conflicts)):** one `announce(text)` action in the app store, read by `LiveAnnouncer`, for text that is not the flipbook's (A18.6's Discovery result, Track); the flipbook keeps writing through it. ViewerPanel's regions stay until Q-156 says otherwise.

### A21.13 Adding a tool or a sky layer

**A rail tool:**
1. Add the id to `ToolId` (`app/shell/shellStore.ts`), its label and hint to `TOOLS` (`app/shell/ToolRail.tsx`), and its shape to `SHAPES` (`app/shell/railIcons.tsx`, strokes with `pathLength="1"`). `app/shell/icons.tsx` only if a card header needs it.
2. Side effects of `setTool(id)`: decide whether it drops `cardRequested` and whether it closes the split pane (as built, every tool but `viewer` does); state them in this fragment.
3. Its surface: the object panel (add a section and teach `Panels.tsx` when to show it) or a feature card (A21.5, proposed). One surface per tool; never the object card's subject.
4. What a search does while it is active (`useOpenPanelOnSearch`): today the tool becomes `flipbook`. **To build (proposed, [Q-155](#open-conflicts)):** a pick or a marker click leaves the tool for the object panel and the tool keeps its state, so its rail button brings back its last card; A18.5's **Open** on a Known row is that left click.
5. Keys on its own element (A21.10), its Escape rank, its hash keys (A21.11), its live-region text (A21.12), its reduced-motion and phone behaviour.
6. Whether it uses the split pane (A21.8, pane kinds) and what `from` it passes.

**A sky layer** (A18.2, Track's marker):
1. A child of SkyPane in the sky layer slot (A21.2), `pointer-events: none`, drawn from `view.onRender` with no React render, device pixel ratio at most 1.5 (D-05), redraw on change only (D-34).
2. Clicks through the hit-test chain after marker buttons; right-clicks only where no marker is within 44 px ([Q-120](../decisions/shell-surfaces.md) keeps the card); drawing through the pointer mode (A21.6, proposed).
3. Labels clamped to the safe rectangle (A21.2); camera moves through `skyFlyTo`; a text alternative appended to the canvas's `aria-describedby`.
4. A moving marker (Track, [Q-142](../decisions/moving-objects.md)) registers a marker feed (`{ key, ra, dec }` updated from the layer's own time) instead of using `sky.resolved`.

## Open conflicts

Each row needs a decision in [decisions/sky-shell.md](../decisions/sky-shell.md); until then the rule in the third column applies. Owner: Moon (D-17); rows touching Track also need Atish. "Draft" means the PR #59 draft of A18; A18 has since been aligned to the proposals, so those rows wait only on the decision.

| # | Conflict | Rule until decided | Placeholder |
|---|---|---|---|
| 1 | Escape has four handlers and no order; the island's skips neither text fields nor `preventDefault` (code) vs [Q-121](../decisions/shell-surfaces.md) item 5 and [Q-113](../decisions/shell-surfaces.md) item 2 (Escape closes the panel or the pane) | as built (A21.10) | **Q-150** |
| 2 | The split pane is Build only (code, [Q-113](../decisions/shell-surfaces.md) item 2) vs [Q-146](../decisions/moving-objects.md) item 2 (Track opens in the split pane with Back to the area); Track's rail tool: [Q-131](../decisions/moving-objects.md) says it has a tool id, `ToolId` has none | Q-146: Track uses the split pane; mechanism A21.8 proposed; Q-161 proposes no `ToolId` and no rail button | **Q-151**, Q-161 |
| 3 | Split width: Q-113 item 2 "right half" and code 50 % vs the draft's 62 % (A18 now defers to A20.1) | 50 %; Q-161 proposes 50 % for Track | **Q-151**, Q-161 |
| 4 | The island takes no clicks ([Q-121](../decisions/shell-surfaces.md) item 2, code) vs island cards that minimise to a progress pill ([Q-146](../decisions/moving-objects.md) item 3); the draft's 408 px vs the 340 px card | Q-146 (later): cards can minimise; how, A21.5 proposed; 340 px | **Q-152** |
| 5 | Unknown hash keys are dropped and wiped, and an object-less hash is a link problem (code) vs `area=` and `track=` links (A18.9, Q-146) | as built | **Q-153** |
| 6 | Markers and labels are not inset-aware and no camera command exists (code, [Q-124](../decisions/shell-surfaces.md)) vs the draft (labels "clamped inside the pane", "fits the camera") | as built | **Q-154** |
| 7 | A search or pick switches the tool to `flipbook` and right-click means the object card ([Q-120](../decisions/shell-surfaces.md) items 1 and 3) vs the draft ("click-to-pick keeps working" inside Area, "a right-click brings the card back", visits in the transport); the transport is the flipbook's ([Q-89](../decisions/sky-shell.md)) vs Track's slider ([Q-142](../decisions/moving-objects.md)) | Q-120 and Q-89 | **Q-155** |
| 8 | [Q-123](../decisions/shell-surfaces.md) item 1 "Enter picks the centre" vs code (Enter and Space); the canvas description omits Space and the card; [Q-121](../decisions/shell-surfaces.md) item 1 "keys 1 to 5 are not added" vs [Q-146](../decisions/moving-objects.md) "key 5" (a mock-up label) | code: Enter and Space pick; no number keys | **Q-157** |
| 9 | `LiveAnnouncer` speaks only `sky.announcement` (code) vs A18.6 announcing Discovery through it | as built | **Q-156** |

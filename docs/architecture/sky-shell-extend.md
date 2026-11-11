# App shell and sky view: extending it, open conflicts

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A21.13, and the open conflicts of A21.8–A21.13 (A21.8–A21.12 in [sky-shell-behaviour.md](sky-shell-behaviour.md)) · **Implements:** [Q-120, Q-121](../decisions/shell-surfaces.md), [Q-142, Q-146](../decisions/moving-objects.md), [Q-170 to Q-177](../decisions/shell-proposals.md) · **Read with:** [sky-shell-behaviour.md](sky-shell-behaviour.md) (A21.8–A21.12), [sky-shell.md](sky-shell.md) (A21.2, A21.4), [sky-shell-surfaces.md](sky-shell-surfaces.md) (A21.5, A21.6)

How a new rail tool or sky layer plugs into the shell, and the conflicts between the shell as built and the Track and Area search specs. Names are defined in [A21](sky-shell.md#a21-app-shell-and-sky-view); code paths are under `frontend/src/`.

### A21.13 Adding a tool or a sky layer

**A rail tool:**
1. Add the id to `ToolId` (`app/shell/shellStore.ts`), its label and hint to `TOOLS` (`app/shell/ToolRail.tsx`), and its shape to `SHAPES` (`app/shell/railIcons.tsx`, strokes with `pathLength="1"`). `app/shell/icons.tsx` only if a card header needs it.
2. Side effects of `setTool(id)`: decide whether it drops `cardRequested` and whether it closes the split pane (as built, every tool but `viewer` does); state them in this fragment.
3. Its surface: the object panel (add a section and teach `Panels.tsx` when to show it) or a feature card (A21.5, proposed). One surface per tool; never the object card's subject.
4. What a search does while it is active (`useOpenPanelOnSearch`): today the tool becomes `flipbook`. **To build (proposed, [Q-175](#open-conflicts)):** a pick or a marker click leaves the tool for the object panel and the tool keeps its state, so its rail button brings back its last card; A18.5's **Open** on a Known row is that left click.
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
| 1 | Escape has four handlers and no order; the island's skips neither text fields nor `preventDefault` (code) vs [Q-121](../decisions/shell-surfaces.md) item 5 and [Q-113](../decisions/shell-surfaces.md) item 2 (Escape closes the panel or the pane) | as built (A21.10) | **Q-170** |
| 2 | The split pane is Build only (code, [Q-113](../decisions/shell-surfaces.md) item 2) vs [Q-146](../decisions/moving-objects.md) item 2 (Track opens in the split pane with Back to the area); Track's rail tool: [Q-131](../decisions/moving-objects.md) says it has a tool id, `ToolId` has none | Q-146: Track uses the split pane; mechanism A21.8 proposed; Q-181 proposes no `ToolId` and no rail button | **Q-171**, Q-181 |
| 3 | Split width: Q-113 item 2 "right half" and code 50 % vs the draft's 62 % (A18 now defers to A20.1) | 50 %; Q-181 proposes 50 % for Track | **Q-171**, Q-181 |
| 4 | The island takes no clicks ([Q-121](../decisions/shell-surfaces.md) item 2, code) vs island cards that minimise to a progress pill ([Q-146](../decisions/moving-objects.md) item 3); the draft's 408 px vs the 340 px card | Q-146 (later): cards can minimise; how, A21.5 proposed; 340 px | **Q-172** |
| 5 | Unknown hash keys are dropped and wiped, and an object-less hash is a link problem (code) vs `area=` and `track=` links (A18.9, Q-146) | as built; **`area=` built ahead for Area (issue #96, Q-406 (7)), Moon to sign at the shell-hooks review** | **Q-173** |
| 6 | Markers and labels are not inset-aware and no camera command exists (code, [Q-124](../decisions/shell-surfaces.md)) vs the draft (labels "clamped inside the pane", "fits the camera") | as built; **`skySafeRect`, `skyFlyTo`, the layer slot, the hit-test chain and the pointer mode built ahead for Area (`app/sky/{layers,safeRect,skyFlyTo}.ts`, issue #96, Q-406 (7)), Moon to sign at the shell-hooks review** | **Q-174** |
| 7 | A search or pick switches the tool to `flipbook` and right-click means the object card ([Q-120](../decisions/shell-surfaces.md) items 1 and 3) vs the draft ("click-to-pick keeps working" inside Area, "a right-click brings the card back", visits in the transport); the transport is the flipbook's ([Q-89](../decisions/sky-shell.md)) vs Track's slider ([Q-142](../decisions/moving-objects.md)) | Q-120 and Q-89 | **Q-175** |
| 8 | [Q-123](../decisions/shell-surfaces.md) item 1 "Enter picks the centre" vs code (Enter and Space); the canvas description omits Space and the card; [Q-121](../decisions/shell-surfaces.md) item 1 "keys 1 to 5 are not added" vs [Q-146](../decisions/moving-objects.md) "key 5" (a mock-up label) | code: Enter and Space pick; no number keys | **Q-177** |
| 9 | `LiveAnnouncer` speaks only `sky.announcement` (code) vs A18.6 announcing Discovery through it | as built | **Q-176** |

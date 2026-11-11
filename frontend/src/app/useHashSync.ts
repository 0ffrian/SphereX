// A10 hash routing: keeps the URL hash and the flipbook in step (UML 08 step 2).
// - On load and on `hashchange` (back button, edited link), a hash with a name or coordinates
//   starts a search.
// - A search typed by the user pushes a history entry; a search from a link replaces it.
// - Pausing or stepping writes `frame=` with replaceState, so playback does not flood history.
// - The flipbook's colour view is `colour=tint|composite` (absent: raw), also with replaceState.
// - A hash this hook wrote itself is ignored when its `hashchange` arrives (no search loop).
// - Issue #60: `build` is in the hash while the build pane is open (mock-up `#build`). Opening it
//   pushes a history entry marked in `history.state` (`{ sxBuild: true }`), so Back closes it;
//   closing it with × or Escape goes Back when the current entry carries that mark (no extra Back
//   step is left), else replaces the entry. Back also returns focus, as × and Escape do.
// - Issue #96 (A18.9, A21.11): `area=<area_id>` while Area search shows a prepared area. A link
//   with it chooses the tool, opens the area and flies to its box; an unknown id is a link problem.
//   A new area pushes a history entry; entering or leaving the tool replaces it. Back to an entry
//   without `area` leaves the tool (its state is kept).
import { useEffect, useRef } from 'react';
import { requestedColour } from '@/app/flipbook/colourMode';
import { useAppStore } from '@/state/store';
import { formatHash, hashToQuery, parseHash, type HashState } from './urlHash';
import { useShellStore } from './shell/shellStore';
import { focusAfterBuildClose } from './build/focus';
import { AREA_TOOL_ENABLED, enterAreaTool } from './sky/area/areaTool';
import { skyFlyTo } from './sky/skyFlyTo';
import { openAreaEntry } from '@/state/area';

/** `history.state` of the entry the build pane pushed. */
const BUILD_STATE = { sxBuild: true } as const;
const isBuildEntry = (state: unknown): boolean =>
  typeof state === 'object' && state !== null && (state as { sxBuild?: unknown }).sxBuild === true;

/** The hash for the current object, frame, colour view and build pane. */
function currentHash(): string {
  const { sky, area } = useAppStore.getState();
  const shell = useShellStore.getState();
  const build = shell.build.open;
  const state: HashState = { ...(build ? { build: true } : {}) };
  if (AREA_TOOL_ENABLED && shell.tool === 'area' && area.areaId) state.area = area.areaId;
  if (sky.resolved && sky.query) {
    const frameId =
      sky.progress?.pendingFrameId ??
      (sky.status === 'ready' && !sky.playing && sky.index > 0
        ? sky.frames?.frames[sky.index]?.frame_id
        : undefined);
    const colour = requestedColour(sky.colour);
    Object.assign(state, {
      ra: sky.resolved.ra,
      dec: sky.resolved.dec,
      ...(sky.query.kind === 'name' ? { name: sky.query.q } : {}),
      ...(frameId ? { frame: frameId } : {}),
      ...(colour !== 'raw' ? { colour } : {}),
    });
  }
  return formatHash(state);
}

const normalise = (hash: string) => new URLSearchParams(hash.replace(/^#/, '')).toString();

/** Opens Area search on the area a link names, then flies to its box (A18.9). */
function applyAreaHash(id: string): void {
  const store = useAppStore.getState();
  if (useShellStore.getState().tool !== 'area') enterAreaTool();
  if (store.area.areaId === id && store.area.summary.status !== 'error') return;
  void store.areaOpen(id, 'hash').then((ok) => {
    if (!ok) return;
    useShellStore.getState().setPointerMode('pan');
    const entry = openAreaEntry(useAppStore.getState().area);
    if (entry) skyFlyTo({ box: entry });
  });
}

export function useHashSync(): void {
  const lastWritten = useRef<string | null>(null);
  /** The area the last applied hash named, so Back to an entry without it leaves the tool. */
  const lastArea = useRef<string | null>(null);
  /** True while a hash is being applied: the hash already says what the stores are changing to. */
  const applying = useRef(false);

  useEffect(() => {
    const apply = () => {
      applying.current = true;
      try {
        applyHash();
      } finally {
        applying.current = false;
      }
    };
    const applyHash = () => {
      const hash = normalise(window.location.hash);
      if (hash === lastWritten.current) return;
      lastWritten.current = hash;
      const store = useAppStore.getState();
      const shell = useShellStore.getState();
      const parsed = parseHash(hash);
      const areaBefore = lastArea.current;
      lastArea.current = AREA_TOOL_ENABLED ? (parsed.area ?? null) : null;
      if (AREA_TOOL_ENABLED && parsed.area) applyAreaHash(parsed.area);
      else if (areaBefore !== null && shell.tool === 'area') shell.setTool('sky');
      // Issue #60: the build pane follows the hash (Back closes it; a link with `build` opens it,
      // built at once).
      if (!parsed.build && shell.build.open) {
        const tool = shell.tool;
        shell.closeBuild();
        focusAfterBuildClose(tool);
      } else if (parsed.build && !shell.build.open) shell.openBuild(false);
      if (hash === '') {
        if (store.sky.query === null) return;
        // Back to the page without a hash (e.g. the Back button): show the empty start state.
        store.skyReset();
        return;
      }
      const q = hashToQuery(parsed);
      // Only the build flag changed (Back from the build pane): the object stays as it is.
      if (q && store.sky.query?.q === q && store.sky.resolved) return;
      if (!q && parsed.build) return;
      // A link with only an area (A18.9) needs no object; its own problems are still shown.
      if (!q && AREA_TOOL_ENABLED && parsed.area) {
        if (parsed.problems.length > 0) store.skySetLinkProblems(parsed.problems);
        return;
      }

      if (q) {
        void store.skySearch({
          q,
          kind: parsed.name ? 'name' : 'coords',
          origin: 'hash',
          ...(parsed.frame ? { frameId: parsed.frame } : {}),
        });
      } else {
        store.skyReset();
      }
      // After the search has cleared the old object (so no hash is written for it); the search
      // keeps the colour choice. A link without `colour` shows the raw frames; the colour view
      // picked before (tint or composite) stays remembered for the Colour switch.
      const colour = useAppStore.getState().sky.colour;
      store.skySetColour(
        parsed.colour ? { on: true, view: parsed.colour } : { ...colour, on: false },
        true,
      );
      // After the search starts (which clears old problems), so these stay visible.
      if (parsed.problems.length > 0) store.skySetLinkProblems(parsed.problems);
      else if (!q) store.skySetLinkProblems(['This link has no object name or coordinates.']);
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);

  useEffect(
    () =>
      useAppStore.subscribe((s, prev) => {
        const sky = s.sky;
        const before = prev.sky;
        if (!sky.resolved || !sky.query) return;
        const newObject = sky.resolved !== before.resolved;
        const pausedMove =
          sky.status === 'ready' &&
          !sky.playing &&
          (sky.index !== before.index || before.playing || sky.frames !== before.frames);
        const colour = requestedColour(sky.colour);
        const colourChanged = colour !== requestedColour(before.colour);
        if (!newObject && !pausedMove && !colourChanged) return;

        // A linked frame that has not arrived yet (progressive load) stays in the link until it
        // does or the user moves, so copying or reloading the page meanwhile keeps it.
        const next = currentHash();
        const normal = normalise(next);
        if (normal === normalise(window.location.hash)) {
          lastWritten.current = normal;
          return;
        }
        lastWritten.current = normal;
        // A search the user started (typed, or picked on the sky) pushes a history entry.
        if (newObject && sky.query.origin !== 'hash') window.location.hash = next;
        else window.history.replaceState(window.history.state, '', next);
      }),
    [],
  );

  // Issue #96: a new area pushes `area=` (so Back returns to the one before); entering or leaving
  // Area search replaces the entry.
  useEffect(() => {
    const write = (push: boolean) => {
      const next = currentHash();
      const normal = normalise(next);
      if (normal === normalise(window.location.hash)) return;
      lastWritten.current = normal;
      lastArea.current = parseHash(next).area ?? null;
      if (push && next !== '') window.location.hash = next;
      else
        window.history.replaceState(
          window.history.state,
          '',
          next === '' ? window.location.pathname + window.location.search : next,
        );
    };
    const offArea = useAppStore.subscribe((s, prev) => {
      if (s.area.areaId === prev.area.areaId || applying.current) return;
      // An area a link or Back opened (it lands after the hash was applied): the hash names it.
      if (s.area.areaId !== null && parseHash(window.location.hash).area === s.area.areaId) return;
      if (useShellStore.getState().tool !== 'area') return;
      write(s.area.areaId !== null);
    });
    const offTool = useShellStore.subscribe((s, prev) => {
      if ((s.tool === 'area') === (prev.tool === 'area') || applying.current) return;
      write(false);
    });
    return () => {
      offArea();
      offTool();
    };
  }, []);

  // Issue #60: opening the build pane pushes `build` (so Back closes it); closing replaces it.
  useEffect(
    () =>
      useShellStore.subscribe((s, prev) => {
        if (s.build.open === prev.build.open) return;
        // Opened or closed by the hash itself (a link, Back): it already says so.
        if (Boolean(parseHash(window.location.hash).build) === s.build.open) return;
        const next = currentHash();
        const normal = normalise(next);
        if (normal === normalise(window.location.hash)) return;
        lastWritten.current = normal;
        if (s.build.open) {
          // pushState fires no hashchange (nothing to ignore) and carries the mark.
          window.history.pushState(BUILD_STATE, '', next);
        } else if (isBuildEntry(window.history.state)) {
          // The current entry is the one the pane pushed: go back over it, so Back does not
          // reopen the pane.
          window.history.back();
        } else
          window.history.replaceState(
            window.history.state,
            '',
            next === '' ? window.location.pathname + window.location.search : next,
          );
      }),
    [],
  );
}

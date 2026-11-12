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
import { useEffect, useRef } from 'react';
import { requestedColour } from '@/app/flipbook/colourMode';
import { useAppStore } from '@/state/store';
import { formatHash, hashToQuery, parseHash, type HashState } from './urlHash';
import { useShellStore } from './shell/shellStore';
import { focusAfterBuildClose } from './build/focus';

/** `history.state` of the entry the build pane pushed. */
const BUILD_STATE = { sxBuild: true } as const;
const isBuildEntry = (state: unknown): boolean =>
  typeof state === 'object' && state !== null && (state as { sxBuild?: unknown }).sxBuild === true;

/** The hash for the current object, frame, colour view and build pane. */
function currentHash(): string {
  const sky = useAppStore.getState().sky;
  const build = useShellStore.getState().build.open;
  const state: HashState = { ...(build ? { build: true } : {}) };
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

export function useHashSync(): void {
  const lastWritten = useRef<string | null>(null);

  useEffect(() => {
    const apply = () => {
      const hash = normalise(window.location.hash);
      if (hash === lastWritten.current) return;
      lastWritten.current = hash;
      const store = useAppStore.getState();
      const shell = useShellStore.getState();
      const parsed = parseHash(hash);
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

// A10 hash routing: keeps the URL hash and the flipbook in step (UML 08 step 2).
// - On load and on `hashchange` (back button, edited link), a hash with a name or coordinates
//   starts a search.
// - A search typed by the user pushes a history entry; a search from a link replaces it.
// - Pausing or stepping writes `frame=` with replaceState, so playback does not flood history.
// - A hash this hook wrote itself is ignored when its `hashchange` arrives (no search loop).
import { useEffect, useRef } from 'react';
import { useAppStore } from '@/state/store';
import { formatHash, hashToQuery, parseHash } from './urlHash';

const normalise = (hash: string) => new URLSearchParams(hash.replace(/^#/, '')).toString();

export function useHashSync(): void {
  const lastWritten = useRef<string | null>(null);

  useEffect(() => {
    const apply = () => {
      const hash = normalise(window.location.hash);
      if (hash === lastWritten.current) return;
      lastWritten.current = hash;
      const store = useAppStore.getState();
      if (hash === '') {
        // Back to the page without a hash (e.g. the Back button): show the empty start state.
        store.skyReset();
        return;
      }
      const parsed = parseHash(hash);
      const q = hashToQuery(parsed);
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
        if (!newObject && !pausedMove) return;

        const frameId =
          sky.status === 'ready' && !sky.playing && sky.index > 0
            ? sky.frames?.frames[sky.index]?.frame_id
            : undefined;
        const next = formatHash({
          ra: sky.resolved.ra,
          dec: sky.resolved.dec,
          ...(sky.query.kind === 'name' ? { name: sky.query.q } : {}),
          ...(frameId ? { frame: frameId } : {}),
        });
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
}

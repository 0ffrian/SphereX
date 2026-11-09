// Issue #60: the selected object (the resolved search) and its 3D body. The body is the backend's
// ObjectCard and RenderParams (D-16 `/card` and `/render-params`), put in the store with
// `setObject` for the 3D view. An object the backend has no 3D model for is refused with a reason
// (shell `body.status = 'none'`), never drawn from a guess.
import { useEffect } from 'react';
import { isApiError } from '@/app/api/errors';
import { getSkyApi, useAppStore } from '@/state/store';
import { useShellStore } from '@/app/shell/shellStore';
import type { ObjectType } from '@/contract';
import { TYPE_NAME } from '@/viewer/altText';

let inFlight: AbortController | null = null;

/** A timeout, a network error or a server error: asking again may work. Not a real "not found". */
export function isTransient(e: unknown): boolean {
  return isApiError(e) && (e.kind === 'timeout' || e.kind === 'network' || e.kind === 'server');
}

/** Plain-words reason for a body that could not be loaded. */
function reasonOf(e: unknown): string {
  if (isApiError(e)) {
    if (e.kind === 'not_found') return 'The archive has no 3D model for this object yet.';
    if (e.code === 'offline_cache_miss') return 'Its 3D model is not in the offline cache.';
    if (e.kind === 'timeout') return 'The 3D model took too long to arrive.';
    if (e.kind === 'network') return 'The server could not be reached.';
  }
  return 'Its 3D model could not be read.';
}

/** Loads the 3D body of object `id` unless it is already loaded or loading. */
export function loadBodyFor(id: string): void {
  const shell = useShellStore.getState();
  const b = shell.body;
  // Loaded, loading, or refused for good: nothing to do. A transient failure is tried again.
  if (b.status !== 'idle' && b.id === id && !(b.status === 'none' && b.transient)) return;
  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;
  shell.setBody({ status: 'loading', id });
  // The old object's body must not be drawn under the new name.
  useAppStore.getState().clearObject();
  const api = getSkyApi();
  Promise.all([api.card(id, controller.signal), api.renderParams(id, controller.signal)]).then(
    ([card, params]) => {
      if (controller.signal.aborted) return;
      if (card.data.type !== params.data.type) {
        useShellStore.getState().setBody({
          status: 'none',
          id,
          reason: 'Its card and render params disagree.',
          transient: false,
        });
        return;
      }
      useAppStore.getState().setObject(card.data, params.data);
      useShellStore
        .getState()
        .setBody({ status: 'ready', id, prebuilt: params.assetStatus === 'saved' });
    },
    (e: unknown) => {
      if (controller.signal.aborted) return;
      useShellStore
        .getState()
        .setBody({ status: 'none', id, reason: reasonOf(e), transient: isTransient(e) });
    },
  );
}

export interface Selection {
  id: string;
  name: string;
  moving: boolean;
}

/** The selected object: the resolved search by name (a marker click or a typed name). */
export function useSelection(): Selection | null {
  const resolved = useAppStore((s) => s.sky.resolved);
  const query = useAppStore((s) => s.sky.query);
  if (!resolved || !query || query.kind !== 'name') return null;
  return {
    id: resolved.id,
    name: resolved.name ?? query.q,
    moving: resolved.moving,
  };
}

/** "Water planet", from the loaded render params; null while there is none. */
export function typeLabel(type: ObjectType | null | undefined): string | null {
  if (!type) return null;
  const t = TYPE_NAME[type];
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Keeps the body in step with the selection: it loads when the card is asked for (so the card can
 * name its type) or when the build pane opens, not on every marker click (issue #64). A new object drops the
 * old body.
 */
export function useSelectedBodyLoader(): void {
  const selection = useSelection();
  // Each search of the object gives a new `resolved`, so selecting the marker again retries a body
  // that failed for a transient reason (loadBodyFor ignores everything else).
  const resolved = useAppStore((s) => s.sky.resolved);
  const buildOpen = useShellStore((s) => s.build.open);
  const cardShown = useShellStore((s) => s.cardRequested);
  const id = selection?.id ?? null;
  useEffect(() => {
    if (!id) return;
    if (cardShown || buildOpen) loadBodyFor(id);
  }, [id, cardShown, buildOpen, resolved]);
}

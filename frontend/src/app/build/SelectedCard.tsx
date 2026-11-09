// Issue #60: the top-centre card of the selected object (mock-up island card, `showInfo`): its
// name, its type, and two actions: "See fingerprint" (the object panel at the spectrum) and
// "Build it" (the split view that moulds the body). × and Escape deselect the object: the card, the
// brackets and the object in the link go, focus returns to its marker, and clicking the marker
// again brings the card back. It sits in a polite live region, so it is announced when it appears.
import { useEffect, useId } from 'react';
import { useAppStore } from '@/state/store';
import { Icon } from '@/app/shell/icons';
import { useShellStore } from '@/app/shell/shellStore';
import { openTool } from '@/app/shell/ToolRail';
import { isEditableTarget } from '@/app/shell/shortcuts';
import { focusSelectedMarker } from './focus';
import { formatCoords } from '@/app/format';
import { loadBodyFor, typeLabel, useSelection } from './selectedBody';

/** Deselects the object: clears the search (brackets, card, flipbook) and the link, then focuses its marker. */
export function deselectObject(id: string): void {
  useAppStore.getState().skyReset();
  window.history.replaceState(
    window.history.state,
    '',
    window.location.pathname + window.location.search,
  );
  focusSelectedMarker(id);
}

/**
 * Who the card is about: the selected object (a marker click or a typed name), or, when asked for
 * with a right-click on its brackets, a position (a picked point or typed coordinates) with no 3D
 * model. Null when there is nothing to show a card for.
 */
function useCardSubject() {
  const selection = useSelection();
  const query = useAppStore((s) => s.sky.query);
  const requested = useShellStore((s) => s.cardRequested);
  if (selection) return { selection, position: null };
  // A bare position ends in the 'error' status by design (nothing is found there); an object found
  // under the coordinates is a selection and wins above.
  if (requested && query && query.kind === 'coords') {
    const [ra, dec] = query.q.split(',').map(Number);
    if (Number.isFinite(ra) && Number.isFinite(dec))
      return { selection: null, position: formatCoords(ra!, dec!) };
  }
  return { selection: null, position: null };
}

export function SelectedCard() {
  const { selection, position } = useCardSubject();
  const tool = useShellStore((s) => s.tool);
  const buildOpen = useShellStore((s) => s.build.open);
  const body = useShellStore((s) => s.body);
  const params = useAppStore((s) => s.params);
  const titleId = useId();
  const show = (selection !== null || position !== null) && tool === 'sky' && !buildOpen;
  // A position has no marker to give focus back to: '' sends it to the sky canvas.
  const selectedId = selection?.id ?? (position !== null ? '' : null);

  const close = () => {
    if (selectedId !== null) deselectObject(selectedId);
  };
  // Escape from anywhere while the card is shown (focus stays on the marker that was clicked), but
  // not in a text field and not when something else has already handled it.
  useEffect(() => {
    if (!show || selectedId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isEditableTarget(e.target)) return;
      e.preventDefault();
      deselectObject(selectedId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show, selectedId]);

  // The type from the loaded render params; before that, only what the search itself says.
  const bodyHere = selection && body.status !== 'idle' && body.id === selection.id;
  const type = bodyHere && body.status === 'ready' ? typeLabel(params?.type) : null;
  const title = selection?.name ?? position ?? '';
  const noModelHere = position !== null;
  const subtitle = noModelHere
    ? 'No 3D model at this position'
    : type
      ? type
      : bodyHere && body.status === 'loading'
        ? 'Looking up its 3D model…'
        : bodyHere && body.status === 'none'
          ? 'No 3D model'
          : selection?.moving
            ? 'Moving object'
            : 'Object on the sky';

  return (
    <div className="sx-island-wrap" aria-live="polite">
      {show && (selection || position !== null) && (
        <section className="sx-island" aria-labelledby={titleId} data-testid="selected-card">
          <header className="sx-island-head">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} data-testid="selected-name">
                {title}
              </h2>
              <p data-testid="selected-type">{subtitle}</p>
              {bodyHere && body.status === 'none' && body.transient && (
                <p className="mt-1" data-testid="selected-retry">
                  Could not load it just now. Press Build it to try again.
                </p>
              )}
            </div>
            <button
              type="button"
              className="sx-panel-x"
              aria-label={`Close ${title}`}
              title="Close (Esc)"
              onClick={close}
            >
              <Icon name="close" className="size-4" />
            </button>
          </header>
          <div className="sx-island-actions">
            <button
              type="button"
              className="sx-btn sx-btn-primary"
              onClick={() => openTool('spectrum')}
            >
              See fingerprint
            </button>
            <button
              type="button"
              className="sx-btn sx-btn-ghost"
              disabled={noModelHere}
              // The reason is in the card (the subtitle) and in the name, for a disabled button.
              aria-label={
                noModelHere ? 'Build it. Not available: no 3D model at this position' : undefined
              }
              title={noModelHere ? 'No 3D model at this position' : undefined}
              onClick={() => {
                // A body that failed for a transient reason is asked for again (also on open).
                if (selectedId) loadBodyFor(selectedId);
                useShellStore.getState().openBuild(true);
              }}
              data-testid="build-it"
            >
              Build it
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

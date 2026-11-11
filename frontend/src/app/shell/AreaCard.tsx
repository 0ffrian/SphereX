// The Discovery tool's card (mock-up `openAreaCard` / `openBoxCard`): draw a square on the sky, then
// pick Known objects or Discovery. The area search backend is not built, so a choice only says so:
// no counts, frames, movers or names are shown (Q-205 pending).
import { useEffect, useRef } from 'react';
import { PanelCard } from './PanelCard';
import { formatAreaSize, useAreaStore } from './areaStore';
import { useShellStore } from './shellStore';
import { centreSquare } from '@/app/sky/areaDraw';

export function AreaCard() {
  const closePanel = useShellStore((s) => s.closePanel);
  const stage = useAreaStore((s) => s.stage);
  const box = useAreaStore((s) => s.box);
  const last = useAreaStore((s) => s.last);
  const choice = useAreaStore((s) => s.choice);
  const rootRef = useRef<HTMLElement>(null);

  // Leaving the tool (close, Escape, another tool) drops drawing mode.
  useEffect(() => () => useAreaStore.getState().reset(), []);
  // Escape cancels from anywhere (the card handles it itself when focus is inside it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      closePanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closePanel]);

  const size = box ? formatAreaSize(box.widthDeg) : '';
  const title = stage === 'set' && box ? `Area · ${size}` : 'Area search';
  const sub = stage === 'set' ? 'Choose how to search it' : 'Drag a square on the sky';

  return (
    <PanelCard
      title={title}
      subtitle={sub}
      icon="area"
      onClose={closePanel}
      returnFocusTo='[data-testid="tool-sky"]'
      rootRef={rootRef}
      testId="area-card"
    >
      {/* Announces the size of the square once it is set (also when it is set without a mouse). */}
      <p className="sr-only" role="status" aria-live="polite" data-testid="area-live">
        {stage === 'set' && box ? `Square set on the sky, ${size} wide.` : ''}
      </p>
      {stage === 'drawing' && (
        <>
          <i className="sx-area-drawing" aria-hidden="true" />
          <p className="text-sm text-sx-mfg">
            Drag a square over the part of the sky you want to search. Then choose how to search it.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="sx-btn sx-btn-ghost"
              data-testid="area-here"
              onClick={() => {
                const b = centreSquare();
                if (b) useAreaStore.getState().setBox(b);
              }}
            >
              Use a square in the middle
            </button>
            {last && (
              <button
                type="button"
                className="sx-btn sx-btn-ghost"
                data-testid="area-keep"
                onClick={() => useAreaStore.getState().setBox(last)}
              >
                Keep the last square
              </button>
            )}
          </div>
        </>
      )}
      {stage === 'set' && (
        <>
          <div className="sx-ar-opts">
            <button
              type="button"
              className="sx-ar-opt"
              data-testid="area-known"
              onClick={() => useAreaStore.getState().choose('known')}
            >
              <OrbitIcon />
              <b>Known objects</b>
              <span>Follow asteroids and comets already on file that crossed this square.</span>
            </button>
            <button
              type="button"
              className="sx-ar-opt"
              data-testid="area-discovery"
              onClick={() => useAreaStore.getState().choose('discovery')}
            >
              <DotsIcon />
              <b>Discovery</b>
              <span>Look for dots that move and match nothing on file.</span>
            </button>
          </div>
          {/* Visual placeholder: no search runs and nothing is invented (Q-205 pending). */}
          <p
            className="sx-ar-note"
            role="status"
            aria-live="polite"
            data-testid="area-not-ready"
          >
            {choice !== null ? 'Not connected yet.' : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="sx-btn sx-btn-ghost"
              data-testid="area-redraw"
              onClick={() => useAreaStore.getState().redraw()}
            >
              Draw again
            </button>
          </div>
        </>
      )}
    </PanelCard>
  );
}

/** The mock-up's `AI["dots"]` icon. */
function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="sx-ico size-5" aria-hidden="true">
      <circle cx="6" cy="7" r="2.2" />
      <circle cx="16" cy="6" r="2.2" />
      <circle cx="10" cy="15" r="2.2" />
      <circle cx="19" cy="17" r="2.2" />
    </svg>
  );
}

/** The mock-up's `AI["orbit"]` icon. */
function OrbitIcon() {
  return (
    <svg viewBox="0 0 24 24" className="sx-ico size-5" aria-hidden="true">
      <path d="M20.341 6.484A10 10 0 0 1 10.266 21.85" />
      <path d="M3.659 17.516A10 10 0 0 1 13.74 2.152" />
      <circle cx="12" cy="12" r="3" />
      <circle cx="19" cy="5" r="2" />
      <circle cx="5" cy="19" r="2" />
    </svg>
  );
}

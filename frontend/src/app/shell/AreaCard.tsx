// The square tools' host (mock-up `openAreaCard`, `arSet`): Known objects and Discovery both start
// by drawing a square on the sky and remember which of them did. What follows depends on the flow:
//   known: the island searches ("Known objects in this square", then "1 known object: 433 Eros"),
//          the card lists the objects, and 433 Eros opens the Eros card with its track in the square.
//   discovery: the sky flies to the square, the steps run and the movers are listed.
// The results are a DEMO (app/area/areaService.ts, Q-205 pending) and are tagged as such.
import { useEffect, useRef } from 'react';
import { DiscoveryCard, MoverCard } from '@/app/area/DiscoveryCard';
import { ErosCard } from '@/app/area/ErosCard';
import { KnownList } from '@/app/area/KnownList';
import { fitCamera, flyToView, centreSquare, safeRect } from '@/app/sky/areaDraw';
import { PanelCard } from './PanelCard';
import { formatAreaSize, useAreaStore } from './areaStore';
import { useShellStore } from './shellStore';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Flies the sky to fit the whole square (and refits at once when the window is resized). */
function useFitSquare(): void {
  const fitSeq = useAreaStore((s) => s.fitSeq);
  const windowOn = useAreaStore((s) => s.screen === 'eros' || s.screen === 'disc' || s.screen === 'mover');
  useEffect(() => {
    if (fitSeq === 0) return;
    // After the card is laid out, so its left edge is known.
    const id = requestAnimationFrame(() => {
      const box = useAreaStore.getState().box;
      const safe = safeRect();
      const cam = box && safe ? fitCamera(box, safe) : null;
      if (cam) flyToView(cam, reducedMotion());
    });
    return () => cancelAnimationFrame(id);
  }, [fitSeq]);
  useEffect(() => {
    if (!windowOn) return;
    const on = () => {
      const box = useAreaStore.getState().box;
      const safe = safeRect();
      const cam = box && safe ? fitCamera(box, safe) : null;
      if (cam) flyToView(cam, true);
    };
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [windowOn]);
}

export function AreaCard() {
  const closePanel = useShellStore((s) => s.closePanel);
  const screen = useAreaStore((s) => s.screen);
  const minimised = useAreaStore((s) => s.minimised);
  useFitSquare();

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

  // Minimised: the island's pill holds the place (Island.tsx). Searching: the island says it.
  if (minimised || screen === 'search') return null;
  switch (screen) {
    case 'list':
      return <KnownList />;
    case 'eros':
      return <ErosCard />;
    case 'disc':
      return <DiscoveryCard />;
    case 'mover':
      return <MoverCard />;
    default:
      return <DrawCard />;
  }
}

function DrawCard() {
  const closePanel = useShellStore((s) => s.closePanel);
  const flow = useAreaStore((s) => s.flow);
  const stage = useAreaStore((s) => s.stage);
  const box = useAreaStore((s) => s.box);
  const last = useAreaStore((s) => s.last);
  const rootRef = useRef<HTMLElement>(null);
  const size = box ? formatAreaSize(box.widthDeg) : '';
  return (
    <PanelCard
      title={flow === 'known' ? 'Known objects' : 'Discovery'}
      subtitle="Drag a square on the sky"
      icon="area"
      onClose={closePanel}
      returnFocusTo={flow === 'known' ? '[data-testid="tool-known"]' : '[data-testid="tool-area"]'}
      rootRef={rootRef}
      testId="area-card"
    >
      {/* Announces the size of the square once it is set (also when it is set without a mouse). */}
      <p className="sr-only" role="status" aria-live="polite" data-testid="area-live">
        {stage === 'set' && box ? `Square set on the sky, ${size} wide.` : ''}
      </p>
      <i className="sx-area-drawing" aria-hidden="true" />
      <p className="text-sm text-sx-mfg">Drag a square over the part of the sky you want to search.</p>
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
    </PanelCard>
  );
}

// The square tools' host (mock-up `openAreaCard`, `arSet`): Known objects and Discovery both start
// by drawing a square on the sky and remember which of them did. What follows depends on the flow:
//   known: the island searches ("Known objects in this square", then "1 known object: 433 Eros"),
//          the card lists the objects, and 433 Eros opens the Eros card with its track in the square.
//   discovery: the sky flies to the square, the steps run and the movers are listed.
// The results are a DEMO (app/area/areaService.ts, Q-205 pending) and are tagged as such.
import { useEffect } from 'react';
import { DiscoveryCard, MoverCard } from '@/app/area/DiscoveryCard';
import { ErosCard } from '@/app/area/ErosCard';
import { KnownList } from '@/app/area/KnownList';
import { fitCamera, flyToView, centreSquare, safeRect } from '@/app/sky/areaDraw';
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
  // Moon (12 Nov 2026): no card while drawing; the user drags a square of their own choice.
  // A small hint says what to do. Keyboard users press Enter for a square in the middle (WCAG 2.5.7).
  const flow = useAreaStore((s) => s.flow);
  const stage = useAreaStore((s) => s.stage);
  const box = useAreaStore((s) => s.box);
  const size = box ? formatAreaSize(box.widthDeg) : '';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.isContentEditable)) return;
      const b = centreSquare();
      if (b) useAreaStore.getState().setBox(b);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="sx-area-hint" data-testid="area-card">
      <p className="sr-only" role="status" aria-live="polite" data-testid="area-live">
        {stage === 'set' && box ? `Square set on the sky, ${size} wide.` : ''}
      </p>
      <span role="status">
        {flow === 'known' ? 'Known objects' : 'Discovery'}: drag a square on the sky
      </span>
      <span className="sx-area-hint-keys" aria-hidden="true">Enter for the middle · Esc to cancel</span>
    </div>
  );
}

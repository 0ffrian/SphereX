// The area tools' host (mock-up `openAreaCard`, `arSet`): Known objects and Discovery both start
// by drawing an area on the sky and remember which of them did. What follows depends on the flow:
//   known: the island searches ("Known objects in this area", then "1 known object: 433 Eros"),
//          the card lists the objects, and 433 Eros opens the Eros card with its track in the area.
//   discovery: the sky flies to the area, the steps run and the movers are listed.
// The results are a DEMO (app/area/areaService.ts, Q-205 pending) and are tagged as such.
import { useEffect, useLayoutEffect } from 'react';
import { boxInBezel, useIslandStore } from '@/app/island/islandStore';
import { DiscoveryCard, MoverCard } from '@/app/area/DiscoveryCard';
import { ErosCard } from '@/app/area/ErosCard';
import { KnownList } from '@/app/area/KnownList';
import { LiveAreaCard } from '@/app/area/LiveAreaCard';
import { fitCamera, flyToView, centreRect, safeRect } from '@/app/sky/areaDraw';
import { MAX_SIDE_DEG } from '@/app/area/aim';
import { formatAreaDims, useAreaStore } from './areaStore';
import { useShellStore } from './shellStore';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Flies the sky to fit the whole area (and refits at once when the window is resized). */
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

/**
 * Tells the island where the area card is, so it grows into it (the same mechanism as the object
 * panel, Panels.tsx). It lives here, not in each card: switching from the list to the Eros card
 * swaps the card but keeps the box, so the island does not travel again. No card (drawing, the
 * island's search, minimised): no box, and the island is a pill or a circle again.
 */
function useReportAreaBox(): void {
  const screen = useAreaStore((s) => s.screen);
  const minimised = useAreaStore((s) => s.minimised);
  const setPanelBox = useIslandStore((s) => s.setPanelBox);
  useLayoutEffect(() => {
    const find = () => document.querySelector<HTMLElement>('.sx-panel[data-testid="area-card"]');
    const report = () => {
      const el = find();
      setPanelBox(el ? boxInBezel(el) : null);
    };
    report();
    let frame = 0;
    const soon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(report);
    };
    soon();
    const mo = new MutationObserver(soon);
    const el = find();
    if (el) {
      mo.observe(el, { childList: true, subtree: true, characterData: true, attributes: true });
      if (el.parentElement) mo.observe(el.parentElement, { attributes: true, attributeFilter: ['style'] });
      el.addEventListener('load', soon, true);
    }
    window.addEventListener('resize', soon);
    return () => {
      cancelAnimationFrame(frame);
      mo.disconnect();
      window.removeEventListener('resize', soon);
      el?.removeEventListener('load', soon, true);
    };
  }, [screen, minimised, setPanelBox]);
  // Gone with the tool: the island goes back to its circle.
  useEffect(() => () => setPanelBox(null), [setPanelBox]);
}

export function AreaCard() {
  const closePanel = useShellStore((s) => s.closePanel);
  const screen = useAreaStore((s) => s.screen);
  const minimised = useAreaStore((s) => s.minimised);
  useFitSquare();
  useReportAreaBox();

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
    case 'live':
      return <LiveAreaCard />;
    default:
      return <DrawCard />;
  }
}

function DrawCard() {
  // Moon (12 Nov 2026): no card while drawing; the user drags an area of their own choice.
  // A small hint says what to do. Keyboard users press Enter for a box in the middle (WCAG 2.5.7).
  const flow = useAreaStore((s) => s.flow);
  const stage = useAreaStore((s) => s.stage);
  const box = useAreaStore((s) => s.box);
  const size = box ? formatAreaDims(box) : '';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      // Typing in a field keeps Enter; so does any button except the dock tool that started this
      // (focus is still on it right after the click, and Enter must work from there).
      const dockTool = !!t?.closest('[data-testid="tool-known"], [data-testid="tool-area"]');
      if (t && !dockTool && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.isContentEditable)) return;
      if (dockTool) e.preventDefault(); // not a second click on the tool
      const b = centreRect();
      if (b) useAreaStore.getState().setBox(b);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Issue #144 (mock-up states 1 and 2): aim, then draw in the picked patch.
  const coarse = typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false);
  const [lead, rest] =
    stage === 'aiming'
      ? [`${coarse ? 'Tap' : 'Click'} a patch to zoom in`, 'drag to turn the sky']
      : ['Drag to draw your area', `up to ${MAX_SIDE_DEG}° a side`];
  return (
    <div className="sx-area-hint" data-testid="area-card" data-stage={stage}>
      <p className="sr-only" role="status" aria-live="polite" data-testid="area-live">
        {stage === 'set' && box ? `Area set on the sky, ${size}.` : ''}
      </p>
      <span role="status" data-testid="area-hint">
        <span className="sr-only">{flow === 'known' ? 'Known objects' : 'Discovery'}: </span>
        {lead} <span className="sx-area-hint-keys">· {rest}</span>
        <span className="sr-only">. Press Enter for an area in the middle, Escape to leave.</span>
      </span>
    </div>
  );
}

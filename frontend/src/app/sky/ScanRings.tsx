// Draws the scanning rings (scanRings.ts) on the square being analysed, live or in a replay (issue
// #173). One animation frame loop moves the model and sets the circles directly (no React render per
// frame). The square's screen quad comes from ScanOverlay's placement, so the rings stay pinned to
// the sky. Nothing plays under reduced motion: the blue square says "analysing" on its own.
// Decoration only: hidden from screen readers (the scan card's live region says the square).
import { useEffect, useRef, type MutableRefObject } from 'react';
import { newSim, quadPoint, ringLook, stepSim } from './scanRings';
import type { Pt } from './scanLabels';

/** Reduced motion, read live: a change while the rings play stops or starts them. */
const stillQuery = () =>
  typeof window !== 'undefined'
    ? (window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null)
    : null;

export function ScanRings({
  quad,
  active,
}: {
  /** The analysing square's corners on screen now, or null when it is off screen. */
  quad: MutableRefObject<Pt[] | null>;
  /** False when nothing is analysing, the scan is paused or the replay is paused. */
  active: boolean;
}) {
  const gRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const g = gRef.current;
    if (!active || !g || typeof requestAnimationFrame !== 'function') return;
    const still = stillQuery();
    const sim = newSim(performance.now());
    let raf = 0;
    const frame = (now: number) => {
      stepSim(sim, now);
      const q = quad.current;
      const circles = g.children;
      // One circle per ring, reused frame to frame.
      while (circles.length < sim.rings.length)
        g.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'circle'));
      for (let i = 0; i < circles.length; i++) {
        const c = circles[i] as SVGCircleElement;
        const r = sim.rings[i];
        if (!r || !q || still?.matches) {
          c.setAttribute('display', 'none');
          continue;
        }
        const p = quadPoint(q, r.u, r.v);
        const { radius, opacity } = ringLook(r, now);
        c.removeAttribute('display');
        c.setAttribute('cx', p.x.toFixed(1));
        c.setAttribute('cy', p.y.toFixed(1));
        c.setAttribute('r', radius.toFixed(1));
        c.setAttribute('opacity', opacity.toFixed(3));
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      g.replaceChildren();
    };
  }, [active, quad]);

  return (
    <g
      ref={gRef}
      className="sx-scan-rings"
      aria-hidden="true"
      data-testid="scan-rings"
      data-active={active || undefined}
    />
  );
}

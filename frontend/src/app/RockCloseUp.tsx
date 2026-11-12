// Issue #71, D-37 (stream V3): the close-up pane's picture for asteroids and comet nuclei: the same
// body as the build pane's stage, drawn by the same rock engine on this pane's own canvas. The
// engine's own camera is the prototype's (one framing), so this is the body at the size of the pane,
// not a nearer camera.
// Issue #93 wave 1: the canvas compiles in the background (B7), or copies the build stage's picture (0.8); a small
// note shows until its first picture is on it.
import { useEffect, useRef, useState } from 'react';
import { useRockStore } from './rockStore';
import { RockPreparing } from './build/RockStage';

export function RockCloseUp({ active }: { active: boolean }) {
  const view = useRockStore((s) => s.view);
  const ref = useRef<HTMLDivElement>(null);
  const [drawnOn, setDrawnOn] = useState<HTMLCanvasElement | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const reduced =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // The canvas is made here, in the effect: the detach function releases its GL context, and a lost
  // context cannot be brought back on the same element (effects run twice in dev, and on every re-attach).
  useEffect(() => {
    const host = ref.current;
    if (!view || !host || !active) return;
    const c = document.createElement('canvas');
    c.tabIndex = 0;
    c.setAttribute('role', 'application');
    c.setAttribute(
      'aria-label',
      'The same body in the close-up pane. Drag or use the arrow keys to turn it.',
    );
    c.className = 'block w-full touch-none';
    c.style.aspectRatio = '8 / 5';
    c.style.maxHeight = '100%';
    host.appendChild(c);
    let off: (() => void) | undefined;
    try {
      off = view.attach(c, 1);
    } catch {
      c.remove();
      return;
    }
    let dead = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the canvas now exists
    setCanvas(c);
    view.whenDrawn(c).then(
      () => !dead && setDrawnOn(c),
      () => undefined,
    );
    return () => {
      dead = true;
      off?.();
      c.remove();
    };
  }, [view, active]);
  if (!view || !active) return null;
  return (
    <div
      ref={ref}
      className="absolute inset-0 z-[1] flex items-center justify-center bg-black"
      data-testid="rock-closeup"
    >
      {canvas !== null && drawnOn !== canvas && <RockPreparing reducedMotion={reduced} />}
    </div>
  );
}

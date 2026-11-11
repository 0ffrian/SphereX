// Issue #71, D-37 (stream V3): the close-up pane's picture for asteroids and comet nuclei: the same
// body as the build pane's stage, drawn by the same rock engine on this pane's own canvas. The
// engine's own camera is the prototype's (one framing), so this is the body at the size of the pane,
// not a nearer camera.
import { useEffect, useRef } from 'react';
import { useRockStore } from './rockStore';

export function RockCloseUp({ active }: { active: boolean }) {
  const view = useRockStore((s) => s.view);
  const ref = useRef<HTMLDivElement>(null);
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
    return () => {
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
    />
  );
}

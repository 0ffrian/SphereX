// Issue #71, D-37 (stream V3): the close-up pane's picture for asteroids and comet nuclei: the same
// body as the build pane's stage, drawn by the same rock engine on this pane's own canvas. The
// engine's own camera is the prototype's (one framing), so this is the body at the size of the pane,
// not a nearer camera.
import { useEffect, useRef } from 'react';
import { useRockStore } from './rockStore';

export function RockCloseUp({ active }: { active: boolean }) {
  const view = useRockStore((s) => s.view);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!view || !c || !active) return;
    try {
      return view.attach(c, 1);
    } catch {
      return;
    }
  }, [view, active]);
  if (!view || !active) return null;
  return (
    <div
      className="absolute inset-0 z-[1] flex items-center justify-center bg-black"
      data-testid="rock-closeup"
    >
      <canvas
        ref={ref}
        tabIndex={0}
        role="application"
        aria-label="The same body in the close-up pane. Drag or use the arrow keys to turn it."
        className="block w-full touch-none"
        style={{ aspectRatio: '8 / 5', maxHeight: '100%' }}
      />
    </div>
  );
}

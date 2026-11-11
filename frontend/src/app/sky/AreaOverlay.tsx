// The rectangle of the area tools over the sky: the accent outline with a light fill, while it is
// dragged and once it is set (then it follows the view, written from the render listener).
import { useEffect, useRef } from 'react';
import type { SkyView } from '@/viewer/sky/SkyView';
import { formatAreaDims, useAreaStore } from '@/app/shell/areaStore';
import { boxToPixels } from './areaDraw';

export function AreaOverlay({ view }: { view: SkyView | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useAreaStore((s) => s.drag);
  const box = useAreaStore((s) => s.box);

  const place = (r: { x0: number; y0: number; x1: number; y1: number } | null) => {
    const el = ref.current;
    if (!el) return;
    if (!r) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.style.left = `${Math.min(r.x0, r.x1)}px`;
    el.style.top = `${Math.min(r.y0, r.y1)}px`;
    el.style.width = `${Math.abs(r.x1 - r.x0)}px`;
    el.style.height = `${Math.abs(r.y1 - r.y0)}px`;
  };

  useEffect(() => {
    if (drag) {
      place(drag);
      return;
    }
    if (!box || !view) {
      place(null);
      return;
    }
    const draw = () => place(boxToPixels(box));
    draw();
    return view.onRender(draw);
  }, [drag, box, view]);

  return (
    <div ref={ref} className="sx-area-sq" style={{ display: 'none' }} aria-hidden="true">
      {/* The rectangle's size over its top left, as the mock-up does (not while it is dragged). */}
      {box && !drag && <span className="sx-area-size">{formatAreaDims(box)}</span>}
    </div>
  );
}

// The rectangle of the area tools over the sky: the accent outline with a light fill, while it is
// dragged and once it is set (then it follows the view, written from the render listener).
// Issue #144 (mock-up state 2): while dragging, its size is read out over its top left, "2° max"
// when a side is held at the limit, and a + marks the corner being dragged.
import { useEffect, useRef } from 'react';
import type { SkyView } from '@/viewer/sky/SkyView';
import { useAreaStore } from '@/app/shell/areaStore';
import { drawReadout, formatBoxDeg } from '@/app/area/aim';
import { boxToPixels, measurePixels } from './areaDraw';

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

  const size = drag ? measurePixels(drag) : null;
  // The + sits on the dragged corner: right or left, bottom or top, by the drag's direction.
  const corner = drag ? `${drag.y1 >= drag.y0 ? 'b' : 't'}${drag.x1 >= drag.x0 ? 'r' : 'l'}` : '';
  return (
    <div ref={ref} className="sx-area-sq" style={{ display: 'none' }} aria-hidden="true" data-testid="area-box">
      {box && !drag && <span className="sx-area-size">{formatBoxDeg(box.widthDeg, box.heightDeg)}</span>}
      {drag && size && (
        <span className="sx-area-size" data-held={drag.held ? '' : undefined} data-testid="area-readout">
          {drawReadout(size.w, size.h, drag.held === true)}
        </span>
      )}
      {drag && <span className="sx-area-plus" data-corner={corner} />}
    </div>
  );
}

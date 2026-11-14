// The set area's outline over the sky: the accent outline with a light fill and its size over its
// top left, following the view (written from the render listener). A scan draws its own grid
// (ScanOverlay), so no outline is drawn under it (issue #157).
import { useEffect, useRef } from 'react';
import type { SkyView } from '@/viewer/sky/SkyView';
import { useAreaStore } from '@/app/shell/areaStore';
import { formatBoxDeg } from '@/app/area/aim';
import { boxToPixels } from './areaDraw';

export function AreaOverlay({ view }: { view: SkyView | null }) {
  const ref = useRef<HTMLDivElement>(null);
  // A scan draws its own grid and frame (ScanOverlay): no single-area outline under it.
  const box = useAreaStore((s) => (s.screen === 'scan' ? null : s.box));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!box || !view) {
      el.style.display = 'none';
      return;
    }
    const draw = () => {
      const r = boxToPixels(box);
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
    draw();
    return view.onRender(draw);
  }, [box, view]);

  return (
    <div
      ref={ref}
      className="sx-area-sq"
      style={{ display: 'none' }}
      aria-hidden="true"
      data-testid="area-box"
    >
      {box && <span className="sx-area-size">{formatBoxDeg(box.widthDeg, box.heightDeg)}</span>}
    </div>
  );
}

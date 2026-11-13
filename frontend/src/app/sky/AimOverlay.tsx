// Select a region (issue #157; mock-up state 1): with Known objects or Discovery on and nothing
// picked yet, the mouse pointer IS a green rectangle with the screen's shape, drawn to scale:
// exactly the region that fills the screen after a click (north up). Zooming the sky (scroll,
// pinch, + and -) makes it cover more or less sky; past 12° a side it is held at the limit, and
// the label says so: "9.6° × 6.0° · 15 squares · about 4 h". A drag still turns the sky; a click
// selects (SkyPane). On touch there is no hover, so the rectangle sits in the middle of the screen
// until a finger lands; a tap selects there. Written from pointer and render events, no React render per move.
import { useEffect, useRef } from 'react';
import type { SkyView } from '@/viewer/sky/SkyView';
import { useAreaStore } from '@/app/shell/areaStore';
import { useShellStore } from '@/app/shell/shellStore';
import { selectionLabel } from '@/app/area/scanGrid';
import { selectionNow, viewNow } from './areaDraw';

const coarse = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false);

export function AimOverlay({ view }: { view: SkyView | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLElement>(null);
  const areaTool = useShellStore((s) => s.tool === 'area');
  const aimStage = useAreaStore((s) => s.stage === 'aiming');
  const aiming = areaTool && aimStage;

  useEffect(() => {
    const el = ref.current;
    const canvas = el?.parentElement?.querySelector<HTMLCanvasElement>('canvas');
    if (!el || !canvas || !view || !aiming) {
      if (el) el.style.display = 'none';
      return;
    }
    let at: { x: number; y: number } | null = null;
    let touch = coarse();
    const place = () => {
      const now = viewNow();
      const p = at ?? (touch && now ? { x: now.width / 2, y: now.height / 2 } : null);
      const sel = p ? selectionNow(p.x, p.y) : null;
      if (!p || !sel) {
        el.style.display = 'none';
        return;
      }
      el.style.display = 'block';
      el.style.left = `${p.x - sel.wPx / 2}px`;
      el.style.top = `${p.y - sel.hPx / 2}px`;
      el.style.width = `${sel.wPx}px`;
      el.style.height = `${sel.hPx}px`;
      el.toggleAttribute('data-held', sel.held);
      if (labelRef.current) labelRef.current.textContent = selectionLabel(sel);
    };
    const onMove = (e: PointerEvent) => {
      touch = e.pointerType === 'touch';
      const r = canvas.getBoundingClientRect();
      at = { x: e.clientX - r.left, y: e.clientY - r.top };
      place();
    };
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      at = null;
      place();
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    const offRender = view.onRender(place);
    place();
    return () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      offRender();
      el.style.display = 'none';
    };
  }, [view, aiming]);

  return (
    <div
      ref={ref}
      className="sx-aim sx-select"
      style={{ display: 'none' }}
      aria-hidden="true"
      data-testid="area-aim"
    >
      <b ref={labelRef} />
    </div>
  );
}

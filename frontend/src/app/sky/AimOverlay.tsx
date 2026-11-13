// Aim (issue #144, Q-462; mock-up state 1): with Known objects or Discovery on and no patch picked
// yet, the mouse pointer is a green rectangle with the screen's shape, drawn to scale: exactly what
// fills the screen after a click (2.2° tall, north up), so it shrinks as the view zooms out. A drag
// still turns the sky; a click zooms there (SkyPane). On touch there is no hover, so nothing is drawn
// before the tap. Written from pointer and render events, with no React render per move.
import { useEffect, useRef } from 'react';
import type { SkyView } from '@/viewer/sky/SkyView';
import { useAreaStore } from '@/app/shell/areaStore';
import { useShellStore } from '@/app/shell/shellStore';
import { aimLabel, aimSizePx } from '@/app/area/aim';
import { viewNow } from './areaDraw';

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
    const place = () => {
      const now = viewNow();
      if (!at || !now) {
        el.style.display = 'none';
        return;
      }
      const { w, h } = aimSizePx(now.cam.fovDeg, now.width, now.height);
      el.style.display = 'block';
      el.style.left = `${at.x - w / 2}px`;
      el.style.top = `${at.y - h / 2}px`;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      if (labelRef.current) labelRef.current.textContent = aimLabel(now.width, now.height);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        at = null;
      } else {
        const r = canvas.getBoundingClientRect();
        at = { x: e.clientX - r.left, y: e.clientY - r.top };
      }
      place();
    };
    const onLeave = () => {
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
    <div ref={ref} className="sx-aim" style={{ display: 'none' }} aria-hidden="true" data-testid="area-aim">
      <b ref={labelRef} />
    </div>
  );
}

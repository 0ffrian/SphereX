// The #track window inside the drawn square (mock-up `knDraw` / `discDraw`): one canvas over the sky
// view, drawn only inside the square. It repaints with the view (the square follows the sky), when
// the area state changes and while the marker glides to the time of the shown exposure.
// A prepared area's answer (Q-205) is drawn at its dots' and tracks' own RA/Dec instead, through
// sky/area/drawLayer.ts (one gnomonic geometry); the demo, at its image pixels. The sky image under
// the Eros card's path is a demo extraction; in the Known flow the path itself is the real Horizons
// path (issue #130). See areaService.ts.
import { useEffect, useRef } from 'react';
import { useAppStore } from '@/state/store';
import { effectiveHonesty } from '@/viewer/honesty';
import { drawArea } from '@/app/sky/area/drawLayer';
import { prepareScene, type AreaScene } from '@/app/sky/area/scene';
import type { RealDiscovery } from './realArea';
import { DEMO_CUTOUT_NOTE, DemoTag } from './DemoTag';
import type { SkyView } from '@/viewer/sky/SkyView';
import { currentHop, useAreaStore } from '@/app/shell/areaStore';
import { boxToPixels } from '@/app/sky/areaDraw';
import { drawTrackWindow, trackShown } from './erosDraw';

export function AreaTrackLayer({ view }: { view: SkyView | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // The canvas draws demo data (Eros's real frames, made-up dots): it wears the tag too (Q-414).
  const real = useAreaStore((s) => s.trackSource === 'real');
  const demoOn = useAreaStore(
    (s) =>
      (s.screen === 'eros' || s.screen === 'disc' || s.screen === 'mover') &&
      !!s.box &&
      !!s.eros &&
      // An object with no demo sky image draws nothing here, so no tag either.
      s.eros.wide.w > 0 &&
      !s.refusal &&
      !s.disc?.real,
  );

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !view) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let now: number | null = null;
    let raf = 0;
    let last = 0;
    // The scene of a prepared area, built once per answer (no allocation per frame).
    let sceneOf: RealDiscovery | null = null;
    let scene: AreaScene | null = null;

    const paint = () => {
      const s = useAreaStore.getState();
      const g = canvas.getContext('2d');
      if (!g) return;
      const { width, height } = view.getSize();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(width * dpr);
      const h = Math.round(height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, width, height);
      const on = s.screen === 'eros' || s.screen === 'disc' || s.screen === 'mover';
      const real = s.disc?.real ?? null;
      if (on && s.box && real && !s.refusal && (s.screen === 'disc' || s.screen === 'mover')) {
        if (sceneOf !== real) {
          sceneOf = real;
          scene = real.dots ? prepareScene(real.summary, real.dots, real.tracks) : null;
        }
        const visit = s.visit ?? scene?.visits[0]?.visit ?? 0;
        drawArea(g, {
          scene,
          visit,
          // The card's step is the last one done (-1 before the first); the layer counts steps done.
          step: s.step + 1,
          layers: { dots: !!real.dots, tracks: !!real.tracks },
          measured: effectiveHonesty(useAppStore.getState().honesty) === 'measured',
          selected: s.screen === 'mover' ? (s.disc?.movers[s.sel]?.id ?? null) : null,
          hidePossible: !s.showPossible,
          outline: null,
          draft: null,
          cam: view.getView(),
          width,
          height,
          safe: { x: 0, y: 0, w: width, h: height },
        });
        return;
      }
      if (!on || !s.box || !s.eros || s.refusal) return;
      const rect = boxToPixels(s.box);
      if (!rect) return;
      const hop = currentHop(s);
      const target = hop ? hop.mjd_avg : (s.eros.hops[0]?.mjd_avg ?? 0);
      if (now === null) now = target;
      const measuredOnly = effectiveHonesty(useAppStore.getState().honesty) === 'measured';
      drawTrackWindow(
        g,
        rect,
        trackShown(s.eros, measuredOnly),
        {
          mode: s.flow === 'known' ? 'eros' : 'disc',
          now,
          step: s.step,
          sel: s.screen === 'mover' ? s.sel : -1,
          disc: s.disc,
          name: s.focus?.name || s.focus?.id || 'Eros',
        },
        () => paint(),
      );
    };

    // The marker glides to the time of the shown exposure (the mock-up's `knTick`).
    const tick = (ts: number) => {
      raf = 0;
      const s = useAreaStore.getState();
      const hop = currentHop(s);
      if (hop && now !== null && now !== hop.mjd_avg) {
        const dt = Math.min(0.1, (ts - (last || ts)) / 1000);
        last = ts;
        now += (hop.mjd_avg - now) * (reduced ? 1 : 1 - Math.exp(-dt * 5));
        if (Math.abs(hop.mjd_avg - now) < 1e-6) now = hop.mjd_avg;
        raf = requestAnimationFrame(tick);
      } else last = 0;
      paint();
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    paint();
    const offStore = useAreaStore.subscribe(kick);
    const offHonesty = useAppStore.subscribe((a, b) => {
      if (a.honesty !== b.honesty) kick();
    });
    const offRender = view.onRender(paint);
    return () => {
      cancelAnimationFrame(raf);
      offStore();
      offHonesty();
      offRender();
    };
  }, [view]);

  return (
    <>
      <canvas ref={ref} className="sx-area-track" aria-hidden="true" data-testid="area-track" />
      {demoOn && (
        <span className="sx-area-track-tag" data-testid="area-track-demo">
          <DemoTag
            testId="area-track-demo-tag"
            {...(real ? { label: 'Demo image', note: DEMO_CUTOUT_NOTE } : {})}
          />
        </span>
      )}
    </>
  );
}

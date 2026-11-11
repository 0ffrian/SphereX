// Issue #71 (D-37): the view controls (the mock-up's zoom bar, the Details rotate / zoom / Reset view
// buttons) act on whatever draws the body: a D-37 engine when one does, else the three.js viewer.
// A control the active drawer cannot do is returned disabled with its reason, never left silent.
import { useMemo } from 'react';
import { useCloseUpStore } from './closeUpStore';
import { useRockStore } from './rockStore';
import { useWorldStore } from './worldStore';
import type { ViewerApp } from '@/viewer/ViewerApp';
import type { RockView } from '@/engine/rocks/RockView';

export type Dir = 'left' | 'right' | 'up' | 'down';

export interface ViewControls {
  kind: 'viewer' | 'world' | 'rock' | 'star' | 'none';
  /** Null when the zoom buttons work, else why they do not. */
  zoomOff: string | null;
  rotateOff: string | null;
  resetOff: string | null;
  zoom(dir: 'in' | 'out'): void;
  rotate(dir: Dir): void;
  reset(): void;
  /** 1 = as opened. */
  ratio(): number;
}

const NOTHING = (): void => undefined;
const WORLD_ZOOM = [1, 10] as const;
const STEP = 0.15;

export function resolveViewControls(src: {
  viewer: ViewerApp | null;
  engineWorld: unknown;
  engineStar: unknown;
  rockView: RockView | null;
  /** Whether the object draws as a rock (asteroid or comet nucleus). */
  rockKind: boolean;
}): ViewControls {
  if (src.engineWorld) {
    const globe = () => useWorldStore.getState().globe;
    const off = globe() ? null : 'The planet view is still starting.';
    return {
      kind: 'world',
      zoomOff: off,
      rotateOff: off,
      resetOff: off,
      zoom: (dir) => {
        const g = globe();
        if (!g) return;
        const z = g.state().zoom * (dir === 'in' ? 1.25 : 0.8);
        useWorldStore
          .getState()
          .apply({ zoom: Math.max(WORLD_ZOOM[0], Math.min(WORLD_ZOOM[1], z)) });
      },
      rotate: (dir) => {
        const g = globe();
        if (!g) return;
        const s = g.state();
        const k = STEP / s.zoom;
        useWorldStore.getState().apply({
          yaw: s.yaw + (dir === 'left' ? -k : dir === 'right' ? k : 0),
          pitch: Math.max(
            -1.4,
            Math.min(1.4, s.pitch + (dir === 'up' ? -k : dir === 'down' ? k : 0)),
          ),
        });
      },
      reset: () => useWorldStore.getState().apply({ zoom: 1, yaw: 0, pitch: 0 }),
      ratio: () => globe()?.state().zoom ?? 1,
    };
  }
  if (src.engineStar) {
    const why =
      'The star view has no zoom or turning here: use its View choices (whole star, close-up).';
    return {
      kind: 'star',
      zoomOff: why,
      rotateOff: why,
      resetOff: why,
      zoom: NOTHING,
      rotate: NOTHING,
      reset: NOTHING,
      ratio: () => 1,
    };
  }
  if (src.rockKind && src.rockView) {
    const v = src.rockView;
    return {
      kind: 'rock',
      zoomOff: 'This body view cannot zoom. Turn it with the arrows or by dragging.',
      rotateOff: null,
      resetOff: null,
      zoom: NOTHING,
      rotate: (dir) => v.rotate(dir),
      reset: () => v.resetPose(),
      ratio: () => 1,
    };
  }
  const v = src.viewer;
  const off = v ? null : 'The 3D view is not ready yet.';
  return {
    kind: v ? 'viewer' : 'none',
    zoomOff: off,
    rotateOff: off,
    resetOff: off,
    zoom: (dir) => v?.zoom(dir),
    rotate: (dir) => v?.rotate(dir),
    reset: () => v?.resetView(),
    ratio: () => v?.zoomRatio() ?? 1,
  };
}

/** The controls for what is drawing now (re-reads when an engine starts or stops). */
export function useViewControls(): ViewControls {
  const viewer = useCloseUpStore((s) => s.viewer);
  const engineWorld = useCloseUpStore((s) => s.engineWorld);
  const engineStar = useCloseUpStore((s) => s.engineStar);
  const type = useCloseUpStore((s) => s.type);
  const rockView = useRockStore((s) => s.view);
  const rockKind = type === 'asteroid_procedural' || type === 'asteroid_shape' || type === 'comet';
  const globe = useWorldStore((s) => s.globe);
  return useMemo(
    () => resolveViewControls({ viewer, engineWorld, engineStar, rockView, rockKind }),
    // `globe` is a dependency: the world controls are off until its engine exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewer, engineWorld, engineStar, rockView, rockKind, globe],
  );
}

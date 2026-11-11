// Camera command for the sky (A21.6; Q-174, built ahead for Area on issue #96's instruction, Q-406):
// any part of the app asks the sky to fly to a position or to fit a box. SkyPane is the only
// listener; it moves the camera with the same 700 ms ease-out as its own fly-to (instant under
// reduced motion) and cancels it on pointer-down, wheel or a key. The search's own fly-to to a
// resolved object is unchanged. The command is kept in a small store ({seq, cmd}), so a command
// given before the sky is ready (a shared link) is carried out once it is.
import { create } from 'zustand';
import { clampFov, screenToRaDec, type SkyCamera } from '@/viewer/sky/skyMath';
import type { Rect } from './safeRect';

export interface SkyBoxTarget {
  ra: number;
  dec: number;
  width_deg: number;
  height_deg: number;
}

export type SkyFlyCommand = { ra: number; dec: number; fovDeg?: number } | { box: SkyBoxTarget };

/** A box is fitted with this much room round it (display choice). */
export const FLY_BOX_MARGIN = 1.25;

interface FlyState {
  seq: number;
  cmd: SkyFlyCommand | null;
}

export const useSkyFlyStore = create<FlyState>()(() => ({ seq: 0, cmd: null }));

export function skyFlyTo(cmd: SkyFlyCommand): void {
  useSkyFlyStore.setState((s) => ({ seq: s.seq + 1, cmd }));
}

/**
 * The camera that shows the target centred in the safe rectangle: a box fits inside it with
 * FLY_BOX_MARGIN; a position keeps the given or current field of view.
 */
export function cameraForTarget(
  cmd: SkyFlyCommand,
  current: SkyCamera,
  width: number,
  height: number,
  safe: Rect,
): SkyCamera {
  const W = Math.max(1, width);
  const H = Math.max(1, height);
  const s = safe.w > 0 && safe.h > 0 ? safe : { x: 0, y: 0, w: W, h: H };
  let ra: number;
  let dec: number;
  let fovDeg: number;
  if ('box' in cmd) {
    ra = cmd.box.ra;
    dec = cmd.box.dec;
    // fov is vertical: degrees per px = fov / H. The box must fit s.w × s.h px.
    const byH = (cmd.box.height_deg * FLY_BOX_MARGIN * H) / s.h;
    const byW = (cmd.box.width_deg * FLY_BOX_MARGIN * H) / s.w;
    fovDeg = clampFov(Math.max(byH, byW));
  } else {
    ra = cmd.ra;
    dec = cmd.dec;
    fovDeg = clampFov(cmd.fovDeg ?? current.fovDeg);
  }
  // Centred on the target, the target sits at the screen centre. The camera that puts it at the
  // safe rectangle's centre (cx, cy) instead looks at the mirror point (W − cx, H − cy).
  const centred: SkyCamera = { ra, dec, fovDeg };
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const look = screenToRaDec(centred, W - cx, H - cy, W, H);
  return { ra: look.ra, dec: look.dec, fovDeg };
}

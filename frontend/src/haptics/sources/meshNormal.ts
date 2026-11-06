// R8.4 mesh-normal source (asteroid_shape, real shape models; tag = texture_tag, `measured`).
//   - When the angle between consecutive face normals exceeds 12°, a tick with
//     strength = clamp(angle / 40°, 0, 1).
//   - When the finger slides off the limb, one firm "edge" tick.
// The angle logic is pure: it reads `TouchSample.normal`, which the caller's raycast fills. The
// `three-mesh-bvh` raycast itself (R8.4 item 1) is not built here: no fixture or renderer has a
// mesh yet (issue #11 plan, R#15), so `profiles.ts` passes the analytic normal until M5 wires it.
import type { Tag } from '@/contract';
import { MESH_NORMAL_FULL_ANGLE_DEG, MESH_NORMAL_MIN_ANGLE_DEG, STRENGTH_FIRM } from '../tuning';
import { clamp, OneShot, type HapticSink, type HapticSource, type TouchSample } from './types';

const DEG = 180 / Math.PI;

/** Angle in degrees between two vectors (not necessarily unit). */
export function angleDeg(a: readonly number[], b: readonly number[]): number {
  const la = Math.hypot(a[0]!, a[1]!, a[2]!);
  const lb = Math.hypot(b[0]!, b[1]!, b[2]!);
  if (!(la > 0) || !(lb > 0)) return 0;
  const dot = (a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!) / (la * lb);
  return Math.acos(clamp(dot, -1, 1)) * DEG;
}

/** R8.4: the tick strength for a normal turn, or -1 when the turn is 12° or less. */
export function normalTurnStrength(angle: number): number {
  if (!(angle > MESH_NORMAL_MIN_ANGLE_DEG)) return -1;
  return clamp(angle / MESH_NORMAL_FULL_ANGLE_DEG, 0, 1);
}

export class MeshNormalSource implements HapticSource {
  readonly id = 'mesh';
  readonly channel = 'texture' as const;
  readonly trigger = 'move' as const;
  private readonly out: OneShot;
  private readonly prev: [number, number, number] = [0, 0, 0];
  private onBody = false;

  constructor(
    engine: HapticSink,
    readonly tag: Tag,
  ) {
    this.out = new OneShot(engine, tag);
  }

  move(s: TouchSample): void {
    if (s.bodyId === null) {
      // Slid off the limb: one firm edge tick.
      if (this.onBody) this.out.play('tick', STRENGTH_FIRM, s.pan, 'click');
      this.onBody = false;
      return;
    }
    const n = s.normal;
    if (this.onBody) {
      const strength = normalTurnStrength(angleDeg(this.prev, n));
      if (strength >= 0) this.out.play('tick', strength, s.pan, 'click');
    }
    this.prev[0] = n[0];
    this.prev[1] = n[1];
    this.prev[2] = n[2];
    this.onBody = true;
  }

  release(): void {
    this.onBody = false;
  }
}

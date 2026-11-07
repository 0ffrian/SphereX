// Issue #42, Q-68 "shader time": simulation time grows without bound (x1000 and more), and a
// float32 time starts to step visibly after a while. The CPU therefore reduces time to bounded
// phases in double precision and the shader only ever sees the reduced values.
//
// Flow-map cross-fade: a pattern that is sheared or advected for ever would stretch into streaks.
// Two copies of it run half a period apart, each reset when its weight is 0, and the picture is
// their weighted mix. The weights are triangle waves, so the reset is never seen.

export interface PhasePair {
  /** Time since the last reset of copy A and of copy B, in the same unit as `t`, 0..period. */
  a: number;
  b: number;
  /** Weight of copy A, 0..1. Copy B has 1 - w. */
  w: number;
}

/** Phases of the two copies at time `t` for a reset period `period` (both > 0). Pure. */
export function phasePair(t: number, period: number): PhasePair {
  if (!(period > 0) || !Number.isFinite(t)) return { a: 0, b: 0, w: 1 };
  const f = (((t / period) % 1) + 1) % 1;
  const fb = (f + 0.5) % 1;
  return { a: f * period, b: fb * period, w: 1 - Math.abs(2 * f - 1) };
}

/** `t` reduced to [0, period) (a plain wrap, for angles and cycles that are periodic anyway). */
export function wrap(t: number, period: number): number {
  if (!(period > 0) || !Number.isFinite(t)) return 0;
  return ((t % period) + period) % period;
}

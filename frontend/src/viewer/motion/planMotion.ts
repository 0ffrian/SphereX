// Issue #42, D-32: helpers the planners use to add the layers the VIEWER decides (the surface
// layers of a star, the jets of a brown dwarf) and to say what moves. Pure: no three.js.
//
// Stage 6 (the backend half, Q-60) does not build these layers yet, so the viewer states them
// itself with the tier its own rule earns, never a stronger one. A layer the backend does offer
// under the same id wins (`offerLayer` keeps it): the backend's tier is then the one shown.
import type { Layer, Tag } from '@/contract';
import type { PlanBuilder } from '../planCommon';
import type { SpinPlan } from '../planTypes';
import { TIER_OF_TAG, processOf, type Motion } from './motion';

/** WCAG 2.3.1 / R5.7: nothing spins faster than this many revolutions per real second. */
export const MAX_SPIN_REV_PER_S = 1;

/** A layer the viewer states, with the tier its tag fixes (R3.4). */
export function viewerLayer(
  id: string,
  tag: Tag,
  description: string,
  extra: { requires?: string[]; formula?: string; assumed?: Layer['assumed'] } = {},
): Layer {
  return {
    id,
    tag,
    tier: TIER_OF_TAG[tag],
    description,
    requires: extra.requires ?? [],
    ...(extra.formula ? { formula: extra.formula } : {}),
    ...(extra.assumed ? { assumed: extra.assumed } : {}),
  };
}

/** Adds the layer unless the backend already offers one with this id (the backend's tier wins). */
export function offerLayer(b: PlanBuilder, layer: Layer): void {
  if (!b.layers.has(layer.id)) b.layers.set(layer.id, layer);
}

/**
 * Lists the motion rates no rung could answer (`dynamics:<key>`) as not drawn, so the panel says
 * why a body is rigid or still. With no `dynamics` at all nothing is listed (R3.4: absent means no
 * motion data and the body stays still); the plan note says so.
 */
export function listMotion(b: PlanBuilder, motion: Motion): void {
  for (const m of motion.missing) b.refuse(m);
  b.notes.push(...motion.notes);
}

/**
 * The speed-up shown and drawn for the spin: the one the card states, lowered when the drawn spin
 * would pass `MAX_SPIN_REV_PER_S` (the same limit as the asteroid spin, R7.1). Rounded down to two
 * significant figures so the label stays readable; the label is always this value.
 */
export function cappedSpinSpeedup(requested: number, periodH: number): number {
  const revPerS = requested / (periodH * 3600);
  if (!(revPerS > MAX_SPIN_REV_PER_S)) return requested;
  const capped = (requested * MAX_SPIN_REV_PER_S) / revPerS;
  const step = 10 ** (Math.floor(Math.log10(capped)) - 1);
  return Number((Math.floor(capped / step) * step).toPrecision(2));
}

/** The spin plan of a body whose spin is animated, else null. */
export function spinPlanOf(motion: Motion): SpinPlan | null {
  const proc = processOf(motion, 'spin');
  const rate = motion.rates.spin_period_h;
  if (!proc || !rate) return null;
  return { periodH: rate.value, speedup: cappedSpinSpeedup(proc.speedup, rate.value) };
}

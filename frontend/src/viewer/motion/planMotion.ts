// Issue #42, D-32: helpers the planners use to add the layers the VIEWER decides (the surface
// layers of a star, the jets of a brown dwarf) and to say what moves. Pure: no three.js.
//
// Stage 6 (the backend half, Q-60) does not build these layers yet, so the viewer states them
// itself with the tier its own rule earns, never a stronger one. A layer the backend does offer
// under the same id wins (`offerLayer` keeps it): the backend's tier is then the one shown.
import type { Layer, Tag } from '@/contract';
import type { PlanBuilder } from '../planCommon';
import type { RenderPlan, SpinPlan } from '../planTypes';
import type { ClockProcess } from '../render/clock';
import { TIER_OF_TAG, processOf, type Motion, type ProcessId } from './motion';

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

/**
 * The processes that drive something DRAWN in this plan (D-21, D-34), in clock order. A process the
 * card animates but whose layer is hidden (honesty level, view mode, a refused layer) is not
 * listed: it is not registered on the clock, has no note and does not keep the frame loop running.
 *   spin       the spin plan exists (a body with a surface to turn),
 *   spots      moving spot groups drawn (star spots, faculae or loops) and the spot clock is real,
 *   flares     flares drawn and the star has a flare rate,
 *   winds      a jets layer (brown dwarf, gas giant) or a cloud layer (planet) is drawn,
 *   clouds     the same jets surface, whose cloud detail evolves on its own clock,
 *   pulsation  the pulsation plan exists.
 */
export function activeProcessesOf(plan: RenderPlan): ProcessId[] {
  const m = plan.motion;
  const drawn = (id: string) => plan.drawn.some((d) => d.id === id);
  const out: ProcessId[] = [];
  for (const p of m.processes) {
    let on = false;
    switch (p.id) {
      case 'spin':
        on = plan.spin !== null;
        break;
      case 'spots': {
        const s = plan.star;
        on = s !== null && (s.spots || s.faculae || s.prominences) && !s.rates.frozen;
        break;
      }
      case 'flares':
        on = plan.star !== null && plan.star.flares && plan.star.rates.flareRatePerS > 0;
        break;
      case 'winds':
        on = drawn('jets') || drawn('clouds');
        break;
      case 'clouds':
        on = drawn('jets');
        break;
      case 'pulsation':
        on = plan.pulsation !== null;
        break;
    }
    if (on) out.push(p.id);
  }
  return out;
}

/** Fills `motion.activeProcesses` from what the finished plan draws. Called once by `planRender`. */
export function finishMotion(plan: RenderPlan): RenderPlan {
  const active = activeProcessesOf(plan);
  return { ...plan, motion: { ...plan.motion, activeProcesses: active } };
}

/**
 * What the clock runs for this plan, for the panel's notes and its pause control: the spin (with the
 * speed-up the plan may have lowered) and every active process, each with the tag and tier of the
 * rates it runs on. The viewer registers exactly this on its clock (`ViewerApp.syncProcesses`).
 */
export function timeLapsesOf(plan: RenderPlan): ClockProcess[] {
  const out: ClockProcess[] = [];
  for (const p of plan.motion.processes) {
    if (p.id === 'spin') {
      if (plan.spin)
        out.push({
          id: 'spin',
          label: p.label,
          speedup: plan.spin.speedup,
          tag: p.tag,
          tier: p.tier,
        });
    } else if (plan.motion.activeProcesses.includes(p.id)) {
      out.push({ id: p.id, label: p.label, speedup: p.speedup, tag: p.tag, tier: p.tier });
    }
  }
  // A spin with no rate record (the asteroids spin from their own card field): no tag to state.
  if (plan.spin && !out.some((t) => t.id === 'spin'))
    out.unshift({ id: 'spin', label: 'Spin', speedup: plan.spin.speedup });
  return out;
}

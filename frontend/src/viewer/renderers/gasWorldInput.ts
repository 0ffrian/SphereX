// Issue #71 stream E: which gas giants run as a solved world, and with what input. Pure (no three.js)
// so the plan can use it. A missing value refuses the world and the plain ShaderBody draws (never blank).
import type { ObjectCard, RenderParams } from '@/contract';
import { gasModel, PACE_DAY_S_PER_S, PACE_SLOW_S_PER_S, type GasInput, type ReferenceGasId } from '@/physics/gasDynamics';
import { STILL_MOTION, type Motion, type ProcessPlan } from '../motion/motion';
import { sliderValue, type Overrides } from '../sliders';

/**
 * Card ids of the reference gas giants (Q-251). ASSUMPTION: the backend registry
 * (`backend/assets/reference_objects.toml`) names them `ref-jupiter` and `ref-saturn`.
 */
export const REFERENCE_IDS: Readonly<Record<string, ReferenceGasId>> = {
  'ref-jupiter': 'jup',
  'ref-saturn': 'sat',
};

/**
 * Internal-heat temperature and mean molecular weight of the references (not on a card).
 * [verify] Tint: Jupiter radiates about 1.67 times what it absorbs (Li et al. 2018), so
 * Tint = Teq (1.67 - 1)^(1/4) = 99 K; Saturn's excess in the literature gives about 77 K at the low
 * end. They feed only the cloud-top temperature (scale height, storm size), not the band positions.
 */
const REFERENCE_HEAT: Record<ReferenceGasId, { tintK: number; mu: number }> = {
  jup: { tintK: 99, mu: 2.3 },
  sat: { tintK: 77, mu: 2.1 },
};

/** A giant with no measured spin and an orbit shorter than this is taken as tidally locked (Q-251, ASSUMPTION). */
const LOCKED_BELOW_PERIOD_D = 30;
/** Mean molecular weight of a hydrogen-helium atmosphere, g/mol (solar composition about 2.3). [verify] */
const MU_HYDROGEN_HELIUM = 2.3;

function numberOf(card: ObjectCard, field: string): number | null {
  const v = (card as unknown as Record<string, { value?: unknown } | undefined>)[field];
  return typeof v?.value === 'number' && Number.isFinite(v.value) ? v.value : null;
}

/**
 * The solver input for a card, or null when a value it needs is missing. Needs radius, mass,
 * equilibrium temperature and a spin period (the card's `rot_period_h`, else the `dynamics` spin).
 */
export function gasWorldInput(card: ObjectCard, params: RenderParams): GasInput | null {
  if (card.type !== 'gas_giant' || params.type !== 'gas_giant') return null;
  const reference = REFERENCE_IDS[card.id] ?? null;
  const radiusRj = numberOf(card, 'radius_rjup');
  const massEarth = numberOf(card, 'mass_mearth');
  const teqK = numberOf(card, 'teq_K');
  const dyn = (params.dynamics as { spin_period_h?: { value?: unknown } } | undefined)?.spin_period_h;
  const dynSpin = typeof dyn?.value === 'number' && Number.isFinite(dyn.value) ? dyn.value : null;
  const measuredSpin = numberOf(card, 'rot_period_h');
  const orbit = numberOf(card, 'orbital_period_d');
  // ASSUMPTION (Q-251): a giant with no measured spin and an orbit under 30 days is tidally locked,
  // so its spin is its orbital period. `model_dependent`, never `measured`.
  const locked = !reference && measuredSpin === null && orbit !== null && orbit < LOCKED_BELOW_PERIOD_D;
  const rotPeriodH = locked ? orbit * 24 : (measuredSpin ?? dynSpin);
  if (radiusRj === null || massEarth === null || teqK === null || rotPeriodH === null) return null;
  const heat = reference ? REFERENCE_HEAT[reference] : null;
  const input: GasInput = {
    reference,
    radiusRj,
    massEarth,
    rotPeriodH,
    teqK,
    tintK: heat?.tintK ?? null,
    mu: heat?.mu ?? MU_HYDROGEN_HELIUM,
    seed: params.seed,
    locked,
  };
  return gasModel(input) ? input : null;
}

/** Planet seconds per real second: 5 minutes by default, one day when the `gas_pacing` slider is 1. */
export function gasPacing(overrides: Overrides | undefined): number {
  return sliderValue(overrides, 'gas_pacing', 'gas_giant') === 1 ? PACE_DAY_S_PER_S : PACE_SLOW_S_PER_S;
}

/**
 * Adds the `winds` clock process of a solved gas world to the plan's motion: its speed-up is the
 * pacing (a display choice, labelled as a time-lapse), and it runs on the model, so `model_dependent`.
 * Returns the motion unchanged when the giant does not run as a solved world.
 */
export function withGasWorldMotion(
  motion: Motion,
  card: ObjectCard,
  params: RenderParams,
  overrides?: Overrides,
): Motion {
  if (!gasWorldInput(card, params)) return motion;
  const winds: ProcessPlan = {
    id: 'winds',
    label: 'Winds and clouds',
    speedup: gasPacing(overrides),
    tag: 'model_dependent',
    tier: 3,
    rates: [],
  };
  return {
    ...(motion ?? STILL_MOTION),
    processes: [...motion.processes.filter((p) => p.id !== 'winds'), winds],
  };
}

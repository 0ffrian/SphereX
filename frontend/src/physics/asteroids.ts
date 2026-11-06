// A7.4 Asteroids: minimum elongation from the light-curve amplitude, and the rubble-pile spin
// barrier. Asteroids are baked (D-01); by D-26 only the spin sliders (period, and bulk density,
// which only moves the barrier; Q-43) feed these.
import type { ObjectCard } from '@/contract';
import { G, HOUR_S } from './constants';
import type { Overrides } from './sliders';
import { derive, InputReader, positive, ResultBuilder, type PhysicsResult } from './tagging';

// Bulk density comes from the slider only. The A7.4 example uses 2,000 kg/m^3, but that is an
// example, not a measured value for any body, so no default is applied (refuse rather than invent).
// [verify] whether a class-based default density may be used (it would be inferred_from_analog).

/** `a / b = 10^(delta_m / 2.5)`, from `delta_m = 2.5 * log10(a / b)`. A lower limit (side-on). */
export function minElongation(amplitudeMag: number): number | null {
  if (!Number.isFinite(amplitudeMag) || amplitudeMag < 0) return null;
  return Math.pow(10, amplitudeMag / 2.5);
}

/** Rubble-pile spin limit `P = sqrt(3 pi / (G rho))`, in hours (rho in kg/m^3). */
export function spinLimitH(densityKgM3: number): number | null {
  if (!positive(densityKgM3)) return null;
  return Math.sqrt((3 * Math.PI) / (G * densityKgM3)) / HOUR_S;
}

const S = 'A7.4';

export function deriveAsteroid(card: ObjectCard, overrides: Overrides): PhysicsResult {
  const r = new InputReader(card, overrides);
  const out = new ResultBuilder();

  const amp = r.readCard('lightcurve_amp_mag');
  if (amp) {
    out.put('elongation_min', minElongation(amp.value), [amp], {
      section: S,
      formula: 'a/b >= 10^(delta_m / 2.5), from delta_m = 2.5 log10(a/b) (side-on, a lower limit)',
    });
  } else {
    out.refuse('elongation_min', ['lightcurve_amp_mag']);
  }

  const rho = r.read('bulk_density_kg_m3');
  const period = r.read('rot_period_h', 'rot_period_h');
  const limit = rho ? spinLimitH(rho.value) : null;
  if (rho && limit !== null) {
    const limitTv = derive(limit, [rho], { section: S, formula: 'P_min = sqrt(3 pi / (G rho))' });
    out.set('spin_limit_h', limitTv);

    if (period) {
      out.set(
        'faster_than_spin_limit',
        derive(period.value < limit, [period, rho], {
          section: S,
          formula:
            'P_rot < sqrt(3 pi / (G rho)): a rubble pile would fly apart, so the body needs strength',
        }),
      );
    } else {
      out.refuse('faster_than_spin_limit', ['rot_period_h']);
    }
  } else {
    out.refuse('spin_limit_h', ['bulk_density_kg_m3']);
    out.refuse(
      'faster_than_spin_limit',
      period ? ['bulk_density_kg_m3'] : ['bulk_density_kg_m3', 'rot_period_h'],
    );
  }

  return out.build(r);
}

// A7.5 Supernova remnants: Sedov-Taylor radius. Drawn by the `nova` shell-remnant kind (A6);
// ASSUMPTION: A7.5 applies to `nova` bodies (Q-44). Every input is a slider, and D-12 makes every
// value on this slider-only kind `artistic`, so the outputs carry that tag (the formula is kept).
// The phases (free expansion, Sedov, radiative) need transition times A7.5 does not give, so no
// phase is computed.
import type { ObjectCard } from '@/contract';
import type { Overrides } from './sliders';
import { InputReader, need, positive, ResultBuilder, type PhysicsResult } from './tagging';

// The SI form `R = 1.15 * (E t^2 / rho)^(1/5)` is not used by the app; the test checks it against
// this typical form, which is the one shown to users.

/** A7.5 typical form: `R ~ 12.4 pc * (E51 / n)^(1/5) * (t / 10^4 yr)^(2/5)`. */
export const SEDOV_TYPICAL_PC = 12.4;

/** `R ~ 12.4 pc * (E51 / n)^(1/5) * (t / 10^4 yr)^(2/5)`; parsecs. */
export function sedovRadiusPc(energyE51: number, densityCm3: number, ageYr: number): number | null {
  if (!positive(energyE51, densityCm3, ageYr)) return null;
  return SEDOV_TYPICAL_PC * Math.pow(energyE51 / densityCm3, 1 / 5) * Math.pow(ageYr / 1e4, 2 / 5);
}

const S = 'A7.5';

export function deriveSnr(card: ObjectCard, overrides: Overrides): PhysicsResult {
  const r = new InputReader(card, overrides);
  const out = new ResultBuilder();

  const ins = need({
    age_yr: r.read('age_yr'),
    energy_e51: r.read('energy_e51'),
    ambient_density_cm3: r.read('ambient_density_cm3'),
  });
  if (ins.ok) {
    const { age_yr: t, energy_e51: e, ambient_density_cm3: n } = ins.v;
    out.put('sedov_radius_pc', sedovRadiusPc(e.value, n.value, t.value), [t, e, n], {
      section: S,
      formula: 'R ~ 12.4 pc * (E51 / n)^(1/5) * (t / 10^4 yr)^(2/5) (Sedov-Taylor)',
      artistic: true,
    });
  } else {
    out.refuse('sedov_radius_pc', ins.absent);
  }

  return out.build(r);
}

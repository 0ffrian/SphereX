// Issue #71 stream D (D-36, Q-240): turns an exoplanet's card and the visitor's sliders into the
// inputs of the world model (physics/climateBudget.ts), with the provenance of each. Pure. A card
// that lacks the star or the orbit is REFUSED here (nothing is invented) and the viewer keeps the
// older planet look (`missing` names what the world model needed).
import type { ObjectCard, Tag } from '@/contract';
import {
  DEFAULT_BOND_ALBEDO,
  DEFAULT_FLUID,
  DEFAULT_MOLAR_MASS,
  DEFAULT_PRESSURE_BAR,
  type WorldInputSources,
  type WorldInputs,
  type WorldTag,
} from '@/physics/climateBudget';
import { FLUID_ORDER, type FluidId } from '@/physics/fluids';
import { InputReader } from '@/physics/tagging';
import { R_EARTH_M, R_JUP_M } from '@/physics/constants';
import { rockyMassForRadius } from '@/physics/zeng2019';
import { deriveLocking } from '@/physics/tides';
import { sliderValue, type Overrides } from '../sliders';
import type { WorldParams, WorldTier } from './worldGenerator';

/** Earth mass, kg (IAU 2015 nominal GM_E / G; the same GM_E the physics layer uses). */
const M_EARTH_KG = 5.972168e24;
/** Ocean share of the surface for a water world: Earth's 71% (NASA Earth Fact Sheet). ASSUMPTION (D-36). */
export const WATER_WORLD_OCEAN_FRACTION = 0.7;
/** A rocky (dry) planet has no ocean basin. ASSUMPTION: no card field says otherwise. */
export const ROCKY_OCEAN_FRACTION = 0;

export type WorldResolution =
  | {
      ok: true;
      params: WorldParams;
      sources: WorldInputSources;
      /** Plain-words assumptions that went into it, for the notes (each is `model_dependent` or weaker). */
      assumptions: string[];
      showPlates: boolean;
    }
  | { ok: false; missing: string[] };

const asWorld = (t: Tag): WorldTag => t;

/**
 * `kind` is the planet kind of the plan. `tier` is the viewer's quality level: `low` gives the
 * reduced phone world (R5.7, brief).
 */
export function resolveWorld(
  card: ObjectCard,
  kind: 'planet_rocky' | 'planet_water',
  seed: number,
  overrides: Overrides,
  tier: WorldTier,
): WorldResolution {
  const reader = new InputReader(card, overrides);
  const teff = reader.read('star_teff_K', 'host_teff_K');
  const rad = reader.read('star_radius_rsun', 'host_radius_rsun');
  const orbit = reader.read('semi_major_axis_au', 'orbit_au');
  const radiusRj = reader.read('radius_rjup', 'radius_rjup');
  const missing: string[] = [];
  if (!teff) missing.push('host_teff_K');
  if (!rad) missing.push('host_radius_rsun');
  if (!orbit) missing.push('orbit_au');
  if (!radiusRj) missing.push('radius_rjup');
  if (missing.length || !teff || !rad || !orbit || !radiusRj) return { ok: false, missing };

  const assumptions: string[] = [];
  const radiusM = radiusRj.value * R_JUP_M;
  let massTag: WorldTag;
  let massE: number;
  const massIn = reader.read('mass_mearth', 'mass_mearth');
  if (massIn) {
    massE = massIn.value;
    massTag = asWorld(massIn.tag);
  } else {
    const m = rockyMassForRadius(radiusM / R_EARTH_M);
    if (m === null) return { ok: false, missing: ['mass_mearth'] };
    massE = m;
    massTag = 'model_dependent';
    assumptions.push(
      `mass ${m.toPrecision(3)} Earth masses: the Earth-like rocky mass for the radius (Zeng et al. 2019)`,
    );
  }

  const albedoIn = reader.read('bond_albedo');
  let albedoTag: WorldTag = 'model_dependent';
  if (albedoIn) albedoTag = asWorld(albedoIn.tag);
  else assumptions.push(`Bond albedo ${DEFAULT_BOND_ALBEDO} assumed (Earth's)`);

  // Surface pressure and fluid: a slider is the visitor's setting (`artistic`); else the card's own
  // value with its own tag (Titan: Huygens and Cassini, issue #71 Q-285); else the Earth-like
  // assumption (`model_dependent`).
  const pressureSet = sliderValue(overrides, 'surface_pressure_bar', kind);
  const cardP = card.surface_pressure_bar;
  const cardPValue =
    pressureSet === undefined && typeof cardP?.value === 'number' && cardP.value > 0 ? cardP.value : null;
  if (pressureSet === undefined && cardPValue === null)
    assumptions.push(`surface pressure ${DEFAULT_PRESSURE_BAR} bar assumed (not measured for any exoplanet)`);
  const fluidIdx = sliderValue(overrides, 'surface_fluid', kind);
  const cardFluidName = card.surface_fluid?.value;
  const cardFluid = FLUID_ORDER.find((id) => id === cardFluidName);
  const cardFluidUsed = fluidIdx === undefined && cardFluid !== undefined ? cardFluid : null;
  const fluid: FluidId =
    fluidIdx !== undefined
      ? (FLUID_ORDER[Math.round(fluidIdx)] ?? DEFAULT_FLUID)
      : (cardFluidUsed ?? DEFAULT_FLUID);
  if (fluidIdx === undefined && cardFluidUsed === null)
    assumptions.push('surface fluid is water, assumed (not measured for any exoplanet)');

  // Locked or not: the tidal rule of the physics layer (Q-155). A refused rule is "not known to be locked".
  const lock = deriveLocking(card);
  const locked = lock.ok && lock.locked;
  if (!lock.ok) assumptions.push('tidal locking could not be tested (a needed value is missing); modelled as turning');
  const periodIn = reader.read('rot_period_h', 'rot_period_h');
  const orbitPeriodD = card.orbital_period_d?.value;
  let rotPeriodD = 1;
  if (locked && typeof orbitPeriodD === 'number' && orbitPeriodD > 0) rotPeriodD = orbitPeriodD;
  else if (!locked && periodIn) rotPeriodD = periodIn.value / 24;
  else assumptions.push('rotation period 1 day assumed (it only sets the wind speed in the model)');

  const sliders = (['star_teff_K', 'semi_major_axis_au', 'bond_albedo', 'surface_pressure_bar', 'surface_fluid', 'mass_mearth', 'star_radius_rsun'] as const).filter(
    (k) => sliderValue(overrides, k, kind) !== undefined,
  );
  const inputs: WorldInputs = {
    starTeffK: teff.value,
    starRadiusRsun: rad.value,
    orbitAu: orbit.value,
    radiusM,
    massKg: massE * M_EARTH_KG,
    bondAlbedo: albedoIn?.value ?? DEFAULT_BOND_ALBEDO,
    pressureBar: pressureSet ?? cardPValue ?? DEFAULT_PRESSURE_BAR,
    fluid,
    locked,
    rotPeriodD,
    molarMass: DEFAULT_MOLAR_MASS,
  };
  const oceanFraction = kind === 'planet_water' ? WATER_WORLD_OCEAN_FRACTION : ROCKY_OCEAN_FRACTION;
  assumptions.push(
    kind === 'planet_water'
      ? `ocean covers ${Math.round(WATER_WORLD_OCEAN_FRACTION * 100)}% of the surface (assumed) and plate tectonics is assumed`
      : 'dry surface and plate tectonics are assumed',
  );
  return {
    ok: true,
    params: { seed, inputs, oceanFraction, tier },
    sources: {
      star: asWorld(teff.tag),
      orbit: asWorld(orbit.tag),
      planet: weakestOf([asWorld(radiusRj.tag), massTag]),
      albedo: albedoTag,
      pressure: pressureSet !== undefined ? 'artistic' : cardPValue !== null ? asWorld(cardP!.tag) : 'model_dependent',
      fluid: fluidIdx !== undefined ? 'artistic' : cardFluidUsed !== null ? asWorld(card.surface_fluid!.tag) : 'model_dependent',
      sliders,
    },
    assumptions,
    showPlates: sliderValue(overrides, 'show_plates', kind) === 1,
  };
}

const ORDER: readonly WorldTag[] = ['measured', 'derived', 'model_dependent', 'inferred_from_analog', 'artistic'];
function weakestOf(tags: readonly WorldTag[]): WorldTag {
  let w = 0;
  for (const t of tags) w = Math.max(w, ORDER.indexOf(t));
  return ORDER[w]!;
}

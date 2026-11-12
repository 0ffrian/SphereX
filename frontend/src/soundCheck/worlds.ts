// R13.9 sound check: the worlds the page plays. Two sources with the same shape (blue 26):
//  - fixture: AirModel and place built from the ambience test fixtures (no WebGL; opens at once). ASSUMPTION: dev
//    only; the numbers are the fixtures' stated test conditions, not a world's data.
//  - engine: one hidden WorldEngine reused for every preset (red M17), settled, fly view on, then buildAirModel and
//    samplePlace exactly as the app does. ASSUMPTION: the CardToWorldOk is built from the preset with no card tags.
import type { WorldEngine } from '@/engine/worlds/WorldEngine';
import { WP } from '@/engine/worlds/presets.js';
import { buildAirModel } from '@/sound/ambience/airModel';
import {
  earthAir,
  makeAir,
  makePlace,
  makeWind,
  makeWorld,
  marsAir,
  titanAir,
  venusAir,
} from '@/sound/ambience/fakeEngine.testutil';
import { markCoast, samplePlace, type WorldEngineWithSpinup } from '@/sound/ambience/place';
import type { AirModel, Place, PlaceFeatures, SampleClass } from '@/sound/ambience/types';
import { windAt } from '@/sound/ambience/wind';
import './marker';

export interface CheckWorld {
  id: string;
  label: string;
  source: 'fixture' | 'engine';
  air: AirModel;
  place: Place;
}

/** Demo order first (the stage script), then the rest. */
export const DEMO_PRESETS = ['earth', 'tit', 'lava', 'jup', 'rivers'] as const;

function placeOf(
  z_km: number,
  cls: (bearing: number, s_km: number) => SampleClass,
  f: Partial<PlaceFeatures> = {},
): Place {
  const p = makePlace(z_km, ({ bearing, s_km }) => ({ cls: cls(bearing, s_km) }), f);
  markCoast(p.samples);
  return p;
}

const south = (b: number) => b > Math.PI / 2 && b < (3 * Math.PI) / 2;

export function fixtureWorlds(): CheckWorld[] {
  const coast = placeOf(0.05, (b) => (south(b) ? 'sea' : 'land'), {
    wind: makeWind({ U10: 9, Uz: 9 }),
  });
  const storm = placeOf(0.3, () => 'land', {
    wind: makeWind({ U10: 14, Uz: 15, Iu: 0.3 }),
    exposure: 0.6,
    relief: 0.8,
    rainRate: 1.2,
    precipPhase: 'rain',
    cnv: 0.8,
    stormNear: 0.8,
  });
  const titanSea = placeOf(0.05, (b) => (south(b) ? 'sea' : 'land'), {
    wind: makeWind({ U10: 1.5, Uz: 1.5 }),
    Tloc: 94,
  });
  const mars = placeOf(0.05, () => 'land', { wind: makeWind({ U10: 8, Uz: 8 }), Tloc: 210 });
  const venus = placeOf(0.05, () => 'land', { wind: makeWind({ U10: 1, Uz: 1 }), Tloc: 737 });
  const lavaAir = makeAir({
    T0: 1800,
    P0: 500,
    mu: 40,
    fluid: 'water',
    lavaWorld: true,
    liquidState: false,
    oceanF: 0,
    presetId: 'lava',
  });
  const lava = placeOf(0.1, (b, s) => (s < 2 ? 'crust' : south(b) ? 'lava' : 'crust'), {
    wind: makeWind({ U10: 6, Uz: 6 }),
    Tloc: 1800,
  });
  const jupAir = makeAir({
    T0: 165,
    P0: 1e5,
    mu: 2.33,
    gas: true,
    fluid: 'ammonia',
    presetId: 'jup',
    gv: 24.8,
    H_km: 27,
  });
  const jup = placeOf(1, () => 'land', {
    wind: makeWind({ U10: 60, Uz: 60, parts: [{ kind: 'jet', U: 60 }] }),
    Tloc: 165,
  });
  return [
    {
      id: 'fx-earth-coast',
      label: 'Earth: coast, moderate wind (fixture)',
      source: 'fixture',
      air: earthAir(),
      place: coast,
    },
    {
      id: 'fx-earth-storm',
      label: 'Earth: ridge in a rain storm (fixture)',
      source: 'fixture',
      air: earthAir(),
      place: storm,
    },
    {
      id: 'fx-titan',
      label: 'Titan-like: methane sea shore (fixture)',
      source: 'fixture',
      air: titanAir({ presetId: 'tit' }),
      place: titanSea,
    },
    {
      id: 'fx-mars',
      label: 'Mars-like: thin CO2 air (fixture)',
      source: 'fixture',
      air: marsAir({ presetId: 'mars-like' }),
      place: mars,
    },
    {
      id: 'fx-venus',
      label: 'Venus-like: thick CO2 air (fixture)',
      source: 'fixture',
      air: venusAir({ presetId: 'venus-like' }),
      place: venus,
    },
    { id: 'fx-lava', label: 'Lava world (fixture)', source: 'fixture', air: lavaAir, place: lava },
    {
      id: 'fx-jupiter',
      label: 'Jupiter-like gas giant (fixture)',
      source: 'fixture',
      air: jupAir,
      place: jup,
    },
  ];
}

export function enginePresets(): { id: string; label: string }[] {
  const rank = (id: string) => {
    const i = (DEMO_PRESETS as readonly string[]).indexOf(id);
    return i < 0 ? 99 : i;
  };
  return WP.map((p) => ({ id: p.id, label: p.label })).sort((a, b) => rank(a.id) - rank(b.id));
}

/** Listener heights the page offers. 'low' is the fly view's floor (0.3 km rocky, 50 km gas giant). */
export type CheckAlt = 'low' | '2' | '10' | '400';
export const CHECK_ALTS: { id: CheckAlt; label: string }[] = [
  { id: 'low', label: 'Lowest (0.3 km; 50 km on a gas giant)' },
  { id: '2', label: '2 km' },
  { id: '10', label: '10 km' },
  { id: '400', label: '400 km (where fly view starts: silent, no air)' },
];

const nextFrame = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Load one preset on the shared hidden engine and build its air and place as the app does.
 * The spin-up runs in slices of about 50 ms with a yield between them, so the page keeps painting (engine.settle()
 * ran it in one synchronous block of about 7 s on Earth). setFly(true) puts the camera at 400 km (6000 km on a
 * giant), where there is no air to hear; the listener is moved to `alt` before the place is sampled.
 */
export async function engineWorld(
  engine: WorldEngine,
  presetId: string,
  alt: CheckAlt = 'low',
  onProgress?: (msg: string) => void,
): Promise<CheckWorld | { error: string }> {
  const preset = WP.find((p) => p.id === presetId);
  if (!preset) return { error: `Unknown preset ${presetId}` };
  onProgress?.(`Building ${preset.label}…`);
  await nextFrame();
  engine.setPreset(preset);
  const total = Math.max(1, engine.spinup);
  for (let guard = 0; engine.spinup > 0 && guard < 100000;) {
    const t0 = performance.now();
    while (engine.spinup > 0 && performance.now() - t0 < 50 && guard < 100000) {
      engine.tick(0.016);
      guard++;
    }
    onProgress?.(
      `Forming ${preset.label}: ${Math.round((100 * (total - engine.spinup)) / total)} %`,
    );
    await nextFrame();
  }
  engine.setFly(true);
  const [lo, hi] = engine.altRange();
  const km = alt === 'low' ? lo : Math.min(hi, Math.max(lo, Number(alt)));
  engine.setFlyAlt(km);
  const air = buildAirModel(makeWorld(preset), engine);
  const place = samplePlace(engine as unknown as WorldEngineWithSpinup, air, windAt);
  if (!place) return { error: 'The world is still forming (spin-up); try again.' };
  const altLabel = km < 1 ? `${Math.round(km * 1000)} m` : `${km} km`;
  return {
    id: `engine-${presetId}-${km}`,
    label: `${preset.label} at ${altLabel} (engine)`,
    source: 'engine',
    air,
    place,
  };
}

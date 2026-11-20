// §12.2 live caption model and the §12.3 air facts. Pure; the 3 s throttle and the live region belong to T6.
//
// SINGLE SOURCE OF USER-FACING TEXT. Every string the ambience shows (refusals, data gaps, phrases, notes, facts) is
// defined in this file; airModel.ts, sources.ts and weather.ts import (and re-export) them. Decisions implemented:
//   Q-436 source catalogue and gates (§7)       -> REFUSAL_TEXT.noAir/lavaNoAir/noLiquid, SOURCE_TEXT.whistle
//   Q-437 weather, lightning rule table (§8.2)  -> LIGHTNING_TEXT
//   Q-440 level model and presentation (§11.4)  -> levelNote
//   Q-442 UI, captions, "What you hear" (§12)   -> CEILING_TEXT, EYE_TEXT, phrases, airFacts
//   Q-447 ceiling caption with its height       -> ceilingCaption (N = H ln(P0/P_FLOOR), derived)
//   R6  acoustic air is P0 >= 1 Pa              -> noAir/lavaNoAir only below P_FLOOR
//   R7  liquid is local (canLiquid gated)       -> noLiquid, boiledAway
//   R8  presence before presentation            -> only present beds are captioned
//   R9  hurricane sanity                        -> EYE_TEXT, hurricane phrases
//   R10 flow-noise presentation                 -> levelNote follows the loudest bed's own true level
//   R11 lightning presets                       -> LIGHTNING_TEXT rows
//   R12 fields not ready                        -> REFUSAL_TEXT.waiting
// Strings marked "new" are not in the spec yet; they are proposed as Q- entries with the R13 docs (#111 / PR #121).
// Direction words come from the 8-point compass bearing of a membership-weighted centroid (R9 of R13: never pan alone).
import { bedWorldDb, ceilingKm, earthRef } from './air';
import type { AirModel, CaptionModel, MixFrame, Place, PlaceSample, SourceId } from './types';
import { CO2_ABS, CRUST_WEIGHT, LEVEL_NOTE_MIN_DB, RIVER_Q_REF, SILENT_DB } from './tuning';

// ---------- strings ----------

/** §7, §13 refusal and data-gap strings (exact). */
export const REFUSAL_TEXT = {
  /** §7 (R6: only below P_FLOOR, 1 Pa). */
  noAir: 'No air here, so there is no sound.',
  /** §7 (R6: only below P_FLOOR). */
  lavaNoAir: 'The magma glows, but with almost no air, it makes no sound you could hear.',
  /** §7 (R7: when the fluid cannot be liquid here or no open water exists). */
  noLiquid: 'No liquid can exist on the surface here, so there are no waves, rain or rivers.',
  /** §13. */
  dataGap: 'Sound needs the surface view.',
  /** New. */
  noSea: 'There is no sea on this world, so there are no waves.',
  /** New (R12): transient while the climate and rivers form; re-evaluated each tick. */
  waiting: 'Waiting for the world to form…',
  /** New: mirrors the engine's runaway readout. */
  boiledAway:
    'The ocean has boiled away (runaway greenhouse), so there are no waves, rain or rivers.',
  /** New. */
  noRivers: 'No rivers flow here.',
} as const;

/** §7 source-gate strings. `whistle` is the spec's; the rest are new. */
export const SOURCE_TEXT = {
  whistle: 'The air is too thin for small stones to whistle.',
  noWaves: 'The wind is too light to raise waves here.',
  noSand: 'The wind never gets strong enough to lift sand here.',
} as const;

/** §8.2 lightning refusal strings (exact). */
export const LIGHTNING_TEXT = {
  titan: 'No lightning has ever been detected on Titan, so there is no thunder here.',
  co2: 'Lightning on worlds like Venus and Mars is unconfirmed, so there is no thunder here.',
  other: 'Lightning needs storm clouds of water or ammonia; there are none here.',
} as const;

/** §4.1 ceiling caption (exact); ceilingCaption adds the Q-447 action with the height. */
export const CEILING_TEXT = 'Too high: the air here is too thin to carry sound.';

/** Two significant figures for a caption height (Q-447): 97.2 -> "97", 1234 -> "1200", 4.56 -> "4.6". */
export function sig2(x: number): string {
  return String(Number(x.toPrecision(2)));
}

/**
 * Q-447 (§4.1): the ceiling caption with what to do about it. N = H ln(P0 / P_FLOOR) (isothermal, derived: ceilingKm),
 * rounded to 2 significant figures (Earth about 97 km). Without a usable height the exact §4.1 text stands alone.
 */
export function ceilingCaption(air: AirModel): string {
  const n = ceilingKm(air);
  return n > 0 && Number.isFinite(n)
    ? `${CEILING_TEXT} Fly below about ${sig2(n)} km to hear it.`
    : CEILING_TEXT;
}

/** A plain name per source for refusal text (m5: never a raw id such as "S6" in front of the user). New. */
export const SOURCE_NAME: Record<SourceId, string> = {
  S1_land: 'the wind over land',
  S1_sea: 'the wind over the sea',
  S2: 'grit hissing in the wind',
  S3: 'wind whistling over the rocks',
  S4: 'the surf',
  S5: 'the open sea',
  S6: 'the rain',
  S7: 'the river',
  S8: 'the lava',
  S9: 'the hurricane winds',
  S10: 'the blowing sand',
  S12: 'the jet stream',
  thunder: 'the thunder',
};

/** Refusal text for a bed that could not be made (palette). New. */
export function bakeRefusalText(id: SourceId, why: string): string {
  return `The sound of ${SOURCE_NAME[id]} is unavailable: ${why}`;
}

/** Why the palette refused the beds it could not bake without a worker (m5). New. */
export const NO_WORKER_TEXT = 'the background sound maker did not start';
/** §12.2 eye caption (exact). */
export const EYE_TEXT = 'Calm eye of a hurricane';
/** New (blue F5b): lava is around the listener but its roar does not carry to this height. */
export const LAVA_GAP_TEXT = "The lava's roar does not carry through this thin air to your height.";

// ---------- shared helpers (here so no module needs to import levels or sources for text) ----------

const COMPASS = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
] as const;
/** 8-point compass name for a bearing in degrees. */
export function compass8(deg: number): (typeof COMPASS)[number] {
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return COMPASS[i] as (typeof COMPASS)[number];
}

/** Ground-class membership of one sample for a bed (§11.1): 0/1, a rain weight, a discharge weight. */
export function bedMembership(id: SourceId, s: PlaceSample, rainRate: number): number {
  switch (id) {
    case 'S4':
      return s.coast ? 1 : 0;
    case 'S5':
      return s.cls === 'sea' || s.cls === 'lake' ? 1 : 0; // ASSUMPTION: lakes count as open water
    case 'S6':
      return Math.max(0, Math.min(3, s.rain / Math.max(rainRate, 1e-3)));
    case 'S7':
      return s.cls === 'river' ? Math.max(0, s.riverQ) / RIVER_Q_REF : 0;
    case 'S8':
      return s.cls === 'lava' ? 1 : s.cls === 'crust' ? CRUST_WEIGHT : 0;
    case 'S10':
      return s.cls === 'land' ? 1 : 0;
    default:
      return 1;
  }
}

// ---------- phrases ----------

function windStrength(U: number): string {
  if (U < 1) return 'still air';
  if (U < 4) return 'light';
  if (U < 8) return 'steady';
  if (U < 14) return 'strong';
  if (U < 25) return 'gale-force';
  return 'storm-force';
}

function windPhrase(place: Place): string {
  const w = place.features.wind;
  const strength = windStrength(w.U10);
  if (strength === 'still air') return 'still air';
  const top = w.parts[0]?.kind ?? 'trade';
  const e = place.features.exposure;
  const terrain = e > 0.3 ? ' on a ridge' : e < -0.3 ? ' in a sheltered hollow' : '';
  // Red M5: the direction named is the dominant part's own. A breeze blows from the cooler side (sea breeze from the
  // sea centroid, land breeze from the land centroid); a hurricane's tangential flow is not computed, so no direction.
  if (top === 'hurricane') return `${strength} hurricane wind${terrain}`;
  if (top === 'breeze') {
    const land = place.samples.filter((s) => s.cls === 'land');
    const sea = place.samples.filter((s) => s.cls === 'sea');
    const mean = (a: typeof land) => a.reduce((t, s) => t + s.T, 0) / Math.max(a.length, 1);
    const seaBreeze = land.length > 0 && sea.length > 0 && mean(land) > mean(sea);
    const from = centroidBearing(seaBreeze ? sea : land);
    const kind = seaBreeze ? 'sea breeze' : 'land breeze';
    return from === null
      ? `${strength} ${kind}${terrain}`
      : `${strength} ${kind} from the ${compass8(from)}${terrain}`;
  }
  const kind = {
    trade: 'trade wind',
    westerly: 'westerly',
    polar: 'polar wind',
    terminator: 'terminator gale',
    jet: 'jet-stream wind',
  }[top];
  return `${strength} ${kind} from the ${compass8(w.dirDeg)}${terrain}`;
}

/** Area-weighted bearing (deg) of a set of samples, or null when they surround the listener. */
function centroidBearing(samples: Place['samples']): number | null {
  let sx = 0;
  let sy = 0;
  let tot = 0;
  for (const s of samples) {
    const w = s.area_m2 / Math.max(s.d_m * s.d_m, 1);
    sx += w * Math.sin(s.bearing);
    sy += w * Math.cos(s.bearing);
    tot += w;
  }
  if (!(tot > 0) || Math.hypot(sx, sy) < 0.2 * tot) return null;
  return (Math.atan2(sx, sy) * 180) / Math.PI;
}

/** Compass phrase for where a ground bed's sound comes from, or "all around". */
export function bedDirection(id: SourceId, place: Place): string {
  let sx = 0;
  let sy = 0;
  let tot = 0;
  for (const s of place.samples) {
    const w =
      (bedMembership(id, s, place.features.rainRate) * s.area_m2) / Math.max(s.d_m * s.d_m, 1);
    sx += w * Math.sin(s.bearing);
    sy += w * Math.cos(s.bearing);
    tot += w;
  }
  if (!(tot > 0) || Math.hypot(sx, sy) < 0.2 * tot) return 'all around';
  return `to the ${compass8((Math.atan2(sx, sy) * 180) / Math.PI)}`;
}

function bedPhrase(id: SourceId, place: Place): string {
  const f = place.features;
  switch (id) {
    case 'S1_land':
    case 'S1_sea':
      return windPhrase(place);
    case 'S2':
      return 'grit hissing in the wind';
    case 'S3':
      return 'wind whistling over the rocks';
    case 'S4':
      return `surf ${bedDirection('S4', place)}`;
    case 'S5':
      return `open sea ${bedDirection('S5', place)}`;
    case 'S6':
      return f.rainRate < 0.5 ? 'light rain' : f.rainRate < 1.5 ? 'steady rain' : 'heavy rain';
    case 'S7':
      return `a river ${bedDirection('S7', place)}`;
    case 'S8':
      return `lava roaring ${bedDirection('S8', place)}`;
    case 'S9':
      return 'hurricane winds';
    case 'S10':
      return 'blowing sand';
    case 'S12':
      return f.stormNear > 0.3
        ? 'the roar of the jet stream and its storms'
        : 'the roar of the jet stream';
    case 'thunder':
      return 'thunder';
  }
}

function weatherPhrase(place: Place): string | null {
  const f = place.features;
  if (f.precipPhase === 'snow' && f.rainRate > 0.05) return 'snow falling';
  if (f.snowCover > 0.5) return 'snow muffles the ground';
  return null;
}

/**
 * §11.4 "true level against Earth" note. `quieterDb` > 0 means the sound is quieter than the same source on Earth (and
 * was raised for the stage); < 0 louder (lowered). Rounded to the nearest 5 dB (ASSUMPTION), at least 5.
 */
export function levelNote(quieterDb: number): { note: string | null; short: string | null } {
  if (!(Math.abs(quieterDb) >= LEVEL_NOTE_MIN_DB)) return { note: null, short: null };
  const n = Math.max(5, Math.round(Math.abs(quieterDb) / 5) * 5);
  return quieterDb > 0
    ? {
        note: `Real level: about ${n} dB quieter than on Earth (raised so you can hear it)`,
        short: `real level about ${n} dB quieter than Earth`,
      }
    : {
        note: `Real level: about ${n} dB louder than on Earth (lowered)`,
        short: `real level about ${n} dB louder than Earth`,
      };
}

function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * §12.2 the caption model for one mixer frame. The level note is the TRUE level of the loudest present bed against the
 * same source on Earth, by the same rule playback uses (bedWorldDb: listener-height impedance for flow noise, R10).
 */
export function caption(air: AirModel, place: Place, frame: MixFrame): CaptionModel {
  const all = air.refusals.find((r) => r.source === 'all');
  const silentReason = all ? all.reason : frame.silent ? ceilingCaption(air) : null;
  if (silentReason) return { line: silentReason, heard: [], levelNote: null, silentReason };

  const live = frame.beds
    .filter((b) => b.gainDb > SILENT_DB + 1)
    .sort((a, b) => b.trueDb - a.trueDb);
  const topBed = live[0];
  const { note, short } = topBed
    ? levelNote(-bedWorldDb(air, place.features.z_km, topBed.id))
    : { note: null, short: null };
  const top = topBed?.trueDb ?? 0;
  const seen = new Set<string>();
  const heard: CaptionModel['heard'] = [];
  const hurricaneHeard = live.some((b) => b.id === 'S9');
  for (const b of live) {
    // Red L5: one wind, one phrase: when the hurricane bed plays, the rumble's own hurricane phrase is dropped.
    if (
      hurricaneHeard &&
      (b.id === 'S1_land' || b.id === 'S1_sea') &&
      place.features.wind.parts[0]?.kind === 'hurricane'
    )
      continue;
    const phrase = bedPhrase(b.id, place);
    if (seen.has(phrase)) continue;
    seen.add(phrase);
    heard.push({ id: b.id, phrase, relDb: b.trueDb - top });
  }
  if (place.features.cyclone?.inEye && air.Vmax !== null) {
    return {
      line: [EYE_TEXT, short].filter(Boolean).join(' · '),
      heard,
      levelNote: note,
      silentReason: null,
    };
  }
  const lavaHere = air.lavaWorld && place.samples.some((s) => s.cls === 'lava');
  const lavaGap =
    lavaHere && frame.beds.some((b) => b.id === 'S8') && !heard.some((h) => h.id === 'S8')
      ? LAVA_GAP_TEXT.charAt(0).toLowerCase() + LAVA_GAP_TEXT.slice(1, -1)
      : null;
  const parts = [heard[0]?.phrase, heard[1]?.phrase, weatherPhrase(place), lavaGap, short].filter(
    (p): p is string => !!p,
  );
  return { line: capitalise(parts.join(' · ')), heard, levelNote: note, silentReason: null };
}

/** §12.3 air facts for the "What you hear" panel (derived). */
export function airFacts(air: AirModel): { label: string; text: string }[] {
  if (!air.airOK) return [];
  const e = earthRef();
  const dB = 10 * Math.log10(air.Z0 / e.Z);
  const facts = [
    { label: 'Speed of sound', text: `${Math.round(air.c0)} m/s` },
    { label: 'Air density', text: `${air.rho0.toPrecision(3)} kg/m³` },
    {
      label: 'True level against Earth',
      text: `${dB >= 0 ? '+' : ''}${dB.toFixed(0)} dB for the same ground sound`,
    },
  ];
  const fr = Math.round((CO2_ABS.fr * air.P0) / CO2_ABS.pRef);
  // Red L8: the measured two-speed fact holds only at the thin (Mars) end of the CO2 model and inside the audible band.
  if (air.cls === 'CO2' && air.P0 <= CO2_ABS.pRef && fr >= 20 && fr <= 20000) {
    facts.push({
      label: 'Two speeds of sound',
      text: `Sound below about ${fr} Hz travels about 10 m/s slower than higher sounds`,
    });
  }
  return facts;
}

// §12.2 live caption model and the §12.3 air facts. Pure; the 3 s throttle and the live region belong to T6.
// Direction words come from the 8-point compass bearing of a bed's membership-weighted centroid (R9: never pan alone).
import { earthRef } from './air';
import { bedMembership } from './sources';
import type { AirModel, CaptionModel, MixFrame, Place, SourceId } from './types';
import { CO2_ABS, LEVEL_NOTE_MIN_DB, SILENT_DB } from './tuning';
import { compass8 } from './wind';

/** §4.1 ceiling caption (exact). */
export const CEILING_TEXT = 'Too high: the air here is too thin to carry sound.';
/** §12.2 eye caption (exact). */
export const EYE_TEXT = 'Calm eye of a hurricane';

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
  let kind: string;
  if (top === 'breeze') {
    const land = place.samples.filter((s) => s.cls === 'land');
    const sea = place.samples.filter((s) => s.cls === 'sea');
    const mean = (a: typeof land) => a.reduce((t, s) => t + s.T, 0) / Math.max(a.length, 1);
    kind = land.length && sea.length && mean(land) > mean(sea) ? 'sea breeze' : 'land breeze';
  } else {
    kind = { trade: 'trade wind', westerly: 'westerly', polar: 'polar wind', terminator: 'terminator gale', hurricane: 'hurricane wind', jet: 'jet-stream wind' }[top];
  }
  const e = place.features.exposure;
  const terrain = e > 0.3 ? ' on a ridge' : e < -0.3 ? ' in a sheltered hollow' : '';
  return `${strength} ${kind} from the ${compass8(w.dirDeg)}${terrain}`;
}

/** Compass phrase for where a ground bed's sound comes from, or "all around". */
export function bedDirection(id: SourceId, place: Place): string {
  let sx = 0;
  let sy = 0;
  let tot = 0;
  for (const s of place.samples) {
    const w = (bedMembership(id, s, place.features.rainRate) * s.area_m2) / Math.max(s.d_m * s.d_m, 1);
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
      return f.stormNear > 0.3 ? 'the roar of the jet stream and its storms' : 'the roar of the jet stream';
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

/** §11.4 "true level against Earth" note; offset > 0 means the world is quieter than Earth and was raised. */
export function levelNote(offsetDb: number): { note: string | null; short: string | null } {
  if (!(Math.abs(offsetDb) >= LEVEL_NOTE_MIN_DB)) return { note: null, short: null };
  const n = Math.max(5, Math.round(Math.abs(offsetDb) / 5) * 5); // ASSUMPTION: rounded to the nearest 5 dB
  return offsetDb > 0
    ? { note: `Real level: about ${n} dB quieter than on Earth (raised so you can hear it)`, short: `real level about ${n} dB quieter than Earth` }
    : { note: `Real level: about ${n} dB louder than on Earth (lowered)`, short: `real level about ${n} dB louder than Earth` };
}

function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** §12.2 the caption model for one mixer frame. */
export function caption(air: AirModel, place: Place, frame: MixFrame): CaptionModel {
  const all = air.refusals.find((r) => r.source === 'all');
  const silentReason = all ? all.reason : frame.silent ? CEILING_TEXT : null;
  const { note, short } = levelNote(frame.presentOffsetDb);
  if (silentReason) return { line: silentReason, heard: [], levelNote: null, silentReason };

  const live = frame.beds.filter((b) => b.gainDb > SILENT_DB + 1).sort((a, b) => b.trueDb - a.trueDb);
  const top = live[0]?.trueDb ?? 0;
  const seen = new Set<string>();
  const heard: CaptionModel['heard'] = [];
  for (const b of live) {
    const phrase = bedPhrase(b.id, place);
    if (seen.has(phrase)) continue;
    seen.add(phrase);
    heard.push({ id: b.id, phrase, relDb: b.trueDb - top });
  }
  if (place.features.cyclone?.inEye && air.Vmax !== null) {
    return { line: [EYE_TEXT, short].filter(Boolean).join(' · '), heard, levelNote: note, silentReason: null };
  }
  const parts = [heard[0]?.phrase, heard[1]?.phrase, weatherPhrase(place), short].filter((p): p is string => !!p);
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
    { label: 'True level against Earth', text: `${dB >= 0 ? '+' : ''}${dB.toFixed(0)} dB for the same ground sound` },
  ];
  if (air.cls === 'CO2') {
    const fr = Math.round((CO2_ABS.fr * air.P0) / CO2_ABS.pRef);
    facts.push({ label: 'Two speeds of sound', text: `Sound below about ${fr} Hz travels about 10 m/s slower than higher sounds` });
  }
  return facts;
}


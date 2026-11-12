// What the wind sound follows in the close-up: the place being looked at on a world the engine draws.
// Place: the fly camera's foot point while the close-up flies (you stand on the ground there), else the last globe click
// (worldStore.target). Signals read from the engine's CPU fields (WorldEngine.cpuFields, WorldFieldSampler):
//   terrain elevation (km) -> local pressure P exp(-h / H), H = R T / (M g)   [derived]
//   surface temperature at the cell        -> sound speed, as the card's T plus the cell's departure from the
//                                              engine's mean (the card's measured T stays the anchor) [model_dependent]
// Not wired: local wind. The engine's u/v grid is ocean-current flow normalised to its own maximum and is 0 on
// land, so it is not a wind speed; the Auto wind option is not offered. Nothing here is invented: with no
// engine, no place or no field, the global values are used.
import { useWorldStore } from '@/app/worldStore';
import { WorldFieldSampler } from '@/engine/worlds/fieldSampler';
import type { CpuFields } from '@/engine/worlds/WorldEngine';
import { GAS_CONSTANT, GASES, soundSpeed, type AtmosphereModel } from '@/app/build/hearModel';

export interface LocalSignals {
  P: number;
  c: number;
  /** Short plain note of what is followed, e.g. "elevation 2.1 km". */
  note: string;
}

let cache: { terrain: unknown; climate: unknown; sampler: WorldFieldSampler; meanT: number | null } | null = null;

function samplerFor(f: CpuFields) {
  if (cache && cache.terrain === (f.terrain?.data ?? null) && cache.climate === (f.climate?.T ?? null)) return cache;
  let meanT: number | null = null;
  if (f.climate) {
    let s = 0;
    const n = f.climate.NX * f.climate.NY;
    for (let i = 0; i < n; i++) s += f.climate.T[i]!;
    meanT = n > 0 ? s / n : null;
  }
  cache = { terrain: f.terrain?.data ?? null, climate: f.climate?.T ?? null, sampler: new WorldFieldSampler(f), meanT };
  return cache;
}

/** null when there is no place or no engine field to read: the sound uses the global values. */
export function sampleLocal(m: AtmosphereModel): LocalSignals | null {
  const ws = useWorldStore.getState();
  const eng = ws.fly ?? ws.globe;
  if (!eng) return null;
  let lon: number;
  let lat: number;
  if (ws.fly && ws.fly.flying) {
    lon = ws.fly.fly.lon;
    lat = ws.fly.fly.lat;
  } else if (ws.target) {
    lon = ws.target.lon;
    lat = ws.target.lat;
  } else return null;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const c = samplerFor(eng.cpuFields());
  const s = c.sampler.sampleLonLat(lon, lat);
  const parts: string[] = [];
  let P = m.P;
  // You stand on the ground under the camera: only the terrain height counts, not the fly altitude.
  const hKm = s.elevationKm ?? 0;
  if (s.elevationKm !== null) {
    const H = (GAS_CONSTANT * m.T) / (GASES[m.gas].M * m.gMs2); // scale height, m (derived)
    P = m.P * Math.exp((-Math.max(0, hKm) * 1000) / H);
    parts.push(`height ${hKm.toFixed(1)} km`);
  }
  let cs = m.c;
  if (s.temperatureK !== null && c.meanT !== null) {
    const T = Math.max(20, m.T + (s.temperatureK - c.meanT));
    cs = soundSpeed(m.gas, T);
    parts.push(`${Math.round(T)} K`);
  }
  if (parts.length === 0) return null;
  return { P, c: cs, note: parts.join(', ') };
}

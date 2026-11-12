// R13.9 sound check: live tuning (blue 27). The page post-processes a MixFrame (stage window, global and per-bed trim,
// solo and mute) before the mixer applies it, so the mixer and tuning.ts stay the app's. "Copy as tuning.ts" prints
// the changed constants to paste by hand (they stay CREATIVE, D-13).
import { HARMONIC_MIX_DB } from '@/sound/tuning';
import { flowOffsetDb, presentOffsetDb } from '@/sound/ambience/levels';
import { isGroundBed } from '@/sound/ambience/sources';
import {
  L_REF,
  L_TARGET,
  SILENT_DB,
  STAGE_HEADROOM_DB,
  STAGE_WINDOW_DB,
} from '@/sound/ambience/tuning';
import type { AirModel, MixFrame, SourceId } from '@/sound/ambience/types';
import './marker';

export interface TuneState {
  windowDb: number;
  trimDb: number;
  bedTrimDb: Partial<Record<SourceId, number>>;
  muted: ReadonlySet<SourceId>;
  /** Only this bed (`id|variant`) sounds; null = all. */
  solo: string | null;
  harmonicOn: boolean;
  harmonicSendDb: number;
}

export const DEFAULT_TUNE: TuneState = {
  windowDb: STAGE_WINDOW_DB,
  trimDb: 0,
  bedTrimDb: {},
  muted: new Set(),
  solo: null,
  harmonicOn: true,
  harmonicSendDb: 0,
};

/** The frame with the tuned stage window and trims; silent beds stay silent (R8: never lifted). */
export function tuneFrame(frame: MixFrame, air: AirModel, z_km: number, t: TuneState): MixFrame {
  const beds = frame.beds.map((b) => {
    const key = `${b.id}|${b.variant}`;
    if (b.gainDb <= SILENT_DB || t.muted.has(b.id) || (t.solo !== null && t.solo !== key)) {
      return { ...b, gainDb: SILENT_DB };
    }
    const G = isGroundBed(b.id) ? presentOffsetDb(air) : flowOffsetDb(air, z_km);
    const windowed = Math.max(-t.windowDb, Math.min(STAGE_HEADROOM_DB, b.trueDb + G - L_TARGET));
    return { ...b, gainDb: windowed + t.trimDb + (t.bedTrimDb[b.id] ?? 0) };
  });
  return { ...frame, beds };
}

const LREF_OF: Partial<Record<SourceId, keyof typeof L_REF>> = {
  S1_land: 'wind',
  S1_sea: 'wind',
  S2: 'hissRel',
  S3: 'hissRel',
  S4: 'sea',
  S5: 'sea',
  S6: 'rain',
  S7: 'river',
  S8: 'lava',
  S10: 'sand',
  S12: 'gas',
  thunder: 'thunder',
};

/** TypeScript lines for the changed constants (empty when nothing changed). */
export function tuningText(t: TuneState): string {
  const out: string[] = [];
  if (t.windowDb !== STAGE_WINDOW_DB)
    out.push(`export const STAGE_WINDOW_DB = ${t.windowDb}; // sound/ambience/tuning.ts`);
  if (t.harmonicSendDb !== 0) {
    out.push(
      `export const HARMONIC_MIX_DB = ${HARMONIC_MIX_DB + t.harmonicSendDb}; // sound/tuning.ts`,
    );
  }
  const lref: Record<string, number> = { ...L_REF };
  let changed = false;
  for (const k of Object.keys(lref))
    if (k !== 'hissRel' && t.trimDb) lref[k] = (lref[k] as number) + t.trimDb;
  for (const [id, d] of Object.entries(t.bedTrimDb)) {
    const k = LREF_OF[id as SourceId];
    if (!k || !d) continue;
    lref[k] = (lref[k] as number) + d;
    changed = true;
  }
  if (changed || t.trimDb) {
    const body = Object.entries(lref)
      .map(([k, v]) => `${k}: ${Math.round(v * 10) / 10}`)
      .join(', ');
    out.push(`export const L_REF = {\n  ${body},\n} as const; // sound/ambience/tuning.ts`);
  }
  return out.join('\n');
}

// R13.9 sound check: the play order for one world (pure, the only tested part of the page with meter.ts).
// Each present bed solo for BED_STEP_S at its presentation level (priority order), then thunder (or the reason it is
// refused), then the data sound that the ambience ducks under.
import { PRIORITY } from '@/sound/ambience/sources';
import type { BedLevel, SourceId } from '@/sound/ambience/types';
import './marker';

export const BED_STEP_S = 5;
export const THUNDER_STEP_S = 8;
export const DATA_STEP_S = 4;

export type Step =
  | { kind: 'bed'; id: SourceId; variant: number; seconds: number; label: string }
  | { kind: 'thunder'; variants: number[]; seconds: number; label: string }
  | { kind: 'reason'; seconds: 0; label: string }
  | { kind: 'data'; seconds: number; label: string };

export interface PlaylistInput {
  /** The world's bed levels from mixFrame (silent beds are skipped). */
  beds: readonly BedLevel[];
  /** The baked beds (bedKey `id|variant`). */
  baked: ReadonlySet<string>;
  lightning: { allowed: boolean; reason: string | null };
  /** Baked thunder variants. */
  thunderVariants: readonly number[];
  /** True when the #115 spectrum chord is available; false plays the stand-in chord. */
  chord: boolean;
}

export function playlist(i: PlaylistInput): Step[] {
  const steps: Step[] = [];
  const beds = [...i.beds]
    .filter((b) => b.id !== 'thunder' && i.baked.has(`${b.id}|${b.variant}`) && b.gainDb > -120)
    .sort((a, b) => PRIORITY.indexOf(a.id) - PRIORITY.indexOf(b.id) || a.variant - b.variant);
  for (const b of beds)
    steps.push({
      kind: 'bed',
      id: b.id,
      variant: b.variant,
      seconds: BED_STEP_S,
      label: `${b.id} (variant ${b.variant})`,
    });
  if (!i.lightning.allowed)
    steps.push({
      kind: 'reason',
      seconds: 0,
      label: i.lightning.reason ?? 'No lightning on this world.',
    });
  else if (!i.thunderVariants.length)
    steps.push({ kind: 'reason', seconds: 0, label: 'Thunder is allowed but not baked yet.' });
  else
    steps.push({
      kind: 'thunder',
      variants: [...i.thunderVariants],
      seconds: THUNDER_STEP_S,
      label: 'Thunder (near and far)',
    });
  steps.push({
    kind: 'data',
    seconds: DATA_STEP_S,
    label: i.chord
      ? 'Spectrum chord (data sound)'
      : 'Data-sound stand-in: a chord on the spectrum bus (the ambience ducks)',
  });
  return steps;
}

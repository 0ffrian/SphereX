// D-36, Q-222: the 3D gate. The backend (stage 7) scores the card and sets `confidence.gate`; the
// viewer only applies it. An object with no `confidence` (an older saved asset, or a type with no
// key measurement defined) is not gated here. The score does not depend on the Show level.
import type { RenderParams } from '@/contract';

export type Confidence = NonNullable<RenderParams['confidence']>;

/** The refusal text when the gate failed, else null. Plain words: what was found, what is needed. */
export function gateRefusal(params: RenderParams): string | null {
  const c = params.confidence;
  if (!c || c.gate.passed) return null;
  const parts = ['Not enough data to build a 3D model.'];
  if (c.found) parts.push(`Found: ${c.found}`);
  if (c.needed) parts.push(`Needed: ${c.needed}`);
  return parts.join(' ');
}

export const BAND_WORDS: Record<Confidence['band'], string> = {
  mostly_data: 'Mostly data',
  part_data: 'Part data, part assumed',
  mostly_assumed: 'Mostly assumed',
  too_little: 'Too little data',
};

/** Whole percent, as shown in the chip and the breakdown. */
export function percent(x: number): number {
  return Math.round(100 * x);
}

/** The badge word of one input: the app's three badges plus "Missing" (D-02). */
export function inputBadge(tag: Confidence['inputs'][number]['tag']): string {
  switch (tag) {
    case 'measured':
      return 'Measured';
    case 'derived':
    case 'model_dependent':
    case 'inferred_from_analog':
      return 'Estimated';
    case 'artistic':
      return 'Default';
    default:
      return 'Missing';
  }
}

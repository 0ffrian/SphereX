// Groups the backend's `missing` codes (A4.1, A4.2) by reason, so a refused frame list reads as
// "239 frames where the detector flagged …" instead of 239 raw codes. Logic only: the wording is
// in messages.ts.
//
// Code formats the backend emits (backend/app/core/find/frames.py, backend/app/core/measure/):
//   per frame      `<reason>:<frame_id>`, e.g. `saturated:2026W17_1B_0634_4_D3`
//   whole result   `frames:truncated`, `frames:moving_object_search`, `spectrum:saturated`,
//                  `cutouts:deferred:<n>`, and the colour composite's `composite:<reason>`
// Anything else is kept and shown as is, never dropped.
import type { Frame, SpectrumPoint } from '@/app/api/types';

/** Every per-frame refusal reason of Stage 1 (/frames) and Stage 2 (/spectrum). */
export const FRAME_REASONS = [
  'saturated',
  'aperture_flags',
  'aperture_edge',
  'background',
  'unit',
  'extension',
  'flags_header',
  'pixel_area',
  'measure',
  'cutout_unreadable',
  'cutout',
  'outside_cutout',
  'wavelength',
  'cutout_stretch',
] as const;
export type FrameReason = (typeof FRAME_REASONS)[number];

/** Whole-result codes with their own wording (no frame id). */
export const WHOLE_RESULT_CODES = [
  'frames:truncated',
  'frames:moving_object_search',
  'spectrum:saturated',
  'spectrum:moving_object_search',
] as const;

export const ALL_SATURATED = 'spectrum:saturated';
const TRUNCATED = 'frames:truncated';
const DEFERRED_RE = /^cutouts:deferred:(\d+)$/;
/** Prefixes of whole-result codes; an unknown code under one of them is a note, not a frame. */
const NAMESPACES: ReadonlySet<string> = new Set(['frames', 'spectrum', 'cutouts', 'composite']);
const REASON_RE = /^[a-z][a-z0-9_]*$/;
const KNOWN_REASONS: ReadonlySet<string> = new Set(FRAME_REASONS);
const KNOWN_WHOLE: ReadonlySet<string> = new Set(WHOLE_RESULT_CODES);

/**
 * Colour composite codes (backend/app/core/composite: select.py, service.py, 7 Nov 2026, built in
 * parallel): whole-result reasons, and per channel `composite:<blue|green|red>:<reason>`.
 * `composite:<channel>:skipped:<reason>:<frame_id>` (a nearer frame refused) is read as the frame
 * refusal `<reason>:<frame_id>` (groupCompositeMissing). Any other code is shown as is.
 */
export const COMPOSITE_WHOLE_REASONS = [
  'too_few_bands',
  'saturated',
  'no_common_pass',
  'moving_object',
  'no_proper_motion',
  'pixel_scale',
] as const;
export const COMPOSITE_CHANNEL_REASONS = [
  'no_frame',
  'saturated',
  'no_usable_frame',
  'stretch',
] as const;
const COMPOSITE_CODE_RE = new RegExp(
  `^composite:(?:(?:${COMPOSITE_WHOLE_REASONS.join('|')})|(?:blue|green|red):(?:${COMPOSITE_CHANNEL_REASONS.join('|')}))$`,
);
const COMPOSITE_SKIPPED_RE = /^composite:(?:blue|green|red):skipped:([a-z][a-z0-9_]*):(.+)$/;

export type ParsedMissing =
  | { kind: 'frame'; reason: string; frameId: string; known: boolean }
  | { kind: 'note'; code: string; known: boolean; count: number };

/** One code. Split on the first ':' like the backend's own report (spectrum.py report_targets). */
export function parseMissing(code: string): ParsedMissing {
  if (KNOWN_WHOLE.has(code) || COMPOSITE_CODE_RE.test(code)) {
    return { kind: 'note', code, known: true, count: 1 };
  }
  const deferred = DEFERRED_RE.exec(code);
  if (deferred) return { kind: 'note', code, known: true, count: Number(deferred[1]) };
  const colon = code.indexOf(':');
  if (colon > 0) {
    const reason = code.slice(0, colon);
    const frameId = code.slice(colon + 1);
    if (!NAMESPACES.has(reason) && REASON_RE.test(reason) && frameId.trim() !== '') {
      return { kind: 'frame', reason, frameId, known: KNOWN_REASONS.has(reason) };
    }
  }
  return { kind: 'note', code, known: false, count: 1 };
}

export interface RefusalGroup {
  key: string;
  kind: 'frames' | 'note';
  /** Frame groups: the reason (`saturated`). Notes: the whole code (`frames:truncated`). */
  reason: string;
  /** False for a reason or code this page has no wording for; it is then shown as is. */
  known: boolean;
  /** Frames in the group; `n` for `cutouts:deferred:<n>`; 1 for other notes. */
  count: number;
  /** Sorted, without duplicates; empty for notes. */
  frameIds: readonly string[];
}

/**
 * Groups codes: notes first (in the order given), then one group per frame reason, largest
 * first, ties by reason A–Z. Duplicates are merged; every distinct code lands in one group.
 */
export function groupMissing(codes: readonly string[]): RefusalGroup[] {
  const notes: RefusalGroup[] = [];
  const byReason = new Map<string, { known: boolean; ids: Set<string> }>();
  for (const code of new Set(codes)) {
    const p = parseMissing(code);
    if (p.kind === 'note') {
      notes.push({
        key: `note:${code}`,
        kind: 'note',
        reason: code,
        known: p.known,
        count: p.count,
        frameIds: [],
      });
      continue;
    }
    let g = byReason.get(p.reason);
    if (!g) {
      g = { known: p.known, ids: new Set() };
      byReason.set(p.reason, g);
    }
    g.ids.add(p.frameId);
  }
  const frames: RefusalGroup[] = [...byReason].map(([reason, g]) => ({
    key: `frames:${reason}`,
    kind: 'frames',
    reason,
    known: g.known,
    count: g.ids.size,
    frameIds: [...g.ids].sort(),
  }));
  frames.sort((a, b) => b.count - a.count || (a.reason < b.reason ? -1 : 1));
  return [...notes, ...frames];
}

export interface SpectrumOutcome {
  points: number;
  flagged: number;
  /** Frames refused, any reason (Stage 1 refusals passed through, and Stage 2). */
  refused: number;
  /** Frames found: points + refused. */
  total: number;
  saturated: number;
  /** Reason of the largest frame group, or null when no frame was refused. */
  largestReason: string | null;
  /** `cutouts:deferred` or `frames:truncated`: more frames exist than were checked. */
  incomplete: boolean;
  /** Wavelength span of the measured points, µm. */
  measuredRange: readonly [number, number] | null;
  /** Wavelength span of the frames the flipbook lists, µm. */
  framesRange: readonly [number, number] | null;
  /** Widest gap between neighbouring measured wavelengths, µm; null with fewer than 2 points. */
  largestGap: readonly [number, number] | null;
  /**
   * Groups to list under the spectrum. `spectrum:saturated` is left out when saturated frames are
   * listed (the empty state says it); otherwise it is kept, so no code is ever dropped.
   */
  groups: readonly RefusalGroup[];
}

function widestGap(values: readonly number[]): readonly [number, number] | null {
  const sorted = [...values].sort((a, b) => a - b);
  let best: readonly [number, number] | null = null;
  for (let i = 1; i < sorted.length; i++) {
    const lo = sorted[i - 1]!;
    const hi = sorted[i]!;
    if (!best || hi - lo > best[1] - best[0]) best = [lo, hi];
  }
  return best;
}

function span(values: readonly number[]): readonly [number, number] | null {
  if (values.length === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

export function summarizeSpectrum(
  points: readonly SpectrumPoint[],
  missing: readonly string[],
  frames?: readonly Frame[],
): SpectrumOutcome {
  const all = groupMissing(missing);
  const frameGroups = all.filter((g) => g.kind === 'frames');
  const refused = frameGroups.reduce((n, g) => n + g.count, 0);
  const saturated = frameGroups.find((g) => g.reason === 'saturated')?.count ?? 0;
  return {
    points: points.length,
    flagged: points.filter((p) => p.flagged).length,
    refused,
    total: points.length + refused,
    saturated,
    largestReason: frameGroups[0]?.reason ?? null,
    incomplete: missing.some((c) => c === TRUNCATED || DEFERRED_RE.test(c)),
    measuredRange: span(points.map((p) => p.wavelength_um)),
    framesRange: frames ? span(frames.map((f) => f.wavelength_um)) : null,
    largestGap: widestGap(points.map((p) => p.wavelength_um)),
    groups: saturated > 0 ? all.filter((g) => g.reason !== ALL_SATURATED) : all,
  };
}

/**
 * The composite's `missing`, grouped like the frames'. A nearer frame the backend skipped
 * (`composite:<channel>:skipped:<reason>:<frame_id>`) joins the frame group of its reason.
 */
export function groupCompositeMissing(codes: readonly string[]): RefusalGroup[] {
  return groupMissing(
    codes.map((c) => {
      const m = COMPOSITE_SKIPPED_RE.exec(c);
      return m ? `${m[1]}:${m[2]}` : c;
    }),
  );
}

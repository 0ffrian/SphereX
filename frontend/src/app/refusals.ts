// Groups the backend's `missing` codes (A4.1, A4.2) by reason, so a refused frame list reads as
// "239 frames where the detector flagged …" instead of 239 raw codes. Logic only: the wording is
// in messages.ts.
//
// Code formats the backend emits (backend/app/core/find/frames.py, find/moving.py,
// backend/app/core/measure/):
//   per frame      `<reason>:<frame_id>`, e.g. `saturated:2026W17_1B_0634_4_D3`
//   whole result   `frames:truncated`, `frames:ephemeris`, `frames:moving_window`,
//                  `spectrum:saturated`, the colour composite's `composite:<reason>`
//   counted        `cutouts:deferred:<n>` and the moving-object path search's
//                  `frames:<cone_cap|cone_maxrec|sparse_path|cone_failed|search_deferred|
//                  outside_window>:<n>` (COUNTED_CODES)
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

/**
 * Per-frame codes of the overlays reply (issue #12): `footprint:<frame_id>` (no detector
 * footprint) and `flags_mask:<frame_id>` (no flag mask). Kept apart from FRAME_REASONS, which
 * mirrors the backend's Stage 1 and Stage 2 reasons (backendReasons.test.ts).
 */
export const OVERLAY_FRAME_REASONS = ['footprint', 'flags_mask'] as const;
export type OverlayFrameReason = (typeof OVERLAY_FRAME_REASONS)[number];

/**
 * Per-frame codes of the moving-object path search (backend find/moving.py, issue #26):
 * `no_footprint:<frame_id>` (the frame has no footprint to check the object against; not the
 * overlays' `footprint`) and `ephemeris:<frame_id>` (no exact predicted position at that time).
 */
export const MOVING_FRAME_REASONS = ['no_footprint', 'ephemeris'] as const;
export type MovingFrameReason = (typeof MOVING_FRAME_REASONS)[number];

/**
 * Counted whole-result codes, `<prefix>:<n>`. `cutouts:deferred` counts frames still to download;
 * the `frames:*` ones come from the moving-object path search (backend find/moving.py).
 */
export const COUNTED_CODES = [
  'cutouts:deferred',
  'frames:cone_cap',
  'frames:cone_maxrec',
  'frames:sparse_path',
  'frames:cone_failed',
  'frames:search_deferred',
  'frames:outside_window',
] as const;
export type CountedCode = (typeof COUNTED_CODES)[number];
const COUNTED_RE = new RegExp(`^(${COUNTED_CODES.join('|')}):(\\d+)$`);

/** The prefix and count of a counted code, or null. */
export function countedCode(code: string): { prefix: CountedCode; count: number } | null {
  const m = COUNTED_RE.exec(code);
  return m ? { prefix: m[1] as CountedCode, count: Number(m[2]) } : null;
}

/**
 * Codes after which more frames may exist than the list holds: the archive list was cut short,
 * cutouts or the path search are still to come, or the path search skipped or lost part of it.
 */
const INCOMPLETE_COUNTED: ReadonlySet<CountedCode> = new Set([
  'cutouts:deferred',
  'frames:cone_cap',
  'frames:cone_maxrec',
  'frames:sparse_path',
  'frames:cone_failed',
  'frames:search_deferred',
]);

/** Whole-result codes with their own wording (no frame id). */
export const WHOLE_RESULT_CODES = [
  'frames:truncated',
  // Moving-object path search: no path ephemeris for (part of) the search, or a bad window.
  'frames:ephemeris',
  'frames:moving_window',
  'spectrum:saturated',
  'overlay:gaia',
  'overlay:wise',
  // The cone is still being fetched (backend overlay_wait_s); a later request will have it.
  'overlay:gaia:pending',
  'overlay:wise:pending',
  // The cone hit the row cap (brightest first), so the faintest sources are left out.
  'overlay:gaia:truncated',
  'overlay:wise:truncated',
] as const;

export const ALL_SATURATED = 'spectrum:saturated';
const TRUNCATED = 'frames:truncated';
/** Prefixes of whole-result codes; an unknown code under one of them is a note, not a frame. */
const NAMESPACES: ReadonlySet<string> = new Set([
  'frames',
  'spectrum',
  'cutouts',
  'composite',
  'overlay',
  // UI-side code for an overlay layer the reply gave no provenance for (OverlayPanel).
  'provenance',
]);
const REASON_RE = /^[a-z][a-z0-9_]*$/;
const KNOWN_REASONS: ReadonlySet<string> = new Set([
  ...FRAME_REASONS,
  ...OVERLAY_FRAME_REASONS,
  ...MOVING_FRAME_REASONS,
]);
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
  const counted = countedCode(code);
  if (counted) return { kind: 'note', code, known: true, count: counted.count };
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
  /** `frames:truncated`, deferred cutouts or path search, or a capped or lossy path search:
   * more frames may exist than were checked. */
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
    incomplete: missing.some((c) => {
      if (c === TRUNCATED || c === 'frames:ephemeris') return true;
      const counted = countedCode(c);
      return counted !== null && counted.count > 0 && INCOMPLETE_COUNTED.has(counted.prefix);
    }),
    measuredRange: span(points.map((p) => p.wavelength_um)),
    framesRange: frames ? span(frames.map((f) => f.wavelength_um)) : null,
    largestGap: widestGap(points.map((p) => p.wavelength_um)),
    groups: saturated > 0 ? all.filter((g) => g.reason !== ALL_SATURATED) : all,
  };
}

// ---- Area search (A18; issue #96) ------------------------------------------------------------
// Kept apart from parseMissing so the flipbook's grouping is unchanged (Moon: hooks only add).

/** Area codes with their own wording (Q-208 (13)): frontend codes of the Area card. */
export const AREA_WHOLE_CODES = ['area:not_prepared', 'area:visits'] as const;
const AREA_KNOWN: ReadonlySet<string> = new Set(AREA_WHOLE_CODES);
/**
 * Prefixes of the Area replies' codes (A17.8): `horizons:<designation>`, `skybot:<visit>`,
 * `stamp:<dot_id>`, `rate_grid:visits`, `checks:*`, and the frontend's `area:*`. They are notes
 * about the area, never frame refusals; an unworded one is shown as is.
 */
const AREA_NAMESPACES: ReadonlySet<string> = new Set([
  'area',
  'horizons',
  'skybot',
  'stamp',
  'rate_grid',
  'checks',
]);

/** Groups an Area reply's `missing`: area notes first, then anything else as groupMissing does. */
export function groupAreaMissing(codes: readonly string[]): RefusalGroup[] {
  const notes: RefusalGroup[] = [];
  const rest: string[] = [];
  for (const code of new Set(codes)) {
    const colon = code.indexOf(':');
    if (colon > 0 && AREA_NAMESPACES.has(code.slice(0, colon))) {
      notes.push({
        key: `note:${code}`,
        kind: 'note',
        reason: code,
        known: AREA_KNOWN.has(code),
        count: 1,
        frameIds: [],
      });
    } else rest.push(code);
  }
  return [...notes, ...groupMissing(rest)];
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

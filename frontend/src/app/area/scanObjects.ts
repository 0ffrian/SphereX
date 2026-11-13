// The objects a scan circles on the sky (issue #157; mock-up states 10 and 11), from the run's
// `found` events (#156): one per object, its trajectory and a label. Pure, so it is tested alone.
//   known       green: a known object found in the frames (a SkyBoT match), its Horizons positions;
//   unexplained amber: moves across both visits and matches nothing on file, its measured dots;
//   predicted   blue dashed: a known object predicted there but not found (hidden by default).
// A designation found in several squares is ONE object: its positions are merged in time order, so
// the trajectory carries across the square border. A Discovery track id belongs to its square
// (T7 of square 3), so tracks are never merged here; #156's results merge them within 30″.
import { separationDeg } from '@/viewer/sky/skyMath';
import type { FoundKind, RunEvent, RunPosition } from './scanApi';

export interface ScanObject {
  /** Stable key: the designation, else `<square>:<track id>`. */
  key: string;
  kind: FoundKind;
  designation?: string;
  trackId?: string;
  /** The squares it was reported in, ascending. */
  squares: number[];
  /** The trajectory, oldest first (duplicate times dropped). */
  positions: RunPosition[];
  /** Not in the run's events (#156): null; the results card shows V from the merged rows. */
  vMag: number | null;
  /** Motion over the trajectory (deg/day, derived), null with fewer than two times. */
  rateDegDay: number | null;
  /** The label's two lines (mock-up `.olbl`). */
  title: string;
  line: string;
}

/** "square 2", "squares 2–3", "squares 2, 5, 6–7". */
export function squaresText(squares: readonly number[]): string {
  const s = [...new Set(squares)].sort((a, b) => a - b);
  if (s.length === 0) return '';
  const parts: string[] = [];
  for (let i = 0; i < s.length;) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j]! + 1) j++;
    parts.push(j > i ? `${s[i]}–${s[j]}` : `${s[i]}`);
    i = j + 1;
  }
  return `${s.length === 1 ? 'square' : 'squares'} ${parts.join(', ')}`;
}

/** Degrees per day between the first and last positions (derived), or null. */
export function rateOf(p: readonly RunPosition[]): number | null {
  if (p.length < 2) return null;
  const a = p[0]!;
  const b = p[p.length - 1]!;
  const days = (Date.parse(b.time) - Date.parse(a.time)) / 86_400_000;
  if (!(days > 0)) return null;
  return separationDeg(a.ra, a.dec, b.ra, b.dec) / days;
}

const vText = (v: number | null) => (v === null ? null : `V ${v.toFixed(1)}`);
const rateText = (r: number | null) => (r === null ? null : `${r.toFixed(2)}°/day`);

function labelOf(o: Omit<ScanObject, 'title' | 'line'>): { title: string; line: string } {
  if (o.kind === 'unexplained')
    return { title: `${o.trackId ?? '?'} · unexplained`, line: rateText(o.rateDegDay) ?? '' };
  const title = o.designation ?? '?';
  if (o.kind === 'predicted')
    return { title, line: ['predicted', vText(o.vMag)].filter(Boolean).join(' · ') };
  const where = o.squares.length > 1 ? squaresText(o.squares) : rateText(o.rateDegDay);
  return { title, line: [vText(o.vMag), where].filter(Boolean).join(' · ') };
}

/** The circled objects of a run, from its events. Detected beats predicted for one designation. */
export function objectsFromEvents(events: readonly RunEvent[]): ScanObject[] {
  const byKey = new Map<string, Omit<ScanObject, 'title' | 'line'>>();
  for (const e of events) {
    const o = e.type === 'found' ? e.object : undefined;
    if (!o || o.positions.length === 0) continue;
    const key = o.designation ?? `${o.square}:${o.track_id ?? ''}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, {
        key,
        kind: o.kind,
        ...(o.designation !== undefined ? { designation: o.designation } : {}),
        ...(o.track_id !== undefined ? { trackId: o.track_id } : {}),
        squares: [o.square],
        positions: [...o.positions],
        vMag: null,
        rateDegDay: null,
      });
      continue;
    }
    if (!prev.squares.includes(o.square)) prev.squares.push(o.square);
    prev.positions.push(...o.positions);
    if (o.kind === 'known') prev.kind = 'known';
  }
  const out: ScanObject[] = [];
  for (const o of byKey.values()) {
    const seen = new Set<string>();
    const positions = o.positions
      .slice()
      .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
      .filter((p) => (seen.has(p.time) ? false : (seen.add(p.time), true)));
    const squares = o.squares.slice().sort((a, b) => a - b);
    const full = { ...o, squares, positions, rateDegDay: rateOf(positions) };
    out.push({ ...full, ...labelOf(full) });
  }
  return out;
}

/** The objects shown: predicted-only ones only when asked (hidden by default). */
export function visibleObjects(objs: readonly ScanObject[], showPredicted: boolean): ScanObject[] {
  return showPredicted ? objs.slice() : objs.filter((o) => o.kind !== 'predicted');
}

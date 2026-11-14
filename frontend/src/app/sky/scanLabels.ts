// Where the scan overlay's object labels go (issue #157; ScanOverlay.tsx). Pure, so the rule is
// unit-tested: labels never overlap a label or another object's ring. Found objects are placed
// first, then unexplained movers, then predicted ones (a stable order, so the same screen always
// gives the same labels); each tries the right of its ring, then the left, else it is not drawn
// (the ring keeps its name as its accessible label).
import type { ScanObject } from '@/app/area/scanObjects';

export interface Pt {
  x: number;
  y: number;
}
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
/** An object's ring on screen, an obstacle for the other objects' labels. */
export interface RingBox extends Rect {
  key: string;
}
/** One label to place: its object, the ring's centre and the two lines it draws. */
export interface LabelIn {
  key: string;
  kind: ScanObject['kind'];
  end: Pt;
  title: string;
  line: string;
}
/** Where a label is drawn: x and the text anchor (the tspans inherit it), or null when hidden. */
export type LabelSpot = { x: number; anchor: 'start' | 'end' } | null;

const RANK: Record<ScanObject['kind'], number> = {
  known: 0,
  track: 0,
  unexplained: 1,
  unchecked: 1,
  predicted: 2,
};

/** The ring's box around its centre (rings are at most 11 px in radius, plus a pixel). */
export function ringBox(key: string, end: Pt): RingBox {
  return { key, x0: end.x - 12, y0: end.y - 12, x1: end.x + 12, y1: end.y + 12 };
}

/** The spot of every label, by object key. */
export function placeScanLabels(labels: LabelIn[], rings: RingBox[]): Map<string, LabelSpot> {
  const out = new Map<string, LabelSpot>();
  const placed: Rect[] = [];
  const ordered = labels.slice().sort((a, b) => RANK[a.kind] - RANK[b.kind]);
  for (const o of ordered) {
    const { end, line } = o;
    // Width from the text length (11 px Inter is about 6 px a character).
    const w = Math.max(o.title.length, line.length) * 6 + 4;
    const spots = [
      { x: end.x + 14, anchor: 'start' as const, x0: end.x + 12, x1: end.x + 14 + w },
      { x: end.x - 14, anchor: 'end' as const, x0: end.x - 14 - w, x1: end.x - 12 },
    ];
    const y0 = end.y - 13;
    const y1 = end.y + (line ? 14 : 2);
    const hit = (sp: { x0: number; x1: number }, r: Rect) =>
      sp.x0 < r.x1 && sp.x1 > r.x0 && y0 < r.y1 && y1 > r.y0;
    const spot = spots.find(
      (sp) => !placed.some((r) => hit(sp, r)) && !rings.some((r) => r.key !== o.key && hit(sp, r)),
    );
    if (spot) {
      placed.push({ x0: spot.x0, y0, x1: spot.x1, y1 });
      out.set(o.key, { x: spot.x, anchor: spot.anchor });
    } else out.set(o.key, null);
  }
  return out;
}

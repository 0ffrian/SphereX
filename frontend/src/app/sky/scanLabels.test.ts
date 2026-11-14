// The scan overlay's label placement (1b6c849): found first, then unexplained, then predicted;
// the right side, then the left, else hidden; deterministic.
import { describe, expect, it } from 'vitest';
import { placeScanLabels, ringBox, type LabelIn } from './scanLabels';

const label = (
  key: string,
  kind: LabelIn['kind'],
  x: number,
  y: number,
  line = 'V 18.2',
): LabelIn => ({
  key,
  kind,
  end: { x, y },
  title: key,
  line,
});
const ringsOf = (ls: LabelIn[]) => ls.map((l) => ringBox(l.key, l.end));

describe('placeScanLabels', () => {
  it('puts a lone label right of its ring, its own ring is no obstacle', () => {
    const ls = [label('A', 'known', 100, 100)];
    expect(placeScanLabels(ls, ringsOf(ls)).get('A')).toEqual({ x: 114, anchor: 'start' });
  });

  it('a label with no second line is shorter: the box ends at y + 2', () => {
    // B's ring sits 15 px below A's centre: clear of a one-line label (y1 = y + 2 < ring top y + 3),
    // in the way of a two-line one (y1 = y + 14).
    const one = [label('A', 'known', 100, 100, ''), label('B', 'known', 130, 115)];
    expect(placeScanLabels(one, ringsOf(one)).get('A')).toEqual({ x: 114, anchor: 'start' });
    const two = [label('A', 'known', 100, 100), label('B', 'known', 130, 115)];
    expect(placeScanLabels(two, ringsOf(two)).get('A')).toEqual({ x: 86, anchor: 'end' });
  });

  it('goes left when another ring is on the right, and is hidden when both sides are taken', () => {
    const left = [label('A', 'known', 100, 100), label('R', 'known', 140, 100)];
    expect(placeScanLabels(left, ringsOf(left)).get('A')).toEqual({ x: 86, anchor: 'end' });
    const boxed = [
      label('A', 'known', 100, 100),
      label('R', 'known', 140, 100),
      label('L', 'known', 60, 100),
    ];
    expect(placeScanLabels(boxed, ringsOf(boxed)).get('A')).toBeNull();
  });

  it('places found objects first, then unexplained, then predicted, whatever the input order', () => {
    // Three labels at one spot, no rings: whoever is placed first gets the right side.
    const p = label('P', 'predicted', 100, 100);
    const u = label('U', 'unexplained', 100, 100);
    const k = label('K', 'known', 100, 100);
    // The first placed takes the right, the second the left, the third has no room.
    const spots = placeScanLabels([p, u, k], []);
    expect(spots.get('K')).toEqual({ x: 114, anchor: 'start' });
    expect(spots.get('U')).toEqual({ x: 86, anchor: 'end' });
    expect(spots.get('P')).toBeNull();
  });

  it('keeps the input order within a kind (a stable sort)', () => {
    const a = label('A', 'unexplained', 100, 100);
    const b = label('B', 'unexplained', 100, 100);
    expect(placeScanLabels([a, b], []).get('A')).toEqual({ x: 114, anchor: 'start' });
    expect(placeScanLabels([b, a], []).get('B')).toEqual({ x: 114, anchor: 'start' });
  });

  it('a label never overlaps another label', () => {
    // Two labels 10 px apart vertically (no rings): the second cannot take the first one's side.
    const ls = [label('A', 'known', 100, 100), label('B', 'known', 100, 110)];
    const spots = placeScanLabels(ls, []);
    expect(spots.get('A')).toEqual({ x: 114, anchor: 'start' });
    expect(spots.get('B')).toEqual({ x: 86, anchor: 'end' });
  });

  it('is deterministic: the same screen gives the same labels', () => {
    const ls = Array.from({ length: 40 }, (_, i) =>
      label(
        `T${i}`,
        (['known', 'unexplained', 'predicted'] as const)[i % 3]!,
        200 + (i % 7) * 23,
        150 + Math.floor(i / 7) * 17,
      ),
    );
    const a = [...placeScanLabels(ls, ringsOf(ls))];
    const b = [...placeScanLabels(ls.slice(), ringsOf(ls))];
    expect(b).toEqual(a);
    // And on a crowded screen some are hidden.
    expect(a.some(([, s]) => s === null)).toBe(true);
  });
});

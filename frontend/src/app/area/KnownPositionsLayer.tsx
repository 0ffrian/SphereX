// Known positions on the sky (A18.2, issues #130 and #145; mock-up state 6): every known object's
// predicted path across the area's visits, a small diamond at the JPL Horizons RA/Dec of each frame
// time joined by a line. Dashed blue where it is only predicted; solid green, with Discovery's
// measured dots, where Discovery detected it (Q-466). The predicted positions are `model_dependent`
// (Estimated), so "Measured only" hides them and says why (D-21); the measured dots stay. Detected
// objects are labelled, the labels placed so they never overlap (held UI issue 2). Drawn as one SVG
// repositioned from the sky view's render listener; no pointer events. On the Eros card, while the
// track window draws the path on its own sky image, the diamonds step aside, so one object never
// shows two paths in two places.
import { useEffect, useReducer } from 'react';
import { ProvenanceBadge } from '@/app/Badge';
import { useAreaStore } from '@/app/shell/areaStore';
import { skyToPixels } from '@/app/sky/areaDraw';
import { placeLabels, type LabelWanted } from '@/app/sky/area/drawLayer';
import { useAppStore, type HonestyState } from '@/state/store';
import type { AreaKnownPosition as KnownPosition } from '@/contract';

/** Estimated layers show in "+ Estimated" and "+ Artistic", not in "Measured only" (D-21, R5.3). */
export const knownPositionsVisible = (honesty: HonestyState | null): boolean => honesty !== 'measured';

export const MEASURED_ONLY_NOTE = 'Tracks and known paths are Estimated';

/** One position per distinct time (the two detectors of an exposure share it), in time order. */
export function distinctTimes(positions: readonly KnownPosition[]): KnownPosition[] {
  const seen = new Set<string>();
  return positions
    .filter((p) => (seen.has(p.time) ? false : (seen.add(p.time), true)))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

const DIAMOND = 3.6;
const LABEL_FONT_PX = 11;
/** Average glyph width of the 11 px label font, for the overlap test (no canvas to measure with). */
const CHAR_PX = 6.2;

type View = { onRender(l: () => void): () => void; getSize?(): { width: number; height: number } };

export function KnownPositionsLayer({ view }: { view: View | null }) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const honesty = useAppStore((s) => s.honesty);
  const known = useAreaStore((s) =>
    s.flow === 'known' &&
    // On the Eros card: only once its frames are in and it has no sky image of its own (while
    // loading, the track window is about to draw; the diamonds would show, then vanish).
    (s.screen === 'list' || s.screen === 'track' || (s.screen === 'eros' && s.eros !== null && !(s.eros.wide.w > 0))) &&
    !s.refusal
      ? s.known
      : null,
  );
  const focus = useAreaStore((s) => s.focus);
  const screen = useAreaStore((s) => s.screen);
  const withPositions = (known?.objects ?? []).filter((o) => (o.positions?.length ?? 0) > 0 || (o.detection?.points?.length ?? 0) > 0);
  useEffect(() => (view ? view.onRender(tick) : undefined), [view]);
  if (!known || withPositions.length === 0) return null;
  const predicted = knownPositionsVisible(honesty);
  const size = view?.getSize?.() ?? { width: window.innerWidth, height: window.innerHeight };
  // On the Track and Eros cards only the focused object is labelled.
  const one = screen === 'list' ? null : focus;
  const drawn = withPositions.map((o) => {
    const pts = predicted ? distinctTimes(o.positions ?? []).map((p) => skyToPixels(p.ra, p.dec)) : [];
    // A position behind the camera breaks the line: no segment is drawn across the gap.
    const segs: { x: number; y: number }[][] = [[]];
    for (const p of pts) {
      if (p) segs[segs.length - 1]!.push(p);
      else if (segs[segs.length - 1]!.length) segs.push([]);
    }
    const meas = (o.detection?.points ?? []).map((p) => skyToPixels(p.ra, p.dec)).filter((p) => p !== null);
    return { o, segs, line: segs.flat(), meas };
  });
  const key = (o: (typeof withPositions)[number]) => o.designation ?? o.id;
  const wanted: LabelWanted[] = [];
  for (const d of drawn) {
    const labelled = one ? d.o === one : !!d.o.detection;
    const anchor = d.meas[d.meas.length - 1] ?? d.line[d.line.length - 1];
    if (!labelled || !anchor) continue;
    const text = [d.o.id, d.o.name].filter(Boolean).join(' ');
    wanted.push({ id: key(d.o), x: anchor.x, y: anchor.y, w: text.length * CHAR_PX, h: LABEL_FONT_PX + 3, rank: d.o === focus ? 0 : 1 });
  }
  const labels = new Map(placeLabels(wanted, { x: 0, y: 0, w: size.width, h: size.height }).map((p) => [p.id, p]));
  return (
    <>
      <svg className="sx-area-pos" aria-hidden="true" data-testid="known-positions" data-tag="model_dependent">
        {drawn.map(({ o, segs, line, meas }) => {
          const on = !focus || focus === o;
          const det = !!o.detection;
          const lbl = labels.get(key(o));
          return (
            <g key={key(o)} data-object={key(o)} data-detected={det || undefined} opacity={on ? 1 : 0.45}>
              {segs
                .filter((sg) => sg.length > 1)
                .map((sg, i) => (
                  <polyline
                    key={i}
                    points={sg.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                    className={det ? 'sx-area-pos-line sx-det' : 'sx-area-pos-line'}
                  />
                ))}
              {line.map((p, i) => (
                <path
                  key={i}
                  d={`M${p.x} ${p.y - DIAMOND}L${p.x + DIAMOND} ${p.y}L${p.x} ${p.y + DIAMOND}L${p.x - DIAMOND} ${p.y}Z`}
                  className={det ? 'sx-area-pos-dot sx-det' : 'sx-area-pos-dot'}
                  data-testid="known-position"
                />
              ))}
              {meas.map((p, i) => (
                <circle key={`m${i}`} cx={p.x} cy={p.y} r={3.5} className="sx-area-pos-meas" data-testid="known-measured" />
              ))}
              {lbl && (
                <text x={lbl.x} y={lbl.y} className={det ? 'sx-area-pos-lbl sx-det' : 'sx-area-pos-lbl'} data-testid="known-label">
                  {[o.id, o.name].filter(Boolean).join(' ')}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {predicted ? (
        <span className="sx-area-track-tag sx-area-pos-tag" data-testid="known-positions-tag">
          <ProvenanceBadge
            tag="model_dependent"
            tooltip="Estimated: JPL Horizons positions seen from SPHEREx at each frame time, a prediction rather than a measurement."
            srText
            variant="tag"
          />
        </span>
      ) : (
        <span className="sx-area-track-tag sx-area-pos-tag" role="status" data-testid="known-positions-note">
          <span className="sx-tagbadge">{MEASURED_ONLY_NOTE}</span>
        </span>
      )}
    </>
  );
}

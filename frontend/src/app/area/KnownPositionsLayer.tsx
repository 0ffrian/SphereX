// Known positions on the sky (A18.2, issue #130): a small diamond per frame time at the Horizons
// RA/Dec of each known object, joined by a thin line. The positions are `model_dependent` (Estimated):
// a JPL Horizons prediction seen from SPHEREx, not a measurement, so "Measured only" hides them and
// says why (D-21). It replaces the demo path of eros.json pixels for the Known flow. Drawn as one SVG
// repositioned from the sky view's render listener; no pointer events.
import { useEffect, useReducer } from 'react';
import { ProvenanceBadge } from '@/app/Badge';
import { useAreaStore } from '@/app/shell/areaStore';
import { skyToPixels } from '@/app/sky/areaDraw';
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

export function KnownPositionsLayer({ view }: { view: { onRender(l: () => void): () => void } | null }) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const honesty = useAppStore((s) => s.honesty);
  const known = useAreaStore((s) =>
    s.flow === 'known' && (s.screen === 'list' || s.screen === 'eros') && !s.refusal ? s.known : null,
  );
  const focus = useAreaStore((s) => s.focus);
  const withPositions = (known?.objects ?? []).filter((o) => (o.positions?.length ?? 0) > 0);
  useEffect(() => (view ? view.onRender(tick) : undefined), [view]);
  if (!known || withPositions.length === 0) return null;
  if (!knownPositionsVisible(honesty)) {
    return (
      <span className="sx-area-track-tag sx-area-pos-tag" role="status" data-testid="known-positions-note">
        <span className="sx-tagbadge">{MEASURED_ONLY_NOTE}</span>
      </span>
    );
  }
  return (
    <>
      <svg className="sx-area-pos" aria-hidden="true" data-testid="known-positions" data-tag="model_dependent">
        {withPositions.map((o) => {
          const pts = distinctTimes(o.positions ?? []).map((p) => skyToPixels(p.ra, p.dec));
          const line = pts.filter((p): p is { x: number; y: number } => p !== null);
          const on = !focus || focus === o;
          return (
            <g key={o.designation ?? o.id} data-object={o.designation ?? o.id} opacity={on ? 1 : 0.45}>
              {line.length > 1 && (
                <polyline points={line.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} className="sx-area-pos-line" />
              )}
              {line.map((p, i) => (
                <path
                  key={i}
                  d={`M${p.x} ${p.y - DIAMOND}L${p.x + DIAMOND} ${p.y}L${p.x} ${p.y + DIAMOND}L${p.x - DIAMOND} ${p.y}Z`}
                  className="sx-area-pos-dot"
                  data-testid="known-position"
                />
              ))}
            </g>
          );
        })}
      </svg>
      <span className="sx-area-track-tag sx-area-pos-tag" data-testid="known-positions-tag">
        <ProvenanceBadge
          tag="model_dependent"
          tooltip="Estimated: JPL Horizons positions seen from SPHEREx at each frame time, a prediction rather than a measurement."
          srText
          variant="tag"
        />
      </span>
    </>
  );
}

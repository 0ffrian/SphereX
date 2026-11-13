// A scan on the sky (issue #157; mock-up states 2, 10 and 11): the region's grid over the whole
// screen, each square numbered and in its state (offer: plain; then to do dashed, analysing blue,
// done green, skipped or failed red), and on every finished square its objects circled with their
// trajectory and an arrow for the direction of motion (scanObjects.ts). Everything is kept in sky
// coordinates and re-projected on each render, so it stays pinned when the sky moves.
// A click on a done square opens that square's results (SkyPane asks scanClickAt); a circle is a
// button that opens its object in its square's results.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { SkyView } from '@/viewer/sky/SkyView';
import { useAreaStore } from '@/app/shell/areaStore';
import { useShellStore } from '@/app/shell/shellStore';
import { inQuad, regionBox, splitRegion, type GridSquare } from '@/app/area/scanGrid';
import { objectsFromEvents, visibleObjects, type ScanObject } from '@/app/area/scanObjects';
import { useScanStore, viewRegion, type ScanView } from '@/app/area/scanStore';
import type { SquareState } from '@/app/area/scanApi';
import { skyToPixels } from './areaDraw';

type Look = SquareState | 'plain';
interface Pt {
  x: number;
  y: number;
}

/** The squares' screen quads now, for the click test (set by the overlay while it shows). */
let hits: { quads: { index: number; pts: Pt[] }[]; open(index: number): void } | null = null;
/** A click at (x, y) on the sky: true when it opened a done square of the scan on screen. */
export function scanClickAt(x: number, y: number): boolean {
  if (!hits) return false;
  const q = hits.quads.find((h) => inQuad(h.pts, x, y));
  if (!q) return false;
  hits.open(q.index);
  return true;
}

const KIND_TEXT: Record<ScanObject['kind'], string> = {
  known: 'known object found',
  unexplained: 'unexplained mover',
  predicted: 'predicted, not found',
};

/** The look of each square: plain while offered, else the record's state. */
function looks(v: ScanView | null, n: number): Look[] {
  if (v?.kind !== 'run' || !v.record)
    return Array.from({ length: n }, () => (v?.kind === 'run' ? 'todo' : 'plain'));
  const by = new Map(v.record.squares.map((s) => [s.index, s.state]));
  return Array.from({ length: n }, (_, i) => by.get(i + 1) ?? 'todo');
}

/** A quad moved `d` px toward its middle (so neighbouring borders do not overlap). */
function inset(p: Pt[], d: number): Pt[] {
  const c = {
    x: p.reduce((a, q) => a + q.x, 0) / p.length,
    y: p.reduce((a, q) => a + q.y, 0) / p.length,
  };
  return p.map((q) => {
    const dx = c.x - q.x;
    const dy = c.y - q.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: q.x + (dx / l) * d * Math.SQRT2, y: q.y + (dy / l) * d * Math.SQRT2 };
  });
}
const pts = (p: Pt[]) => p.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ');

export function ScanOverlay({ view }: { view: SkyView | null }) {
  const areaTool = useShellStore((s) => s.tool === 'area');
  const onScan = useAreaStore((s) => s.screen === 'scan');
  const scan = useScanStore((s) => s.view);
  const showPredicted = useScanStore((s) => s.showPredicted);
  const region = viewRegion(scan);
  const shown = areaTool && onScan && region !== null;
  const svgRef = useRef<SVGSVGElement>(null);

  const grid = useMemo(() => (region ? splitRegion(region) : null), [region]);
  const squareLooks = looks(scan, grid?.squares.length ?? 0);
  const events = scan?.kind === 'run' ? scan.record?.events : undefined;
  const objects = useMemo(
    () => visibleObjects(objectsFromEvents(events ?? []), showPredicted),
    [events, showPredicted],
  );
  const record = scan?.kind === 'run' ? scan.record : null;
  const flow = scan?.flow ?? 'discovery';

  const openSquare = (
    index: number,
    focus: Parameters<ReturnType<typeof useAreaStore.getState>['openSquare']>[2] = null,
  ) => {
    const sq = record?.squares.find((s) => s.index === index);
    if (!sq || sq.state !== 'done') return false;
    useAreaStore.getState().openSquare(regionBox(sq.box), flow, focus);
    return true;
  };
  const openObject = (o: ScanObject) => {
    const index = o.squares[0];
    if (index === undefined) return;
    openSquare(
      index,
      o.designation !== undefined ? { designation: o.designation } : { trackId: o.trackId ?? '' },
    );
  };
  const openRef = useRef(openSquare);

  // Re-projected on every sky render: the grid and the objects stay pinned to the sky.
  const place = useRef<() => void>(() => {});
  const placeNow = () => {
    const svg = svgRef.current;
    if (!svg || !grid) return;
    const quads: { index: number; pts: Pt[] }[] = [];
    grid.squares.forEach((s: GridSquare, i) => {
      const p = s.corners.map((c) => skyToPixels(c.ra, c.dec));
      const g = svg.querySelector<SVGGElement>(`[data-sq="${s.index}"]`);
      if (!g) return;
      if (p.some((q) => q === null)) {
        g.style.display = 'none';
        return;
      }
      const q = p as Pt[];
      g.style.display = '';
      const plain = squareLooks[i] === 'plain';
      g.querySelector('polygon.sx-scan-cell')?.setAttribute(
        'points',
        pts(plain ? q : inset(q, 1.5)),
      );
      g.querySelector('polygon.sx-scan-pulse')?.setAttribute('points', pts(inset(q, 4.5)));
      const t = g.querySelector('text');
      if (t) {
        t.setAttribute('x', (q[0]!.x + 7).toFixed(1));
        t.setAttribute('y', (q[0]!.y + 17).toFixed(1));
      }
      if (squareLooks[i] === 'done') quads.push({ index: s.index, pts: q });
    });
    hits = { quads, open: (index) => void openRef.current(index) };
    // Labels never overlap (as the area layer's placeLabels): found objects first, then
    // unexplained, then predicted; each tries the right of its ring, then the left, else it is not
    // drawn (the ring keeps its name as its accessible label).
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const RANK: Record<ScanObject['kind'], number> = { known: 0, unexplained: 1, predicted: 2 };
    const ordered = objects.slice().sort((a, b) => RANK[a.kind] - RANK[b.kind]);
    // Every ring on screen is an obstacle for the other objects' labels.
    const rings = objects.flatMap((o) => {
      const last = o.positions[o.positions.length - 1];
      const e = last ? skyToPixels(last.ra, last.dec) : null;
      return e ? [{ key: o.key, x0: e.x - 12, y0: e.y - 12, x1: e.x + 12, y1: e.y + 12 }] : [];
    });
    for (const o of ordered) {
      const g = svg.querySelector<SVGGElement>(`[data-obj="${CSS.escape(o.key)}"]`);
      if (!g) continue;
      const p = o.positions.map((q) => skyToPixels(q.ra, q.dec));
      if (p.some((q) => q === null)) {
        g.style.display = 'none';
        continue;
      }
      g.style.display = '';
      const q = p as Pt[];
      const end = q[q.length - 1]!;
      g.querySelector('path')?.setAttribute(
        'd',
        q.length > 1 ? `M${q.map((r) => `${r.x.toFixed(1)} ${r.y.toFixed(1)}`).join(' L')}` : '',
      );
      const ring = g.querySelector('circle');
      ring?.setAttribute('cx', end.x.toFixed(1));
      ring?.setAttribute('cy', end.y.toFixed(1));
      const label = g.querySelector('text');
      if (label) {
        // Width from the text length (11 px Inter is about 6 px a character).
        const w = Math.max(o.title.length, o.line.length) * 6 + 4;
        const spots = [
          { x: end.x + 14, anchor: 'start', x0: end.x + 12, x1: end.x + 14 + w },
          { x: end.x - 14, anchor: 'end', x0: end.x - 14 - w, x1: end.x - 12 },
        ];
        const y0 = end.y - 13;
        const y1 = end.y + (o.line ? 14 : 2);
        const hit = (
          sp: { x0: number; x1: number },
          r: { x0: number; y0: number; x1: number; y1: number },
        ) => sp.x0 < r.x1 && sp.x1 > r.x0 && y0 < r.y1 && y1 > r.y0;
        const spot = spots.find(
          (sp) =>
            !placed.some((r) => hit(sp, r)) && !rings.some((r) => r.key !== o.key && hit(sp, r)),
        );
        if (spot) {
          placed.push({ x0: spot.x0, y0, x1: spot.x1, y1 });
          label.style.display = '';
          label.setAttribute('text-anchor', spot.anchor);
          label.setAttribute('x', spot.x.toFixed(1));
          label.setAttribute('y', (end.y - 2).toFixed(1));
          label.querySelectorAll('tspan').forEach((ts) => ts.setAttribute('x', spot.x.toFixed(1)));
        } else label.style.display = 'none';
      }
    }
  };
  // The latest closures for the render loop and the click test, then a placement at once.
  useLayoutEffect(() => {
    place.current = placeNow;
    openRef.current = openSquare;
    if (shown) placeNow();
  });
  useEffect(() => {
    if (!view || !shown) {
      hits = null;
      return;
    }
    const off = view.onRender(() => place.current());
    view.requestRender();
    return () => {
      off();
      hits = null;
    };
  }, [view, shown]);

  if (!shown || !grid) return null;
  return (
    <svg
      ref={svgRef}
      className="sx-scan"
      data-testid="scan-overlay"
      data-cols={grid.cols}
      data-rows={grid.rows}
    >
      <defs>
        {(['known', 'unexplained', 'predicted'] as const).map((k) => (
          <marker
            key={k}
            id={`sx-arr-${k}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0 1 L9 5 L0 9z" className={`sx-scan-arr-${k}`} />
          </marker>
        ))}
      </defs>
      <g aria-hidden="true">
        {grid.squares.map((s, i) => (
          <g
            key={s.index}
            data-sq={s.index}
            data-state={squareLooks[i]}
            data-testid={`scan-square-${s.index}`}
          >
            <polygon className="sx-scan-cell" />
            {squareLooks[i] === 'running' && <polygon className="sx-scan-pulse" />}
            <text>{s.index}</text>
          </g>
        ))}
      </g>
      {objects.map((o) => (
        <g
          key={o.key}
          data-obj={o.key}
          data-kind={o.kind}
          className="sx-scan-obj"
          data-testid="scan-object"
          role="button"
          tabIndex={0}
          aria-label={`${o.title}, ${KIND_TEXT[o.kind]}${o.squares.length > 1 ? `, ${o.line}` : ''}. Open it`}
          onClick={() => openObject(o)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            openObject(o);
          }}
        >
          <path markerEnd={`url(#sx-arr-${o.kind})`} />
          <circle r={o.kind === 'predicted' ? 9 : 11} />
          <text>
            <tspan>{o.title}</tspan>
            {o.line && (
              <tspan dy="13" className="sx-scan-sub">
                {o.line}
              </tspan>
            )}
          </text>
        </g>
      ))}
    </svg>
  );
}

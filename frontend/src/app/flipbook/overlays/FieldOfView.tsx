// Field of view (issue #12): a small map of the current frame on the sky. Drawn in a tangent-plane
// (gnomonic) projection centred on the object, north up and east left (as the sky looks from
// Earth). It shows the detector footprint (`measured`), the cutout box (`derived`) and the object.
// A null footprint is refused and said so, never drawn from a guess.
import type { OverlayFrame, ProvenanceEntry, SkyPoint } from '@/app/api/types';
import { niceScale, toMap, type MapPoint } from './geometry';
import { ProvenanceBadge } from './ProvenanceBadge';

const SIZE = 200;
const PAD = 22;
/** Smallest drawn side of the cutout box, px: at the footprint's scale it can be under a pixel. */
const MIN_BOX_PX = 5;

export const FOV_NO_FOOTPRINT =
  'No detector footprint is on record for this frame, so the field of view can’t be drawn.';
export const FOV_NO_PROJECTION =
  'This frame’s footprint is too far from the object to draw on this map.';

function project(center: { ra: number; dec: number }, pts: readonly SkyPoint[]): MapPoint[] | null {
  const out: MapPoint[] = [];
  for (const p of pts) {
    const m = toMap(center.ra, center.dec, p);
    if (!m) return null;
    out.push(m);
  }
  return out;
}

export function FieldOfView({
  frame,
  center,
  footprintTag,
  boxTag,
  fixture,
  frameLabel,
}: {
  frame: OverlayFrame;
  /** The object's position, degrees: the map centre. */
  center: { ra: number; dec: number };
  footprintTag: ProvenanceEntry;
  boxTag: ProvenanceEntry;
  fixture: boolean;
  /** "frame 3" */
  frameLabel: string;
}) {
  const heading = (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="font-medium text-neutral-200">Field of view, {frameLabel}</span>
      <span className="flex items-center gap-1.5">
        Detector footprint <ProvenanceBadge entry={footprintTag} fixture={fixture} />
      </span>
      <span className="flex items-center gap-1.5">
        Cutout box <ProvenanceBadge entry={boxTag} fixture={fixture} />
      </span>
    </p>
  );
  const refuse = (text: string) => (
    <div className="flex flex-col gap-1 text-sm text-neutral-300" data-testid="fov">
      {heading}
      <p data-testid="fov-refused">{text}</p>
    </div>
  );

  if (frame.footprint === null) return refuse(FOV_NO_FOOTPRINT);
  const foot = project(center, frame.footprint);
  const box = project(center, frame.cutout_box);
  if (!foot || !box) return refuse(FOV_NO_PROJECTION);

  const all = [...foot, ...box, { u: 0, v: 0 }];
  const us = all.map((p) => p.u);
  const vs = all.map((p) => p.v);
  const [u0, u1] = [Math.min(...us), Math.max(...us)];
  const [v0, v1] = [Math.min(...vs), Math.max(...vs)];
  const span = Math.max(u1 - u0, v1 - v0) || 1 / 3600;
  const scale = (SIZE - 2 * PAD) / span;
  const uc = (u0 + u1) / 2;
  const vc = (v0 + v1) / 2;
  const sx = (u: number) => SIZE / 2 + (u - uc) * scale;
  const sy = (v: number) => SIZE / 2 + (v - vc) * scale;
  const points = (pts: readonly MapPoint[]) =>
    pts.map((p) => `${sx(p.u).toFixed(2)},${sy(p.v).toFixed(2)}`).join(' ');

  const bx = box.map((p) => sx(p.u));
  const by = box.map((p) => sy(p.v));
  const boxW = Math.max(...bx) - Math.min(...bx);
  const boxH = Math.max(...by) - Math.min(...by);
  const enlarged = boxW < MIN_BOX_PX && boxH < MIN_BOX_PX;
  const bcx = bx.reduce((a, b) => a + b, 0) / 4;
  const bcy = by.reduce((a, b) => a + b, 0) / 4;

  const bar = niceScale(span * 0.4);
  const barPx = bar.deg * scale;

  const summary =
    `Map of ${frameLabel} on the sky, centred on the object, north up and east left: ` +
    `the detector footprint (outline), the cutout box (filled${enlarged ? ', drawn larger than scale' : ''}) ` +
    `and the object (dot). The scale bar is ${bar.label}.`;

  return (
    <div className="flex flex-col gap-1 text-sm text-neutral-300" data-testid="fov">
      {heading}
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-full max-w-[200px] rounded-md border border-neutral-800 bg-black"
        role="img"
        aria-label={summary}
        data-testid="fov-map"
      >
        <polygon
          points={points(foot)}
          fill="rgb(56 189 248 / 0.08)"
          stroke="#a3a3a3"
          strokeWidth={1.5}
          data-testid="fov-footprint"
        />
        {enlarged ? (
          <rect
            x={bcx - MIN_BOX_PX / 2}
            y={bcy - MIN_BOX_PX / 2}
            width={MIN_BOX_PX}
            height={MIN_BOX_PX}
            fill="#fbbf24"
            data-testid="fov-box"
          />
        ) : (
          <polygon
            points={points(box)}
            fill="rgb(251 191 36 / 0.6)"
            stroke="#fbbf24"
            data-testid="fov-box"
          />
        )}
        <circle
          cx={sx(0)}
          cy={sy(0)}
          r={3}
          fill="#38bdf8"
          stroke="#0a0a0a"
          data-testid="fov-target"
        />
        <text x={SIZE / 2} y={12} textAnchor="middle" fill="#e5e5e5" fontSize={11}>
          N
        </text>
        <text x={8} y={SIZE / 2 + 4} textAnchor="middle" fill="#e5e5e5" fontSize={11}>
          E
        </text>
        <line
          x1={SIZE - PAD - barPx}
          x2={SIZE - PAD}
          y1={SIZE - 10}
          y2={SIZE - 10}
          stroke="#e5e5e5"
          strokeWidth={2}
        />
        <text
          x={SIZE - PAD - barPx / 2}
          y={SIZE - 14}
          textAnchor="middle"
          fill="#e5e5e5"
          fontSize={10}
        >
          {bar.label}
        </text>
      </svg>
      <p className="text-xs text-neutral-400" data-testid="fov-caption">
        North up, east left; tangent-plane projection centred on the object. Scale bar {bar.label}.
        {enlarged && ' The cutout box is drawn larger than scale so it stays visible.'}
      </p>
    </div>
  );
}

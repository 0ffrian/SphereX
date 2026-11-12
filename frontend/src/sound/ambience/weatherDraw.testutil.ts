// Test helpers for the weather overlay (#117): a fly camera basis built as core.js flyCamera does, and a recording 2D
// context.
import type { Basis } from './weatherDraw';

const nrm = (v: number[]): [number, number, number] => {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
  return [v[0]! / l, v[1]! / l, v[2]! / l];
};
const cross = (a: number[], b: number[]): number[] => [
  a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!,
];

/** core.js flyCamera (the horizon dip included) at (lon, lat), head, pitch, alt km over flat ground at groundKm. */
export function makeBasis(o: { lon?: number; lat?: number; head?: number; pitch?: number; altKm?: number; groundKm?: number; rkm?: number; ex?: number } = {}): Basis {
  const lon = o.lon ?? 0, lat = o.lat ?? 0, head = o.head ?? 0, rkm = o.rkm ?? 6371, ex = o.ex ?? 3;
  const up = [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
  const east = nrm(cross([0, 1, 0], up));
  const north = cross(up, east);
  const r = 1 + ((o.groundKm ?? 0) * ex + (o.altKm ?? 1)) / rkm;
  const pitch = (o.pitch ?? 0) - Math.acos(Math.min(1 / r, 1));
  const ch = Math.cos(head), sh = Math.sin(head);
  const fh = [0, 1, 2].map((k) => north[k]! * ch + east[k]! * sh);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const fwd = nrm([0, 1, 2].map((k) => fh[k]! * cp + up[k]! * sp));
  const rt = nrm(cross(fwd, up));
  const cu = cross(rt, fwd) as [number, number, number];
  return { cam: [up[0]! * r, up[1]! * r, up[2]! * r], fwd, rt, up: cu, rkm, ex, fov: 0.62 };
}

export interface Call { op: string; args: unknown[]; style?: unknown; width?: number }

/** A recording Ctx2D: every call with the fill/stroke style and line width at the time. */
export function recordingCtx() {
  const calls: Call[] = [];
  const grad = () => ({ addColorStop: (...args: unknown[]) => calls.push({ op: 'stop', args }) });
  const ctx = {
    strokeStyle: '' as unknown,
    fillStyle: '' as unknown,
    lineWidth: 1,
    lineCap: 'butt',
    clearRect: (...args: unknown[]) => calls.push({ op: 'clearRect', args }),
    beginPath: () => calls.push({ op: 'beginPath', args: [] }),
    moveTo: (...args: unknown[]) => calls.push({ op: 'moveTo', args }),
    lineTo: (...args: unknown[]) => calls.push({ op: 'lineTo', args }),
    rect: (...args: unknown[]) => calls.push({ op: 'rect', args }),
    stroke: () => calls.push({ op: 'stroke', args: [], style: ctx.strokeStyle, width: ctx.lineWidth }),
    fill: () => calls.push({ op: 'fill', args: [], style: ctx.fillStyle }),
    fillRect: (...args: unknown[]) => calls.push({ op: 'fillRect', args, style: ctx.fillStyle }),
    setTransform: (...args: unknown[]) => calls.push({ op: 'setTransform', args }),
    createRadialGradient: (...args: number[]) => {
      if (!args.every(Number.isFinite)) throw new TypeError('non-finite');
      calls.push({ op: 'radial', args });
      return grad();
    },
    createLinearGradient: (...args: number[]) => {
      if (!args.every(Number.isFinite)) throw new TypeError('non-finite');
      calls.push({ op: 'linear', args });
      return grad();
    },
  };
  return { ctx, calls };
}

/** The alpha of an rgba() string. */
export function alphaOf(css: unknown): number {
  const m = /rgba\([^)]*,([\d.]+)\)$/.exec(String(css));
  return m ? Number(m[1]) : NaN;
}

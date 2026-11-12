// Issue #93 F1: the fly view's max-height pyramid must be a ceiling of the marched surface everywhere FLY_FS trusts it:
// any point within one cell width (2^L texels) of a cell, read through the coastline warp and the bilinear filter, with
// every noise octave at its highest, stays at or below the cell's value. A synthetic grid with one-texel spikes (the
// B4 class: narrow peaks) and spikes next to the poles (where the warp reaches furthest in longitude).
import { describe, expect, it } from 'vitest';
import { PYR, buildPyramid, ceilKm, pyramidCached } from './heightPyramid.js';
import { FLY_FS } from './shaders.js';

const W = 720,
  H = 360;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    return s / 4294967296;
  };
}

function grid(seed: number) {
  const r = rng(seed),
    data = new Float32Array(W * H * 2);
  for (let i = 0; i < W * H; i++) data[i * 2] = (r() - 0.6) * 3;
  // one-texel spikes, some at the first and last rows (the poles)
  for (let k = 0; k < 400; k++) {
    const j = k < 40 ? (k % 2 ? 0 : H - 1 - (k % 3)) : Math.floor(r() * H),
      i = Math.floor(r() * W);
    data[(j * W + i) * 2] = 4 + r() * 9;
  }
  return { W, H, data };
}

/** The height grid read bilinearly at a direction, as FLY_FS's texture(uHt, uvOf(d)) does (wrap in x, clamp in y). */
function bilinear(data: Float32Array, d: number[]) {
  const u = Math.atan2(d[2]!, d[0]!) / (2 * Math.PI) + 0.5,
    v = Math.asin(Math.max(-1, Math.min(1, d[1]!))) / Math.PI + 0.5;
  const px = u * W - 0.5,
    py = v * H - 0.5,
    x0 = Math.floor(px),
    y0 = Math.floor(py),
    fx = px - x0,
    fy = py - y0;
  const at = (x: number, y: number) =>
    data[(Math.max(0, Math.min(H - 1, y)) * W + (((x % W) + W) % W)) * 2]!;
  return (
    (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
    (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy
  );
}

const norm = (v: number[]) => {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return v.map((x) => x / l);
};
const dirOf = (lon: number, lat: number) => [
  Math.cos(lat) * Math.cos(lon),
  Math.sin(lat),
  Math.cos(lat) * Math.sin(lon),
];
/** A direction at angle a from d, toward bearing b. */
function moveBy(d: number[], a: number, b: number) {
  const ref = Math.abs(d[1]!) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  const e = norm([
    ref[1]! * d[2]! - ref[2]! * d[1]!,
    ref[2]! * d[0]! - ref[0]! * d[2]!,
    ref[0]! * d[1]! - ref[1]! * d[0]!,
  ]);
  const n = [
    d[1]! * e[2]! - d[2]! * e[1]!,
    d[2]! * e[0]! - d[0]! * e[2]!,
    d[0]! * e[1]! - d[1]! * e[0]!,
  ];
  const t = [0, 1, 2].map((k) => Math.cos(b) * e[k]! + Math.sin(b) * n[k]!);
  return norm([0, 1, 2].map((k) => Math.cos(a) * d[k]! + Math.sin(a) * t[k]!));
}

/** The pyramid value FLY_FS reads (pyrK) for direction d at level L. */
function pyrAt(P: { data: Float32Array }, d: number[], L: number) {
  const u = Math.atan2(d[2]!, d[0]!) / (2 * Math.PI) + 0.5,
    v = Math.asin(Math.max(-1, Math.min(1, d[1]!))) / Math.PI + 0.5;
  const i = Math.min(719, Math.max(0, Math.floor(u * 720))) >> L,
    j = Math.min(359, Math.max(0, Math.floor(v * 360))) >> L;
  const ox = L === 0 ? 0 : 720 - (720 >> (L - 1)),
    oy = L === 0 ? 0 : 360;
  return P.data[(oy + j) * PYR.TW + ox + i]!;
}

describe('fly view max-height pyramid (issue #93 F1)', () => {
  it('bounds the noise terms by their exact ranges', () => {
    expect(PYR.DETAIL).toBeCloseTo(0.45 * 0.6 + 1.1 * (63 / 64), 12);
    expect(PYR.FINE).toBe(0.07);
    // the warp: two octaves of (vn3 - .5) times .008 and .0025, per component, then normalised
    expect(PYR.WARP).toBeGreaterThanOrEqual(Math.asin(Math.sqrt(3) * (0.004 + 0.00125)));
    expect(FLY_FS).toContain('(vn3(wq)-.5)*.008+(vn3(wq*4.)-.5)*.0025');
    expect(FLY_FS).toContain(
      '((ridge(p,4)-.55)*.6+efbm(p*.8)*1.1)*(.3+2.6*m)+(fbm(p*3.7,3)-.5)*.14',
    );
    expect(FLY_FS).toContain('m=smoothstep(.1,2.5,e)');
  });

  it('is a ceiling of the warped, bilinear surface within one cell of every cell, at every level', () => {
    const t = grid(7),
      P = buildPyramid(t)!,
      r = rng(99);
    let worst = Infinity,
      n = 0;
    for (let k = 0; k < 40000; k++) {
      // bias toward the poles, where the longitude reach is largest
      const lat =
          (k % 4 === 0 ? Math.sign(r() - 0.5) * (1.45 + r() * 0.12) : (r() - 0.5) * Math.PI) *
          0.9999,
        lon = (r() - 0.5) * 2 * Math.PI,
        d = dirOf(lon, lat),
        L = Math.floor(r() * PYR.LEVELS),
        c = (1 << L) * (Math.PI / 360),
        pm = Math.abs(lat) + c;
      if (pm >= 1.5) continue;
      // FLY_FS's travel limit for this level (pyrStep), then the warp from there
      const s = Math.asin(Math.sin(c) * Math.cos(pm)),
        q = moveBy(d, s * r(), r() * 2 * Math.PI),
        qw = moveBy(q, Math.asin(Math.sqrt(3) * (0.004 + 0.00125)) * r(), r() * 2 * Math.PI);
      const e = bilinear(t.data, qw),
        top = ceilKm(e);
      worst = Math.min(worst, pyrAt(P, d, L) - top);
      n++;
    }
    expect(n).toBeGreaterThan(20000);
    expect(worst).toBeGreaterThanOrEqual(0);
  });

  it('keeps one-texel peaks: the ceiling over a spike is the spike plus the full detail', () => {
    const t = grid(3),
      P = buildPyramid(t)!;
    let checked = 0;
    for (let j = 1; j < H - 1; j += 7)
      for (let i = 0; i < W; i += 11) {
        const v = t.data[(j * W + i) * 2]!;
        if (v < 4) continue;
        const d = dirOf(((i + 0.5) / W - 0.5) * 2 * Math.PI, ((j + 0.5) / H - 0.5) * Math.PI);
        for (let L = 0; L < PYR.LEVELS; L++)
          expect(pyrAt(P, d, L)).toBeGreaterThanOrEqual(ceilKm(v));
        checked++;
      }
    expect(checked).toBeGreaterThan(0);
  });

  it('is deterministic, cached per terrain, and refuses a grid that is not 720 x 360', () => {
    const t = grid(5);
    const a = buildPyramid(t)!,
      b = buildPyramid({ W, H, data: t.data.slice() })!;
    expect(Buffer.from(a.data.buffer).equals(Buffer.from(b.data.buffer))).toBe(true);
    expect(pyramidCached(t)).toBe(pyramidCached(t));
    expect(buildPyramid({ W: 360, H: 180, data: new Float32Array(360 * 180 * 2) })).toBeNull();
  });

  it('FLY_FS marches with it and keeps its loops as loops (Q-337)', () => {
    expect(FLY_FS).toContain('uniform highp sampler2D uPyr;uniform float uPyrOn;');
    expect(FLY_FS).toContain('for(int k=0;k<7+uZ0;k++){if(lv<0)break;');
    expect(FLY_FS).toContain('if(rm>=1.&&rm-1e-6-te*6e-5>pyrR(pyrK(uv,lv)))');
    // the shadow skips only steps that cannot darken (10 gq / st >= 1)
    expect(FLY_FS).toContain(
      'if(uPyrOn<.5||rq-pyrR(pyrK(uvOf(s2/rq),0))<st*.1)gq=rq-surfR(s2/rq);',
    );
  });
});

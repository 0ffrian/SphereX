// @ts-nocheck
// Issue #93 F1 (fly view ticket 1; hand-written, not extracted): the max-height pyramid of the fly view's ray march.
// FLY_FS marches the surface hKm(d) (shaders.js, the bilinear read, HQ false):
//   e + ((ridge - .55) .6 + efbm 1.1) (.3 + 2.6 m(e)) + (fbm - .5) .14,  m(e) = smoothstep(.1, 2.5, e),
// with e the 720 x 360 height grid read bilinearly through the coastline warp (two octaves, at most .008 / 2 and
// .0025 / 2 per component, so under WARP radians from d). Every noise term has a known range (value noise in [0, 1]:
// ridge in [0, 1], efbm in [-0.984, 0.984], fbm in [0, 1]), so the surface can never rise above
//   ceil(e) = e + 1.3528 (.3 + 2.6 m(e)) + .07  (km),
// with e the highest texel the warp and the bilinear read can reach (m is monotone). The lava sea (uHM) and the
// ocean floor at 0 are applied in the shader. Level L holds, for each cell of 2^L x 2^L texels, the highest ceiling
// within one cell width (2^L texels) of any point of the cell, so a ray that stays within that distance and above
// that height cannot meet the surface: FLY_FS steps over it in one go. Everything here is an upper bound (no physical
// value is made up): the marched surface itself is unchanged.
// Layout (one R32F texture, PYR.TW x PYR.TH): level 0 at (0, 0), 720 x 360; level L >= 1 at x = 720 - (720 >> (L - 1)),
// y = 360, ceil(720 / 2^L) x ceil(360 / 2^L) cells. FLY_FS reads cell (i >> L, j >> L), with (i, j) the texel under d.
// Built once per terrain object (terrains are shared read-only, Q-341; the pyramid only reads t.data).

var PYR = {
  W: 720,
  H: 360,
  LEVELS: 7,
  TW: 720,
  TH: 540,
  /** Largest angle (radians) the coastline warp moves a point: |(.008 + .0025) / 2| per component, times sqrt(3), normalised; rounded up. */
  WARP: 0.0095,
  /** Highest value of ((ridge - .55) .6 + efbm 1.1): .45 x .6 + (1 - 2^-6) x 1.1. */
  DETAIL: 0.27 + 1.1 * (1 - 1 / 64),
  /** Highest value of (fbm - .5) .14. */
  FINE: 0.07,
};

function sstep(a, b, x) { var t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); }

/** The highest the marched surface can be over a texel neighbourhood whose highest height is e (km). */
function ceilKm(e) { return e + PYR.DETAIL * (0.3 + 2.6 * sstep(0.1, 2.5, e)) + PYR.FINE; }

/** Windowed maximum of row (length n) over [i - r, i + r], wrapping; r >= n / 2 gives the row's maximum. */
function rowMax(src, off, n, r, dst, doff) {
  var i, k, m;
  if (2 * r + 1 >= n) {
    m = -Infinity; for (i = 0; i < n; i++) if (src[off + i] > m) m = src[off + i];
    for (i = 0; i < n; i++) dst[doff + i] = m;
    return;
  }
  for (i = 0; i < n; i++) {
    m = -Infinity;
    for (k = i - r; k <= i + r; k++) { var v = src[off + ((k % n) + n) % n]; if (v > m) m = v; }
    dst[doff + i] = m;
  }
}

/** The pyramid of terrain t ({ W, H, data: Float32Array of (height km, plate) pairs }), or null when its grid is not 720 x 360. */
function buildPyramid(t) {
  var Wd = t.W, Hd = t.H, i, j, k, L;
  if (Wd !== PYR.W || Hd !== PYR.H) return null;
  var c0 = Math.PI / Hd, N = Wd * Hd;
  // texel values as FLY_FS sees them, rounded up: the grid is uploaded as half floats (relative error 2^-11)
  var e = new Float32Array(N);
  for (i = 0; i < N; i++) { var v = t.data[i * 2]; e[i] = v + Math.abs(v) * 1e-3 + 1e-3; }
  // the warp moves a point by at most WARP, so its cell by at most ceil(WARP / c0) rows; the bilinear read adds one
  var RJ = Math.ceil(PYR.WARP / c0) + 1, V = new Float32Array(N), D = new Float32Array(N);
  for (j = 0; j < Hd; j++) for (i = 0; i < Wd; i++) {
    var m = -Infinity;
    for (k = Math.max(0, j - RJ); k <= Math.min(Hd - 1, j + RJ); k++) if (e[k * Wd + i] > m) m = e[k * Wd + i];
    V[j * Wd + i] = m;
  }
  for (j = 0; j < Hd; j++) {
    // the highest latitude a warped point of this row can reach; the longitude reach grows as 1 / cos(latitude)
    var pm = Math.max(Math.abs(j * c0 - Math.PI / 2), Math.abs((j + 1) * c0 - Math.PI / 2)) + PYR.WARP, cm = Math.cos(pm);
    var dl = cm > Math.sin(PYR.WARP) ? Math.asin(Math.sin(PYR.WARP) / cm) : Math.PI, ri = dl >= Math.PI ? Wd : Math.ceil(dl / c0) + 1;
    rowMax(V, j * Wd, Wd, ri, D, j * Wd);
  }
  var H0 = new Float32Array(N);
  for (i = 0; i < N; i++) H0[i] = ceilKm(D[i]) + 0.002;
  var out = new Float32Array(PYR.TW * PYR.TH);
  for (L = 0; L < PYR.LEVELS; L++) {
    var s = 1 << L, nI = Math.ceil(Wd / s), nJ = Math.ceil(Hd / s), ox = L === 0 ? 0 : Wd - (Wd >> (L - 1)), oy = L === 0 ? 0 : Hd;
    // columns: the cell's own columns and s more on each side (wrapping in longitude)
    var Hh = new Float32Array(Hd * nI), I, J;
    for (j = 0; j < Hd; j++) for (I = 0; I < nI; I++) {
      var a = I * s - s, b = Math.min((I + 1) * s, Wd) + s, mm = -Infinity;
      if (b - a >= Wd) { for (k = 0; k < Wd; k++) if (H0[j * Wd + k] > mm) mm = H0[j * Wd + k]; }
      else for (k = a; k < b; k++) { var q = H0[j * Wd + ((k % Wd) + Wd) % Wd]; if (q > mm) mm = q; }
      Hh[j * nI + I] = mm;
    }
    // rows: the cell's own rows and s more on each side (clamped at the poles)
    for (J = 0; J < nJ; J++) for (I = 0; I < nI; I++) {
      var r0 = Math.max(0, J * s - s), r1 = Math.min(Hd, Math.min((J + 1) * s, Hd) + s), mx = -Infinity;
      for (k = r0; k < r1; k++) if (Hh[k * nI + I] > mx) mx = Hh[k * nI + I];
      out[(oy + J) * PYR.TW + ox + I] = mx;
    }
  }
  return { w: PYR.TW, h: PYR.TH, data: out };
}

var cache = new WeakMap();

/** buildPyramid(t), computed once per terrain object. */
function pyramidCached(t) {
  if (!cache.has(t)) cache.set(t, buildPyramid(t));
  return cache.get(t);
}

export { PYR, ceilKm, buildPyramid, pyramidCached };

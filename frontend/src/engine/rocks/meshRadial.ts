// Issue #71, D-37 (stream V3): a shape model as a radial height map for the prototype's rock engine.
// The engine draws `radius(direction) * (1 + h)`; for a mesh `h = r(direction) / r_mean - 1` where
// r is how far the model's surface is from its centre along that direction (the model is treated as
// star-shaped, which holds for Bennu and for the 67P nucleus except under a few overhangs: the
// farthest surface wins). Pure maths over a flat triangle list; deterministic.
export interface RadialMap {
  /** `h` per texel, row-major, width x height. */
  h: Float32Array;
  /** Largest `1 + h`: the engine's scale extent. */
  ext: number;
  /** Texels no triangle covered (filled from neighbours). */
  holes: number;
}

/** Triangles as x y z triples, nine numbers each, relative to the model's centre. */
export function radialHeights(tris: Float32Array, TW = 1024, TH = 512): RadialMap {
  const r = new Float32Array(TW * TH);
  const n = tris.length / 9;
  const TAU = Math.PI * 2;
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const ax = tris[o]!,
      ay = tris[o + 1]!,
      az = tris[o + 2]!;
    const bx = tris[o + 3]!,
      by = tris[o + 4]!,
      bz = tris[o + 5]!;
    const cx = tris[o + 6]!,
      cy = tris[o + 7]!,
      cz = tris[o + 8]!;
    const lons = [Math.atan2(az, ax), Math.atan2(bz, bx), Math.atan2(cz, cx)];
    const lats = [
      Math.asin(Math.max(-1, Math.min(1, ay / (Math.hypot(ax, ay, az) || 1)))),
      Math.asin(Math.max(-1, Math.min(1, by / (Math.hypot(bx, by, bz) || 1)))),
      Math.asin(Math.max(-1, Math.min(1, cy / (Math.hypot(cx, cy, cz) || 1)))),
    ];
    let lmin = Math.min(...lats),
      lmax = Math.max(...lats);
    let omin = Math.min(...lons),
      omax = Math.max(...lons);
    let full = false;
    if (omax - omin > Math.PI) {
      const sh = lons.map((l) => (l < 0 ? l + TAU : l));
      omin = Math.min(...sh);
      omax = Math.max(...sh);
      if (omax - omin > Math.PI) {
        full = true; // the triangle holds a pole
        if (lmin + lmax >= 0) lmax = Math.PI / 2;
        else lmin = -Math.PI / 2;
      }
    }
    const j0 = Math.max(0, Math.floor((lmin / Math.PI + 0.5) * TH) - 1);
    const j1 = Math.min(TH - 1, Math.ceil((lmax / Math.PI + 0.5) * TH) + 1);
    const i0 = full ? 0 : Math.floor((omin / TAU + 0.5) * TW) - 1;
    const i1 = full ? TW - 1 : Math.ceil((omax / TAU + 0.5) * TW) + 1;
    // Edges for Moller-Trumbore with the ray origin at the centre.
    const e1x = bx - ax,
      e1y = by - ay,
      e1z = bz - az;
    const e2x = cx - ax,
      e2y = cy - ay,
      e2z = cz - az;
    for (let j = j0; j <= j1; j++) {
      const la = ((j + 0.5) / TH - 0.5) * Math.PI;
      const cl = Math.cos(la),
        sl = Math.sin(la);
      for (let ii = i0; ii <= i1; ii++) {
        const i = ((ii % TW) + TW) % TW;
        const lo = ((i + 0.5) / TW - 0.5) * TAU;
        const dx = cl * Math.cos(lo),
          dy = sl,
          dz = cl * Math.sin(lo);
        const px = dy * e2z - dz * e2y,
          py = dz * e2x - dx * e2z,
          pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det;
        const tx = -ax,
          ty = -ay,
          tz = -az;
        const u = (tx * px + ty * py + tz * pz) * inv;
        if (u < -1e-6 || u > 1 + 1e-6) continue;
        const qx = ty * e1z - tz * e1y,
          qy = tz * e1x - tx * e1z,
          qz = tx * e1y - ty * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < -1e-6 || u + v > 1 + 1e-6) continue;
        const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (d > r[j * TW + i]!) r[j * TW + i] = d;
      }
    }
  }
  // Holes: copy the nearest covered texel on the row, then the rows above and below.
  let holes = 0;
  for (let k = 0; k < r.length; k++) if (r[k] === 0) holes++;
  for (let pass = 0; pass < 4 && holes > 0; pass++) {
    const src = r.slice();
    for (let j = 0; j < TH; j++)
      for (let i = 0; i < TW; i++) {
        if (src[j * TW + i] !== 0) continue;
        let s = 0,
          c = 0;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const jj = j + dj;
            if (jj < 0 || jj >= TH) continue;
            const v = src[jj * TW + ((i + di + TW) % TW)]!;
            if (v > 0) {
              s += v;
              c++;
            }
          }
        if (c > 0) r[j * TW + i] = s / c;
      }
    holes = 0;
    for (let k = 0; k < r.length; k++) if (r[k] === 0) holes++;
  }
  let sum = 0,
    cnt = 0;
  for (let k = 0; k < r.length; k++)
    if (r[k]! > 0) {
      sum += r[k]!;
      cnt++;
    }
  const mean = cnt > 0 ? sum / cnt : 1;
  const h = new Float32Array(TW * TH);
  let mx = 1;
  for (let k = 0; k < r.length; k++) {
    const v = r[k]! > 0 ? r[k]! / mean : 1;
    h[k] = v - 1;
    if (v > mx) mx = v;
  }
  return { h, ext: mx, holes };
}

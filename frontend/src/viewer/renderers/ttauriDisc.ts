// Issue #62, R7.5: the T Tauri circumstellar disc as a flared, lit disc (three r187 TSL).
//
// The old disc was one flat `RingGeometry` with an unlit material in one colour. This one has:
//   - flaring: the half-thickness grows with radius, `H(r) = H_in (r / r_in)^p`, so the disc has a
//     top and a bottom surface, an inner wall that faces the star and an outer wall;
//   - radial falloff: the brightness drops as `(r_in / r)^1.8` and the disc fades out at its edge;
//   - a bright inner rim: the hot inner wall glows;
//   - light from the star: each fragment is lit by the direction to the star (the origin), with
//     wrap lighting so the grazing top surface is not black;
//   - a dark midplane lane: the walls darken toward the midplane, and surfaces seen at a graze
//     darken as a thick dust column does;
//   - depth: the disc is depth-tested against the opaque star and does not write depth, so the near
//     half passes in front of the star and the far half is hidden behind it.
//   - order (PR #63 review): a transparent mesh with no depth write blends its triangles in index
//     order, so the internal overlap (the far wall seen through the near surface) was unsorted and the
//     near side was almost opaque over the star. The disc is now two passes over one geometry: the
//     back faces first (BackSide, renderOrder BACK_RENDER_ORDER: the far wall and the underside), then
//     the front faces (FrontSide, renderOrder FRONT_RENDER_ORDER) at a lower opacity, so the star stays
//     visible through the thin near rim. A fixed order, not a depth sort: deterministic for any view.
// Everything about it (radii, tilt, flaring, colours, the falloff and rim constants) is `artistic`
// (R7.5); no physical value is claimed. The geometry is built in the XY plane with Z as the
// thickness, so the same `rotation.x = inclination` as before tilts it away from face-on.
/* eslint-disable @typescript-eslint/no-explicit-any -- TSL node graphs are built from untyped proxies */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  BackSide,
  FrontSide,
  Mesh,
  MeshBasicNodeMaterial,
  SRGBColorSpace,
} from 'three/webgpu';
import {
  abs,
  clamp,
  dot,
  exp,
  float,
  length,
  max,
  mix,
  normalize,
  normalLocal,
  normalView,
  positionLocal,
  positionView,
  pow,
  smoothstep,
  vec2,
  vec3,
} from 'three/tsl';
import type { DiscPlan } from '../planTypes';

/** Dust colour of the disc, sRGB (artistic; the previous flat disc's colour). */
export const DISC_DUST_COLOUR = 0x8a7a6a;
/** Colour of the hot inner rim, sRGB (artistic). */
export const DISC_RIM_COLOUR = 0xffc785;
/** Angular and radial resolution of the surfaces. */
export const DISC_SEGMENTS = { around: 128, radial: 40, thickness: 10 } as const;

/** Render order of the back-face pass (drawn first) and the front-face pass (artistic, fixed). */
export const BACK_RENDER_ORDER = 1;
export const FRONT_RENDER_ORDER = 2;
/** Opacity of the near (front-face) pass relative to the far pass, so the star shows through (artistic). */
export const FRONT_OPACITY_SCALE = 0.55;

/** Half-thickness of the disc at radius `r`: `H_in (r / r_in)^p` (artistic). */
export function discHalfHeight(disc: DiscPlan, r: number): number {
  return disc.heightAtInner * Math.pow(r / disc.innerRadius, disc.flareExponent);
}

/**
 * The flared disc: top and bottom surfaces from the inner to the outer radius, the inner wall and
 * the outer wall, closed. Pure: the same plan gives the same vertices.
 */
export function flaredDiscGeometry(disc: DiscPlan): BufferGeometry {
  const { around, radial, thickness } = DISC_SEGMENTS;
  const pos: number[] = [];
  const idx: number[] = [];
  const rows = (rings: number, point: (i: number, a: number) => [number, number, number]) => {
    const base = pos.length / 3;
    for (let i = 0; i <= rings; i++) {
      for (let j = 0; j <= around; j++) {
        const a = (j / around) * Math.PI * 2;
        pos.push(...point(i, a));
      }
    }
    return base;
  };
  const link = (base: number, rings: number, flip: boolean) => {
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < around; j++) {
        const a = base + i * (around + 1) + j;
        const b = a + 1;
        const c = a + around + 1;
        const d = c + 1;
        if (flip) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
    }
  };
  const radiusAt = (i: number) =>
    disc.innerRadius + (i / radial) * (disc.outerRadius - disc.innerRadius);
  // Top (+z) and bottom (-z) surfaces; the winding makes each normal point away from the midplane.
  const top = rows(radial, (i, a) => {
    const r = radiusAt(i);
    return [r * Math.cos(a), r * Math.sin(a), discHalfHeight(disc, r)];
  });
  link(top, radial, true);
  const bottom = rows(radial, (i, a) => {
    const r = radiusAt(i);
    return [r * Math.cos(a), r * Math.sin(a), -discHalfHeight(disc, r)];
  });
  link(bottom, radial, false);
  // Inner wall (faces the axis, so the star) and outer wall (faces away).
  const wall = (r: number, inward: boolean) => {
    const h = discHalfHeight(disc, r);
    const base = rows(thickness, (i, a) => [
      r * Math.cos(a),
      r * Math.sin(a),
      h - (i / thickness) * 2 * h,
    ]);
    link(base, thickness, !inward);
  };
  wall(disc.innerRadius, true);
  wall(disc.outerRadius, false);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * The lit, flared disc: the back-face mesh (returned, tilted by the plan) with the front-face mesh as
 * its only child (same geometry, so it tilts with it). Both are transparent, depth-tested, no depth write.
 */
export function buildTTauriDisc(disc: DiscPlan): Mesh {
  const geometry = flaredDiscGeometry(disc);
  const dust = new Color().setHex(DISC_DUST_COLOUR, SRGBColorSpace);
  const rim = new Color().setHex(DISC_RIM_COLOUR, SRGBColorSpace);

  const p = positionLocal;
  const r = max(length(vec2(p.x, p.y)), disc.innerRadius);
  const span = disc.outerRadius - disc.innerRadius;
  const rn = clamp(r.sub(disc.innerRadius).div(span), 0, 1);
  const halfHeight = float(disc.heightAtInner).mul(
    pow(r.div(disc.innerRadius), float(disc.flareExponent)),
  );
  // 0 on the midplane, 1 on the top and bottom surfaces.
  const hn = clamp(abs(p.z).div(halfHeight), 0, 1);

  // Light from the star at the origin; wrap lighting keeps the grazing surfaces from going black.
  const toStar = normalize(p.negate());
  const n = normalize(normalLocal);
  const lit = clamp(dot(n, toStar).mul(3).add(0.5), 0, 1);
  const falloff = pow(float(disc.innerRadius).div(r), float(1.8));
  let col: any = vec3(dust.r, dust.g, dust.b)
    .mul(falloff.mul(1.6).add(0.12))
    .mul(lit.mul(0.8).add(0.3));

  // Bright inner rim: hot dust at the inner edge, strongest on the wall that faces the star.
  const rimGlow = exp(rn.mul(-9)).mul(lit.mul(0.6).add(0.6));
  col = col.add(vec3(rim.r, rim.g, rim.b).mul(rimGlow.mul(1.5)));

  // Midplane lane: the walls darken toward the midplane (more with distance), and a surface seen at
  // a graze darkens like a thick dust column does.
  const laneStrength = smoothstep(0.05, 0.6, rn);
  const lane = mix(float(1), mix(float(0.12), float(1), smoothstep(0, 0.6, hn)), laneStrength);
  const mu = abs(dot(normalView, normalize(positionView.negate())));
  const graze = mix(float(0.45), float(1), smoothstep(0.05, 0.5, mu));
  col = col.mul(lane).mul(mix(float(1), graze, smoothstep(0.1, 0.5, rn)));

  const outerFade = float(1).sub(smoothstep(0.8, 1, rn));
  const opacity = clamp(falloff.mul(1.2).add(0.16), 0, 0.96).mul(outerFade);
  const pass = (side: typeof BackSide | typeof FrontSide, scale: number) => {
    const m = new MeshBasicNodeMaterial();
    m.colorNode = col;
    m.opacityNode = opacity.mul(scale);
    m.transparent = true;
    m.side = side;
    // Depth-tested against the opaque star (near half in front, far half hidden), no depth write.
    m.depthTest = true;
    m.depthWrite = false;
    return m;
  };

  const mesh = new Mesh(geometry, pass(BackSide, 1));
  mesh.name = 'disc';
  mesh.renderOrder = BACK_RENDER_ORDER;
  mesh.rotation.x = (disc.inclinationDeg * Math.PI) / 180;
  const front = new Mesh(geometry, pass(FrontSide, FRONT_OPACITY_SCALE));
  front.name = 'disc-front';
  front.renderOrder = FRONT_RENDER_ORDER;
  mesh.add(front);
  return mesh;
}

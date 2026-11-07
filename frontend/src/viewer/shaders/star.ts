// Issue #42, R7.5, R7.5.1 to R7.5.5: the star surface as a three r187 TSL node material.
//
// The picture is a pure function of the uniforms. Which spot groups and flares exist at time t is
// decided on the CPU (`bodies/starModel.ts`, bounded phases from `motion/phase.ts`) and given here,
// so no state lives between frames and float32 time never grows without bound (Q-68).
//
// Layers (each can be left out; the plan decides by tier and honesty state, D-21, D-32):
//   photosphere  Teff colour x linear limb darkening (R7.5) x granulation (cells, dark lanes,
//                churn) carried by differential rotation Omega(phi) = Omega_eq (1 - k sin^2 phi)
//   spots        leader, broken-up follower and pores; near-black umbra with umbral dots and a
//                filamentary penumbra (radial streaks from noise in polar coordinates)
//   faculae      bright patches around the groups that brighten towards the limb
//   flares       two ribbons either side of the polarity line plus kernels, HDR so they bloom
// Colour values here are display choices (artistic) except the tint, which is the Teff colour.
/* eslint-disable @typescript-eslint/no-explicit-any -- TSL node graphs are built from untyped proxies */
import { MeshBasicNodeMaterial, Vector4 } from 'three/webgpu';
import {
  abs,
  atan,
  cos,
  cross,
  dot,
  exp,
  float,
  length,
  mix,
  mx_noise_float,
  mx_worley_noise_float,
  normalize,
  normalView,
  positionLocal,
  pow,
  saturate,
  select,
  sin,
  smoothstep,
  uniform,
  vec3,
} from 'three/tsl';
import { seedOffset } from './noise';
import type { FlareState, RegionState, StarSurfaceConfig } from '../bodies/starModel';
import { STAR_SURFACE, discsPerRegion } from '../bodies/starModel';

export interface StarShaderOptions {
  /** Teff colour (derived), already the plan's tint. */
  tint: readonly [number, number, number];
  /** Brightness multiplier (the Mira light curve; 1 otherwise). */
  emissive: number;
  /** Linear limb-darkening coefficient u of I(mu) = 1 - u (1 - mu), or null for none (R7.5). */
  limbU: number | null;
  /** The card seed, reduced by `seedOffset` for the noise. */
  seed: number;
  /** Quality level octave count (R5.7). */
  octaves: number;
  granulation: boolean;
  spots: boolean;
  faculae: boolean;
  flares: boolean;
  cfg?: StarSurfaceConfig;
}

/** One frame of what the shader draws: the CPU's answer for time t. */
export interface StarFrame {
  regions: readonly RegionState[];
  flares: readonly FlareState[];
  /** Flow-map phases for the mottling: shear angle per sin^2(lat) for copy A and B, weight of A. */
  shearA: number;
  shearB: number;
  churnA: number;
  churnB: number;
  weightA: number;
}

/** Granule cells across the disc (artistic: real granules are far too small to resolve). */
export const CELLS_ACROSS = 30;
/** Contrast of the granules, and of the large-scale mottling (artistic). */
const GRAIN_AMP = 0.13;
const MOTTLE_AMP = 0.05;
/** Umbra and penumbra brightness relative to the photosphere (artistic). */
const UMBRA = 0.06;
const PENUMBRA_LO = 0.5;
const PENUMBRA_HI = 0.88;
/** Facula brightening and flare brightness, relative to the photosphere (artistic; flares are HDR). */
const FACULA_AMP = 0.45;
const FLARE_RIBBON = 0.9;
const FLARE_KERNEL = 2.6;
/** Distance of each ribbon from the polarity line, as a fraction of the group size (artistic). */
export const FLARE_RIBBON_OFFSET = 0.32;
/** Hot white-orange of a flare (artistic). */
const FLARE_COLOUR = [1.0, 0.78, 0.58] as const;

const rotY = (p: any, a: any) => {
  const c = cos(a);
  const s = sin(a);
  return vec3(p.x.mul(c).add(p.z.mul(s)), p.y, p.x.negate().mul(s).add(p.z.mul(c)));
};

export interface StarMaterial {
  material: MeshBasicNodeMaterial;
  /** Writes the frame into the uniforms. No allocation of nodes; call every frame. */
  update(frame: StarFrame): void;
}

export function buildStarMaterial(opts: StarShaderOptions): StarMaterial {
  const cfg = opts.cfg ?? STAR_SURFACE;
  const nDisc = discsPerRegion(cfg);
  const so = seedOffset(opts.seed);
  const seedV = vec3(so[0], so[1], so[2]);

  // Uniforms ------------------------------------------------------------------------------------
  const discU = Array.from({ length: cfg.regionCount * nDisc }, () => uniform(new Vector4()));
  const facU = Array.from({ length: cfg.regionCount }, () => uniform(new Vector4()));
  const flA = Array.from({ length: cfg.maxFlares }, () => uniform(new Vector4()));
  const flB = Array.from({ length: cfg.maxFlares }, () => uniform(new Vector4()));
  const flC = Array.from({ length: cfg.maxFlares }, () => uniform(new Vector4()));
  const phaseU = uniform(new Vector4(0, 0, 0, 0)); // shearA, shearB, churnA, churnB
  const weightU = uniform(1);

  const p = normalize(positionLocal);
  const mu = saturate(normalView.z);
  const sin2lat = p.y.mul(p.y);
  let col: any = vec3(opts.tint[0], opts.tint[1], opts.tint[2]).mul(opts.emissive);

  // Limb darkening (R7.5, model_dependent).
  if (opts.limbU !== null) col = col.mul(float(1).sub(float(opts.limbU).mul(float(1).sub(mu))));

  // Granulation ---------------------------------------------------------------------------------
  // Two scales of warped cells (so no regular tiling or round polka dots show), dark lanes between
  // the cells, churning with the clock and sheared by differential rotation. Artistic (R7.5.2).
  if (opts.granulation) {
    const cellsAt = (shear: any, churn: any, freq: number, off: number) => {
      const q = rotY(p, shear.mul(sin2lat)).mul(freq);
      // Domain warp so the cells are irregular and do not line up on the lattice.
      const w = vec3(
        mx_noise_float(q.mul(0.45).add(seedV).add(3.1)),
        mx_noise_float(q.mul(0.45).add(seedV).add(7.7)),
        mx_noise_float(q.mul(0.45).add(seedV).add(1.3)),
      );
      return mx_worley_noise_float(
        q
          .add(w.mul(0.55))
          .add(vec3(off, 0, churn))
          .add(seedV),
      );
    };
    const layer = (freq: number, off: number) =>
      mix(cellsAt(phaseU.y, phaseU.w, freq, off), cellsAt(phaseU.x, phaseU.z, freq, off), weightU);
    // Bright cells, thin dark lanes: the lane is where the distance to the nearest centre is large.
    const lane = (c: any) => smoothstep(0.55, 1.0, c);
    const big = lane(layer(CELLS_ACROSS / 2, 0));
    const small = lane(layer(CELLS_ACROSS * 0.9, 11.5));
    const grain = float(0.5).sub(big.mul(0.65).add(small.mul(0.35)));
    // Large-scale mottling (supergranule scale), steady between flow-map resets.
    let mottle: any = float(0);
    {
      let amp = 1;
      let f = 2.6;
      let norm = 0;
      for (let i = 0; i < Math.max(2, opts.octaves - 2); i++) {
        mottle = mottle.add(
          mx_noise_float(
            p
              .mul(f)
              .add(seedV)
              .add(i * 17.31),
          ).mul(amp),
        );
        norm += amp;
        amp *= 0.5;
        f *= 2;
      }
      mottle = mottle.div(norm);
    }
    col = col.mul(
      float(1)
        .add(grain.mul(2 * GRAIN_AMP))
        .add(mottle.mul(MOTTLE_AMP)),
    );
  }

  // Faculae ---------------------------------------------------------------------------------------
  if (opts.faculae) {
    let fac: any = float(0);
    for (const u of facU) {
      const c = u.xyz;
      const r = u.w;
      const d = length(p.sub(c)).div(max1e4(r));
      fac = fac.add(exp(d.mul(d).negate()));
    }
    const net = mx_noise_float(p.mul(15).add(seedV)).mul(0.5).add(0.5);
    // Brighter towards the limb (R7.5.4): the law is [verify], this is a display choice.
    const limbBoost = pow(float(1).sub(mu), 1.2).mul(1.4).add(0.18);
    col = col.mul(float(1).add(fac.mul(net.mul(0.65).add(0.35)).mul(limbBoost).mul(FACULA_AMP)));
  }

  // Spots -----------------------------------------------------------------------------------------
  if (opts.spots) {
    let best: any = float(1e3);
    let bestC: any = vec3(0, 1, 0);
    for (const u of discU) {
      const c = u.xyz;
      const q = length(p.sub(c)).div(max1e4(u.w));
      const better = q.lessThan(best);
      best = select(better, q, best);
      bestC = select(better, c, bestC);
    }
    const east = normalize(cross(vec3(0, 1, 0), bestC));
    const north = cross(bestC, east);
    const rel = p.sub(bestC);
    const ang = atan(dot(rel, north), dot(rel, east));
    // Radial streaks: noise that varies fast with the polar angle and slowly with radius.
    const fil = mx_noise_float(
      vec3(cos(ang).mul(7), sin(ang).mul(7), best.mul(0.9).add(so[2] * 0.01)),
    )
      .mul(0.5)
      .add(0.5);
    const penumbra = mix(PENUMBRA_LO, PENUMBRA_HI, smoothstep(0.45, 1.0, best)).mul(
      float(0.62).add(fil.mul(0.7)),
    );
    let inner: any = mix(float(UMBRA), penumbra, smoothstep(0.38, 0.5, best));
    // Umbral dots: small bright cells inside the umbra.
    const dots = float(1).sub(smoothstep(0.1, 0.28, mx_worley_noise_float(p.mul(70).add(seedV))));
    inner = inner.add(dots.mul(float(1).sub(smoothstep(0.3, 0.42, best))).mul(0.32));
    const edge = smoothstep(1.0, 0.9, best);
    col = col.mul(mix(float(1), inner, edge));
  }

  // Flares ----------------------------------------------------------------------------------------
  if (opts.flares) {
    let emis: any = float(0);
    for (let i = 0; i < flA.length; i++) {
      const c = flA[i]!.xyz;
      const I = flA[i]!.w;
      const ax = flB[i]!.xyz;
      const off = flB[i]!.w;
      const nrm = flC[i]!.xyz;
      const size = max1e4(flC[i]!.w);
      const rel = p.sub(c);
      const x = dot(rel, ax);
      const y = dot(rel, nrm);
      const w = size.mul(0.06);
      const len = size.mul(0.95);
      const dx = abs(x).sub(off);
      const ribbon = exp(dx.mul(dx).div(w.mul(w)).negate()).mul(
        float(1).sub(smoothstep(len.mul(0.55), len, abs(y))),
      );
      // Kernels where the ribbons are brightest: near the ends of the ribbons.
      const ky = abs(y).sub(len.mul(0.45));
      const kern = exp(dx.mul(dx).add(ky.mul(ky)).div(w.mul(w).mul(2.4)).negate());
      const facing = smoothstep(0.0, 0.2, dot(p, c));
      emis = emis.add(I.mul(facing).mul(ribbon.mul(FLARE_RIBBON).add(kern.mul(FLARE_KERNEL))));
    }
    col = col.add(vec3(FLARE_COLOUR[0], FLARE_COLOUR[1], FLARE_COLOUR[2]).mul(emis));
  }

  const material = new MeshBasicNodeMaterial();
  material.colorNode = col;

  const update = (f: StarFrame): void => {
    phaseU.value.set(f.shearA, f.shearB, f.churnA, f.churnB);
    weightU.value = f.weightA;
    for (const u of discU) u.value.set(0, 1, 0, 0);
    for (const u of facU) u.value.set(0, 1, 0, 0);
    f.regions.forEach((r, i) => {
      if (i >= cfg.regionCount) return;
      facU[i]!.value.set(r.center[0], r.center[1], r.center[2], 2.4 * r.size);
      r.discs.forEach((d, j) => {
        discU[i * nDisc + j]!.value.set(d.center[0], d.center[1], d.center[2], d.radius);
      });
    });
    for (let i = 0; i < flA.length; i++) {
      const fl = f.flares[i];
      if (!fl) {
        flA[i]!.value.set(0, 1, 0, 0);
        continue;
      }
      flA[i]!.value.set(fl.center[0], fl.center[1], fl.center[2], fl.intensity);
      flB[i]!.value.set(fl.axis[0], fl.axis[1], fl.axis[2], FLARE_RIBBON_OFFSET * fl.size);
      flC[i]!.value.set(fl.north[0], fl.north[1], fl.north[2], fl.size);
    }
  };
  return { material, update };
}

/** max(x, 1e-4): a zero-radius (absent) disc divides to a huge value and so never wins or glows. */
function max1e4(x: any): any {
  return x.max(1e-4);
}

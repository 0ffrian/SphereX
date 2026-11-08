// Issue #42, A7.2, R7.4, R7.7: the banded, moving surface of a gas giant or a brown dwarf as a three
// r187 TSL node material.
//
//   - The band profile (R of texture A) is the field's, fixed in the body frame; the shader only
//     adds detail below the field's resolution, which is seen and not felt (D-12).
//   - Counter-flowing jets: that detail is advected by the zonal wind, which changes sign from one
//     band to the next (`2 A.x - 1 = sin(phase)`, the same profile as `zonalWind`), so neighbouring bands
//     visibly slide past each other. Turbulence is strongest at the band edges, where the shear is.
//     The advection is a flow-map cross-fade (motion/phase.ts), so it never stretches for ever.
//   - Storms: positions, sizes and own turning come from the CPU (`fields/flowModel.ts`) as
//     uniforms; the haptic sampler is given the same list at the same time.
//   - Brown dwarf cloud cover (R7.4): a patchy dimming whose coverage the caller drives from the
//     measured light curve.
// Every colour and amplitude is a display choice (artistic).
/* eslint-disable @typescript-eslint/no-explicit-any -- TSL node graphs are built from untyped proxies */
import {
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  SphereGeometry,
  Vector3,
  Vector4,
  type DataTexture,
} from 'three/webgpu';
import {
  abs,
  acos,
  atan,
  cameraPosition,
  clamp,
  cos,
  cross,
  dot,
  exp,
  float,
  log,
  max,
  mix,
  normalize,
  normalView,
  normalWorld,
  positionLocal,
  positionWorld,
  pow,
  saturate,
  sin,
  smoothstep,
  sqrt,
  step,
  uniform,
  vec3,
} from 'three/tsl';
import {
  STORM_RING_CENTRE,
  STORM_RING_WIDTH,
  MAX_STORMS,
  type FieldParams,
  type FieldSampler,
} from '../fields/fieldGenerator';
import {
  MIN_COS_LAT,
  peakAngularRate,
  stormsAt,
  type JetRates,
  type MovingStorm,
} from '../fields/flowModel';
import { phasePair } from '../motion/phase';
import type { SimTimeFn } from '../motion/motion';
import { shaderSeedOffsets } from '../fields/noise';
import type { Rgb } from './shaderPalette';
import { bilinear, fieldUV, vnoise3 } from './fieldTexture';

/** Largest streak shear before the flow-map resets, radians (artistic). */
export const MAX_STREAK_SHEAR = 1.0;

export interface JetOptions {
  texA: DataTexture;
  /** Band count of the field (the shader's wind profile uses it). */
  bands: number;
  seed: number;
  turbulence: number;
  palette: readonly [Rgb, Rgb, Rgb, Rgb];
  octaves: number;
  /** Brown dwarf: draws with its own light (no external light). Gas giants are lit by the scene. */
  selfLit: boolean;
  /** Self-lit brightness multiplier (the 4.5 micron emissive layer, R7.4), or the gas glow term. */
  emissive: number;
  /** Brown dwarf cloud cover patches. */
  clouds: boolean;
  /** Storms the shader can draw (at most MAX_STORMS). */
  storms: number;
  /** Self-lit only: linear limb-darkening coefficient `u` (R7.5 law), or null for an even disc. */
  limbU?: number | null;
  /** Mesh segments. */
  segments?: [number, number];
  /**
   * Gas giants: the world-space direction to the sun (a TSL node). With it the lit side follows a
   * Minnaert-style law (k = MINNAERT_K): a softer terminator and a slightly darker limb, because a
   * gas giant has no solid surface to cast a hard shadow edge (airless rock keeps its sharp terminator).
   */
  sunWorld?: any;
}

/** Minnaert exponent for gas giants (artistic: 1 is a plain Lambert surface). */
export const MINNAERT_K = 0.8;

export interface JetFrame {
  storms: readonly MovingStorm[];
  /** Streak shear angle of the two flow-map copies (rad at peak jet), weight of A, evolve offsets. */
  shearA: number;
  shearB: number;
  weightA: number;
  evoA: number;
  evoB: number;
  /** 0..1 cloud cover (brown dwarf); ignored when `clouds` is off. */
  cover: number;
}

/**
 * Issue #62: which parts of the gas giant surface are drawn. Each is a layer of its own with its
 * own tag (D-21), so each is a uniform that switches without a rebuild. All on is the full surface
 * (and what a brown dwarf always draws).
 */
export interface JetLayers {
  /** The band profile of the field; off: one flat tone, no jets to shear. */
  bands: boolean;
  /** The swirling fine detail; off: smooth bands. */
  turbulence: boolean;
  /** The palette of the class; off: the same tones as plain greys (the contrast stays). */
  colour: boolean;
  /** The storm spots, rings and arms. */
  storms: boolean;
}
export const ALL_JET_LAYERS: JetLayers = {
  bands: true,
  turbulence: true,
  colour: true,
  storms: true,
};

export interface JetSurface {
  mesh: Mesh;
  update(f: JetFrame): void;
  setLayers(l: JetLayers): void;
}

/** Rec. 709 luma of a linear colour: the grey a tone becomes when its colour is not shown. */
const luma = (c: Rgb): Rgb => {
  const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return [y, y, y];
};

const rotY = (p: any, a: any) => {
  const c = cos(a);
  const s = sin(a);
  return vec3(p.x.mul(c).add(p.z.mul(s)), p.y, p.x.negate().mul(s).add(p.z.mul(c)));
};

/**
 * Extra factor on top of the Lambert term `mu0`: Minnaert's `mu0^k mu^(k-1)` is `mu0 * mu0^(k-1) *
 * mu^(k-1)`. The mu0 part (a soft terminator) is used as is, floored so it stays finite at the
 * terminator; the view part is flipped to `mu^(1-k)` so that it darkens the limb (artistic).
 */
const minnaert = (sun: any) => {
  const mu0 = max(dot(normalWorld, sun), 0.04);
  const mu = max(abs(dot(normalWorld, normalize(cameraPosition.sub(positionWorld)))), 0.04);
  return pow(mu0, MINNAERT_K - 1).mul(pow(mu, 1 - MINNAERT_K));
};

export function buildJetSurface(o: JetOptions): JetSurface {
  const so = shaderSeedOffsets(o.seed);
  const nStorm = Math.min(MAX_STORMS, Math.max(0, o.storms));
  const stormU = Array.from({ length: nStorm }, () => uniform(new Vector4(0, 1, 0, 1)));
  const swirlU = Array.from({ length: nStorm }, () => uniform(0));
  const phaseU = uniform(new Vector4(0, 0, 0, 0)); // shearA, shearB, evoA, evoB
  const weightU = uniform(1);
  const coverU = uniform(0);
  const bandsU = uniform(1);
  const turbU = uniform(1);
  const stormsU = uniform(1);
  const colourU = uniform(1);
  const palU = o.palette.map((c) => uniform(new Vector3(c[0], c[1], c[2])));

  const dir = normalize(positionLocal);
  const { u, v } = fieldUV(dir);
  const Af = bilinear(o.texA, u, v);
  // Bands off: the band profile is the flat 0.5 (a band edge is where it crosses 0.5, so no edges).
  const A = { x: mix(float(0.5), Af.x, bandsU) };
  // -1..1, the jet direction and strength: sin of the field's WARPED band phase, exactly the CPU's
  // `zonalWind` (the field stores 0.5 + 0.5 sin(phase)), so the drawn shear and the drift of the
  // storms (flowModel) flow the same way at every point.
  const profile = A.x.mul(2).sub(1);

  const cosLat = max(sqrt(dir.x.mul(dir.x).add(dir.z.mul(dir.z))), MIN_COS_LAT);

  // Detail advected by the jets (two flow-map copies).
  const detail = (shear: any, evo: any) => {
    // 1 / cos(lat), floored like the CPU's `invCosLat`: a wind of fixed speed turns a point near
    // the pole faster, and the storms (flowModel) drift by the same factor, so they stay with their band.
    const q = rotY(dir, shear.mul(profile).div(cosLat));
    return vnoise3(
      vec3(q.x.mul(7), q.y.mul(28), q.z.mul(7))
        .add(so.gasFine)
        .add(vec3(0, 0, evo)),
      Math.max(3, o.octaves - 1),
    );
  };
  const fine = mix(detail(phaseU.y, phaseU.w), detail(phaseU.x, phaseU.z), weightU);
  // Shear is strongest where the profile crosses 0.5 (a band edge).
  const edge = float(1)
    .sub(smoothstep(0.0, 0.3, abs(A.x.sub(0.5)).mul(2)))
    .mul(bandsU);
  const amp = float(0.2 * (0.3 + o.turbulence)).add(edge.mul(0.5 * (0.4 + o.turbulence)));
  const val = clamp(A.x.mul(0.7).add(0.15).add(fine.sub(0.5).mul(amp).mul(turbU)), 0, 1);

  const [c0, c1, c2, c3] = palU as [any, any, any, any];
  let col: any = mix(mix(c0, c1, val.mul(2)), mix(c1, c2, val.mul(2).sub(1)), step(0.5, val));

  // Storms between the jets: a spot, a ring and spiral arms that turn.
  for (let i = 0; i < nStorm; i++) {
    const s = stormU[i]!;
    const c = s.xyz;
    const size = s.w;
    const dist = acos(clamp(dot(dir, c), -1, 1));
    const ratio = dist.div(size);
    const spot = exp(pow(ratio, 2).negate());
    const ring = exp(pow(ratio.sub(STORM_RING_CENTRE).div(STORM_RING_WIDTH), 2).negate());
    // At a pole c is parallel to (0,1,0) and the cross product is 0 (normalize would be NaN): fall
    // back to the x axis for the (arbitrary at the pole) local east.
    const east0 = cross(vec3(0, 1, 0), c);
    const east = normalize(mix(east0, vec3(0, 0, -1), step(dot(east0, east0), 1e-8)));
    const north = cross(c, east);
    const rel = dir.sub(c);
    const ang = atan(dot(rel, north), dot(rel, east));
    const arms = sin(
      ang
        .mul(2)
        .sub(log(ratio.add(0.15)).mul(5))
        .add(swirlU[i]!),
    )
      .mul(0.5)
      .add(0.5);
    col = mix(col, mix(c3, c2, arms.mul(0.55)), spot.mul(0.85).mul(stormsU));
    col = mix(col, c2, ring.mul(0.35).mul(stormsU));
  }

  // Brown dwarf cloud cover: patches that dim the surface; more cover, more patches.
  if (o.clouds) {
    const n = vnoise3(
      dir
        .mul(4.5)
        .add(vec3(0, 0, so.cloud))
        .add(fine.mul(0.8)),
      3,
    );
    const thick = smoothstep(float(1).sub(coverU), float(1.15).sub(coverU), n);
    col = col.mul(float(1).sub(thick.mul(coverU).mul(0.55)));
  }

  const geo = new SphereGeometry(1, o.segments?.[0] ?? 96, o.segments?.[1] ?? 64);
  let mesh: Mesh;
  if (o.selfLit) {
    const mat = new MeshBasicNodeMaterial();
    // R7.5 law I(mu) = 1 - u (1 - mu), mu = cos of the angle to the view direction (issue #62).
    const limb =
      o.limbU === null || o.limbU === undefined
        ? float(1)
        : float(1).sub(float(o.limbU).mul(float(1).sub(saturate(normalView.z))));
    mat.colorNode = col.mul(o.emissive).mul(limb);
    mesh = new Mesh(geo, mat);
  } else {
    // Lit by the scene's DirectionalLight (N5 / R5.1); hot bodies add a self-glow term.
    const mat = new MeshStandardNodeMaterial();
    mat.colorNode = o.sunWorld ? col.mul(minnaert(o.sunWorld)) : col;
    mat.roughness = 1;
    mat.metalness = 0;
    mat.emissiveNode = o.emissive > 0 ? col.mul(colourU.mul(o.emissive * 0.6)) : vec3(0, 0, 0);
    mesh = new Mesh(geo, mat);
  }

  return {
    mesh,
    setLayers(l) {
      bandsU.value = l.bands ? 1 : 0;
      turbU.value = l.turbulence ? 1 : 0;
      stormsU.value = l.storms ? 1 : 0;
      colourU.value = l.colour ? 1 : 0;
      o.palette.forEach((c, i) => {
        const t = l.colour ? c : luma(c);
        palU[i]!.value.set(t[0], t[1], t[2]);
      });
    },
    update(f) {
      phaseU.value.set(f.shearA, f.shearB, f.evoA, f.evoB);
      weightU.value = f.weightA;
      coverU.value = clamp01(f.cover);
      for (let i = 0; i < nStorm; i++) {
        const s = f.storms[i];
        if (!s) {
          stormU[i]!.value.set(0, 1, 0, 1e-3);
          continue;
        }
        stormU[i]!.value.set(s.center[0], s.center[1], s.center[2], s.size);
        swirlU[i]!.value = s.swirl;
      }
    },
  };
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** How fast gas-giant detail re-forms per radian of shear (artistic noise units). */
export const EVOLVE_PER_RAD = 1.2;

export interface JetRuntimeInput {
  surface: JetSurface;
  fp: FieldParams;
  /** Peak wind and radius, or null when the winds do not move (storms stay where the field put them). */
  jets: JetRates | null;
  /** Radians per sim second of the spin (0 = not animated). */
  spinRate: number;
  /** Speed-up of the cloud process over the winds process (0 = detail does not re-form). */
  evolveRatio: number;
  /** The haptic sampler to hand the same storms (D-34), if the body has a field. */
  sampler: FieldSampler | null;
  /** Cloud cover now, 0..1. */
  cover?: () => number;
}

/**
 * The per-frame update of a jet surface: spins the mesh, asks the CPU model for the storms at this
 * time and gives the SAME list to the shader and to the haptic sampler, and sets the bounded
 * flow-map phases of the detail. A pure function of the clock times.
 */
export function makeJetRuntime(i: JetRuntimeInput): (time: SimTimeFn) => void {
  // Signed, like the storms' drift in flowModel: a negative wind flows the other way in both.
  const rate = i.jets ? peakAngularRate(i.jets) : 0;
  const peak = Math.abs(rate);
  return (time) => {
    i.surface.mesh.rotation.y = i.spinRate * time('spin');
    const t = i.jets ? time('winds') : 0;
    const storms = stormsAt(i.fp, i.jets, t);
    i.sampler?.setStorms(storms);
    const pair = peak > 0 ? phasePair(t, MAX_STREAK_SHEAR / peak) : { a: 0, b: 0, w: 1 };
    i.surface.update({
      storms,
      shearA: rate * pair.a,
      shearB: rate * pair.b,
      weightA: pair.w,
      evoA: EVOLVE_PER_RAD * peak * pair.a * i.evolveRatio,
      evoB: EVOLVE_PER_RAD * peak * pair.b * i.evolveRatio,
      cover: i.cover ? i.cover() : 0,
    });
  };
}

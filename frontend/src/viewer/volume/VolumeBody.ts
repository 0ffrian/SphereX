// Issue #43: the emission-only volume renderer (three r187, `three/webgpu`, TSL). One box mesh per
// volume; the fragment shader marches a ray through the box with `steps` samples (by quality
// level, R5.7), offset by a per-pixel `interleavedGradientNoise` jitter that the temporal AA
// averages away. Emission is summed front to back with a transmittance term, so dust lanes dim the
// glow behind them. No lighting: an emission volume is self-luminous. Each step costs one fetch of
// the baked noise cube (noiseVolume.ts) plus a few arithmetic operations. Every density, colour
// and gain is a display value (`artistic`, R7.7); nothing here is measured.
//
// A GPU is needed to run the node graph, so only the pure parts (volumeMath.ts, volumeSpecs.ts,
// noiseVolume.ts) are unit-tested; this file is covered by the e2e frames (nebula, nova, comet).
/* eslint-disable @typescript-eslint/no-explicit-any -- TSL node graphs are built from untyped proxies */
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  Data3DTexture,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
  Vector3,
} from 'three/webgpu';
import {
  Fn,
  Loop,
  cameraPosition,
  exp,
  float,
  fract,
  int,
  interleavedGradientNoise,
  length,
  max,
  min,
  mix,
  modelWorldMatrixInverse,
  normalize,
  positionLocal,
  pow,
  screenCoordinate,
  smoothstep,
  texture3DLevel,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import type { VolumePlan } from '../planTypes';
import { TIERS, type TierName } from '../render/quality';
import { NOISE_VOLUME_SIZE, noiseVolumeData } from './noiseVolume';
import { boxBasis, comaDensity } from './volumeMath';

/** Emission gain at gain 1 (display choice, artistic). */
const EMISSION_GAIN = 2.2;
/** Extra gain for the nebula, so it holds up on a projector (display choice, artistic). */
const NEBULA_GAIN = 1.8;
/** Extinction per unit length at dust strength 1 (display choice, artistic). */
const DUST_EXTINCTION = 5;
/** Inner edge of the coma's 1/r^2 profile in box units (avoids the r = 0 singularity). */
const COMA_INNER = 0.06;

type Field = { emission: any; sigma: any };

function emitterColour(plan: VolumePlan, i: number): any {
  const e = plan.emitters[i];
  return e ? vec3(...e.rgb).mul(e.gain) : vec3(0);
}

/** Density and colour of one volume kind at box-space point `p` (the box spans [-1, 1]^3). */
function fieldFor(
  plan: VolumePlan,
  noise: (p: any) => any,
  noiseMirrored: (p: any) => any,
  shell: any,
): (p: any) => Field {
  const c0 = emitterColour(plan, 0);
  const c1 = emitterColour(plan, 1);
  const c2 = emitterColour(plan, 2);
  const dustAmount = float(plan.dust * DUST_EXTINCTION);

  switch (plan.kind) {
    case 'nebula':
      return (p) => {
        const r = length(p);
        const mask = smoothstep(1.0, 0.2, r);
        const n = noise(p);
        // Filament field: bright where the crest of the noise passes; dust lanes beside it.
        const wBroad = float(1).sub(n.x.sub(0.5).mul(2).abs());
        const wFine = float(1).sub(n.w.sub(0.5).mul(2).abs());
        const density = mask
          .mul(pow(wBroad, float(5)))
          .mul(pow(wFine, float(2.5)).mul(0.7).add(0.3))
          .mul(n.z.mul(0.6).add(0.4));
        const emission = mix(c0, c1, smoothstep(0.35, 0.65, n.y))
          .mul(density)
          .mul(EMISSION_GAIN * NEBULA_GAIN);
        const lane = smoothstep(0.55, 0.9, n.x);
        return { emission, sigma: dustAmount.mul(mask).mul(lane) };
      };
    case 'remnant':
      return (p) => {
        const r = length(p);
        // Smooth synchrotron core glow (no dots): a gaussian that grows with the shell.
        const core = exp(r.div(shell.mul(0.6).max(0.02)).pow(2).negate()).mul(0.55);
        // Thin line-emitting filaments on a shell of radius `shell`. The noise is looked up by
        // direction, so the filaments keep their pattern as the shell grows with age.
        const n = noise(p.div(max(r, 1e-4)));
        const width = float(0.045);
        const onShell = exp(r.sub(shell).div(width).pow(2).negate());
        const ridge = smoothstep(0.55, 0.9, float(1).sub(n.w.sub(0.5).mul(2).abs()));
        const filament = onShell.mul(ridge).mul(2.4);
        const lines = mix(c0, c1, smoothstep(0.35, 0.65, n.y)).mul(filament);
        const emission = c2.mul(core).add(lines).mul(EMISSION_GAIN);
        const lane = smoothstep(0.55, 0.85, n.y);
        const inside = smoothstep(shell.add(0.1), shell.mul(0.5), r);
        return { emission, sigma: dustAmount.mul(inside).mul(lane) };
      };
    case 'coma':
      return (p) => {
        const r = length(p);
        const rho = float(COMA_INNER * COMA_INNER).div(max(r, COMA_INNER).pow(2));
        const edge = smoothstep(1.0, 0.8, r);
        // Gentle jets: +-15% noise so the coma is not a perfect ball (artistic).
        const jets = noise(p).z.sub(0.5).mul(0.3).add(1);
        const emission = c0
          .add(c1)
          .add(c2)
          .mul(rho)
          .mul(edge)
          .mul(jets)
          .mul(0.05 * EMISSION_GAIN);
        return { emission, sigma: float(0) };
      };
    default: {
      // Tails and the dust cone: local x runs along the tail from the nucleus (u = 0) to its end
      // (u = 1); the width follows a pear (dust) or stays narrow and straight (ion).
      const ion = plan.kind === 'ion_tail';
      const widthMax = float(ion ? 0.5 : 0.3);
      const bendY = float(plan.bendFraction);
      return (p) => {
        const u = p.x.mul(0.5).add(0.5);
        // Centre line: straight for the ion tail; the dust tail bends toward local +y.
        const yc = bendY.mul(u).mul(u);
        const q = vec3(p.x, p.y.sub(yc), p.z);
        const width = ion
          ? widthMax.mul(float(0.35).add(u.mul(0.65)))
          : widthMax.mul(smoothstep(0.0, 0.25, u).mul(0.7).add(0.3));
        const rho = length(q.yz).div(width);
        const across = smoothstep(1.0, 0.15, rho);
        const along = float(1)
          .sub(u)
          .pow(ion ? 1.2 : 1.6)
          .mul(smoothstep(0.0, 0.04, u));
        // Streaks along the tail (ion: the cube is stretched along x) or soft clumps (dust).
        // The stretched lookup runs past the cube's edge: mirror it, since the cube does not tile.
        const n = ion ? noiseMirrored(vec3(p.x.mul(0.3), q.y.mul(3), q.z.mul(3))) : noise(p);
        const grain = ion ? float(1).sub(n.x.sub(0.5).mul(2).abs()) : n.z;
        const density = across.mul(along).mul(grain.mul(0.6).add(0.4));
        const emission = c0.add(c1).add(c2).mul(density).mul(EMISSION_GAIN);
        return { emission, sigma: float(0) };
      };
    }
  }
}

export interface VolumeHandle {
  readonly mesh: Mesh;
  /** Changes the step count for a quality level. */
  setTier(tier: TierName): void;
  /** Remnant: shell radius as a fraction of the box half-size (the age slider). */
  setShell(fraction: number): void;
  /** Extra per-frame jitter offset in [0, 1), so TAAU averages different samples (default 0). */
  setJitterShift(shift: number): void;
  dispose(): void;
}

/** Pose of the box: scale by `halfExtent`, local +x along `axis`, local +y along `bend`. */
function poseBox(mesh: Mesh, plan: VolumePlan): void {
  mesh.scale.set(...plan.halfExtent);
  const basis = plan.axis ? boxBasis(plan.axis, plan.bend) : null;
  if (basis) {
    const [x, y, z] = basis.map((v) => new Vector3(...v));
    mesh.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(x!, y!, z!));
  }
  mesh.position.set(...plan.center);
}

function noiseTexture(seed: number): Data3DTexture {
  const t = new Data3DTexture(
    noiseVolumeData(seed),
    NOISE_VOLUME_SIZE,
    NOISE_VOLUME_SIZE,
    NOISE_VOLUME_SIZE,
  );
  t.format = RGBAFormat;
  t.type = UnsignedByteType;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = RepeatWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

export function createVolume(plan: VolumePlan, tier: TierName): VolumeHandle {
  const steps = uniform(TIERS[tier].volumeSteps, 'int');
  const shell = uniform(plan.shell);
  const jitterShift = uniform(0);
  const geometry = new BoxGeometry(2, 2, 2);
  const noiseTex = noiseTexture(plan.seed);
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: BackSide, // the far faces are drawn, so a camera inside the box still works
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = plan.id;
  mesh.renderOrder = 5;
  mesh.frustumCulled = true;
  poseBox(mesh, plan);

  // One fetch of the baked noise cube; coordinates repeat, and level 0 keeps it a plain fetch.
  const noise = (p: any) => texture3DLevel(noiseTex, p.mul(0.5).add(0.5), float(0));

  // Same fetch with the coordinate folded back and forth (a triangle wave) instead of wrapped, so
  // a lookup beyond the cube has no seam where the two edges, which do not match, would meet.
  const noiseMirrored = (p: any) => {
    const u = p.mul(0.5).add(0.5);
    const folded = float(1).sub(fract(u.mul(0.5)).mul(2).sub(1).abs());
    return texture3DLevel(noiseTex, folded, float(0));
  };

  material.colorNode = Fn(() => {
    const field = fieldFor(plan, noise, noiseMirrored, shell);
    const camLocal = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz;
    const rd = normalize(positionLocal.sub(camLocal));
    // Slab test against the unit box [-1, 1]^3.
    const inv = vec3(1).div(rd);
    const t0 = camLocal.negate().sub(1).mul(inv);
    const t1 = camLocal.negate().add(1).mul(inv);
    const tmin = min(t0, t1);
    const tmax = max(t0, t1);
    const tNear = max(max(tmin.x, tmin.y), max(tmin.z, 0));
    const tFar = min(min(tmax.x, tmax.y), tmax.z);
    const span = max(tFar.sub(tNear), 0);
    const dt = span.div(steps.toFloat());
    // Per-pixel jitter of the first sample (interleaved gradient noise, r187 TSL).
    const jitter = fract(interleavedGradientNoise(screenCoordinate.xy).add(jitterShift));

    const accum = vec3(0).toVar();
    const trans = float(1).toVar();
    Loop(int(steps), ({ i }: { i: any }) => {
      const t = tNear.add(float(i).add(jitter).mul(dt));
      const p = camLocal.add(rd.mul(t));
      const f = field(p);
      trans.mulAssign(exp(f.sigma.mul(dt).negate()));
      accum.addAssign(f.emission.mul(trans).mul(dt));
    });
    return vec4(accum, 1);
  })();

  return {
    mesh,
    setTier(next) {
      steps.value = TIERS[next].volumeSteps;
    },
    setShell(fraction) {
      shell.value = Math.min(1, Math.max(0, fraction));
    },
    setJitterShift(shift) {
      jitterShift.value = shift - Math.floor(shift);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      noiseTex.dispose();
    },
  };
}

/** CPU twin of the coma profile used above (for tests): density relative to the inner radius. */
export const COMA_PROFILE = (r: number): number => comaDensity(r, COMA_INNER);

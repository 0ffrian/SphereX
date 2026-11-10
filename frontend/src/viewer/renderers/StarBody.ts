// Issue #42, R7.5, R7.5.1 to R7.5.5, D-34: the star's surface, loops and glow as three r187 objects.
// Which layers exist is decided by the plan (`StarSurfacePlan`, by tier and honesty state); this
// class only draws them and poses them for the SimClock. A frame is a pure function of (card, seed,
// t): `setTime` reads the clock, asks the CPU model (`bodies/starModel.ts`) which spot groups and
// flares exist at that time, and writes the answer into uniforms. Nothing is kept between frames.
import {
  AdditiveBlending,
  Group,
  Mesh,
  SphereGeometry,
  Sprite,
  SpriteNodeMaterial,
} from 'three/webgpu';
import { exp, float, length, smoothstep, uv, vec3, vec4 } from 'three/tsl';
import type { StarSurfacePlan } from '../planTypes';
import {
  flaresAt,
  regionsAt,
  smooth01,
  STAR_SURFACE,
  type StarSurfaceConfig,
  type FlareState,
  type RegionState,
} from '../bodies/starModel';
import { phasePair, wrap } from '../motion/phase';
import type { SimTimeFn } from '../motion/motion';
import { buildStarMaterial, type StarMaterial } from '../shaders/star';
import { buildLoopMesh, type LoopMesh } from '../shaders/loops';
import { StarPlasma } from './StarPlasma';
import type { TierName } from '../render/quality';

/** Largest shear of the granulation before its flow-map resets, radians (artistic). */
const MAX_MOTTLE_SHEAR = 0.8;
/** Cell turnovers per rotation (artistic pacing: the cell lifetime is [verify], R7.5.2). */
const CHURN_PER_ROT = 6;
/** Strands per loop at the strand look (tier 5) and in the plain look (tier 4). */
export const STRANDS_PLAIN = 1;
export const STRANDS_FULL = 18;
/** Glow sprite size in star radii (artistic). */
const GLOW_SIZE = 6;
/** Loop sway period as a fraction of a spot lifetime (artistic: "sway slowly"). */
const SWAY_FRACTION = 1 / 12;

export interface StarBodyOptions {
  tint: readonly [number, number, number];
  emissive: number;
  limbU: number | null;
  octaves: number;
  /** Semi-axes of the body (the Mira pulsation scale is applied to the group). */
  axes: readonly [number, number, number];
  segments: readonly [number, number];
  tier?: TierName;
}

export class StarBody {
  readonly group = new Group();
  /** The rotating frame: sphere, loops and glow turn together. */
  readonly spin = new Group();
  private readonly cfg: StarSurfaceConfig;
  private readonly mat: StarMaterial;
  private readonly loops: LoopMesh[] = [];
  private readonly geometry: SphereGeometry;
  private readonly glow: Sprite | null = null;
  /** Issue #71 stream G: flares and plasma along the physical spot groups (null: old look). */
  readonly plasma: StarPlasma | null = null;
  /** The most recent CPU state, for tests and haptics (R7.5 has no star haptic yet). */
  lastRegions: readonly RegionState[] = [];
  lastFlares: readonly FlareState[] = [];

  constructor(
    private readonly star: StarSurfacePlan,
    o: StarBodyOptions,
  ) {
    this.cfg = star.config ?? STAR_SURFACE;
    this.group.scale.set(o.axes[0], o.axes[1], o.axes[2]);
    this.group.add(this.spin);
    this.mat = buildStarMaterial({
      tint: o.tint,
      emissive: o.emissive,
      limbU: o.limbU,
      seed: star.seed,
      octaves: o.octaves,
      granulation: star.granulation,
      spots: star.spots,
      faculae: star.faculae,
      flares: star.flares && !star.plasma,
      cfg: this.cfg,
      colourView: star.colourView,
      cellsAcross: star.cellsAcross,
      granuleVisibility: star.granuleVisibility,
      convection: star.physics ? star.physics.convection : 1,
    });
    this.geometry = new SphereGeometry(1, o.segments[0], o.segments[1]);
    this.spin.add(new Mesh(this.geometry, this.mat.material));

    if (star.plasma && star.physics) {
      this.plasma = new StarPlasma({
        seed: star.seed,
        physics: star.physics,
        ratePerDisplayS: star.rates.flareRatePerS * star.rates.flareSpeedup,
        tier: o.tier ?? 'medium',
        enlarged: star.scale === 'enlarged',
      });
      // True colour and the close-up show the bare surface (as in the prototype).
      this.plasma.group.visible = star.colourView !== 'true' && star.scale !== 'close';
      this.spin.add(this.plasma.group);
    }
    if (star.prominences && !star.plasma) {
      for (let s = 0; s < this.cfg.regionCount; s++) {
        const loop = buildLoopMesh(star.seed, s, star.strands ? STRANDS_FULL : STRANDS_PLAIN);
        this.loops.push(loop);
        this.spin.add(loop.mesh);
      }
    }
    if (star.glow) {
      const g = new SpriteNodeMaterial();
      const r = length(uv().sub(0.5)).mul(GLOW_SIZE);
      // Outside the limb only: 1 at the limb, falling off exponentially; nothing over the disc.
      const fall = exp(r.sub(1).max(0).mul(-9)).mul(smoothstep(0.998, 1.012, r));
      g.colorNode = vec4(vec3(o.tint[0], o.tint[1], o.tint[2]).mul(o.emissive), 1);
      g.opacityNode = fall
        .mul(0.12)
        .mul(float(1).sub(smoothstep(GLOW_SIZE * 0.45, GLOW_SIZE * 0.5, r)));
      g.transparent = true;
      g.depthWrite = false;
      g.blending = AdditiveBlending;
      const sprite = new Sprite(g);
      sprite.scale.setScalar(GLOW_SIZE);
      sprite.frustumCulled = false;
      sprite.renderOrder = 1;
      this.glow = sprite;
      this.spin.add(sprite);
    }
    this.setTime(() => 0);
  }

  /** Poses the star at the clock's times. A pure function of (plan, time). */
  setTime(time: SimTimeFn): void {
    const { rates, seed } = this.star;
    const tSpin = time('spin');
    const tSpots = time('spots');
    const tFlares = time('flares');
    const omega = rates.omegaEq;
    this.spin.rotation.y = wrap(omega * tSpin, Math.PI * 2);

    // Mottling flow-map: bounded shear and churn, two copies half a period apart.
    const kOmega = rates.k * omega;
    const spinPeriod = omega > 0 ? (Math.PI * 2) / omega : 0;
    let period = 1;
    if (omega > 0) {
      period = spinPeriod / 2;
      if (kOmega !== 0) period = Math.min(period, MAX_MOTTLE_SHEAR / Math.abs(kOmega));
    }
    const pair = omega > 0 ? phasePair(tSpin, period) : { a: 0, b: period / 2, w: 0 };
    const churn = (tau: number) => (spinPeriod > 0 ? (CHURN_PER_ROT * tau) / spinPeriod : 0);

    const regions = regionsAt(seed, tSpots, rates, this.cfg, tSpin);
    const flares = this.star.flares && !this.star.plasma ? flaresAt(seed, tFlares, tSpots, rates, this.cfg, tSpin) : [];
    if (this.plasma) {
      // Display seconds of the flare schedule: sim seconds over the shown speed-up.
      this.plasma.setTime(rates.flareSpeedup > 0 ? tFlares / rates.flareSpeedup : 0);
    }
    this.lastRegions = regions;
    this.lastFlares = flares;
    this.mat.update({
      regions,
      flares,
      shearA: kOmega * pair.a,
      shearB: kOmega * pair.b,
      churnA: churn(pair.a),
      churnB: churn(pair.b),
      weightA: pair.w,
    });

    const swayPeriod = rates.frozen ? 0 : rates.lifetimeS * SWAY_FRACTION;
    this.loops.forEach((loop, slot) => {
      const r = regions[slot];
      if (!r) return;
      let intensity = 0;
      let rise = 0;
      for (const f of flares) {
        if (f.slot !== slot) continue;
        intensity = Math.max(intensity, f.intensity);
        rise = Math.max(rise, f.rise);
      }
      const quiet = 0.55 * smooth01((r.env - 0.2) / 0.5);
      loop.update({
        center: r.center,
        axis: r.axis,
        north: r.north,
        size: r.size,
        rise,
        opacity: Math.min(1, quiet + 0.35 * intensity),
        sway: swayPeriod > 0 ? (Math.PI * 2 * wrap(tSpots, swayPeriod)) / swayPeriod + slot : 0,
        glow: 1 + 0.7 * intensity,
      });
    });
  }

  dispose(): void {
    this.plasma?.dispose();
    this.geometry.dispose();
    this.mat.material.dispose();
    for (const l of this.loops) l.dispose();
    if (this.glow) (this.glow.material as SpriteNodeMaterial).dispose();
    this.group.clear();
  }
}

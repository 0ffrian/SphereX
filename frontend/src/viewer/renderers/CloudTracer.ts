// Issue #71 stream D, round 2 (Q-245): the cloud tracer of a rocky world, ported from the prototype's
// `ADV_FS` pass. A texture on the world UV (u = lon, v = lat, row 0 = south) holds a cloud amount
// (R) and a fine-detail field (G). Each step it is carried by the winds (a semi-Lagrangian
// backtrace, midpoint rule), then relaxed toward a source made of the climate's humidity plus
// fractal noise. It is a ping-pong pair of render targets drawn with a full-screen quad in TSL, so
// it runs on WebGPU and the WebGL2 fallback.
//
// Wind: u = U0 cos(N lat) smoothstep(1.55, 1.15, |lat|) (+ a super-rotation term on locked worlds),
// N the Rhines jet count from the world model. The prototype also adds cyclone vortices; they are
// not ported (the cyclone and gyre code is out of this round, Q-245).
//
// Determinism: the state after step n is a function of (world model, seed, n) only. The step count
// comes from the simulation clock (`targetStep`), never from frame time. The GPU noise is the same
// on every run of one device; it can differ in the last bits between devices (as every GPU noise).
// Tags: the cloud amount follows the model's humidity (`model_dependent`); the noise detail is
// `artistic`.
/* eslint-disable @typescript-eslint/no-explicit-any -- TSL node graphs are built from untyped proxies */
import {
  HalfFloatType,
  LinearFilter,
  NodeMaterial,
  QuadMesh,
  RenderTarget,
  RepeatWrapping,
  ClampToEdgeWrapping,
  RGBAFormat,
  type Texture,
} from 'three/webgpu';
import {
  clamp,
  cos,
  float,
  max,
  mix,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { bilinear, vnoise3 } from './fieldTexture';
import { shaderSeedOffsets } from '../fields/noise';
import type { DataTexture } from 'three/webgpu';

const TAU = Math.PI * 2;

/** Steps run while the world opens, to fill the tracer from the humidity (relax 0.05 each). */
export const TRACER_SPINUP_STEPS = 24;
/** Relax weight toward the source: 1 on the first fill, then these. */
export const TRACER_RELAX_SPINUP = 0.05;
export const TRACER_RELAX_RUN = 0.012;
/** One tracer step per this many simulated seconds of the winds clock (artistic pacing). */
export const TRACER_STEP_SIM_S = 1800;
/** Most steps one frame may run, so a fast clock cannot stall a frame. */
export const TRACER_MAX_STEPS_PER_FRAME = 4;
/** Resolution of the tracer: the phone tier is a quarter of the area. */
export const TRACER_SIZE = { full: [1024, 512], low: [512, 256] } as const;

/** Wind speed scale U0 (rad of longitude per step, the prototype's mapping of wind speed, m/s). */
export function tracerWindScale(windMs: number): number {
  return Math.min(0.0095, Math.max(0.003, 0.0035 + 0.0012 * Math.log10(Math.max(windMs, 1e-3))));
}

/** The step the clock asks for at winds time `t` (sim seconds), after the spin-up. Pure. */
export function targetStep(t: number): number {
  if (!Number.isFinite(t) || t <= 0) return 0;
  return Math.floor(t / TRACER_STEP_SIM_S);
}

export interface TracerOptions {
  /** Climate grid texture (A = relative humidity), same world UV. */
  climate: DataTexture;
  windMs: number;
  /** Rhines jet count. */
  jets: number;
  locked: boolean;
  seed: number;
  low: boolean;
}

/** The pass itself. `step(renderer)` needs a renderer; everything else works without one. */
export class CloudTracer {
  /** Texture node-free handle to the latest tracer texture; replaced after each step. */
  texture: Texture;
  /** Steps run so far (the spin-up included). */
  stepsRun = 0;
  private readonly a: RenderTarget;
  private readonly b: RenderTarget;
  private readonly prev: any;
  private readonly relax = uniform(1);
  private readonly stepU = uniform(0);
  private readonly quad: QuadMesh;
  private readonly material: NodeMaterial;
  private src: RenderTarget;
  private dst: RenderTarget;
  private spun = false;
  private clockStep = 0;
  /** Called after each step so a render-on-change viewer redraws. */
  onStep: (() => void) | null = null;

  constructor(o: TracerOptions) {
    const [w, h] = o.low ? TRACER_SIZE.low : TRACER_SIZE.full;
    const mk = (): RenderTarget => {
      const rt = new RenderTarget(w, h, { type: HalfFloatType, format: RGBAFormat, depthBuffer: false });
      rt.texture.minFilter = LinearFilter;
      rt.texture.magFilter = LinearFilter;
      rt.texture.wrapS = RepeatWrapping;
      rt.texture.wrapT = ClampToEdgeWrapping;
      rt.texture.generateMipmaps = false;
      return rt;
    };
    this.a = mk();
    this.b = mk();
    this.src = this.a;
    this.dst = this.b;
    this.texture = this.a.texture;
    this.prev = texture(this.a.texture);

    const seed = shaderSeedOffsets(o.seed).cloud;
    const u0 = tracerWindScale(o.windMs);
    const N = o.jets;
    const superRot = o.locked ? 0.4 : 0;
    const pos = uv();
    const lon = pos.x.sub(0.5).mul(TAU);
    const lat = pos.y.sub(0.5).mul(Math.PI);
    const dirOf = (lo: any, la: any) => vec3(cos(la).mul(cos(lo)), sin(la), cos(la).mul(sin(lo)));
    const noiseSeed = vec3(0, 0, seed);
    const slowTime = (k: number) => vec3(0, this.stepU.mul(0.0025 * k), 0);
    const vel = (la: any, lo: any) => {
      const cl = max(cos(la), 0.08);
      const uWind = float(u0)
        .mul(cos(la.mul(N)))
        .mul(smoothstep(1.55, 1.15, la.abs()))
        .add(la.mul(la).negate().div(0.16).exp().mul(superRot * u0 * 2.4));
      // A small seeded curl-noise kick keeps the flow from being purely zonal (the prototype's kick).
      const e = 0.03;
      const p0 = dirOf(lo, la).mul(7).add(noiseSeed).add(slowTime(1));
      const n0 = vnoise3(p0, 3);
      const nx = vnoise3(dirOf(lo.add(e), la).mul(7).add(noiseSeed).add(slowTime(1)), 3);
      const ny = vnoise3(dirOf(lo, la.add(e)).mul(7).add(noiseSeed).add(slowTime(1)), 3);
      const kick = u0 * 0.3;
      return vec2(uWind.add(ny.sub(n0).div(e).mul(kick)).div(cl), nx.sub(n0).div(e).mul(-kick));
    };
    const v1 = vel(lat, lon);
    const mid = vel(lat.sub(v1.y.mul(0.5)), lon.sub(v1.x.mul(0.5)));
    const bx = lon.sub(mid.x);
    const by = lat.sub(mid.y);
    const s = this.prev.sample(vec2(bx.div(TAU).add(0.5), clamp(by.div(Math.PI).add(0.5), 0.002, 0.998)));
    const d = dirOf(lon, lat);
    const slow = this.stepU.mul(0.0012);
    const det = vnoise3(d.mul(vec3(9, 28, 9)).add(noiseSeed).add(vec3(slow.mul(2), slow.mul(2), slow.mul(2))), 4);
    const rh = bilinear(o.climate, pos.x, pos.y).w;
    const tr = clamp(
      smoothstep(0.55, 1.05, rh)
        .mul(0.85)
        .add(vnoise3(d.mul(4.5).add(noiseSeed).add(vec3(slow.mul(3), slow.mul(3), slow.mul(3))), 4).sub(0.5).mul(1.3)),
      0,
      1,
    );
    this.material = new NodeMaterial();
    this.material.colorNode = mix(s, vec4(tr, det, 0, 1), this.relax);
    this.material.depthTest = false;
    this.material.depthWrite = false;
    this.quad = new QuadMesh(this.material);
  }

  /** A node that samples the latest tracer; its `.value` follows each step. */
  get node(): any {
    return this.prev;
  }

  /** Runs one step of the pass on `renderer` (a three `WebGPURenderer`). */
  private runOne(renderer: any, relax: number): void {
    this.relax.value = relax;
    this.stepU.value = this.stepsRun;
    this.prev.value = this.src.texture;
    const old = renderer.getRenderTarget();
    renderer.setRenderTarget(this.dst);
    this.quad.render(renderer);
    renderer.setRenderTarget(old);
    const t = this.src;
    this.src = this.dst;
    this.dst = t;
    this.prev.value = this.src.texture;
    this.texture = this.src.texture;
    this.stepsRun++;
  }

  /**
   * Brings the tracer to the step the clock asks for: the first call fills it (one step at relax 1,
   * then the spin-up); later calls run steps up to `targetStep(windsTime)`, at most
   * `TRACER_MAX_STEPS_PER_FRAME` per call. Returns true when anything changed.
   */
  advance(renderer: any, windsTime: number): boolean {
    let changed = false;
    if (!this.spun) {
      this.runOne(renderer, 1);
      for (let i = 0; i < TRACER_SPINUP_STEPS; i++) this.runOne(renderer, TRACER_RELAX_SPINUP);
      this.spun = true;
      this.clockStep = 0;
      changed = true;
    }
    const want = targetStep(windsTime);
    let n = 0;
    while (this.clockStep < want && n < TRACER_MAX_STEPS_PER_FRAME) {
      this.runOne(renderer, TRACER_RELAX_RUN);
      this.clockStep++;
      n++;
      changed = true;
    }
    if (changed) this.onStep?.();
    return changed;
  }

  dispose(): void {
    this.a.dispose();
    this.b.dispose();
    this.material.dispose();
  }
}

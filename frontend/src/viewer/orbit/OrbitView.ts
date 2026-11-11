// Issue #71 stream H (D-36, Q-270 to Q-272): the Surface view (orbit view) of the viewer. It owns
// the full-screen pass (QuadMesh + NodeMaterial), the camera state and the input maths, and draws
// into a rectangle of the viewer's own canvas AFTER the globe, with the same renderer. That is the
// only way both WebGPU and the WebGL2 fallback can share the gas tracer's render target.
// The pass renders only while the view is on. A render scale below 1 draws into a smaller target
// and blits it (mobile and the low quality level).
/* eslint-disable @typescript-eslint/no-explicit-any -- TSL node graphs are built from untyped proxies */
import {
  SRGBColorSpace,
  UnsignedByteType,
  LinearFilter,
  NodeMaterial,
  QuadMesh,
  RenderTarget,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  ENTRY_ALT_KM,
  HEIGHT_EXAGGERATION,
  aimAtPeak,
  aimDefault,
  altToSlider,
  applyDrag,
  applyFlyKey,
  clampAlt,
  flyForwardSpeedKmS,
  flyKeyAction,
  flyMove,
  goTo,
  sliderToAlt,
  wheelAlt,
  type FlyState,
  type Vec3,
} from './orbitMath';
import { buildOrbitShader, createOrbitUniforms, type OrbitShader, type OrbitUniforms } from './orbitShader';
import type { OrbitSources } from './orbitSources';
import { orbitUniformValues, type OrbitLight, type OrbitUniformValues } from './orbitUniforms';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Sim seconds of the clouds to the shader's drift time (artistic: about the prototype's default pacing). */
export const CLOUD_TIME_PER_SIM_S = 0.02;
/** Render scale of the pass: half on mobile and the low quality level. */
export function renderScaleFor(lowQuality: boolean): number {
  return lowQuality ? 0.5 : 1;
}

/** The pass never renders above this pixel ratio (Moon: lag). */
export const ORBIT_MAX_PIXEL_RATIO = 1.25;
/** Render scale while the user drags, scrolls or flies; it refines to the level's own scale when input stops. */
export const INTERACT_SCALE = 0.25;
/** How long after the last input the view counts as interacting, ms. */
export const INTERACT_MS = 220;

export interface OrbitQuality {
  /** Share of the full size the pass is drawn at. */
  scale: number;
  march: number;
  shadow: number;
  atmo: number;
  trace: number;
}
/** Levels 0 (best) to 3. While interacting the pass uses `INTERACTING`. */
export const QUALITY_LEVELS: readonly OrbitQuality[] = [
  { scale: 1, march: 360, shadow: 36, atmo: 16, trace: 10 },
  { scale: 0.75, march: 240, shadow: 24, atmo: 12, trace: 7 },
  { scale: 0.5, march: 160, shadow: 16, atmo: 8, trace: 5 },
  { scale: 0.35, march: 100, shadow: 10, atmo: 6, trace: 3 },
];
export const INTERACTING: OrbitQuality = { scale: INTERACT_SCALE, march: 120, shadow: 12, atmo: 8, trace: 4 };
/** Frame time above this steps the level down; below FAST_MS for FAST_FRAMES frames steps it back up. */
export const SLOW_MS = 20;
export const FAST_MS = 12;
export const FAST_FRAMES = 40;
export const LEVEL_GAP_MS = 600;

/**
 * Adaptive quality with hysteresis: a smoothed frame time over SLOW_MS lowers the level (at most one
 * step per LEVEL_GAP_MS); FAST_FRAMES quick frames in a row raise it again. Pure and testable.
 */
export class QualityGovernor {
  level = 0;
  private ema = 0;
  private fast = 0;
  private lastChange = -Infinity;
  feed(ms: number, now: number): void {
    this.ema = this.ema === 0 ? ms : this.ema * 0.8 + ms * 0.2;
    if (this.ema > SLOW_MS && this.level < QUALITY_LEVELS.length - 1 && now - this.lastChange >= LEVEL_GAP_MS) {
      this.level++;
      this.lastChange = now;
      this.fast = 0;
    } else if (ms < FAST_MS) {
      this.fast++;
      if (this.fast >= FAST_FRAMES && this.level > 0 && now - this.lastChange >= LEVEL_GAP_MS) {
        this.level--;
        this.lastChange = now;
        this.fast = 0;
        this.ema = 0;
      }
    } else this.fast = 0;
  }
}

const DEFAULT_LIGHT: OrbitLight = { sunDir: [0, 0, 1], starColour: [1, 1, 1], timeSec: 0, cloudsOn: true };

function setUniforms(U: OrbitUniforms, v: OrbitUniformValues): void {
  U.uR.value.set(v.size[0], v.size[1]);
  const set3 = (n: any, a: Vec3) => n.value.set(a[0], a[1], a[2]);
  set3(U.uCam, v.cam);
  set3(U.uFwd, v.fwd);
  set3(U.uRt, v.right);
  set3(U.uUp, v.up);
  set3(U.uLb, v.light);
  set3(U.uStar, v.star);
  set3(U.uC0, v.c0);
  set3(U.uCA, v.ca);
  set3(U.uCB, v.cb);
  set3(U.uLiq, v.liq);
  set3(U.uIce, v.ice);
  set3(U.uLand, v.land);
  set3(U.uCld, v.cld);
  set3(U.uAw, v.aw);
  set3(U.uZ, v.z);
  set3(U.uB, v.b);
  set3(U.uS, v.s);
  set3(U.uP, v.p);
  set3(U.uHazeC, v.hazeC);
  set3(U.uSCR, v.scr);
  set3(U.uSCM, v.scm);
  set3(U.uEXT, v.ext);
  U.uFov.value = v.fov;
  U.uEx.value = v.ex;
  U.uRkm.value = v.rkm;
  U.uOcean.value = v.ocean;
  U.uTt.value = v.tt;
  U.uTb.value = v.tb;
  U.uCov.value = v.cov;
  U.uTau.value = v.tau;
  U.uHz.value = v.hz;
  U.uTime.value = v.time;
  U.uSeed.value = v.seed;
  U.uGam.value = v.gam;
  U.uClouds.value = v.clouds;
  U.uHV.value = v.hv;
  U.uMX.value = v.mx;
}

export class OrbitView {
  readonly sources: OrbitSources;
  state: FlyState;
  light: OrbitLight = { ...DEFAULT_LIGHT };
  /** Set by the owner every frame: 0..1 fade-in. */
  fade = 1;
  /** "Fly forward" is on. */
  flying = false;
  renderScale = 1;
  failed = false;
  /** Adaptive quality, fed by the owner with real frame times (affects animated frames only). */
  readonly governor = new QualityGovernor();
  private lastInput = -Infinity;
  private lastSig = '';
  private drawn = false;
  /** Passes actually rendered (tests, the performance readout). */
  passes = 0;

  private readonly U = createOrbitUniforms();
  private readonly shader: OrbitShader;
  private readonly material: NodeMaterial;
  private readonly quad: QuadMesh;
  private rt: RenderTarget | null = null;

  constructor(sources: OrbitSources) {
    this.sources = sources;
    const gas = sources.kind === 'gas';
    if (gas && !(sources.tracer?.() ?? null)) throw new Error('The cloud tracer is not ready yet');
    this.state = { lon: 0, lat: 0.3, head: 0.6, pitch: -0.16, altKm: ENTRY_ALT_KM[sources.kind] };
    this.shader = buildOrbitShader(
      {
        kind: sources.kind,
        height: sources.height,
        climate: sources.climate,
        hydrology: sources.hydrology,
        cloudBase: sources.cloudBase?.() ?? null,
        clouds: !gas && sources.cloudCover !== null && (sources.cloudBase !== null || sources.climate !== null),
        ocean: sources.hasOcean && sources.climate !== null,
        snow: sources.lapseKPerKm !== null && sources.climate !== null,
        velocity: sources.velocity,
        bands: sources.bands,
        tracer: gas ? (sources.tracer?.() ?? null) : null,
      },
      this.U,
    );
    this.material = new NodeMaterial();
    this.material.name = 'OrbitView';
    this.material.fragmentNode = this.shader.fragment;
    this.material.toneMapped = false;
    this.quad = new QuadMesh(this.material);
  }

  get kind() {
    return this.sources.kind;
  }

  /** Slider position 0..1000 for the current height. */
  get slider(): number {
    return altToSlider(this.kind, this.state.altKm);
  }

  setAltitudeSlider(v: number): void {
    this.markInput();
    this.state = { ...this.state, altKm: sliderToAlt(this.kind, v) };
  }

  setAltitude(km: number): void {
    this.state = { ...this.state, altKm: clampAlt(this.kind, km) };
  }

  /** Entry: face the highest sunlit mountains (rocky) or put the Sun about 35 degrees up (default). */
  enter(sun: Vec3, viewDir: Vec3 = [0, 0, 1]): void {
    const alt = ENTRY_ALT_KM[this.kind];
    const peak =
      this.kind === 'rocky' ? aimAtPeak(this.sources.heightGrid, sun, alt, this.sources.radiusKm) : null;
    this.state = peak ?? aimDefault(sun, viewDir, this.kind, alt);
  }

  /** Marks input so the next frames render coarse and refine when it stops. */
  markInput(now = performance.now()): void {
    this.lastInput = now;
  }

  isInteracting(now = performance.now()): boolean {
    return now - this.lastInput < INTERACT_MS;
  }

  drag(dx: number, dy: number): void {
    this.markInput();
    this.state = applyDrag(this.state, dx, dy);
  }

  wheel(deltaY: number): void {
    this.markInput();
    this.state = { ...this.state, altKm: wheelAlt(this.kind, this.state.altKm, deltaY) };
  }

  pinch(scale: number): void {
    this.markInput();
    if (scale > 0) this.setAltitude(this.state.altKm / scale);
  }

  setFlying(on: boolean): void {
    this.flying = on;
  }

  /** Returns true when the key was a surface-view key. */
  key(k: string): boolean {
    const a = flyKeyAction(k, this.state.altKm);
    if (!a) return false;
    this.markInput();
    this.state = applyFlyKey(this.state, a, this.kind, this.sources.radiusKm);
    return true;
  }

  goTo(place: { lon: number; lat: number }): void {
    this.state = goTo(this.state, place);
  }

  /** Moves forward for `dt` real seconds while "Fly forward" is on. */
  advance(dt: number): void {
    if (!this.flying) return;
    this.state = flyMove(this.state, flyForwardSpeedKmS(this.state.altKm) * dt, 0, this.sources.radiusKm);
  }

  /** The numbers the shader will read for a frame (pure; also used by tests). */
  uniformValues(size: { w: number; h: number }): OrbitUniformValues {
    return orbitUniformValues(this.sources, this.state, this.light, size);
  }

  exaggeration(): number {
    return HEIGHT_EXAGGERATION[this.kind];
  }

  /** The quality this frame uses. Settled frames (nothing moving) always use level 0: the same image every time. */
  qualityFor(now: number, animating: boolean): OrbitQuality {
    if (this.isInteracting(now) || this.flying) return INTERACTING;
    const base = QUALITY_LEVELS[animating ? this.governor.level : 0]!;
    return { ...base, scale: Math.min(base.scale, this.renderScale) };
  }

  /**
   * Renders the pass into an offscreen 8-bit sRGB target of `size` (logical px) times the pixel
   * ratio (capped) and the quality scale, only when something changed (camera, light, time, tracer,
   * size or quality); otherwise the last image stands. The owner reads the target back and paints it
   * into the pane canvas. Returns null when the view has failed (the owner falls back to the globe).
   */
  render(
    renderer: WebGPURenderer,
    size: { w: number; h: number },
    pixelRatio: number,
    ctx: { now?: number; animating?: boolean } = {},
  ): { rt: RenderTarget; changed: boolean } | null {
    if (this.failed) return null;
    try {
      const now = ctx.now ?? performance.now();
      const q = this.qualityFor(now, ctx.animating ?? false);
      const pr = Math.min(pixelRatio, ORBIT_MAX_PIXEL_RATIO);
      const w = Math.max(1, Math.round(size.w * pr * q.scale));
      const h = Math.max(1, Math.round(size.h * pr * q.scale));
      const values = this.uniformValues({ w, h });
      const live = this.sources.tracer?.() ?? null;
      const cb = this.sources.cloudBase?.() ?? null;
      const sig = `${JSON.stringify(values)}|${q.march},${q.shadow},${q.atmo},${q.trace}|${live?.uuid ?? ''}|${cb?.uuid ?? ''}`;
      const rt = this.ensureTarget(w, h);
      if (sig === this.lastSig && this.drawn) return { rt, changed: false };
      setUniforms(this.U, values);
      this.U.uFade.value = 1;
      this.U.uMarch.value = q.march;
      this.U.uShadow.value = q.shadow;
      this.U.uAtmo.value = q.atmo;
      this.U.uTrace.value = q.trace;
      if (live && this.shader.tracerBase) this.shader.tracerBase.value = live;
      if (cb && this.shader.cloudBase) this.shader.cloudBase.value = cb;
      const prevTarget = renderer.getRenderTarget();
      const prevClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget(rt);
      try {
        this.quad.render(renderer);
      } finally {
        renderer.setRenderTarget(prevTarget);
        renderer.autoClear = prevClear;
      }
      this.lastSig = sig;
      this.drawn = true;
      this.passes++;
      return { rt, changed: true };
    } catch (err) {
      this.failed = true;
      console.warn('[viewer] the surface view failed; showing the globe alone', err);
      return null;
    }
  }

  /** True while the pane needs more frames: input just happened (it refines after), or it is flying. */
  needsFrames(now = performance.now()): boolean {
    return this.flying || this.isInteracting(now) || now - this.lastInput < INTERACT_MS + 40;
  }

  private ensureTarget(w: number, h: number): RenderTarget {
    if (!this.rt) {
      this.rt = new RenderTarget(w, h, {
        type: UnsignedByteType,
        colorSpace: SRGBColorSpace,
        depthBuffer: false,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        generateMipmaps: false,
      });
    } else if (this.rt.width !== w || this.rt.height !== h) {
      this.rt.setSize(w, h);
    }
    return this.rt;
  }

  dispose(): void {
    this.material.dispose();
    this.rt?.dispose();
    this.rt = null;
  }
}

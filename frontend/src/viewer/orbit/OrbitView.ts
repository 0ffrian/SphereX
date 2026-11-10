// Issue #71 stream H (D-36, Q-270 to Q-272): the Surface view (orbit view) of the viewer. It owns
// the full-screen pass (QuadMesh + NodeMaterial), the camera state and the input maths, and draws
// into a rectangle of the viewer's own canvas AFTER the globe, with the same renderer. That is the
// only way both WebGPU and the WebGL2 fallback can share the gas tracer's render target.
// The pass renders only while the view is on. A render scale below 1 draws into a smaller target
// and blits it (mobile and the low quality level).
/* eslint-disable @typescript-eslint/no-explicit-any -- TSL node graphs are built from untyped proxies */
import {
  HalfFloatType,
  LinearFilter,
  NodeMaterial,
  QuadMesh,
  RenderTarget,
  type WebGPURenderer,
} from 'three/webgpu';
import { texture, uv } from 'three/tsl';
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

  private readonly U = createOrbitUniforms();
  private readonly shader: OrbitShader;
  private readonly material: NodeMaterial;
  private readonly quad: QuadMesh;
  private rt: RenderTarget | null = null;
  private blit: { material: NodeMaterial; quad: QuadMesh; node: any } | null = null;

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
        cloudBase: sources.cloudBase,
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

  drag(dx: number, dy: number): void {
    this.state = applyDrag(this.state, dx, dy);
  }

  wheel(deltaY: number): void {
    this.state = { ...this.state, altKm: wheelAlt(this.kind, this.state.altKm, deltaY) };
  }

  pinch(scale: number): void {
    if (scale > 0) this.setAltitude(this.state.altKm / scale);
  }

  setFlying(on: boolean): void {
    this.flying = on;
  }

  /** Returns true when the key was a surface-view key. */
  key(k: string): boolean {
    const a = flyKeyAction(k, this.state.altKm);
    if (!a) return false;
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

  /**
   * Draws into `rect` (logical px, top-left origin) of the renderer's canvas. Never throws: a
   * failure marks the view failed and the owner falls back to the globe alone.
   */
  render(renderer: WebGPURenderer, rect: Rect, pixelRatio: number): void {
    if (this.failed) return;
    try {
      const scale = this.renderScale;
      const w = Math.max(1, Math.round(rect.w * pixelRatio * scale));
      const h = Math.max(1, Math.round(rect.h * pixelRatio * scale));
      setUniforms(this.U, this.uniformValues({ w, h }));
      this.U.uFade.value = this.fade;
      const live = this.sources.tracer?.() ?? null;
      if (live && this.shader.tracerBase) this.shader.tracerBase.value = live;
      const prevClear = renderer.autoClear;
      renderer.autoClear = false;
      try {
        if (scale >= 1) {
          renderer.setViewport(rect.x, rect.y, rect.w, rect.h);
          this.quad.render(renderer);
        } else {
          const rt = this.ensureTarget(w, h);
          const prevTarget = renderer.getRenderTarget();
          renderer.setRenderTarget(rt);
          this.quad.render(renderer);
          renderer.setRenderTarget(prevTarget);
          renderer.setViewport(rect.x, rect.y, rect.w, rect.h);
          this.ensureBlit(rt);
          this.blit!.quad.render(renderer);
        }
      } finally {
        renderer.autoClear = prevClear;
      }
    } catch (err) {
      this.failed = true;
      console.warn('[viewer] the surface view failed; showing the globe alone', err);
    }
  }

  private ensureTarget(w: number, h: number): RenderTarget {
    if (!this.rt) {
      this.rt = new RenderTarget(w, h, {
        type: HalfFloatType,
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

  private ensureBlit(rt: RenderTarget): void {
    if (this.blit) return;
    const node = texture(rt.texture, uv());
    const material = new NodeMaterial();
    material.name = 'OrbitBlit';
    material.fragmentNode = node;
    material.toneMapped = false;
    this.blit = { material, quad: new QuadMesh(material), node };
  }

  dispose(): void {
    this.material.dispose();
    this.rt?.dispose();
    this.blit?.material.dispose();
    this.rt = null;
    this.blit = null;
  }
}

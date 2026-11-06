// R4 (level 3) / R5 Sky Sculptor viewer shell. Smoke scene only: one plain placeholder sphere.
// Implements: three r187 WebGPURenderer with WebGL2 fallback (R2, D-03), R5.1 ambient limit,
// R5.5 pixel ratio and render-on-change, R5.6 default-mode orbit + keyboard + on-screen rotate.
// R5.1-R5.4, R7.x: `setObject` takes an ObjectCard + RenderParams, plans what to draw (pure, in
// renderPlan.ts) and builds it (renderers/build.ts). Spin runs only when the plan has a spin and
// the user does not prefer reduced motion (R9). Not implemented yet: Touch mode.
//
// Plain module (no React) so it works with or without React (A10).
import {
  AmbientLight,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardNodeMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  WebGPURenderer,
} from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ObjectCard, RenderParams } from '@/contract';
import { buildLights, MAX_AMBIENT_INTENSITY } from './lighting';
import type { PlanContext, RenderPlan, SpinPlan } from './planTypes';
import { planRender } from './renderPlan';
import type { BodyRenderer } from './renderers/bodyRenderer';
import { AssetCache, buildScene, type BuildHooks, type BuiltScene } from './renderers/build';
import { SimClock, type PauseReason } from './render/clock';
import { RenderChain } from './render/pipeline';
import { FrameGovernor, initialTier, isTierName, type TierName } from './render/quality';

/** Which backend `WebGPURenderer` ended up on after `init()`. */
export type RendererBackend = 'webgpu' | 'webgl2';

/** R5.5 / D-05: `min(devicePixelRatio, 1.5)`. */
export const MAX_PIXEL_RATIO = 1.5;

export function viewerPixelRatio(devicePixelRatio: number): number {
  return Math.min(devicePixelRatio, MAX_PIXEL_RATIO);
}

/** Longest wait for `compileAsync` before the new content is shown anyway (never stuck on the old). */
export const COMPILE_TIMEOUT_MS = 3000;
/** Frame times kept for `renderStats` percentiles. */
const STATS_WINDOW = 240;

export interface RenderStats {
  tier: string;
  backend: RendererBackend;
  frames: number;
  p50Ms: number;
  p95Ms: number;
  drops: number;
}

/** Fired when the governor (or `setQualityTier`) changes the tier; the panel announces it. */
export interface QualityChange {
  from: TierName;
  to: TierName;
  /** True when the frame-time governor lowered it, false for a manual change. */
  auto: boolean;
}

/** Nearest-rank percentile of an unsorted list; 0 for an empty list. */
export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;
}

/** R9: `prefers-reduced-motion` disables auto-spin. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Deep-space background (display choice, 'artistic'). */
const SPACE_BACKGROUND = 0x05060a;

/** Camera distance for the unit sphere, and the vertical field of view (degrees). */
const DEFAULT_CAMERA_DISTANCE = 4;
const CAMERA_FOV_DEG = 40;
/** Margin around the largest thing drawn when the camera is placed to frame it. Display value. */
const FRAME_MARGIN = 1.15;

/** Camera distance that keeps a scene reaching `extent` from the origin inside the view. */
export function cameraDistanceFor(extent: number): number {
  const fit = (FRAME_MARGIN * extent) / Math.tan((CAMERA_FOV_DEG * Math.PI) / 360);
  return Math.max(DEFAULT_CAMERA_DISTANCE, fit);
}

/**
 * The parts of a plan that change what is built. Mode, honesty and epoch changes that leave these
 * unchanged (a legend or colour-name change) do not rebuild the scene.
 */
export function sceneKey(plan: RenderPlan): string {
  return JSON.stringify([
    plan.threeD,
    plan.bodies,
    plan.shells,
    plan.discs,
    plan.screens,
    plan.trails,
    plan.dust,
    plan.spin,
    // The shader kinds: what the body is built from. Honesty and light are not in it (they update
    // the body in place), so a toggle does not regenerate the field.
    plan.shader?.key ?? null,
  ]);
}

/** Rotate-button and arrow-key step. UI convenience, not a physical value. */
const ROTATE_STEP_RAD = Math.PI / 12;
/**
 * Zoom step for +/− keys and buttons. UI convenience, not a physical value.
 * r187 OrbitControls multiplies the orbit radius by the factor passed to `dollyIn` and divides
 * it by the factor passed to `dollyOut`, so the factor must be < 1 for `dollyIn` to move closer.
 */
const DOLLY_SCALE = 1 / 1.2;

export type RotateDirection = 'left' | 'right' | 'up' | 'down';
export type ZoomDirection = 'in' | 'out';
export type ViewerAction =
  | { kind: 'rotate'; direction: RotateDirection }
  | { kind: 'zoom'; direction: ZoomDirection }
  | { kind: 'reset' };

/** The subset of OrbitControls the step helpers use (keeps them testable without a renderer). */
type StepControls = Pick<OrbitControls, 'rotateLeft' | 'rotateUp' | 'dollyIn' | 'dollyOut'>;

export function rotateControls(controls: StepControls, direction: RotateDirection): void {
  switch (direction) {
    case 'left':
      controls.rotateLeft(ROTATE_STEP_RAD);
      break;
    case 'right':
      controls.rotateLeft(-ROTATE_STEP_RAD);
      break;
    case 'up':
      controls.rotateUp(ROTATE_STEP_RAD);
      break;
    case 'down':
      controls.rotateUp(-ROTATE_STEP_RAD);
      break;
  }
}

export function zoomControls(controls: StepControls, direction: ZoomDirection): void {
  if (direction === 'in') controls.dollyIn(DOLLY_SCALE);
  else controls.dollyOut(DOLLY_SCALE);
}

/**
 * R5.6 keyboard: arrows rotate, +/− zoom, R resets. `T` (Touch mode) is not implemented yet.
 * Returns null for keys the viewer does not own, including any Ctrl/Meta/Alt combination, so
 * browser shortcuts (Ctrl+R reload, Ctrl+± page zoom) keep working while the canvas has focus.
 */
export function viewerKeyAction(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>,
): ViewerAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  switch (e.key) {
    case 'ArrowLeft':
      return { kind: 'rotate', direction: 'left' };
    case 'ArrowRight':
      return { kind: 'rotate', direction: 'right' };
    case 'ArrowUp':
      return { kind: 'rotate', direction: 'up' };
    case 'ArrowDown':
      return { kind: 'rotate', direction: 'down' };
    case '+':
    case '=':
      return { kind: 'zoom', direction: 'in' };
    case '-':
    case '_':
      return { kind: 'zoom', direction: 'out' };
    case 'r':
    case 'R':
      return { kind: 'reset' };
    default:
      return null;
  }
}

export class ViewerApp {
  readonly backend: RendererBackend;

  private readonly renderer: WebGPURenderer;
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly geometry: SphereGeometry;
  private readonly material: MeshStandardNodeMaterial;
  private readonly placeholder: Mesh;
  private lights: Object3D[] = [];
  private placeholderLights: Object3D[] = [];
  private built: BuiltScene | null = null;
  private builtKey = '';
  private framedKey: string | null = null;
  /** Textures and meshes by URL, kept across rebuilds. */
  private readonly assets = new AssetCache();
  /** Content in the scene; `built` may be newer while its shaders compile (never blank). */
  private onScreen: BuiltScene | null = null;
  private compileToken = 0;
  private compiling: Promise<void> | null = null;
  /** One sim time per moving process (plan 09); the spin is the only process today. */
  private readonly clock = new SimClock(() => performance.now());
  /** Radians per simulated second of the spin (the shown speed-up is the clock's, not in this). */
  private spinBase = 0;
  /** WCAG 2.2.2: the user can pause auto-spin. */
  private spinPaused = false;
  private chain: RenderChain | null = null;
  private chainFailed = false;
  private tier: TierName;
  private readonly governor: FrameGovernor;
  private onQualityChange: ((e: QualityChange) => void) | null = null;
  private frames = 0;
  private drops = 0;
  private readonly frameTimes: number[] = [];
  private burstLeft = 0;
  private loopLast: number | null = null;
  private settleWaiters: (() => void)[] = [];
  private intersection: IntersectionObserver | null = null;
  private motionQuery: MediaQueryList | null = null;
  /** Called when a mesh or texture fails to load; the panel adds the layer to `failed` and re-plans. */
  private onLoadFailed: ((layerId: string) => void) | null = null;
  /** Tests only: field and point sources and slider overrides for the shader kinds. */
  private shaderOptions: BuildHooks['shader'];

  setQualityChangeHandler(handler: ((e: QualityChange) => void) | null): void {
    this.onQualityChange = handler;
  }

  setLoadFailedHandler(handler: ((layerId: string) => void) | null): void {
    this.onLoadFailed = handler;
  }
  private readonly resizeObserver: ResizeObserver | null;
  private dprQuery: MediaQueryList | null = null;
  private frameRequest: number | null = null;
  private disposed = false;

  /**
   * Creates the renderer and awaits `renderer.init()`, which picks WebGPU or falls back to
   * WebGL2. Rejects if neither backend is available; the caller shows that state.
   */
  static async create(canvas: HTMLCanvasElement): Promise<ViewerApp> {
    const renderer = new WebGPURenderer({ canvas, antialias: true });
    try {
      await renderer.init();
    } catch (err) {
      await renderer.dispose().catch(() => undefined);
      throw err;
    }
    const app = new ViewerApp(canvas, renderer);
    await app.initPipeline();
    return app;
  }

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    renderer: WebGPURenderer,
  ) {
    this.renderer = renderer;
    // r187: after init(), `backend` is a WebGPUBackend or, after fallback, a WebGLBackend.
    this.backend = 'isWebGPUBackend' in renderer.backend ? 'webgpu' : 'webgl2';

    renderer.setPixelRatio(viewerPixelRatio(window.devicePixelRatio || 1));
    renderer.setClearColor(new Color(SPACE_BACKGROUND), 1);
    this.tier = initialTier({
      backend: this.backend,
      coarsePointer:
        typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches,
    });
    this.governor = new FrameGovernor(this.tier);

    this.scene = new Scene();
    // The background must be scene.background: through the HDR RenderPipeline the clear colour alone
    // came out black (0,0,0) on WebGL2. The golden spec checks it at a canvas corner.
    this.scene.background = new Color(SPACE_BACKGROUND);
    this.camera = new PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(0, 0, 4);

    // Placeholder body: a plain unit sphere. Not an object; tag 'artistic' (no data drawn).
    this.geometry = new SphereGeometry(1, 64, 32);
    this.material = new MeshStandardNodeMaterial({ color: 0x8a8a8a, roughness: 0.9 });
    this.placeholder = new Mesh(this.geometry, this.material);
    this.scene.add(this.placeholder);

    // R5.1: one DirectionalLight plus ambient ≤ 0.03. This direction is for the placeholder only
    // ('artistic'); a loaded object is lit from its own phase angle (lighting.ts).
    const sun = new DirectionalLight(0xffffff, 2);
    sun.position.set(3, 1.5, 2);
    this.placeholderLights = [sun, new AmbientLight(0xffffff, MAX_AMBIENT_INTENSITY)];
    this.setLights(this.placeholderLights);

    // R5.6 default mode: drag rotates, wheel/pinch zooms. No damping, so nothing animates
    // after input stops and we can render only on change (R5.5).
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = false;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 20;
    this.controls.saveState();
    this.controls.addEventListener('change', this.requestRender);

    canvas.addEventListener('keydown', this.onKeyDown);

    // R9: the reduced-motion preference is read live, so spin stops when it is switched on.
    if (typeof window.matchMedia === 'function') {
      this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.motionQuery.addEventListener?.('change', this.onMotionChange);
    }
    // The clock pauses for reduced motion, a hidden tab and an off-screen canvas.
    this.clock.setPaused('reduced-motion', prefersReducedMotion());
    this.clock.setPaused('hidden', typeof document !== 'undefined' && document.hidden === true);
    document.addEventListener('visibilitychange', this.onVisibility);
    if (typeof IntersectionObserver !== 'undefined') {
      this.intersection = new IntersectionObserver((entries) => {
        const last = entries[entries.length - 1];
        if (last) this.setPause('offscreen', !last.isIntersecting);
      });
      this.intersection.observe(canvas);
    }

    this.resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.resize());
    this.resizeObserver?.observe(canvas);
    this.watchPixelRatio();

    this.resize();
  }

  /**
   * Draws an object: plans it (honesty, mode, epoch, `missing`), builds the scene and returns the
   * plan. Never throws and never leaves the view blank: layers that cannot be drawn are listed in
   * `plan.missing`. Call again with a new context to change mode, epoch or honesty.
   */
  setObject(card: ObjectCard, params: RenderParams, ctx: PlanContext): RenderPlan {
    const plan = planRender(card, params, ctx);
    this.showPlan(plan);
    return plan;
  }

  /** Tests and sliders (D-27): replaces the field source or sets overrides for the next build. */
  setShaderOptions(options: BuildHooks['shader']): void {
    this.shaderOptions = options;
  }

  /** The generated body of a shader kind (haptics read its field and points), else null. */
  get body(): BodyRenderer | null {
    return this.built?.body ?? null;
  }

  /** Draws a plan made with `planRender` (the panel plans once and reuses the plan for its UI). */
  showPlan(plan: RenderPlan): void {
    if (this.disposed) return;
    // The new lights go on with the content they belong to: an old object still on screen while
    // the new one compiles is not lit from the new object's phase angle.
    const lights = buildLights(plan.lighting);
    const key = sceneKey(plan);
    if (this.built && key === this.builtKey) {
      // Nothing that is built changed: only the lights, the honesty state or the labels did. A
      // generated body takes the new tags and light in place (no field is regenerated).
      this.setLights(lights);
      this.built.update(plan);
      this.restartSettle();
      return;
    }
    // A build that never reached the screen (still compiling) is dropped for the newer one.
    this.compileToken++;
    if (this.built && this.built !== this.onScreen) this.built.dispose();
    this.built = null;
    this.builtKey = '';
    let next: BuiltScene | null = null;
    if (plan.threeD && (plan.bodies.length > 0 || plan.shader !== null)) {
      try {
        next = buildScene(
          plan,
          {
            onLoadFailed: (id) => this.onLoadFailed?.(id),
            onChange: this.requestRender,
            shader: this.shaderOptions,
          },
          this.assets,
        );
      } catch (err) {
        // Never blank, never crash: the plan stays on screen as text and the canvas stays empty.
        console.warn('[viewer] could not build the scene', err);
      }
    }
    if (!next) {
      this.setLights(lights);
      this.removeOnScreen();
      this.placeholder.visible = false;
      this.syncProcesses(null, null);
      this.renderNow();
      return;
    }
    this.built = next;
    this.builtKey = key;
    this.syncProcesses(plan.spin, next);
    this.frame(plan.id, plan.extent, plan.shader?.distance ?? 0);
    this.swapInAfterCompile(next, lights);
  }

  /**
   * Compiles the new content's shaders (`renderer.compileAsync`), then swaps it in. Until then
   * the old content (or the placeholder) stays on screen, so no frame is blank. A renderer
   * without `compileAsync` (test stubs) swaps at once.
   */
  private swapInAfterCompile(next: BuiltScene, lights: Object3D[]): void {
    const token = this.compileToken;
    const swap = () => {
      if (this.disposed || token !== this.compileToken || this.built !== next) return;
      this.removeOnScreen();
      this.setLights(lights);
      this.scene.add(next.group);
      this.onScreen = next;
      this.placeholder.visible = false;
      this.applySpinAngle();
      this.restartSettle();
    };
    if (typeof this.renderer.compileAsync !== 'function') {
      swap();
      return;
    }
    const p = this.compile(next.group).then(swap);
    this.compiling = p;
    void p.finally(() => {
      if (this.compiling === p) this.compiling = null;
    });
  }

  /** `compileAsync` with a timeout and no throw. */
  private compile(object: Object3D): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, COMPILE_TIMEOUT_MS);
    });
    const done = Promise.resolve()
      .then(() => this.renderer.compileAsync(object, this.camera, this.scene))
      .catch((err: unknown) => console.warn('[viewer] compileAsync failed', err));
    return Promise.race([done, timeout]).finally(() => clearTimeout(timer));
  }

  private removeOnScreen(): void {
    if (!this.onScreen) return;
    this.scene.remove(this.onScreen.group);
    this.onScreen.dispose();
    this.onScreen = null;
  }

  /** Registers or removes the spin process on the clock. */
  private syncProcesses(spin: SpinPlan | null, built: BuiltScene | null): void {
    if (built && spin && built.spinRate > 0) {
      this.spinBase = built.spinRate / spin.speedup;
      this.clock.setProcess({ id: 'spin', label: 'Spin', speedup: spin.speedup });
    } else {
      this.spinBase = 0;
      this.clock.removeProcess('spin');
    }
    this.updateLoop();
  }

  /** Back to the placeholder sphere. */
  clearObject(): void {
    if (this.disposed) return;
    this.clearBuilt();
    this.placeholder.visible = true;
    this.setLights(this.placeholderLights);
    this.frame('', 1, 0);
    this.syncProcesses(null, null);
    this.restartSettle();
  }

  /**
   * Places the camera so everything drawn is in view (the T Tauri disc and the star trail reach
   * past the unit sphere). Only when the object or its extent changes, so a user's zoom survives
   * an honesty or mode change.
   */
  private frame(id: string, extent: number, minDistance: number): void {
    const key = `${id}|${extent}|${minDistance}`;
    if (key === this.framedKey) return;
    this.framedKey = key;
    // A generated body brings its own framing distance (ShaderPlan.distance, a display value).
    const d = Math.max(cameraDistanceFor(extent), minDistance);
    this.controls.maxDistance = Math.max(20, d * 2);
    this.camera.position.set(0, 0, d);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.controls.saveState();
  }

  /** Pause or resume auto-spin (WCAG 2.2.2). Survives rebuilds. */
  setSpinPaused(paused: boolean): void {
    if (this.disposed || paused === this.spinPaused) return;
    this.spinPaused = paused;
    this.setPause('user', paused);
  }

  isSpinPaused(): boolean {
    return this.spinPaused;
  }

  /** The processes that are time-lapses (each is shown with its speed-up). */
  timeLapses(): { id: string; label: string; speedup: number }[] {
    return this.clock.processes();
  }

  private setPause(reason: PauseReason, paused: boolean): void {
    this.clock.setPaused(reason, paused);
    this.updateLoop();
  }

  private applySpinAngle(): void {
    if (!this.built) return;
    const angle = this.spinBase * this.clock.simTime('spin');
    for (const o of this.built.spinners) o.rotation.y = angle;
  }

  private clearBuilt(): void {
    this.compileToken++;
    this.removeOnScreen();
    if (this.built) this.built.dispose();
    this.built = null;
    this.builtKey = '';
  }

  private setLights(next: Object3D[]): void {
    for (const l of this.lights) this.scene.remove(l);
    this.lights = next;
    for (const l of next) this.scene.add(l);
  }

  /**
   * New content: restart temporal AA history so the settled frame depends only on what is shown
   * now (same card, seed and time give the same frame), then draw and settle. Orbit changes keep
   * the history (`requestRender`), since that is what temporal AA is for while moving.
   */
  private restartSettle(): void {
    this.chain?.restartTemporal();
    this.renderNow();
  }

  /** Draws now (no blank frame on resize) and starts a settle burst for temporal AA. */
  private renderNow(): void {
    this.draw();
    this.burstLeft = Math.max(this.burstLeft, this.settleFrames());
    if (this.burstLeft > 0) this.schedule();
  }

  private settleFrames(): number {
    return this.chain ? this.chain.config.settleFrames : 0;
  }

  /** One frame: through the pipeline, or plain if the pipeline is missing or failed. */
  private draw(): void {
    this.frames++;
    if (this.chain) {
      try {
        this.chain.render();
        return;
      } catch (err) {
        this.dropChain(err);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  private dropChain(err: unknown): void {
    if (!this.chainFailed) console.warn('[viewer] render pipeline failed; drawing plainly', err);
    this.chainFailed = true;
    try {
      this.chain?.dispose();
    } catch {
      /* already broken */
    }
    this.chain = null;
  }

  /** Builds the HDR pipeline and warms up the placeholder; a failure leaves plain rendering. */
  private async initPipeline(): Promise<void> {
    try {
      this.chain = new RenderChain(
        this.renderer,
        this.scene,
        this.camera,
        this.tier,
        prefersReducedMotion(),
      );
    } catch (err) {
      this.dropChain(err);
      return;
    }
    if (typeof this.renderer.compileAsync === 'function') await this.compile(this.scene);
    if (!this.disposed) this.renderNow();
  }

  /** Test hook and tier choice. Rebuilds the pipeline for the tier's bloom and anti-aliasing. */
  setQualityTier(name: TierName): void {
    this.applyTier(name, false);
  }

  private applyTier(name: TierName, auto: boolean): void {
    if (this.disposed || !isTierName(name) || name === this.tier) return;
    const from = this.tier;
    this.tier = name;
    this.governor.setTier(name);
    if (this.chain) {
      try {
        this.chain.setTier(name);
      } catch (err) {
        this.dropChain(err);
      }
    }
    if (auto) this.drops++;
    this.onQualityChange?.({ from, to: name, auto });
    this.renderNow();
  }

  /** Quality tier, backend and frame-time percentiles of the continuous frames (tests, tuning). */
  renderStats(): RenderStats {
    return {
      tier: this.tier,
      backend: this.backend,
      frames: this.frames,
      p50Ms: percentile(this.frameTimes, 0.5),
      p95Ms: percentile(this.frameTimes, 0.95),
      drops: this.drops,
    };
  }

  /** Resolves when no settle burst is pending and no shader compile is in flight. */
  async whenSettled(): Promise<void> {
    while (this.compiling) await this.compiling;
    if (this.disposed || this.burstLeft <= 0) return;
    await new Promise<void>((resolve) => this.settleWaiters.push(resolve));
  }

  /**
   * Test hook: pauses the clock (reason 'test'), puts every process at the given sim time, renders
   * the settle burst and resolves when it is done. The same card, seed and time give one picture.
   * The 'test' pause is never lifted: a frozen viewer stays frozen (tests and golden frames only).
   */
  async freezeClock(simSeconds: number): Promise<void> {
    if (this.disposed) return;
    this.setPause('test', true);
    this.clock.setAllSimTimes(simSeconds);
    this.applySpinAngle();
    this.restartSettle();
    await this.whenSettled();
  }

  /** Continuous rAF only while the clock runs; otherwise frames come from changes (D-05). */
  private updateLoop(): void {
    if (this.clock.running) this.schedule();
  }

  private schedule(): void {
    if (this.disposed || this.frameRequest !== null) return;
    this.frameRequest = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    this.frameRequest = null;
    if (this.disposed) return;
    if (this.clock.running) {
      this.clock.tick();
      this.applySpinAngle();
    }
    this.draw();
    // Frame time is only meaningful between consecutive frames of one continuous run.
    if (this.loopLast !== null) {
      const ms = now - this.loopLast;
      this.frameTimes.push(ms);
      if (this.frameTimes.length > STATS_WINDOW) this.frameTimes.shift();
      const drop = this.governor.feed(ms, now);
      if (drop) this.applyTier(drop.to, true);
    }
    this.loopLast = now;
    if (this.burstLeft > 0) this.burstLeft--;
    if (this.burstLeft === 0) this.flushSettled();
    if (this.clock.running || this.burstLeft > 0) {
      this.schedule();
    } else {
      this.loopLast = null;
      this.governor.reset();
    }
  };

  private flushSettled(): void {
    const waiters = this.settleWaiters;
    this.settleWaiters = [];
    for (const w of waiters) w();
  }

  /** On-screen rotate buttons (WCAG 2.5.7) and arrow keys. */
  rotate(direction: RotateDirection): void {
    if (this.disposed) return;
    rotateControls(this.controls, direction);
  }

  zoom(direction: ZoomDirection): void {
    if (this.disposed) return;
    zoomControls(this.controls, direction);
  }

  /** R5.6 `R` key: back to the starting view. */
  resetView(): void {
    if (this.disposed) return;
    this.controls.reset();
  }

  /** Coalesces any number of change events into one render on the next frame. */
  readonly requestRender = (): void => {
    if (this.disposed) return;
    this.burstLeft = Math.max(this.burstLeft, this.settleFrames(), 1);
    this.schedule();
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frameRequest !== null) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = null;
    this.flushSettled();
    this.intersection?.disconnect();
    this.intersection = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.clearBuilt();
    this.chain?.dispose();
    this.chain = null;
    this.assets.dispose();
    this.motionQuery?.removeEventListener?.('change', this.onMotionChange);
    this.motionQuery = null;
    this.resizeObserver?.disconnect();
    this.dprQuery?.removeEventListener('change', this.onPixelRatioChange);
    this.dprQuery = null;
    this.canvas.removeEventListener('keydown', this.onKeyDown);
    this.controls.removeEventListener('change', this.requestRender);
    this.controls.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.scene.clear();
    void this.renderer.dispose().catch(() => undefined);
  }

  private resize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setPixelRatio(viewerPixelRatio(window.devicePixelRatio || 1));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // Resizing the canvas clears its drawing buffer, and ResizeObserver callbacks run after this
    // frame's rAF callbacks, so a deferred render would leave one blank frame on screen. Render
    // now instead (still only on change, R5.5).
    this.renderNow();
  }

  /**
   * A devicePixelRatio change with no CSS size change (window moved to another monitor) does not
   * fire ResizeObserver, so watch it with a resolution media query and re-arm after each change.
   */
  private watchPixelRatio(): void {
    this.dprQuery?.removeEventListener('change', this.onPixelRatioChange);
    this.dprQuery = null;
    if (typeof window.matchMedia !== 'function') return;
    this.dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.dprQuery.addEventListener('change', this.onPixelRatioChange);
  }

  private readonly onMotionChange = (): void => {
    if (this.disposed) return;
    const reduced = prefersReducedMotion();
    try {
      this.chain?.setReducedMotion(reduced);
    } catch (err) {
      this.dropChain(err);
    }
    this.setPause('reduced-motion', reduced);
    this.renderNow();
  };

  private readonly onVisibility = (): void => {
    if (!this.disposed) this.setPause('hidden', document.hidden);
  };

  private readonly onPixelRatioChange = (): void => {
    if (this.disposed) return;
    this.watchPixelRatio();
    this.resize();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const action = viewerKeyAction(e);
    if (action === null) return;
    e.preventDefault();
    switch (action.kind) {
      case 'rotate':
        this.rotate(action.direction);
        break;
      case 'zoom':
        this.zoom(action.direction);
        break;
      case 'reset':
        this.resetView();
        break;
    }
  };
}

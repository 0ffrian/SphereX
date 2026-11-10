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
import { bodyScreenPx, lodUrls, shadowSettings } from './shape/shapeModel';
import type { PlanContext, RenderPlan, SpinPlan } from './planTypes';
import type { Overrides } from './sliders';
import { planRender } from './renderPlan';
import type { BodyRenderer } from './renderers/bodyRenderer';
import { AssetCache, buildScene, type BuildHooks, type BuiltScene } from './renderers/build';
import { SimClock, type ClockProcess, type PauseReason } from './render/clock';
import type { Motion } from './motion/motion';
import type { MouldPose } from './mould/mouldSteps';
import { RenderChain } from './render/pipeline';
import { noiseBakePending, whenNoiseIdle } from './volume/noiseVolume';
import { onVolumeNoiseReady } from './volume/VolumeBody';
import {
  FEED_GAP_MS,
  FrameGovernor,
  initialTier,
  isTierName,
  capIntervalMs,
  FrameCap,
  qualityFromSearch,
  TIERS,
  type TierName,
} from './render/quality';

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
/** R5.7: on phones the clock pauses after this long without interaction ([verify on phones]). */
export const IDLE_PAUSE_MS = 60_000;

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
    plan.volumes,
    plan.shape,
    // The shader kinds' spin is applied in place (a honesty toggle must not rebuild the field).
    plan.shader ? null : plan.spin,
    // What moves: rates and processes (R5.7). The star's layers, a brown dwarf's jets and a Mira's
    // pulsation change what is built; the cloud cover of a brown dwarf is applied in place.
    // `activeProcesses` follows the honesty state, which is applied in place (see `syncProcesses`).
    { ...plan.motion, activeProcesses: undefined },
    plan.star,
    plan.jets ? { ...plan.jets, cover: 0 } : null,
    plan.pulsation,
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

/** Mock-up build view drag: radians per CSS pixel, and the tilt limit about x. UI values. */
const TURN_PER_PX = 0.008;
const TURN_X_LIMIT = 1.2;

/** What counts as interaction for the R5.7 idle pause (a touch, a key, a wheel or trackpad). */
const IDLE_EVENTS = ['pointerdown', 'keydown', 'wheel'] as const;

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
  private unsubscribeNoise: (() => void) | null = null;
  private compileToken = 0;
  /** The plan last shown, so a quality-level change can rebuild it. */
  private lastPlan: RenderPlan | null = null;
  private compiling: Promise<void> | null = null;
  /**
   * What goes on with `built` when it swaps in: its lights, spin and framing. Held back while it
   * compiles so the old content keeps its own (no relit, reframed or frozen old body).
   */
  private pending: { lights: Object3D[]; plan: RenderPlan } | null = null;
  /** One sim time per moving process (R5.7); the spin is the only process today. */
  private readonly clock = new SimClock(() => performance.now());
  /** Radians per simulated second of the spin (the shown speed-up is the clock's, not in this). */
  private spinBase = 0;
  /** WCAG 2.2.2: the user can pause auto-spin. */
  private spinPaused = false;
  /** The user asked to play although the device asks for reduced motion. */
  private motionOverride = false;
  private chain: RenderChain | null = null;
  private chainFailed = false;
  private tier: TierName;
  private readonly governor: FrameGovernor;
  private onQualityChange: ((e: QualityChange) => void) | null = null;
  private frames = 0;
  private drops = 0;
  private readonly frameTimes: number[] = [];
  private burstLeft = 0;
  /** A TAAU restart waits for its first loop frame, which is drawn and discarded (see restartSettle). */
  private primePending = false;
  private loopLast: number | null = null;
  /** R5.7 phone frame-rate cap; no cap on desktop or the medium and high levels. */
  private readonly cap = new FrameCap();
  /** Coarse pointer (phone or tablet): 30 fps start tier and the R5.7 idle pause. */
  private readonly coarsePointer: boolean;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private idle = false;
  private onIdleChange: ((idle: boolean) => void) | null = null;
  private settleWaiters: (() => void)[] = [];
  private intersection: IntersectionObserver | null = null;
  private motionQuery: MediaQueryList | null = null;
  /** Called when a mesh or texture fails to load; the panel adds the layer to `failed` and re-plans. */
  private onLoadFailed: ((layerId: string) => void) | null = null;
  private onMeshMeasured: ((m: { radiusM: number }) => void) | null = null;
  /** Tests only: field and point sources and slider overrides for the shader kinds. */
  private shaderOptions: BuildHooks['shader'];
  /** Issue #60: the build animation's pose of what is on screen (null = the normal render). */
  private mould: Readonly<MouldPose> | null = null;
  /** Issue #60: the body's own turn (mock-up drag and auto-rotation), radians about x and y. */
  private turn = { x: 0, y: 0 };
  private dragTurns = false;
  private turnDrag: { x: number; y: number; rx: number; ry: number; id: number } | null = null;

  setQualityChangeHandler(handler: ((e: QualityChange) => void) | null): void {
    this.onQualityChange = handler;
  }

  setLoadFailedHandler(handler: ((layerId: string) => void) | null): void {
    this.onLoadFailed = handler;
  }

  /** Called when a shape model loads, with half of its longest box extent in metres (the real size). */
  setMeshMeasuredHandler(handler: ((m: { radiusM: number }) => void) | null): void {
    this.onMeshMeasured = handler;
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

    // R7.1: shape models self-shadow through the Sun light's shadow map (only lights that ask).
    if (renderer.shadowMap) renderer.shadowMap.enabled = true;
    renderer.setPixelRatio(viewerPixelRatio(window.devicePixelRatio || 1));
    renderer.setClearColor(new Color(SPACE_BACKGROUND), 1);
    this.coarsePointer =
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    this.tier =
      qualityFromSearch(window.location?.search ?? '') ??
      initialTier({ backend: this.backend, coarsePointer: this.coarsePointer });
    this.governor = new FrameGovernor(this.tier);
    this.cap.setInterval(capIntervalMs(this.tier, this.coarsePointer));

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
    // R5.7: on phones the clock pauses after a minute without interaction and resumes on touch.
    if (this.coarsePointer) {
      for (const type of IDLE_EVENTS)
        canvas.addEventListener(type, this.onInteraction, { passive: true });
      this.armIdle();
    }
    // WebGPU reports pipeline and validation errors asynchronously (uncapturederror), so they
    // never reach draw()'s try/catch. r187 WebGPUBackend calls renderer.onError; drop the chain
    // there too and keep drawing plainly (never blank). The types say a string; r187 passes info.
    if (this.backend === 'webgpu') {
      const r = renderer as unknown as { onError?: (info: unknown) => void };
      const original = r.onError;
      r.onError = (info: unknown) => {
        original?.call(renderer, info);
        if (this.disposed || !this.chain) return;
        this.dropChain(info);
        this.renderNow();
      };
    }

    // A volume's noise cube arrives a little after the build (sliced bake): draw it, from a fresh
    // temporal history so the settled frame does not depend on the empty frames before it.
    this.unsubscribeNoise = onVolumeNoiseReady(() => {
      if (!this.disposed && this.onScreen) this.restartSettle();
    });

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

  /**
   * D-27 slider values for the generated body: kept for the next build and applied to the body on
   * screen now (the remnant age slider moves the shell without a rebuild).
   */
  setOverrides(overrides: Overrides): void {
    this.shaderOptions = { ...this.shaderOptions, overrides };
    void this.built?.body?.setOverrides(overrides);
  }

  /** The generated body of a shader kind (haptics read its field and points), else null. */
  get body(): BodyRenderer | null {
    return this.built?.body ?? null;
  }

  /** Draws a plan made with `planRender` (the panel plans once and reuses the plan for its UI). */
  showPlan(plan: RenderPlan): void {
    if (this.disposed) return;
    this.lastPlan = plan;
    // The new lights go on with the content they belong to: an old object still on screen while
    // the new one compiles is not lit from the new object's phase angle.
    const lights = buildLights(
      plan.lighting,
      plan.shape?.shadows ? shadowSettings(this.tier) : null,
    );
    const key = sceneKey(plan);
    if (this.built && key === this.builtKey) {
      // Nothing that is built changed: only the lights, the honesty state or the labels did. A
      // generated body takes the new tags and light in place (no field is regenerated).
      this.built.update(plan);
      if (this.built === this.onScreen) {
        this.syncProcesses(plan.spin, this.built, plan.motion);
        // Pose again from the clock: a brown dwarf's cloud cover follows the light-curve scrub, which
        // must show while the clock is paused too (reduced motion, user or idle pause).
        this.applySpinAngle();
      }
      if (this.built !== this.onScreen && this.pending) {
        // Still compiling: the new lights wait for the content they belong to.
        this.pending = { lights, plan };
        return;
      }
      this.setLights(lights);
      this.restartSettle();
      return;
    }
    // A build that never reached the screen (still compiling) is dropped for the newer one.
    this.compileToken++;
    if (this.built && this.built !== this.onScreen) this.built.dispose();
    this.built = null;
    this.builtKey = '';
    this.pending = null;
    let next: BuiltScene | null = null;
    // A mesh that finishes loading in a scene that is no longer the current plan must not report its
    // size: the panel would attach it to the new object (Bennu's size on a cached Eros).
    const buildToken = this.compileToken;
    if (plan.threeD && (plan.bodies.length > 0 || plan.shader !== null)) {
      try {
        next = buildScene(
          plan,
          {
            onLoadFailed: (id) => this.onLoadFailed?.(id),
            onChange: this.requestRender,
            tier: this.tier,
            onMeshMeasured: (m) => {
              if (buildToken === this.compileToken) this.onMeshMeasured?.(m);
            },
            shader: this.shaderOptions,
            octaves: TIERS[this.tier].octaves,
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
    this.pending = { lights, plan };
    this.swapInAfterCompile(next);
  }

  /**
   * Compiles the new content's shaders, then swaps it in with its lights, spin and framing
   * (`pending`). Until then the old content (or the placeholder) stays on screen with its own
   * lights, spin and camera, so no frame is blank or wrong. A renderer without `compileAsync`
   * (test stubs) swaps at once.
   */
  private swapInAfterCompile(next: BuiltScene): void {
    const token = this.compileToken;
    const swap = () => {
      if (this.disposed || token !== this.compileToken || this.built !== next) return;
      const pending = this.pending;
      this.pending = null;
      this.removeOnScreen();
      this.scene.add(next.group);
      this.onScreen = next;
      this.placeholder.visible = false;
      next.setMould(this.mould);
      this.applyTurn();
      if (pending) {
        this.setLights(pending.lights);
        const { plan } = pending;
        this.frame(plan.id, plan.extent, plan.shader?.distance ?? 0);
        this.syncProcesses(plan.spin, next, plan.motion);
      }
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

  /**
   * `compileAsync` with a timeout and no throw. Through the chain it compiles for the pass's HDR
   * target and MRT, which is where the object is drawn; plainly, for the canvas.
   */
  private compile(object: Object3D): Promise<void> {
    // The timeout starts when this compile starts: through the chain, compiles queue behind each
    // other, and a slow earlier one must not time this one out.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let startTimer!: () => void;
    const timeout = new Promise<void>((resolve) => {
      startTimer = () => {
        timer ??= setTimeout(resolve, COMPILE_TIMEOUT_MS);
      };
    });
    const chain = this.chain;
    if (!chain) startTimer();
    const done = Promise.resolve()
      .then(() =>
        chain
          ? chain.compileAsync(object, startTimer)
          : this.renderer.compileAsync(object, this.camera, this.scene),
      )
      .catch((err: unknown) => console.warn('[viewer] compileAsync failed', err));
    return Promise.race([done, timeout]).finally(() => clearTimeout(timer));
  }

  private removeOnScreen(): void {
    if (!this.onScreen) return;
    this.scene.remove(this.onScreen.group);
    this.onScreen.dispose();
    this.onScreen = null;
  }

  /**
   * Registers the processes that move on the clock: the spin (shown with its own note) and the
   * animated processes of the plan's motion (R5.7, D-34), each with the speed-up the card states
   * and the tier of the rates it runs on. Processes of the last body that are no longer there are
   * removed.
   */
  private syncProcesses(spin: SpinPlan | null, built: BuiltScene | null, motion?: Motion): void {
    const keep = new Set<string>();
    if (built && spin && built.spinRate > 0) {
      this.spinBase = built.spinRate / spin.speedup;
      const rate = motion?.processes.find((p) => p.id === 'spin');
      this.clock.setProcess({
        id: 'spin',
        label: 'Spin',
        speedup: spin.speedup,
        ...(rate ? { tag: rate.tag, tier: rate.tier } : {}),
      });
      keep.add('spin');
    } else {
      this.spinBase = 0;
    }
    if (built && motion) {
      // Only processes that drive a drawn layer (D-21, D-34): a hidden layer has no note and does
      // not keep the frame loop running.
      for (const p of motion.processes) {
        if (p.id === 'spin') continue; // the spin is the plan's (its speed-up may be lowered)
        if (!motion.activeProcesses.includes(p.id)) continue;
        this.clock.setProcess({
          id: p.id,
          label: p.label,
          speedup: p.speedup,
          tag: p.tag,
          tier: p.tier,
        });
        keep.add(p.id);
      }
    }
    for (const p of this.clock.processes()) if (!keep.has(p.id)) this.clock.removeProcess(p.id);
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

  /**
   * Under reduced motion the scene starts paused (R9); the "Play motion" button is the user's
   * choice to start it anyway (WCAG 2.2.2). Ends when the preference is switched off.
   */
  setMotionOverride(on: boolean): void {
    if (this.disposed || on === this.motionOverride) return;
    this.motionOverride = on;
    this.setPause('reduced-motion', prefersReducedMotion() && !on);
  }

  /** Pause or resume all motion (WCAG 2.2.2). Survives rebuilds. */
  setSpinPaused(paused: boolean): void {
    if (this.disposed || paused === this.spinPaused) return;
    this.spinPaused = paused;
    this.setPause('user', paused);
  }

  isSpinPaused(): boolean {
    return this.spinPaused;
  }

  /** The processes that are time-lapses (each is shown with its speed-up). */
  timeLapses(): ClockProcess[] {
    return this.clock.processes();
  }

  private setPause(reason: PauseReason, paused: boolean): void {
    this.clock.setPaused(reason, paused);
    this.updateLoop();
  }

  /** Spins what is on screen (a newer build still compiling is posed when it swaps in). */
  private applySpinAngle(): void {
    if (!this.onScreen) return;
    const angle = this.spinBase * this.clock.simTime('spin');
    for (const o of this.onScreen.spinners) o.rotation.y = angle;
    // Everything else that moves is posed from the same clock (D-34: one clock, a pure function of t).
    this.onScreen.setTime(this.simTimeOf);
  }

  private readonly simTimeOf = (id: string): number => this.clock.simTime(id);

  private clearBuilt(): void {
    this.compileToken++;
    this.pending = null;
    this.removeOnScreen();
    if (this.built) this.built.dispose();
    this.built = null;
    this.builtKey = '';
  }

  private setLights(next: Object3D[]): void {
    for (const l of this.lights) {
      this.scene.remove(l);
      // A shadow-casting light owns a shadow map (about 16 MB at 2048): free it, or every
      // honesty, epoch or mode toggle leaves one behind.
      if (l instanceof DirectionalLight) l.shadow.dispose();
    }
    this.lights = next;
    for (const l of next) this.scene.add(l);
  }

  /**
   * New content: restart temporal AA history so the settled frame depends only on what is shown
   * now (same card, seed and time give the same frame), then draw and settle. Orbit changes keep
   * the history (`requestRender`), since that is what temporal AA is for while moving.
   */
  private restartSettle(): void {
    const chain = this.chain;
    chain?.restartTemporal();
    if (chain?.config.aa === 'taau') {
      // r187 keeps one snapshot of the camera per display frame (VelocityNode, and TAAUNode's own
      // matrices): the first draw of a display frame stores it, a second draw in the same frame
      // reuses it. Drawing here, between loop frames, may land in a display frame the loop already
      // drew in, so the next frame reprojects the history from a stale camera. Where that happens
      // depends on timing, and it shifted the settled frame by up to 53 levels. So nothing is drawn
      // here: the loop draws one frame per display frame, the first of them (which still sees the
      // old camera or content) is discarded and history restarts after it, and the 32 that follow
      // are one clean jitter cycle. The canvas keeps the last frame meanwhile (no blank frame).
      this.primePending = true;
      this.burstLeft = Math.max(this.burstLeft, this.settleFrames() + 1);
      this.schedule();
      return;
    }
    this.renderNow();
  }

  /**
   * Tier change and resize: the pipeline's targets or size changed, so on TAAU the history is
   * restarted and the first loop frame is discarded, exactly as in `restartSettle`, so the settled
   * frame is a function of content and not of which display frame this ran in. The one draw here is
   * kept only so a resize (which clears the canvas) leaves no blank frame; it is discarded the same
   * way as the first loop frame. SMAA draws and settles as before.
   */
  private renderNowPrimed(): void {
    const chain = this.chain;
    if (chain?.config.aa !== 'taau') {
      this.renderNow();
      return;
    }
    chain.restartTemporal();
    this.draw();
    this.primePending = true;
    this.burstLeft = Math.max(this.burstLeft, this.settleFrames() + 1);
    this.schedule();
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
    this.updateScreenSize();
    // A body with an off-screen pass of its own (the gas world's tracer) runs it before the frame.
    try {
      this.onScreen?.prepareFrame(this.renderer);
    } catch (err) {
      console.warn('[viewer] a body could not prepare its frame', err);
    }
    if (this.chain) {
      try {
        // Volumes shift their per-pixel ray jitter by the TAAU frame index (same index after a
        // restart, so a settled frame is deterministic).
        const jitter = this.chain.jitterIndex();
        if (jitter !== null) this.onScreen?.setJitterFrame(jitter);
        this.chain.render();
        return;
      } catch (err) {
        this.dropChain(err);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** The 160 px level-of-detail rule: tell the shape model how big it is on screen now. */
  private updateScreenSize(): void {
    const scene = this.onScreen;
    if (!scene || scene.shapeRadius === null) return;
    scene.setScreenPx(
      bodyScreenPx(
        scene.shapeRadius,
        this.camera.position.distanceTo(this.controls.target),
        CAMERA_FOV_DEG,
        this.canvas.clientHeight,
      ),
    );
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
    this.primePending = false;
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
    this.cap.setInterval(capIntervalMs(name, this.coarsePointer));
    this.built?.setTier(name);
    if (this.chain) {
      try {
        this.chain.setTier(name);
      } catch (err) {
        this.dropChain(err);
      }
    }
    if (auto) this.drops++;
    this.onQualityChange?.({ from, to: name, auto });
    // A body built from noise has its octave count baked in: rebuild it at the new level.
    if (this.built?.usesQuality && this.lastPlan) {
      this.builtKey = '';
      this.showPlan(this.lastPlan);
      return;
    }
    this.renderNowPrimed();
  }

  /** Quality level, backend and frame-time percentiles of the continuous frames (tests, tuning). */
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
    // A volume's noise cube is baked in slices after the build: wait for it and for the redraw it
    // asks for, so a settled frame always has its noise.
    if (noiseBakePending()) {
      await whenNoiseIdle();
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    while (this.compiling) await this.compiling;
    if (this.disposed || this.burstLeft <= 0) return;
    await new Promise<void>((resolve) => this.settleWaiters.push(resolve));
  }

  /**
   * Issue #60: resolves when the plan on screen is fully loaded: its textures and meshes (a failed
   * one counts as done, it is refused through the usual path), the generated surface of a shader
   * kind, and the shader compile. The build animation starts only after this (never on a half-loaded
   * body). Gives up after `timeoutMs` so a stuck load never blocks the view.
   */
  async whenLoaded(timeoutMs = 15_000): Promise<void> {
    if (this.disposed) return;
    const deadline = performance.now() + timeoutMs;
    const plan = this.lastPlan;
    const loads: Promise<unknown>[] = [];
    for (const b of plan?.bodies ?? []) {
      for (const url of [b.albedoUrl, b.normalUrl, b.heightUrl])
        if (url) loads.push(this.assets.texture(url).catch(() => undefined));
      if (b.meshUrl) loads.push(this.assets.mesh(lodUrls(b.meshUrl).lod0).catch(() => undefined));
    }
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    await Promise.race([Promise.all(loads), sleep(timeoutMs)]);
    while (!this.disposed && this.compiling && performance.now() < deadline) await this.compiling;
    // A generated surface comes from the field worker a little after the build.
    for (;;) {
      const body = this.built?.body;
      const waiting = body && body.status.state === 'drawn' && body.drawn.length === 0;
      if (!waiting || this.disposed || performance.now() > deadline) break;
      await sleep(30);
    }
    if (!this.disposed) await this.whenSettled();
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
    // R5.7 phone frame-rate cap (30 fps on the low quality level): skip this display frame.
    if (!this.cap.shouldDraw(now)) {
      this.schedule();
      return;
    }
    if (this.clock.running) {
      this.clock.tick();
      this.applySpinAngle();
    }
    this.draw();
    // Frame time is only meaningful between consecutive frames of one continuous run. A longer
    // gap (a hidden tab, a stalled main thread) is not a frame time and would skew p95.
    if (this.loopLast !== null && now - this.loopLast <= FEED_GAP_MS) {
      const ms = now - this.loopLast;
      this.frameTimes.push(ms);
      if (this.frameTimes.length > STATS_WINDOW) this.frameTimes.shift();
      const drop = this.governor.feed(ms, now);
      if (drop) this.applyTier(drop.to, true);
    }
    this.loopLast = now;
    if (this.primePending) {
      this.primePending = false;
      this.chain?.restartTemporal();
    }
    if (this.burstLeft > 0) this.burstLeft--;
    if (this.burstLeft === 0) this.flushSettled();
    if (this.clock.running || this.burstLeft > 0) {
      this.schedule();
    } else {
      this.loopLast = null;
      this.cap.reset();
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

  /** R5.6 `R` key: back to the starting view (and the body's own turn back to none). */
  resetView(): void {
    if (this.disposed) return;
    this.controls.reset();
    this.setTurn(0, 0);
  }

  /**
   * Issue #60 build animation: poses the scene on screen (scale, scaffold, morph, growth, shader
   * knobs; mould/mouldSteps.ts). Null restores the normal render of the plan exactly. A scene that
   * swaps in later gets the same pose.
   */
  setMould(pose: Readonly<MouldPose> | null): void {
    if (this.disposed) return;
    if (pose === null && this.mould === null) return;
    this.mould = pose;
    this.onScreen?.setMould(pose);
    this.requestRender();
  }

  /**
   * Issue #60 (mock-up build view): turns the body itself about x and y, under a fixed light. The
   * camera does not move. (0, 0) is the normal pose.
   */
  setTurn(x: number, y: number): void {
    if (this.disposed) return;
    if (x === this.turn.x && y === this.turn.y) return;
    this.turn = { x, y };
    this.applyTurn();
    this.requestRender();
  }

  getTurn(): { x: number; y: number } {
    return { ...this.turn };
  }

  /** True while the user drags the body (the build view's auto-rotation waits meanwhile). */
  isDraggingBody(): boolean {
    return this.turnDrag !== null;
  }

  /**
   * Issue #60: in the build view a drag turns the body (mock-up: .008 rad per pixel, x within
   * ±1.2 rad) instead of orbiting the camera. Wheel and pinch zoom, keys and buttons are unchanged.
   */
  setDragTurnsBody(on: boolean): void {
    if (this.disposed || on === this.dragTurns) return;
    this.dragTurns = on;
    this.controls.enableRotate = !on;
    if (on) {
      this.canvas.addEventListener('pointerdown', this.onTurnDown);
      this.canvas.addEventListener('pointermove', this.onTurnMove);
      this.canvas.addEventListener('pointerup', this.onTurnUp);
      this.canvas.addEventListener('pointercancel', this.onTurnUp);
    } else {
      this.removeTurnListeners();
    }
  }

  private removeTurnListeners(): void {
    this.canvas.removeEventListener('pointerdown', this.onTurnDown);
    this.canvas.removeEventListener('pointermove', this.onTurnMove);
    this.canvas.removeEventListener('pointerup', this.onTurnUp);
    this.canvas.removeEventListener('pointercancel', this.onTurnUp);
    this.turnDrag = null;
  }

  private readonly onTurnDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !e.isPrimary) return;
    this.turnDrag = {
      x: e.clientX,
      y: e.clientY,
      rx: this.turn.x,
      ry: this.turn.y,
      id: e.pointerId,
    };
  };

  private readonly onTurnMove = (e: PointerEvent): void => {
    const d = this.turnDrag;
    if (!d || e.pointerId !== d.id) return;
    this.setTurn(
      Math.max(-TURN_X_LIMIT, Math.min(TURN_X_LIMIT, d.rx + (e.clientY - d.y) * TURN_PER_PX)),
      d.ry + (e.clientX - d.x) * TURN_PER_PX,
    );
  };

  private readonly onTurnUp = (e: PointerEvent): void => {
    if (this.turnDrag && e.pointerId === this.turnDrag.id) this.turnDrag = null;
  };

  private applyTurn(): void {
    const g = this.onScreen?.group;
    if (g) g.rotation.set(this.turn.x, this.turn.y, 0);
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
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    for (const type of IDLE_EVENTS) this.canvas.removeEventListener(type, this.onInteraction);
    this.flushSettled();
    this.intersection?.disconnect();
    this.intersection = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.unsubscribeNoise?.();
    this.unsubscribeNoise = null;
    this.clearBuilt();
    this.chain?.dispose();
    this.chain = null;
    this.primePending = false;
    this.assets.dispose();
    this.motionQuery?.removeEventListener?.('change', this.onMotionChange);
    this.motionQuery = null;
    this.resizeObserver?.disconnect();
    this.dprQuery?.removeEventListener('change', this.onPixelRatioChange);
    this.dprQuery = null;
    this.canvas.removeEventListener('keydown', this.onKeyDown);
    this.removeTurnListeners();
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
    // now instead (still only on change, R5.5); on TAAU the frame is primed (renderNowPrimed).
    this.renderNowPrimed();
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
    if (!reduced) this.motionOverride = false;
    this.setPause('reduced-motion', reduced && !this.motionOverride);
    this.renderNow();
  };

  /** R5.7 phone idle pause: (re)starts the 60 s countdown. */
  private armIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.disposed) this.setIdle(true);
    }, IDLE_PAUSE_MS);
  }

  private setIdle(idle: boolean): void {
    if (idle === this.idle) return;
    this.idle = idle;
    this.setPause('idle', idle);
    this.onIdleChange?.(idle);
  }

  /** True while the R5.7 phone idle pause holds the clock (the panel says so). */
  isIdlePaused(): boolean {
    return this.idle;
  }

  /** The panel's resume control lifts the idle pause too (D-34: resume on touch). */
  resumeFromIdle(): void {
    if (this.disposed || !this.coarsePointer) return;
    this.setIdle(false);
    this.armIdle();
  }

  setIdleChangeHandler(handler: ((idle: boolean) => void) | null): void {
    this.onIdleChange = handler;
  }

  private readonly onInteraction = (): void => this.resumeFromIdle();

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

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
import type { PlanContext, RenderPlan } from './planTypes';
import { planRender } from './renderPlan';
import type { BodyRenderer } from './renderers/bodyRenderer';
import { AssetCache, buildScene, type BuildHooks, type BuiltScene } from './renderers/build';

/** Which backend `WebGPURenderer` ended up on after `init()`. */
export type RendererBackend = 'webgpu' | 'webgl2';

/** R5.5 / D-05: `min(devicePixelRatio, 1.5)`. */
export const MAX_PIXEL_RATIO = 1.5;

export function viewerPixelRatio(devicePixelRatio: number): number {
  return Math.min(devicePixelRatio, MAX_PIXEL_RATIO);
}

/** R9: `prefers-reduced-motion` disables auto-spin. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

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
  private spinFrame: number | null = null;
  private lastSpinTime = 0;
  /** Accumulated spin of the spinning bodies, kept across rebuilds so the body does not jump back. */
  private spinAngle = 0;
  /** WCAG 2.2.2: the user can pause auto-spin. */
  private spinPaused = false;
  private motionQuery: MediaQueryList | null = null;
  /** Called when a mesh or texture fails to load; the panel adds the layer to `failed` and re-plans. */
  private onLoadFailed: ((layerId: string) => void) | null = null;
  /** Tests only: field and point sources and slider overrides for the shader kinds. */
  private shaderOptions: BuildHooks['shader'];

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
    return new ViewerApp(canvas, renderer);
  }

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    renderer: WebGPURenderer,
  ) {
    this.renderer = renderer;
    // r187: after init(), `backend` is a WebGPUBackend or, after fallback, a WebGLBackend.
    this.backend = 'isWebGPUBackend' in renderer.backend ? 'webgpu' : 'webgl2';

    renderer.setPixelRatio(viewerPixelRatio(window.devicePixelRatio || 1));
    renderer.setClearColor(new Color(0x05060a), 1);

    this.scene = new Scene();
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
    this.placeholder.visible = false;
    this.setLights(buildLights(plan.lighting));
    const key = sceneKey(plan);
    if (this.built && key === this.builtKey) {
      // Nothing that is built changed: only the lights, the honesty state or the labels did. A
      // generated body takes the new tags and light in place (no field is regenerated).
      this.built.update(plan);
      this.renderNow();
      return;
    }
    this.clearBuilt();
    if (plan.threeD && (plan.bodies.length > 0 || plan.shader !== null)) {
      try {
        this.built = buildScene(
          plan,
          {
            onLoadFailed: (id) => this.onLoadFailed?.(id),
            onChange: this.requestRender,
            shader: this.shaderOptions,
          },
          this.assets,
        );
        this.builtKey = key;
        this.applySpinAngle();
        this.scene.add(this.built.group);
        this.frame(plan.id, plan.extent, plan.shader?.distance ?? 0);
      } catch (err) {
        // Never blank, never crash: the plan stays on screen as text and the canvas stays empty.
        console.warn('[viewer] could not build the scene', err);
        this.built = null;
      }
    }
    this.updateSpinLoop();
    this.renderNow();
  }

  /** Back to the placeholder sphere. */
  clearObject(): void {
    if (this.disposed) return;
    this.clearBuilt();
    this.placeholder.visible = true;
    this.setLights(this.placeholderLights);
    this.frame('', 1, 0);
    this.updateSpinLoop();
    this.renderNow();
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
    this.updateSpinLoop();
  }

  isSpinPaused(): boolean {
    return this.spinPaused;
  }

  private applySpinAngle(): void {
    if (!this.built) return;
    for (const o of this.built.spinners) o.rotation.y = this.spinAngle;
  }

  private clearBuilt(): void {
    if (!this.built) return;
    this.scene.remove(this.built.group);
    this.built.dispose();
    this.built = null;
    this.builtKey = '';
  }

  private setLights(next: Object3D[]): void {
    for (const l of this.lights) this.scene.remove(l);
    this.lights = next;
    for (const l of next) this.scene.add(l);
  }

  private renderNow(): void {
    if (this.frameRequest !== null) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = null;
    this.renderer.render(this.scene, this.camera);
  }

  /** Spin is the only animation. It runs only if the plan spins and reduced motion is not set. */
  private updateSpinLoop(): void {
    const wanted =
      this.built !== null && this.built.spinRate > 0 && !this.spinPaused && !prefersReducedMotion();
    if (!wanted) {
      if (this.spinFrame !== null) cancelAnimationFrame(this.spinFrame);
      this.spinFrame = null;
      return;
    }
    if (this.spinFrame !== null) return;
    this.lastSpinTime = performance.now();
    const tick = (now: number) => {
      this.spinFrame = null;
      if (this.disposed || !this.built || this.built.spinRate <= 0) return;
      const dt = Math.min((now - this.lastSpinTime) / 1000, 0.1);
      this.lastSpinTime = now;
      this.spinAngle += this.built.spinRate * dt;
      this.applySpinAngle();
      this.renderer.render(this.scene, this.camera);
      this.spinFrame = requestAnimationFrame(tick);
    };
    this.spinFrame = requestAnimationFrame(tick);
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
    if (this.disposed || this.frameRequest !== null) return;
    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = null;
      if (!this.disposed) this.renderer.render(this.scene, this.camera);
    });
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frameRequest !== null) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = null;
    if (this.spinFrame !== null) cancelAnimationFrame(this.spinFrame);
    this.spinFrame = null;
    this.clearBuilt();
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
    if (this.frameRequest !== null) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = null;
    this.renderer.render(this.scene, this.camera);
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
    if (!this.disposed) this.updateSpinLoop();
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

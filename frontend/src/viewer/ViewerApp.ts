// R4 (level 3) / R5 Sky Sculptor viewer shell. Smoke scene only: one plain placeholder sphere.
// Implements: three r187 WebGPURenderer with WebGL2 fallback (R2, D-03), R5.1 ambient limit,
// R5.5 pixel ratio and render-on-change, R5.6 default-mode orbit + keyboard + on-screen rotate.
// Not implemented yet: RenderParams loading, renderers by type, Touch mode, honesty, modes.
//
// Plain module (no React) so it works with or without React (A10).
import {
  AmbientLight,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardNodeMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  WebGPURenderer,
} from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ObjectCard, RenderParams } from '@/contract';
import { MAX_AMBIENT_INTENSITY } from './lighting';
import type { BodyContext, BodyRenderer } from './renderers/bodyRenderer';
import { createBodyRenderer } from './renderers/registry';

/** Which backend `WebGPURenderer` ended up on after `init()`. */
export type RendererBackend = 'webgpu' | 'webgl2';

/** R5.5 / D-05: `min(devicePixelRatio, 1.5)`. */
export const MAX_PIXEL_RATIO = 1.5;

export function viewerPixelRatio(devicePixelRatio: number): number {
  return Math.min(devicePixelRatio, MAX_PIXEL_RATIO);
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
  private readonly sun: DirectionalLight;
  private body: BodyRenderer | null = null;
  private bodyToken = 0;
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

    // R5.1: one DirectionalLight plus ambient ≤ 0.03. The direction is a placeholder ('artistic');
    // real scenes place it at phase_angle_deg from RenderParams.lighting.
    this.sun = new DirectionalLight(0xffffff, 2);
    this.sun.position.set(3, 1.5, 2);
    this.scene.add(this.sun);
    this.scene.add(new AmbientLight(0xffffff, MAX_AMBIENT_INTENSITY));

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

    this.resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.resize());
    this.resizeObserver?.observe(canvas);
    this.watchPixelRatio();

    this.resize();
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

  /**
   * Shows the object described by `card` + `params` with the renderer registered for its type
   * (renderers/registry.ts). Types without a renderer keep the placeholder sphere and resolve to
   * null. A newer call supersedes an older one that is still loading.
   */
  async setBody(
    card: ObjectCard,
    params: RenderParams,
    ctx: BodyContext = {},
  ): Promise<BodyRenderer | null> {
    const token = ++this.bodyToken;
    const pending = createBodyRenderer(card, params, ctx);
    if (!pending) return null;
    const next = await pending;
    if (this.disposed || token !== this.bodyToken) {
      next.dispose();
      return null;
    }
    this.clearBody();
    this.body = next;
    this.placeholder.visible = false;
    this.scene.add(next.object);
    // R5.1: the light direction comes from RenderParams.lighting.sun_dir when given.
    const sd = params.lighting.sun_dir;
    if (sd) this.sun.position.set(sd[0], sd[1], sd[2]).multiplyScalar(5);
    this.camera.position.set(0, 0, next.suggestedDistance);
    this.controls.maxDistance = Math.max(20, next.suggestedDistance * 3);
    this.controls.saveState();
    this.controls.reset();
    this.requestRender();
    return next;
  }

  private clearBody(): void {
    if (!this.body) return;
    this.scene.remove(this.body.object);
    this.body.dispose();
    this.body = null;
    this.placeholder.visible = true;
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
    this.resizeObserver?.disconnect();
    this.dprQuery?.removeEventListener('change', this.onPixelRatioChange);
    this.dprQuery = null;
    this.canvas.removeEventListener('keydown', this.onKeyDown);
    this.controls.removeEventListener('change', this.requestRender);
    this.clearBody();
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

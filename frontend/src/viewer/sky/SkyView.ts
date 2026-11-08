// Sky view renderer: an inside-out sphere textured with an equirectangular all-sky image, seen
// from its centre, with three r187 `WebGPURenderer` (WebGPU, WebGL2 fallback; D-03).
//
// - Orientation and pointer maths are in skyMath.ts (pure, tested). The sphere's UVs are set so
//   that every vertex samples the image at its own RA/Dec (skyGeometry), and the camera uses the
//   same yaw/pitch as skyMath, so the picture, the readout and the markers agree.
// - Render on demand (R5.5): a frame is drawn only when the view, the size or the texture changes.
//   Pixel ratio min(devicePixelRatio, 1.5) (D-05). Mipmapped texture with anisotropic filtering.
// - No per-frame allocations: the render callback reuses one camera object for listeners.
// - The texture is decoded off the main thread with ImageBitmapLoader (flipped at decode, so the
//   texture's flipY stays false on both backends).
//
// Plain module (no React), like ViewerApp.
import {
  BackSide,
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  Float32BufferAttribute,
  ImageBitmapLoader,
  LinearMipmapLinearFilter,
  LineBasicNodeMaterial,
  LineSegments,
  Mesh,
  MeshBasicNodeMaterial,
  PerspectiveCamera,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  WebGPURenderer,
} from 'three/webgpu';
import type { RendererBackend } from '@/viewer/ViewerApp';
import { viewerPixelRatio } from '@/viewer/ViewerApp';
import { cameraEuler, clampDec, clampFov, raDecToWorld, wrapRa, type SkyCamera } from './skyMath';

/** Radius of the sky sphere (scene units); the camera sits at its centre. */
const SKY_RADIUS = 10;
/** Sphere tessellation. 128 × 64 is smooth at a 2° field of view and trivial to draw. */
const SKY_SEGMENTS_W = 128;
const SKY_SEGMENTS_H = 64;
/** Anisotropic filtering cap (most GPUs report 16). Display value. */
const MAX_ANISOTROPY = 8;
/** Colour of the empty sky before (or without) an image. Display value. */
const EMPTY_SKY = 0x020204;
/** Coordinate grid shown only when no image is drawn: spacing in degrees. */
const GRID_STEP_DEG = 30;

/**
 * Sphere geometry whose UVs map each vertex to its own RA/Dec in an equirect image
 * (u = RA/360 with RA 0 at the left edge, v = (Dec + 90)/180 with north at v = 1, texture flipY
 * convention). three's SphereGeometry puts the vertex of parameter u at RA = 360·u − 180 in the
 * skyMath world frame, so u is shifted by one half; the texture repeats in u, so the shift is
 * continuous and the sphere's own seam (RA 180°) samples the same texels from both sides.
 */
export function createSkyGeometry(
  radius = SKY_RADIUS,
  widthSegments = SKY_SEGMENTS_W,
  heightSegments = SKY_SEGMENTS_H,
): SphereGeometry {
  const g = new SphereGeometry(radius, widthSegments, heightSegments);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) - 0.5);
  uv.needsUpdate = true;
  return g;
}

/** RA/Dec grid lines (every 30°) as line segments on a sphere just inside the sky. */
function createGridGeometry(radius: number): BufferGeometry {
  const pts: number[] = [];
  const v = { x: 0, y: 0, z: 0 };
  const push = (ra: number, dec: number) => {
    raDecToWorld(ra, dec, v);
    pts.push(v.x * radius, v.y * radius, v.z * radius);
  };
  const step = 2;
  for (let ra = 0; ra < 360; ra += GRID_STEP_DEG) {
    for (let dec = -88; dec < 88; dec += step) {
      push(ra, dec);
      push(ra, dec + step);
    }
  }
  for (let dec = -60; dec <= 60; dec += GRID_STEP_DEG) {
    for (let ra = 0; ra < 360; ra += step) {
      push(ra, dec);
      push(ra + step, dec);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pts, 3));
  return g;
}

/** Max 2D texture size the device can hold, from whichever backend three ended up on. */
function maxTextureSizeOf(renderer: WebGPURenderer): number {
  const backend = renderer.backend as unknown as {
    device?: { limits?: { maxTextureDimension2D?: number } };
    gl?: WebGL2RenderingContext;
  };
  const gpu = backend.device?.limits?.maxTextureDimension2D;
  if (typeof gpu === 'number' && gpu > 0) return gpu;
  const gl = backend.gl;
  if (gl) {
    const n = gl.getParameter(gl.MAX_TEXTURE_SIZE) as unknown;
    if (typeof n === 'number' && n > 0) return n;
  }
  // ASSUMPTION: WebGPU and WebGL2 both guarantee at least 8192 / 2048; take the WebGL2 floor.
  return 2048;
}

export interface SkyRenderStats {
  renders: number;
  /** Sum of CPU time spent in renderer.render, ms. */
  renderMs: number;
}

export type SkyRenderListener = (cam: Readonly<SkyCamera>, width: number, height: number) => void;

export class SkyView {
  readonly backend: RendererBackend;
  readonly maxTextureSize: number;
  readonly stats: SkyRenderStats = { renders: 0, renderMs: 0 };

  private readonly renderer: WebGPURenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly geometry: SphereGeometry;
  private readonly material: MeshBasicNodeMaterial;
  private readonly sphere: Mesh;
  private readonly gridGeometry: BufferGeometry;
  private readonly gridMaterial: LineBasicNodeMaterial;
  private readonly grid: LineSegments;
  private texture: Texture | null = null;
  private readonly view: SkyCamera;
  private readonly listeners = new Set<SkyRenderListener>();
  private readonly resizeObserver: ResizeObserver | null;
  private frameRequest: number | null = null;
  private disposed = false;
  private width = 1;
  private height = 1;
  /** A drag or pinch is in progress: a decoded image waits until it ends before it is swapped in. */
  private interacting = false;
  private idleWaiters: (() => void)[] = [];

  /** Creates the renderer and awaits `init()` (WebGPU, else WebGL2). Rejects if neither works. */
  static async create(canvas: HTMLCanvasElement, view: SkyCamera): Promise<SkyView> {
    // No MSAA: one textured sphere has no geometric edges to smooth.
    const renderer = new WebGPURenderer({ canvas, antialias: false });
    try {
      await renderer.init();
    } catch (err) {
      await renderer.dispose().catch(() => undefined);
      throw err;
    }
    return new SkyView(canvas, renderer, view);
  }

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    renderer: WebGPURenderer,
    view: SkyCamera,
  ) {
    this.renderer = renderer;
    this.backend = 'isWebGPUBackend' in renderer.backend ? 'webgpu' : 'webgl2';
    this.maxTextureSize = maxTextureSizeOf(renderer);
    renderer.setPixelRatio(viewerPixelRatio(window.devicePixelRatio || 1));
    renderer.setClearColor(new Color(EMPTY_SKY), 1);

    this.view = { ra: wrapRa(view.ra), dec: clampDec(view.dec), fovDeg: clampFov(view.fovDeg) };
    this.camera = new PerspectiveCamera(this.view.fovDeg, 1, 0.1, SKY_RADIUS * 4);
    this.camera.rotation.order = 'YXZ';

    this.geometry = createSkyGeometry();
    this.material = new MeshBasicNodeMaterial({ color: EMPTY_SKY, side: BackSide });
    this.material.depthWrite = false;
    this.sphere = new Mesh(this.geometry, this.material);
    this.scene.add(this.sphere);

    this.gridGeometry = createGridGeometry(SKY_RADIUS * 0.98);
    this.gridMaterial = new LineBasicNodeMaterial({
      color: 0x3a4a5e,
      transparent: true,
      opacity: 0.8,
    });
    this.gridMaterial.depthTest = false;
    this.grid = new LineSegments(this.gridGeometry, this.gridMaterial);
    this.scene.add(this.grid);

    this.resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.resize());
    this.resizeObserver?.observe(canvas);
    this.resize();
  }

  /** The current view (a copy). */
  getView(): SkyCamera {
    return { ...this.view };
  }

  /** CSS size of the canvas. */
  getSize(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  setView(next: SkyCamera): void {
    const ra = wrapRa(next.ra);
    const dec = clampDec(next.dec);
    const fovDeg = clampFov(next.fovDeg);
    if (ra === this.view.ra && dec === this.view.dec && fovDeg === this.view.fovDeg) return;
    this.view.ra = ra;
    this.view.dec = dec;
    this.view.fovDeg = fovDeg;
    this.requestRender();
  }

  /** The pane reports drags and pinches, so a texture swap (a GPU upload) never lands mid-gesture. */
  setInteracting(on: boolean): void {
    this.interacting = on;
    if (!on) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const w of waiters) w();
    }
  }

  private whenNotInteracting(): Promise<void> {
    if (!this.interacting) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** Called after every rendered frame with the view and CSS size (markers follow it). */
  onRender(listener: SkyRenderListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Loads an equirect image and swaps it in on success; the current picture stays until then
   * (never blank). Rejects on failure, leaving the old picture.
   */
  async loadEquirect(
    url: string,
    signal?: AbortSignal,
  ): Promise<{ width: number; height: number }> {
    const loader = new ImageBitmapLoader();
    loader.setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none' });
    const onAbort = () => loader.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    let bitmap: ImageBitmap;
    try {
      bitmap = await loader.loadAsync(url);
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
    await this.whenNotInteracting();
    if (this.disposed || signal?.aborted) {
      bitmap.close();
      throw new DOMException('aborted', 'AbortError');
    }
    const tex = new Texture(bitmap);
    tex.flipY = false; // flipped at decode (imageOrientation: 'flipY')
    tex.colorSpace = SRGBColorSpace;
    tex.wrapS = RepeatWrapping; // see createSkyGeometry: u runs from −0.5 to 0.5
    tex.wrapT = ClampToEdgeWrapping;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = Math.max(1, Math.min(MAX_ANISOTROPY, this.renderer.getMaxAnisotropy()));
    tex.needsUpdate = true;

    const old = this.texture;
    this.texture = tex;
    this.material.map = tex;
    this.material.color.set(0xffffff);
    this.material.needsUpdate = true;
    this.grid.visible = false;
    this.renderNow();
    if (old) {
      const img = old.image as ImageBitmap | undefined;
      old.dispose();
      img?.close?.();
    }
    return { width: bitmap.width, height: bitmap.height };
  }

  /** Coalesces any number of changes into one render on the next animation frame. */
  readonly requestRender = (): void => {
    if (this.disposed || this.frameRequest !== null) return;
    this.frameRequest = requestAnimationFrame(this.renderFrame);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frameRequest !== null) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = null;
    this.listeners.clear();
    this.setInteracting(false);
    this.resizeObserver?.disconnect();
    if (this.texture) {
      const img = this.texture.image as ImageBitmap | undefined;
      this.texture.dispose();
      img?.close?.();
      this.texture = null;
    }
    this.geometry.dispose();
    this.material.dispose();
    this.gridGeometry.dispose();
    this.gridMaterial.dispose();
    this.scene.clear();
    void this.renderer.dispose().catch(() => undefined);
  }

  private readonly renderFrame = (): void => {
    this.frameRequest = null;
    this.renderNow();
  };

  private renderNow(): void {
    if (this.disposed) return;
    const { yaw, pitch } = cameraEuler(this.view);
    this.camera.rotation.set(pitch, yaw, 0);
    if (this.camera.fov !== this.view.fovDeg) {
      this.camera.fov = this.view.fovDeg;
      this.camera.updateProjectionMatrix();
    }
    const t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.stats.renderMs += performance.now() - t0;
    this.stats.renders += 1;
    for (const l of this.listeners) l(this.view, this.width, this.height);
  }

  private resize(): void {
    if (this.disposed) return;
    this.width = Math.max(1, this.canvas.clientWidth);
    this.height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setPixelRatio(viewerPixelRatio(window.devicePixelRatio || 1));
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    // A resize clears the drawing buffer; draw now so no blank frame shows (as in ViewerApp).
    if (this.frameRequest !== null) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = null;
    this.renderNow();
  }
}

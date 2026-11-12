// Issue #71, D-37 (stream V3): hosts the prototype rock engine (`source.ts`) on canvases. One body at a
// time; the same body can be drawn on several canvases (the build pane's globe stage and the
// close-up pane). Wraps what the prototype's page code did (`rebuild`, the pointer handlers and the
// `loop`) without its DOM: Pause, Surface age and drag to turn are driven through this class.
// Raw WebGL2 on its own canvas (D-37 overrides "three r187 TSL only" for generated bodies).
//
// Issue #93 wave 1 (PR #101 roadmap; wrapper only, the engine changes are @deviation blocks in source.ts):
// - 0.3: a canvas that is off-screen (IntersectionObserver) or in a hidden tab (visibilitychange) is not drawn, and
//   the clock and the spin stop while no canvas is shown.
// - 0.4: back-face culling, turned on here for each canvas (the engine never touches CULL_FACE). The body's triangles
//   are counter-clockwise from outside (checked with a capture: scripts/engine-bench/rocks.html `cull=0`).
// - 0.8: when two canvases of the same shape show the body, the larger one draws it and the other copies that picture
//   (Mirror) instead of running the rock shader again.
// - 1.8: the height map is built in a worker (rockBuild.worker.ts; same bytes as the main thread), newest request wins.
// - B7: the programs compile in the background; whenReady() says when, and a canvas is released (loseContext) only
//   once its compile has finished, as WorldEngine.dispose (a lost context waits for a compile still running).
import * as E from './source';
const R: any = E.R;
const RockGL: any = E.RockGL;
const clamp: any = E.clamp;
const setReducedMotion: any = E.setReducedMotion;
import type { RockFromCard } from './cardToRock';
import type { RadialMap } from './meshRadial';
import {
  buildField,
  type BuildMessage,
  type BuildReply,
  type BuildRequest,
  type BuildResult,
  type RockModel,
} from './rockBuild';

/** How often a released canvas checks whether its compile has finished (UI pacing, ms; as WorldEngine). */
export const ROCK_DISPOSE_POLL_MS = 100;
/**
 * Longest a released canvas waits for a compile still running (ms). After it the context is left to the browser
 * without `loseContext()` (which would block on that compile); it goes with the canvas.
 */
export const ROCK_DISPOSE_MAX_WAIT_MS = 180_000;
/** Two canvases whose width-to-height ratios differ by less than this share draw one picture (0.8). */
export const MIRROR_ASPECT_TOLERANCE = 0.01;

interface EngineGL {
  upload(b: unknown): void;
  draw(m: unknown): void;
  /** True once the programs are linked; throws the compile or link log. Missing on an engine without it. */
  poll?: () => boolean;
}

interface View {
  canvas: HTMLCanvasElement;
  gl: EngineGL;
  /** Zoom of this view against the prototype's own framing. */
  zoom: number;
  off: () => void;
  /** On screen (IntersectionObserver); true until the observer says otherwise. */
  shown: boolean;
  /** Its programs are linked. */
  ready: boolean;
  /** The compile or link failed (never drawn). */
  error: unknown;
  /** Copies another canvas's picture (0.8); made the first time it is needed. */
  mirror: Mirror | null;
  /** A picture has been put on this canvas (drawn or copied). */
  drawn: boolean;
  drawnWaiters: (() => void)[];
}

export interface RockStats {
  gravity: number;
  escape: number;
  /** Relief the generated field may hold, fraction of the radius. Describes the generated field only. */
  lump: number;
  /** Craters in the generated field. Describes the generated field only. */
  craters: number;
  limit: number;
  kind: string;
  fast: boolean;
  /**
   * A shape model replaced the generated lumps and craters (Bennu, 67P): `lump` and `craters` then
   * describe a field that is not drawn, so a readout must hide or relabel them.
   */
  shapeModel: boolean;
}

export interface RockViewOptions {
  /** Build the height map in a Web Worker (default true; false or no Worker: on the main thread, synchronously). */
  worker?: boolean;
}

let supportedCache: boolean | null = null;

/** Release a canvas's WebGL context now (the browser keeps only a few alive). */
function loseContext(canvas: HTMLCanvasElement): void {
  try {
    canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    /* already gone */
  }
}

/** The canvas's drawing-buffer size, as the engine's draw() sets it. */
function bufferSize(canvas: HTMLCanvasElement): [number, number] {
  const dp = Math.min(globalThis.devicePixelRatio || 1, 1.5);
  return [Math.round(canvas.clientWidth * dp), Math.round(canvas.clientHeight * dp)];
}

const MIRROR_VS =
  '#version 300 es\nout vec2 vUv;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}';
const MIRROR_FS =
  '#version 300 es\nprecision mediump float;uniform sampler2D uT;in vec2 vUv;out vec4 O;void main(){O=texture(uT,vec2(vUv.x,1.-vUv.y));}';

/**
 * 0.8: puts another canvas's picture on this canvas with one textured triangle, in this canvas's own context (the
 * engine's context, so the canvas can draw the body itself again when the other one goes). Its program is tiny and
 * compiles in the background like the engine's.
 */
export class Mirror {
  private readonly prog: WebGLProgram;
  private readonly tex: WebGLTexture;
  private readonly ext: { COMPLETION_STATUS_KHR: number } | null;
  private loc: WebGLUniformLocation | null = null;
  private ok = false;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('KHR_parallel_shader_compile') as {
      COMPLETION_STATUS_KHR: number;
    } | null;
    const p = gl.createProgram()!;
    for (const [type, src] of [
      [gl.VERTEX_SHADER, MIRROR_VS],
      [gl.FRAGMENT_SHADER, MIRROR_FS],
    ] as const) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    this.prog = p;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.tex = t;
  }

  /** True once the program is linked (never waits for the driver); false for good if it failed. */
  poll(): boolean {
    if (this.ok) return true;
    const gl = this.gl;
    if (this.ext && !gl.getProgramParameter(this.prog, this.ext.COMPLETION_STATUS_KHR))
      return false;
    if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS)) return false;
    this.loc = gl.getUniformLocation(this.prog, 'uT');
    this.ok = true;
    return true;
  }

  /** Draws `src` (a canvas drawn in this task) over all of `dst`. */
  copy(src: HTMLCanvasElement, dst: HTMLCanvasElement): void {
    const gl = this.gl;
    const [w, h] = bufferSize(dst);
    if (!w || !h) return;
    if (dst.width !== w || dst.height !== h) {
      dst.width = w;
      dst.height = h;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.prog);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.uniform1i(this.loc, 0);
    // The triangle is counter-clockwise, so it survives the back-face culling RockView turns on.
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

/** Turns on back-face culling in the canvas's context (0.4). A test stub without `enable` is left alone. */
function cullBackFaces(canvas: HTMLCanvasElement): void {
  const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
  if (!gl || typeof gl.enable !== 'function') return;
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.frontFace(gl.CCW);
}

/** The view's programs are linked (an engine without poll() links on its first draw). Throws the compile log. */
function pollView(v: View): boolean {
  if (v.ready) return true;
  if (v.error) throw v.error;
  try {
    v.ready = v.gl.poll ? v.gl.poll() : true;
  } catch (err) {
    v.error = err;
    throw err;
  }
  return v.ready;
}

/**
 * Releases a canvas's context once its compile has finished (B7: loseContext() waits for a compile still running,
 * which froze the page for seconds). Never blocks; gives up after ROCK_DISPOSE_MAX_WAIT_MS and leaves the context to
 * the browser.
 */
function release(v: View): void {
  const t0 = Date.now();
  const settled = (): boolean => {
    try {
      return pollView(v);
    } catch {
      return true; // a compile or link error: nothing is running any more
    }
  };
  const tryLose = () => {
    if (settled()) loseContext(v.canvas);
    else if (Date.now() - t0 < ROCK_DISPOSE_MAX_WAIT_MS) setTimeout(tryLose, ROCK_DISPOSE_POLL_MS);
  };
  tryLose();
}

function markDrawn(v: View): void {
  v.drawn = true;
  const w = v.drawnWaiters;
  v.drawnWaiters = [];
  for (const f of w) f();
}

export class RockView {
  /** 0.4: cull back faces (a switch for the winding check in the bench; the app keeps it on). */
  static cullBackFaces = true;
  /** 0.8: let one canvas copy another's picture (a switch for the bench; the app keeps it on). */
  static shareCanvases = true;
  /** 2.1: canvases attached after this call draw from baked cube maps of `n` texels a side (on), or run the prototype's ROCK_FS (off). */
  static setBake(on: boolean, n?: number): void {
    (E.setRockBake as (on: boolean, n?: number) => void)(on, n);
  }

  private lostCb: (() => void) | null = null;
  private views: View[] = [];
  private RM: RockModel | null = null;
  private raf = 0;
  private last = 0;
  private visible = true;
  private disposed = false;
  private mesh: RadialMap | null = null;
  private rock: RockFromCard | null = null;
  private onStats: ((s: RockStats) => void) | null = null;
  /** Set when a frame must be drawn while paused. */
  private dirty = true;
  private mode: 'rocky' | 'smooth' = R.mode ?? 'rocky';
  private ageV: number = R.age ?? 70;
  private readonly useWorker: boolean;
  /** undefined: not made yet; null: no worker (none in this environment, or it failed): build on this thread. */
  private worker: Worker | null | undefined = undefined;
  private gen = 0;
  private inFlight: BuildMessage | null = null;
  private next: BuildMessage | null = null;
  private builtWaiters: (() => void)[] = [];
  private readonly onVis = () => {
    if (!document.hidden) this.dirty = true;
  };

  constructor(reducedMotion: boolean, opts: RockViewOptions = {}) {
    this.useWorker = opts.worker ?? true;
    setReducedMotion(reducedMotion);
    R.playing = !reducedMotion;
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVis);
  }

  /** The canvas can start WebGL2? (false: the caller keeps the three.js viewer, D-32). Checked once; the probe context is released. */
  static supported(): boolean {
    if (supportedCache === null) {
      try {
        const gl = document.createElement('canvas').getContext('webgl2');
        supportedCache = !!gl;
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
      } catch {
        supportedCache = false;
      }
    }
    return supportedCache;
  }

  /** Called when a canvas's WebGL context is lost, so the caller can fall back to the old path. */
  onContextLost(cb: (() => void) | null): void {
    this.lostCb = cb;
  }

  /** Attach a canvas. Throws if WebGL2 is not available. Its programs compile in the background (whenReady). */
  attach(canvas: HTMLCanvasElement, zoom = 1): () => void {
    const gl = new RockGL(canvas) as EngineGL;
    if (RockView.cullBackFaces) cullBackFaces(canvas);
    const view: View = {
      canvas,
      gl,
      zoom,
      off: () => undefined,
      shown: true,
      ready: false,
      error: null,
      mirror: null,
      drawn: false,
      drawnWaiters: [],
    };
    const down = (e: PointerEvent) => {
      R.drag = [e.clientX, e.clientY];
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    };
    const move = (e: PointerEvent) => {
      if (!R.drag) return;
      R.yaw += (e.clientX - R.drag[0]) * 0.01;
      R.pitch = clamp(R.pitch + (e.clientY - R.drag[1]) * 0.01, -1.4, 1.4);
      R.drag = [e.clientX, e.clientY];
      this.dirty = true;
    };
    const end = () => {
      R.drag = null;
      canvas.style.cursor = 'grab';
    };
    canvas.style.cursor = 'grab';
    canvas.style.touchAction = 'pan-y';
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    // Arrow keys turn it too (the canvas takes focus).
    const key = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === 'ArrowLeft') R.yaw -= 0.1;
      else if (k === 'ArrowRight') R.yaw += 0.1;
      else if (k === 'ArrowUp') R.pitch = clamp(R.pitch - 0.1, -1.4, 1.4);
      else if (k === 'ArrowDown') R.pitch = clamp(R.pitch + 0.1, -1.4, 1.4);
      else return;
      e.preventDefault();
      this.dirty = true;
    };
    canvas.addEventListener('keydown', key);
    const lost = (e: Event) => {
      e.preventDefault();
      this.lostCb?.();
    };
    canvas.addEventListener('webglcontextlost', lost);
    // 0.3: a canvas scrolled or laid out off-screen is not drawn; it is drawn again as it comes back.
    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((es) => {
            for (const x of es) {
              const was = view.shown;
              view.shown = x.isIntersecting;
              if (view.shown && !was) this.dirty = true;
            }
          });
    io?.observe(canvas);
    view.off = () => {
      io?.disconnect();
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', end);
      canvas.removeEventListener('pointercancel', end);
      canvas.removeEventListener('keydown', key);
    };
    this.views.push(view);
    if (this.RM) {
      view.gl.upload(R.built);
      this.dirty = true;
    }
    return () => {
      view.off();
      this.views = this.views.filter((v) => v !== view);
      release(view);
    };
  }

  /**
   * Resolves when `canvas` (default: the first attached canvas) has its programs linked, checking every 16 ms so the
   * page keeps running. Rejects with the compile or link log, or when the view is disposed or the canvas detached.
   */
  whenReady(canvas?: HTMLCanvasElement): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const check = () => {
        if (this.disposed)
          return reject(new Error('rock engine disposed before its shaders were ready'));
        const v = canvas ? this.views.find((x) => x.canvas === canvas) : this.views[0];
        if (!v) return reject(new Error('rock engine: the canvas is not attached'));
        try {
          if (pollView(v)) {
            this.dirty = true;
            return resolve();
          }
        } catch (err) {
          return reject(err instanceof Error ? err : new Error(String(err)));
        }
        setTimeout(check, 16);
      };
      check();
    });
  }

  /** Resolves once a picture has been put on `canvas` (drawn there or copied from the other pane). */
  whenDrawn(canvas: HTMLCanvasElement): Promise<void> {
    const v = this.views.find((x) => x.canvas === canvas);
    if (!v) return Promise.reject(new Error('rock engine: the canvas is not attached'));
    if (v.drawn) return Promise.resolve();
    return new Promise((resolve) => v.drawnWaiters.push(resolve));
  }

  /** Resolves when no height-map build is waiting or running. */
  whenBuilt(): Promise<void> {
    if (!this.inFlight && !this.next) return Promise.resolve();
    return new Promise((resolve) => this.builtWaiters.push(resolve));
  }

  onChange(cb: (s: RockStats) => void): void {
    this.onStats = cb;
  }

  /** Set the body and build it (the prototype's `rebuild`). A mesh replaces the generated lumps. */
  setBody(rock: RockFromCard, mesh: RadialMap | null = null): void {
    this.rock = rock;
    this.mesh = mesh;
    this.rebuild();
  }

  setMesh(mesh: RadialMap | null): void {
    this.mesh = mesh;
    this.rebuild();
  }

  /**
   * The prototype's `rebuild`: model, height field, upload, draw. In a worker (1.8) the body on screen stays until the
   * new height map arrives; a newer request replaces one still waiting, so a slider drag builds at most two.
   */
  rebuild(): void {
    if (!this.rock) return;
    const msg: BuildMessage = {
      id: ++this.gen,
      req: {
        preset: this.rock.preset,
        mode: this.mode,
        age: this.ageV,
        mesh: this.mesh?.h ?? null,
      },
    };
    const w = this.getWorker();
    if (!w) {
      this.apply(msg.req, buildField(msg.req));
      return;
    }
    if (this.inFlight) {
      this.next = msg;
      return;
    }
    this.post(w, msg);
  }

  private getWorker(): Worker | null {
    if (this.worker !== undefined) return this.worker;
    this.worker = null;
    if (!this.useWorker || typeof Worker === 'undefined') return null;
    try {
      const w = new Worker(new URL('./rockBuild.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<BuildReply>) => this.onReply(e.data);
      w.onerror = (e) => {
        e.preventDefault?.();
        this.workerFailed();
      };
      this.worker = w;
    } catch {
      this.worker = null;
    }
    return this.worker;
  }

  private post(w: Worker, msg: BuildMessage): void {
    this.inFlight = msg;
    w.postMessage(msg);
  }

  private onReply(res: BuildReply): void {
    if (this.disposed) return;
    const sent = this.inFlight;
    this.inFlight = null;
    if ('error' in res) {
      this.workerFailed(sent);
      return;
    }
    // Requests go one at a time, so this one is newer than the picture on screen: show it while the next one builds.
    if (sent && res.id === sent.id) this.apply(sent.req, res);
    const nx = this.next;
    this.next = null;
    if (nx && this.worker) this.post(this.worker, nx);
    else this.flushBuilt();
  }

  /** The worker broke: build what is still wanted on this thread, and from now on always here. */
  private workerFailed(sent: BuildMessage | null = this.inFlight): void {
    this.worker?.terminate();
    this.worker = null;
    const want = this.next ?? sent;
    this.inFlight = null;
    this.next = null;
    if (want && want.id === this.gen) this.apply(want.req, buildField(want.req));
    this.flushBuilt();
  }

  private flushBuilt(): void {
    const w = this.builtWaiters;
    this.builtWaiters = [];
    for (const f of w) f();
  }

  /** Puts a finished build on screen (the end of the prototype's `rebuild`). */
  private apply(req: BuildRequest, res: BuildResult): void {
    R.p = req.mesh ? { ...req.preset, ab: 1 } : req.preset;
    R.mode = req.mode;
    R.age = req.age;
    R.built = res.built;
    this.RM = res.RM;
    for (const v of this.views) v.gl.upload(R.built);
    this.dirty = true;
    const m = this.RM;
    this.onStats?.({
      gravity: m.gv,
      escape: m.escape,
      lump: m.lump,
      craters: R.built.craters,
      limit: m.limit,
      kind: m.kind,
      fast: m.fast,
      shapeModel: req.mesh !== null,
    });
    if (!this.inFlight && !this.next) this.flushBuilt();
  }

  /** The label of the body being drawn (parity hook and tests). */
  get label(): string | null {
    return this.rock?.preset.label ?? null;
  }
  get built(): boolean {
    return this.RM !== null;
  }
  /** The first canvas draws from the baked cube maps (2.1), not the prototype's per-pixel ROCK_FS (bench, tests). */
  get baked(): boolean {
    return !!(this.views[0]?.gl as { baked?: boolean } | undefined)?.baked;
  }
  /** Surface mode: 'rocky' (the default for every body) or 'smooth' (only data may ask for it). */
  setMode(mode: 'rocky' | 'smooth'): void {
    this.mode = mode;
    this.rebuild();
  }
  /** Advance the clock and the spin by `n` frames of 1/60 s, as the prototype's loop does. */
  step(n: number): void {
    R.clock += (1 / 60) * n;
    R.spin += (1 / 60) * 0.14 * n;
    this.dirty = true;
  }
  /**
   * Draw once on a temporary canvas of the artifact's stage size (704 x 439 CSS px) and return the
   * centred square scaled to `size` as a PNG data URL (the parity harness, `?parity=1` in dev).
   */
  capture(size: number): string {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:704px;height:439px';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:704px;height:439px;display:block';
    host.appendChild(canvas);
    document.body.appendChild(host);
    const off = this.attach(canvas);
    try {
      // Drawn by its own engine (never copied from a pane), waiting for its compile.
      const v = this.views.find((x) => x.canvas === canvas)!;
      if (this.RM && R.built) v.gl.draw(this.RM);
      const out = document.createElement('canvas');
      out.width = out.height = size;
      const g = out.getContext('2d')!;
      g.fillStyle = '#000';
      g.fillRect(0, 0, size, size);
      const w = canvas.width;
      const h = canvas.height;
      const sq = Math.min(w, h);
      g.drawImage(canvas, (w - sq) / 2, (h - sq) / 2, sq, sq, 0, 0, size, size);
      return out.toDataURL('image/png');
    } finally {
      off();
      host.remove();
    }
  }

  get age(): number {
    return this.ageV;
  }
  setAge(v: number): void {
    this.ageV = v;
    this.rebuild();
  }
  get playing(): boolean {
    return R.playing;
  }
  setPlaying(v: boolean): void {
    R.playing = v;
    this.dirty = true;
  }
  /** Draw nothing and stop the clock while false (on top of the per-canvas and tab checks). */
  setVisible(v: boolean): void {
    this.visible = v;
    this.dirty = true;
  }
  /** Draw once now (tests and screenshots). */
  draw(): void {
    this.drawAll();
  }
  /** Turn the body one step (the on-screen arrows; the same step as the arrow keys). */
  rotate(dir: 'left' | 'right' | 'up' | 'down'): void {
    if (dir === 'left') R.yaw -= 0.1;
    else if (dir === 'right') R.yaw += 0.1;
    else if (dir === 'up') R.pitch = clamp(R.pitch - 0.1, -1.4, 1.4);
    else R.pitch = clamp(R.pitch + 0.1, -1.4, 1.4);
    this.dirty = true;
  }
  /** Back to the pose the body opened with. */
  resetPose(): void {
    R.yaw = 0.6;
    R.pitch = 0.25;
    this.dirty = true;
  }
  /** Set the pose directly (tests). */
  pose(yaw: number, pitch: number, spin = 0): void {
    R.yaw = yaw;
    R.pitch = pitch;
    R.spin = spin;
    this.dirty = true;
  }

  /** Something is on screen to draw for: not paused by the host, the tab shown, at least one canvas shown. */
  private active(): boolean {
    if (!this.visible) return false;
    if (typeof document !== 'undefined' && document.hidden) return false;
    return this.views.some((v) => v.shown);
  }

  /**
   * Draws every shown canvas whose programs are ready. 0.8: the largest ready canvas draws the body; another canvas
   * of the same shape copies that picture, and draws the body itself only when it cannot (another shape, no ready
   * canvas to copy, its copier not compiled yet).
   */
  private drawAll(): void {
    if (!this.RM || !R.built) return;
    const shown = this.views.filter(
      (v) => v.shown && v.canvas.clientWidth > 0 && v.canvas.clientHeight > 0,
    );
    const ready = (v: View): boolean => {
      try {
        return pollView(v);
      } catch {
        return false;
      }
    };
    const area = (v: View) => v.canvas.clientWidth * v.canvas.clientHeight;
    const aspect = (v: View) => v.canvas.clientWidth / v.canvas.clientHeight;
    let primary: View | null = null;
    for (const v of shown) if (ready(v) && (!primary || area(v) > area(primary))) primary = v;
    let missed = false;
    if (primary) {
      primary.gl.draw(this.RM);
      markDrawn(primary);
    }
    for (const v of shown) {
      if (v === primary) continue;
      const same =
        primary !== null &&
        Math.abs(aspect(v) / aspect(primary) - 1) < MIRROR_ASPECT_TOLERANCE &&
        RockView.shareCanvases;
      if (same && primary) {
        if (!v.mirror) {
          const gl = v.canvas.getContext('webgl2') as WebGL2RenderingContext | null;
          if (gl && typeof gl.createProgram === 'function') v.mirror = new Mirror(gl);
        }
        if (v.mirror?.poll()) {
          v.mirror.copy(primary.canvas, v.canvas);
          markDrawn(v);
          continue;
        }
      }
      if (ready(v)) {
        v.gl.draw(this.RM);
        markDrawn(v);
      } else missed = true;
    }
    // A canvas still compiling (or its copier) gets its picture on a later frame, even while paused.
    this.dirty = missed || (shown.length > 0 && !primary);
  }

  /** The prototype's `loop`: spin and clock while playing; one frame on change while paused. Stops while nothing is shown. */
  private loop(now: number): void {
    if (this.disposed) return;
    const dt = Math.min(0.06, (now - this.last) / 1000 || 0);
    this.last = now;
    if (this.views.length > 0 && this.RM && this.active()) {
      if (R.playing) {
        if (!R.drag) R.spin += dt * 0.14;
        R.clock += dt;
        this.drawAll();
      } else if (this.dirty) this.drawAll();
    }
    this.raf = requestAnimationFrame(this.loop);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (typeof document !== 'undefined')
      document.removeEventListener('visibilitychange', this.onVis);
    for (const v of this.views) {
      v.off();
      release(v);
    }
    this.views = [];
    this.lostCb = null;
    this.worker?.terminate();
    this.worker = null;
    this.inFlight = null;
    this.next = null;
    this.flushBuilt();
  }
}

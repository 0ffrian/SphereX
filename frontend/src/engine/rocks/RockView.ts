// Issue #71, D-37 (stream V3): hosts the prototype rock engine (`source.ts`) on canvases. One body at a
// time; the same body can be drawn on several canvases (the build pane's globe stage and the
// close-up pane). Wraps what the prototype's page code did (`rebuild`, the pointer handlers and the
// `loop`) without its DOM: Pause, Surface age and drag to turn are driven through this class.
// Raw WebGL2 on its own canvas (D-37 overrides "three r187 TSL only" for generated bodies).
import * as E from './source';
/* eslint-disable @typescript-eslint/no-explicit-any -- the prototype engine is untyped JavaScript */
const R: any = E.R;
const RockGL: any = E.RockGL;
const buildRock: any = E.buildRock;
const rockModel: any = E.rockModel;
const clamp: any = E.clamp;
const radialFn: any = E.radialFn;
const setReducedMotion: any = E.setReducedMotion;
import type { RockFromCard } from './cardToRock';
import type { RadialMap } from './meshRadial';

interface View {
  canvas: HTMLCanvasElement;
  gl: any;
  /** Zoom of this view against the prototype's own framing. */
  zoom: number;
  off: () => void;
}

export interface RockStats {
  gravity: number;
  escape: number;
  lump: number;
  craters: number;
  limit: number;
  kind: string;
  fast: boolean;
}

export class RockView {
  private views: View[] = [];
  private RM: any = null;
  private raf = 0;
  private last = 0;
  private visible = true;
  private disposed = false;
  private mesh: RadialMap | null = null;
  private rock: RockFromCard | null = null;
  private onStats: ((s: RockStats) => void) | null = null;
  /** Set when a frame must be drawn while paused. */
  private dirty = true;

  constructor(reducedMotion: boolean) {
    setReducedMotion(reducedMotion);
    R.playing = !reducedMotion;
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  /** The canvas can start WebGL2? (false: the caller keeps the three.js viewer, D-32). */
  static supported(): boolean {
    try {
      return !!document.createElement('canvas').getContext('webgl2');
    } catch {
      return false;
    }
  }

  /** Attach a canvas. Throws if WebGL2 is not available. */
  attach(canvas: HTMLCanvasElement, zoom = 1): () => void {
    const gl = new RockGL(canvas);
    const view: View = { canvas, gl, zoom, off: () => undefined };
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
    view.off = () => {
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
    };
  }

  onChange(cb: (s: RockStats) => void): void {
    this.onStats = cb;
  }

  /** Set the body and build it (the prototype's `rebuild`). A mesh replaces the generated lumps. */
  setBody(rock: RockFromCard, mesh: RadialMap | null = null): void {
    this.rock = rock;
    this.mesh = mesh;
    R.p = rock.preset;
    this.rebuild();
  }

  setMesh(mesh: RadialMap | null): void {
    this.mesh = mesh;
    this.rebuild();
  }

  /** The prototype's `rebuild`: model, height field, upload, draw. */
  rebuild(): void {
    if (!this.rock) return;
    if (this.mesh) R.p = { ...R.p, ab: 1 };
    this.RM = rockModel();
    buildRock(this.RM);
    const mesh = this.mesh;
    if (mesh) {
      // A shape model: the measured radius replaces the generated lumps and craters; the engine's
      // fine ridges, boulders, lighting, shadows and (for a comet) jets still apply. The engine
      // draws `radialFn(d) * (1 + h)`, so `h` is the model's radius over the engine's own radius.
      this.RM.ax = [1, 1, 1];
      const rf = radialFn(this.RM.ax, !!R.p.comet);
      const { w, h: rows, data } = R.built;
      let ext = 0;
      for (let j = 0; j < rows; j++) {
        const la = ((j + 0.5) / rows - 0.5) * Math.PI;
        const cl = Math.cos(la);
        const sl = Math.sin(la);
        for (let i = 0; i < w; i++) {
          const lo = ((i + 0.5) / w - 0.5) * 2 * Math.PI;
          const base = rf(cl * Math.cos(lo), sl, cl * Math.sin(lo));
          const k = j * w + i;
          const r = 1 + mesh.h[k]!;
          data[k * 2] = r / base - 1;
          data[k * 2 + 1] = 0;
          if (r > ext) ext = r;
        }
      }
      R.built.ext = ext;
    }
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
    });
  }

  /** The label of the body being drawn (parity hook and tests). */
  get label(): string | null {
    return this.rock?.preset.label ?? null;
  }
  get built(): boolean {
    return this.RM !== null;
  }
  /** Surface mode: 'rocky' (the default for every body) or 'smooth' (only data may ask for it). */
  setMode(mode: 'rocky' | 'smooth'): void {
    R.mode = mode;
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
      this.drawAll();
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
    return R.age;
  }
  setAge(v: number): void {
    R.age = v;
    this.rebuild();
  }
  get playing(): boolean {
    return R.playing;
  }
  setPlaying(v: boolean): void {
    R.playing = v;
    this.dirty = true;
  }
  setVisible(v: boolean): void {
    this.visible = v;
    this.dirty = true;
  }
  /** Draw once now (tests and screenshots). */
  draw(): void {
    this.drawAll();
  }
  /** Set the pose directly (tests). */
  pose(yaw: number, pitch: number, spin = 0): void {
    R.yaw = yaw;
    R.pitch = pitch;
    R.spin = spin;
    this.dirty = true;
  }

  private drawAll(): void {
    if (!this.RM || !R.built) return;
    for (const v of this.views) {
      if (!v.canvas.clientWidth || !v.canvas.clientHeight) continue;
      v.gl.draw(this.RM);
    }
    this.dirty = false;
  }

  /** The prototype's `loop`: spin and clock while playing; one frame on change while paused. */
  private loop(now: number): void {
    if (this.disposed) return;
    const dt = Math.min(0.06, (now - this.last) / 1000 || 0);
    this.last = now;
    if (this.visible && this.views.length > 0 && this.RM) {
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
    for (const v of this.views) v.off();
    this.views = [];
  }
}

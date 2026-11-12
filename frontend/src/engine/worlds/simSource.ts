// Issue #93 1.9 and 1.10 (PR #101 render-performance roadmap): one planet simulation feeding every view of a world.
// A SimSource owns the simulation (a SimHost, on the main thread or in a worker) and the views that draw it (the
// globe and the fly engine, `SimFollower`). Either view may be disposed first: the simulation lives in the source, not
// in a view, and the source is released with its last view. A view that is not drawing (paused, hidden) is skipped
// and catches up from a snapshot when it draws again.
import type { EngineOverrides, WorldPreset } from './types';
import { SimHost, type SimOp, type SimSnapshot, type SimState } from './simHost';

/** A view that draws a source's world (WorldEngine). */
export interface SimFollower {
  /** The view's own simulation key (engineControls.simKey): it may follow a source only while the keys agree. */
  simKey(): string;
  simApply(op: SimOp): void;
  simState(s: SimState, T: Float32Array | null, rain: Float32Array | null): void;
  simResync(snap: SimSnapshot): void;
}

/** A view that has not pumped for this long is not drawing (UI pacing, ms): ops skip it and it catches up later. */
export const SIM_LIVE_MS = 300;

export type SimMode = 'own' | 'shared';

export abstract class SimSource {
  private followers = new Set<SimFollower>();
  private lastPump = new Map<SimFollower, number>();
  private stale = new Set<SimFollower>();
  private driver: SimFollower | null = null;
  private disposed = false;
  /** Set when the simulation broke (a worker error): every pump throws it, so the host falls back (never blank). */
  protected error: Error | null = null;

  abstract readonly mode: SimMode;
  /** The simulation key of the world this source runs (the key of the views that attached to it). */
  abstract get key(): string;
  /** Spin-up steps left, as far as this side knows. */
  abstract get spinup(): number;
  /** A control change; `key` is the views' simulation key after it (they apply it first). */
  abstract setOverrides(o: EngineOverrides, key?: string): void;
  /** Run (or request) one simulation tick. */
  protected abstract step(playing: boolean, dt: number): void;
  /** The current state for a view that catches up, or null while there is none yet. */
  protected abstract snapshot(): SimSnapshot | null;
  protected abstract release(): void;

  get viewCount(): number {
    return this.followers.size;
  }

  /** A view joins; it catches up at its next pump. */
  attach(f: SimFollower): void {
    if (this.disposed) throw new Error('simulation source disposed');
    this.followers.add(f);
    this.stale.add(f);
  }

  /** A view leaves. The last one releases the simulation (terminates the worker). */
  detach(f: SimFollower): void {
    this.followers.delete(f);
    this.lastPump.delete(f);
    this.stale.delete(f);
    if (this.driver === f) this.driver = null;
    if (!this.followers.size && !this.disposed) {
      this.disposed = true;
      this.release();
    }
  }

  /** The view needs a full catch-up (its own world was rebuilt locally). */
  markStale(f: SimFollower): void {
    if (this.followers.has(f)) this.stale.add(f);
  }

  /**
   * Called by a view on every frame it draws. The first view that draws drives the simulation (one tick a frame);
   * another view only catches up. A view that stopped drawing for SIM_LIVE_MS hands the drive over.
   */
  pump(f: SimFollower, playing: boolean, dt: number): void {
    if (this.error) throw this.error;
    if (this.disposed || !this.followers.has(f)) return;
    const now = performance.now();
    this.lastPump.set(f, now);
    if (this.stale.has(f)) this.catchUp(f);
    const d = this.driver;
    if (d && d !== f && this.isLive(d, now)) return;
    this.driver = f;
    this.step(playing, dt);
  }

  private isLive(f: SimFollower, now: number): boolean {
    const t = this.lastPump.get(f);
    return t != null && now - t < SIM_LIVE_MS;
  }

  private catchUp(f: SimFollower): void {
    const snap = this.snapshot();
    if (!snap) return;
    f.simResync(snap);
    this.stale.delete(f);
  }

  /** Give every drawing, caught-up view one op; the others will catch up from a snapshot. */
  protected deliver(op: SimOp): void {
    const now = performance.now();
    for (const f of this.followers) {
      if (this.stale.has(f)) continue;
      if (!this.isLive(f, now)) {
        this.stale.add(f);
        continue;
      }
      f.simApply(op);
    }
  }

  protected deliverState(s: SimState, T: Float32Array | null, rain: Float32Array | null): void {
    for (const f of this.followers) if (!this.stale.has(f)) f.simState(s, T, rain);
  }

  protected fail(err: Error): void {
    this.error = err;
  }
}

/**
 * Synchronous mode: the SimHost runs on the main thread, inside the driving view's frame, and its ops are replayed in
 * every drawing view as they happen. Used without Worker support, for `?sim=shared`, by the parity spin-up and in tests.
 */
export class LocalSimSource extends SimSource {
  readonly mode = 'shared' as const;
  readonly host: SimHost;

  constructor(preset: WorldPreset | string, applied?: EngineOverrides) {
    super();
    this.host = new SimHost((op) => this.deliver(op));
    this.host.load(preset, applied);
  }

  get key(): string {
    return this.host.state().key;
  }
  get spinup(): number {
    return this.host.spinup;
  }

  setOverrides(o: EngineOverrides): void {
    this.host.setOverrides(o);
    const s = this.host.snapshot();
    this.deliverState(s.state, s.T, s.rain);
  }

  protected step(playing: boolean, dt: number): void {
    this.host.tick(playing, dt);
    const s = this.host.snapshot();
    this.deliverState(s.state, s.T, s.rain);
  }

  protected snapshot(): SimSnapshot {
    return this.host.snapshot();
  }

  protected release(): void {
    this.host.setSink(() => undefined);
  }

  /**
   * The parity spin-up (WorldEngine.spinUp): tick until formed. With `virtualClock` performance.now() advances 1 ms a
   * call, so the step count per tick is the same on every machine (Q-306).
   */
  spinUpSync(f: SimFollower, dt: number, virtualClock: boolean): void {
    const real = performance.now.bind(performance);
    let t = 0;
    if (virtualClock) performance.now = () => (t += 1);
    try {
      for (let g = 0; this.host.spinup > 0 && g < 100000; g++) this.pump(f, false, dt);
    } finally {
      performance.now = real;
    }
  }
}

/**
 * The source a new view should follow: the other view's, when it runs the same world, else a new one in `mode`. Null
 * for mode 'own' (the view runs its own simulation, as the prototype does).
 */
export function simSourceFor(
  mode: SimMode,
  preset: WorldPreset,
  applied: EngineOverrides,
  view: SimFollower,
  other: SimSource | null | undefined,
): SimSource | null {
  if (mode === 'own') return null;
  if (other && other.key === view.simKey()) return other;
  return new LocalSimSource(preset, applied);
}

/** `?sim=own|shared`; the default is one shared simulation (the worker comes with roadmap 1.10). */
export function simModeFromQuery(search = typeof location === 'undefined' ? '' : location.search) {
  const q = new URLSearchParams(search).get('sim');
  if (q === 'own' || q === 'shared') return q;
  return 'shared';
}

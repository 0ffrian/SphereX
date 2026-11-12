// Render-performance roadmap 0.1 for the world engine: GPU time of each host frame, read-only, from
// the wrapper side (WorldEngine.ts), with EXT_disjoint_timer_query_webgl2. core.js is not touched:
// the query brackets the whole `tick()` (simulation passes and the redraw). A query result arrives
// a few frames later; results from a frame where the GPU was disjoint (power state change, context
// switch) are dropped, as the extension asks. Dev only: the host turns it on with `?gputime=1`.
import { RollingStats } from '@/viewer/render/gpuTiming';

/** The extension's constants (WebGL 2 spec extension registry, EXT_disjoint_timer_query_webgl2). */
const TIME_ELAPSED_EXT = 0x88bf;
const GPU_DISJOINT_EXT = 0x8fbb;

/** Queries kept in flight at most; older ones are dropped unread rather than piling up. */
const MAX_PENDING = 8;

export class GlGpuTimer {
  private readonly pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  readonly stats = new RollingStats(240);

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly ext: object,
  ) {}

  /** Null when the context or the extension is missing (most software renderers, some browsers). */
  static create(gl: WebGL2RenderingContext | null): GlGpuTimer | null {
    if (!gl) return null;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    return ext ? new GlGpuTimer(gl, ext) : null;
  }

  /** Starts timing; a nested begin (one is already running) is ignored. */
  begin(): void {
    if (this.active) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end(): void {
    const q = this.active;
    if (!q) return;
    this.gl.endQuery(TIME_ELAPSED_EXT);
    this.active = null;
    this.pending.push(q);
    while (this.pending.length > MAX_PENDING) this.gl.deleteQuery(this.pending.shift()!);
    this.poll();
  }

  /** Reads every finished query, oldest first. */
  poll(): void {
    const gl = this.gl;
    const disjoint = !!gl.getParameter(GPU_DISJOINT_EXT);
    while (this.pending.length > 0) {
      const q = this.pending[0]!;
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      gl.deleteQuery(q);
      if (!disjoint) this.stats.push(ns / 1e6);
    }
  }

  dispose(): void {
    if (this.active) {
      try {
        this.gl.endQuery(TIME_ELAPSED_EXT);
      } catch {
        /* context gone */
      }
      this.active = null;
    }
    for (const q of this.pending) this.gl.deleteQuery(q);
    this.pending.length = 0;
  }
}

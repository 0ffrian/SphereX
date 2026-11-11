// R11.3 / R11.4 (issue #16): frame-time summary and pass/fail verdicts for the A15 measurement run.
// Pure: no DOM, no viewer. Percentiles use the viewer's own nearest-rank `percentile` (one definition,
// ViewerApp.ts) so a recorded run and `renderStats()` agree; the import pulls in three, which is fine
// here: this module ships only in the fixtures build and in tests.
import { percentile } from '@/viewer/ViewerApp';
import { FEED_GAP_MS, TIERS } from '@/viewer/render/quality';

/** Fewest intervals per second of recording that still counts as a run (a vsynced 30 Hz run passes). */
export const MIN_SAMPLES_PER_SECOND = 20;
/** R11.3: the length of the gate run. */
export const EVENT_GATE_SECONDS = 20;
/** D-05, R11 gate: the 30 fps floor. */
export const FLOOR_FPS = 30;

export interface FrameSummary {
  /** Intervals at or below FEED_GAP_MS: the ones the percentiles are over (R11.3 definition). */
  samples: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  /** 1000 / p50Ms; 0 when there are no samples (never Infinity). */
  fpsAtP50: number;
  /** Share of samples slower than 33.3 ms and than 16.7 ms, in percent. */
  over33Pct: number;
  over16_7Pct: number;
  /** Intervals above FEED_GAP_MS: stalls the percentiles skip. */
  longGaps: number;
  maxGapMs: number;
}

export function summarizeFrameTimes(intervals: readonly number[]): FrameSummary {
  const used = intervals.filter((ms) => ms <= FEED_GAP_MS);
  const gaps = intervals.filter((ms) => ms > FEED_GAP_MS);
  const p50Ms = percentile(used, 0.5);
  const share = (limit: number): number =>
    used.length === 0 ? 0 : (100 * used.filter((ms) => ms > limit).length) / used.length;
  return {
    samples: used.length,
    p50Ms,
    p95Ms: percentile(used, 0.95),
    p99Ms: percentile(used, 0.99),
    maxMs: used.length === 0 ? 0 : used.reduce((a, b) => Math.max(a, b), 0),
    fpsAtP50: p50Ms > 0 ? 1000 / p50Ms : 0,
    over33Pct: share(1000 / 30),
    over16_7Pct: share(1000 / 60),
    longGaps: gaps.length,
    maxGapMs: gaps.reduce((a, b) => Math.max(a, b), 0),
  };
}

export interface VerdictContext {
  /** Length of the recording. */
  seconds: number;
  /** Frames the viewer drew during the recording (renderStats().frames, end minus start). */
  viewerFrames: number;
  /** Quality tier at the start (R11.3: a drop is a miss for the level the run started on). */
  tierStart: string;
  tierEnd: string;
  backend: string;
  /** Auto drops since the viewer loaded (renderStats().drops at the end): any drop fails the run. */
  dropsAbsolute: number;
}

export interface Verdict {
  /** D-05 and the R11 gate: p50 at or above 30 fps. */
  meetsFloor30: boolean;
  /** R5.7: p50 at or above the start tier's target (60 on High and Medium, 30 on Low). */
  meetsTarget: boolean;
  targetFps: number;
  /** The R11 event gate: floor 30, WebGPU, started on Medium. */
  eventGate: boolean;
  reasons: string[];
}

export function verdict(s: FrameSummary, ctx: VerdictContext): Verdict {
  const reasons: string[] = [];
  const tiers: Readonly<Record<string, { targetFps: number } | undefined>> = TIERS;
  const tier = tiers[ctx.tierStart];
  const targetFps = tier ? tier.targetFps : 60;
  if (!tier) reasons.push(`unknown start tier "${ctx.tierStart}"`);
  const need = MIN_SAMPLES_PER_SECOND * ctx.seconds;
  if (s.samples < need)
    reasons.push(`too few samples (${s.samples}, need ${need}): is the body rotating?`);
  if (ctx.viewerFrames < s.samples - 2)
    reasons.push(
      `viewer not drawing every frame (${ctx.viewerFrames} drawn, ${s.samples} sampled): rotate continuously, auto-spin on`,
    );
  if (ctx.dropsAbsolute > 0)
    reasons.push(
      `quality dropped ${ctx.dropsAbsolute} time(s) (${ctx.tierStart} to ${ctx.tierEnd})`,
    );
  if (s.longGaps > 0)
    reasons.push(
      `stall: ${s.longGaps} interval(s) over ${FEED_GAP_MS} ms (max ${s.maxGapMs.toFixed(0)} ms)`,
    );
  const sound = tier !== undefined && reasons.length === 0;
  // Display convention: a vsynced 60 Hz p50 of 16.7 ms counts as 60 fps.
  const fps = Math.round(s.fpsAtP50);
  const meetsFloor30 = sound && fps >= FLOOR_FPS;
  const meetsTarget = sound && fps >= targetFps;
  const eventConfig = ctx.backend === 'webgpu' && ctx.tierStart === 'medium';
  if (!eventConfig) reasons.push('not the event configuration (WebGPU, started on Medium)');
  // R11.3: the gate run is 20 s of rotation.
  const longEnough = ctx.seconds >= EVENT_GATE_SECONDS;
  if (!longEnough) reasons.push(`run shorter than the ${EVENT_GATE_SECONDS} s gate run`);
  return {
    meetsFloor30,
    meetsTarget,
    targetFps,
    eventGate: meetsFloor30 && eventConfig && longEnough,
    reasons,
  };
}

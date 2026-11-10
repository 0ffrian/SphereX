// R11.3 / R11.4 (issue #16): `window.__sxPerf.record(seconds)` for the fixtures build only
// (ViewerPanel installs it inside its MODE === 'fixtures' block; production builds drop it, and
// check-dist looks for the `__sxPerf` marker). Self-contained: its own rAF loop, no ViewerApp edit.
// All rAF callbacks of one frame share a timestamp, so these intervals equal the viewer's tick
// intervals; nothing is skipped, so stalls over FEED_GAP_MS are seen.
import { summarizeFrameTimes, verdict } from './frameStats';
import type { FrameSummary, Verdict } from './frameStats';

interface StatsLike {
  tier: string;
  backend: string;
  frames: number;
  drops: number;
}
interface ViewerLike {
  renderStats?: () => StatsLike;
}

export interface PerfResult {
  summary: FrameSummary;
  verdict: Verdict;
  seconds: number;
  tierStart: string;
  tierEnd: string;
  backend: string;
  dropsAbsolute: number;
  viewerFrames: number;
  samples: number;
}

export interface PerfHooks {
  record(seconds?: number): Promise<PerfResult>;
}

let running = false;

function record(seconds = 20): Promise<PerfResult> {
  // The viewer is read at call time: React StrictMode (dev:fixtures) re-creates it.
  const viewer = (window as unknown as { __sxViewer?: ViewerLike }).__sxViewer;
  if (!Number.isFinite(seconds) || seconds <= 0)
    return Promise.reject(new Error('__sxPerf: seconds must be a positive number'));
  if (!viewer?.renderStats)
    return Promise.reject(new Error('__sxPerf: no viewer (call __sxShow first)'));
  if (running) return Promise.reject(new Error('__sxPerf: a recording is already running'));
  const stats = (): StatsLike => viewer.renderStats!();
  running = true;
  return new Promise<PerfResult>((resolve, reject) => {
    let handle = 0;
    try {
      const start = stats();
      const intervals: number[] = [];
      let first: number | null = null;
      let last: number | null = null;
      const tick = (now: number): void => {
        try {
          if (first === null) first = now;
          if (last !== null) intervals.push(now - last);
          last = now;
          if (now - first < seconds * 1000) {
            handle = requestAnimationFrame(tick);
            return;
          }
          const end = stats();
          const summary = summarizeFrameTimes(intervals);
          // Cumulative since load: a governor drop before the recording still fails the run.
          const dropsAbsolute = end.drops;
          const viewerFrames = end.frames - start.frames;
          const v = verdict(summary, {
            seconds,
            viewerFrames,
            tierStart: start.tier,
            tierEnd: end.tier,
            backend: end.backend,
            dropsAbsolute,
          });
          running = false;
          resolve({
            summary,
            verdict: v,
            seconds,
            tierStart: start.tier,
            tierEnd: end.tier,
            backend: end.backend,
            dropsAbsolute,
            viewerFrames,
            samples: summary.samples,
          });
        } catch (err) {
          cancelAnimationFrame(handle);
          running = false;
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };
      handle = requestAnimationFrame(tick);
    } catch (err) {
      cancelAnimationFrame(handle);
      running = false;
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export function installPerfHooks(): void {
  (window as unknown as { __sxPerf?: PerfHooks }).__sxPerf = { record };
}

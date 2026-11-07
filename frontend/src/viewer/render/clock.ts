// SimClock (R5.7, D-34): one simulation time per moving process, equal to the accumulated real
// time times that process's shown speed-up. Pure: `now` is injected. The browser bindings (reduced
// motion, hidden tab, off-screen, phone idle) live in ViewerApp and only add or remove pause
// reasons here.

/** `idle`: a coarse-pointer device saw no interaction for `IDLE_PAUSE_MS` (R5.7). */
export type PauseReason = 'reduced-motion' | 'hidden' | 'offscreen' | 'user' | 'idle' | 'test';

export interface ClockProcess {
  id: string;
  /** Plain-words name shown with the speed-up, e.g. "Spin". */
  label: string;
  /** Time-lapse factor shown on screen ("×1000"). Display choice; always labelled. */
  speedup: number;
}

/** Longest real step one tick may take, so a stalled tab does not make a jump (existing spin rule). */
export const MAX_TICK_S = 0.1;

export class SimClock {
  private readonly procs = new Map<string, ClockProcess & { simS: number }>();
  private readonly reasons = new Set<PauseReason>();
  private last: number | null = null;

  constructor(private readonly now: () => number) {}

  /** Adds a process, or updates its label and speed-up while keeping its sim time. */
  setProcess(p: ClockProcess): void {
    const old = this.procs.get(p.id);
    this.procs.set(p.id, { ...p, simS: old?.simS ?? 0 });
  }

  removeProcess(id: string): void {
    this.procs.delete(id);
  }

  processes(): ClockProcess[] {
    return [...this.procs.values()].map(({ id, label, speedup }) => ({ id, label, speedup }));
  }

  simTime(id: string): number {
    return this.procs.get(id)?.simS ?? 0;
  }

  /** Sets every process to the same sim time (tests and golden frames). */
  setAllSimTimes(simS: number): void {
    for (const p of this.procs.values()) p.simS = simS;
  }

  pause(reason: PauseReason): void {
    this.reasons.add(reason);
    this.last = null;
  }

  resume(reason: PauseReason): void {
    this.reasons.delete(reason);
    this.last = null;
  }

  setPaused(reason: PauseReason, paused: boolean): void {
    if (paused) this.pause(reason);
    else this.resume(reason);
  }

  isPaused(): boolean {
    return this.reasons.size > 0;
  }

  pauseReasons(): PauseReason[] {
    return [...this.reasons];
  }

  /** True while something moves: a process exists and nothing pauses the clock. */
  get running(): boolean {
    return this.procs.size > 0 && this.reasons.size === 0;
  }

  /** Advances every process by the real time since the last tick; returns that real step (s). */
  tick(): number {
    if (this.reasons.size > 0) {
      this.last = null;
      return 0;
    }
    const t = this.now();
    if (this.last === null) {
      this.last = t;
      return 0;
    }
    const dt = Math.min(Math.max((t - this.last) / 1000, 0), MAX_TICK_S);
    this.last = t;
    for (const p of this.procs.values()) p.simS += dt * p.speedup;
    return dt;
  }
}

// Test helper (src/test/ is test-only code): a recording HapticSink for the #11 sources, plus a
// helper that builds TouchSamples. No engine rules (no honesty gate, no rate cap): tests of those
// go through the real HapticEngine. App modules must never import this (fixtures.test.ts checks it).
import type { HapticEvent } from '@/contract';
import type { TrainParams } from '@/haptics/haptics';
import { directionToUV } from '@/viewer/fields/fieldGenerator';
import { createTouchSample, type HapticSink, type TouchSample } from '@/haptics/sources/types';

export interface TrainOp {
  op: 'start' | 'update' | 'stop';
  id: string;
  params: TrainParams | null;
}

export class RecordingSink implements HapticSink {
  readonly events: HapticEvent[] = [];
  readonly trains: TrainOp[] = [];
  private active: string | null = null;
  private params: TrainParams | null = null;

  emit(e: HapticEvent): boolean {
    this.events.push({ ...e });
    return true;
  }

  startTrain(id: string, p: TrainParams): boolean {
    if (this.active === id) return this.updateTrain(id, p);
    this.active = id;
    this.params = { ...p };
    this.trains.push({ op: 'start', id, params: { ...p } });
    return true;
  }

  updateTrain(id: string, p: Partial<TrainParams>): boolean {
    if (this.active !== id) return false;
    this.params = { ...this.params!, ...p };
    this.trains.push({ op: 'update', id, params: { ...this.params } });
    return true;
  }

  stopTrain(id?: string): void {
    if (!this.active || (id !== undefined && id !== this.active)) return;
    this.trains.push({ op: 'stop', id: this.active, params: null });
    this.active = null;
    this.params = null;
  }

  get activeTrainId(): string | null {
    return this.active;
  }

  /** The running train's params, or null. */
  get current(): TrainParams | null {
    return this.params;
  }

  ticks(kind: HapticEvent['kind'] = 'tick'): HapticEvent[] {
    return this.events.filter((e) => e.kind === kind);
  }

  clear(): void {
    this.events.length = 0;
    this.trains.length = 0;
  }
}

/** A sample on the unit sphere at direction `d` (normalised), with screen position and time. */
export function sampleAt(
  d: readonly [number, number, number],
  opts: { x?: number; y?: number; t?: number; bodyId?: string | null } = {},
): TouchSample {
  const s = createTouchSample();
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  s.dir = [d[0] / l, d[1] / l, d[2] / l];
  s.normal = [...s.dir];
  const { u, v } = directionToUV(s.dir);
  s.u = u;
  s.v = v;
  s.bodyId = opts.bodyId === undefined ? 'body' : opts.bodyId;
  s.xPx = opts.x ?? 0;
  s.yPx = opts.y ?? 0;
  s.timeMs = opts.t ?? 0;
  return s;
}

/** A sample at texture coordinates (u, v) on the unit sphere. */
export function sampleUV(u: number, v: number, opts: { x?: number; t?: number } = {}): TouchSample {
  const theta = v * Math.PI;
  const phi = u * 2 * Math.PI;
  return sampleAt(
    [-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta)],
    opts,
  );
}

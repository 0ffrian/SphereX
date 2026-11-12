// Spec R13 §9.4 (priority), §9.5 (budgets, cache), §2.6 (never blank): the ambience palette (#113). The palette is the
// main-thread client of the bake worker. It takes the beds that #112's `selectBeds` chose and queues them in priority
// order. It keeps them inside the memory budgets and bakes them one at a time in the worker (bake engine ported from
// Moon's Ambience Loop Lab). It wraps each result as an AudioBuffer and caches two worlds (LRU).
// The AudioContext is injected (BaseAudioContext): nothing here imports haptics/ or creates a context.
import { bakeRefusalText, NO_WORKER_TEXT } from './captions';
import { bakedLength, checkSpec, isOneShot, releaseBakeCaches } from './dsp';
import * as K from './dspTuning';
import { hash32 } from './hash';
import { handleBakeRequest, type BakeRequest, type BakeResponse } from './bake.worker';
import type { AirModel, BedSpec, Refusal, SourceId } from './types';

/** §9.4 bake order (1 first). */
export const BED_PRIORITY: Record<SourceId, number> = {
  S1_land: 1,
  S1_sea: 1,
  S4: 2,
  S5: 2,
  S6: 3,
  S12: 4,
  S2: 5,
  S3: 5,
  S7: 6,
  S8: 7,
  S10: 8,
  S9: 9,
  thunder: 10,
};

/** The part of a Worker the palette uses (tests pass a fake). */
export interface WorkerLike {
  postMessage(msg: BakeRequest): void;
  onmessage: ((e: { data: BakeResponse }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  terminate(): void;
}

export interface PaletteOptions {
  /** Creates the bake worker; null means no worker (the main-thread fallback runs). */
  workerFactory?: () => WorkerLike | null;
  /** Schedules a main-thread fallback bake (default setTimeout 0). */
  schedule?: (fn: () => void) => void;
}

export interface ReadyEvent {
  id: SourceId;
  variant: number;
  worldKey: string;
}

function defaultWorker(): WorkerLike | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./bake.worker.ts', import.meta.url), {
      type: 'module',
    }) as unknown as WorkerLike;
  } catch {
    return null;
  }
}

/** Hash of the physics fields of an AirModel, in a fixed order (the tagged inputs and refusal texts are excluded). */
export function airHash(air: AirModel): number {
  const l = air.liquid;
  return hash32(
    air.gas ? 1 : 0,
    air.cls,
    air.fluid,
    air.state,
    air.T0,
    air.P0,
    air.H_km,
    air.mu,
    air.gamma,
    air.gv,
    air.gamK,
    air.c0,
    air.rho0,
    air.Z0,
    air.airOK ? 1 : 0,
    l ? `${l.name},${l.rho},${l.sigma},${l.viscous ? 1 : 0}` : '-',
    air.lavaWorld ? 1 : 0,
    air.Uscale,
    air.Us,
    air.phiH,
    air.Om,
    air.locked ? 1 : 0,
    air.res32 ? 1 : 0,
    air.R_km,
    air.zc_km ?? '-',
    air.regime,
    air.seed,
    air.Vmax ?? '-',
    air.seed3.join(','),
    air.oceanF,
    air.presetId,
  );
}

/** Hash of everything in a BedSpec that changes the baked samples. */
export function specHash(s: BedSpec): number {
  const params = Object.keys(s.params)
    .sort()
    .map((k) => `${k}=${s.params[k]}`);
  return hash32(s.id, s.variant, s.sampleRate, s.N, s.seed, s.Uref, ...params);
}

/** §9.5 cache world key: preset id plus the air hash. */
export function worldKeyOf(air: AirModel): string {
  return `${air.presetId}#${airHash(air).toString(16)}`;
}

const bedId = (id: SourceId, variant: number) => `${id}|${variant}`;
const bytesOf = (s: BedSpec) => bakedLength(s) * 2 * 4;

interface Item {
  key: string;
  worldKey: string;
  spec: BedSpec;
  air: AirModel;
}
interface Entry {
  key: string;
  /** Identity of the samples across worlds of one preset: bed, spec hash and the only air fields dsp reads (c0, gv). */
  reuse: string;
  buf: AudioBuffer;
  bytes: number;
  ms: number;
  notes: string[];
}

/** dsp.ts reads only `c0` (S4 echo delays) and `gv` (S4/S5 wave fall time) from the AirModel, so a bed with the
 * same spec, and the same c0/gv where it reads them, is the same sound. */
const reuseKey = (s: BedSpec, air: AirModel) => {
  const airPart = s.id === 'S4' ? `|${air.c0}|${air.gv}` : s.id === 'S5' ? `|${air.gv}` : '';
  return `${bedId(s.id, s.variant)}|${specHash(s).toString(16)}${airPart}`;
};
const presetOf = (worldKey: string) => worldKey.slice(0, worldKey.lastIndexOf('#'));

export class Palette {
  private readonly ctx: BaseAudioContext;
  private readonly makeWorker: () => WorkerLike | null;
  private readonly schedule: (fn: () => void) => void;
  private worker: WorkerLike | null = null;
  private workerFailed = false;
  /** worldKey → (bed id → entry); Map order is the LRU order (oldest first). */
  private readonly worlds = new Map<string, Map<string, Entry>>();
  private current: string | null = null;
  private queue: Item[] = [];
  private inFlight: { reqId: number; item: Item } | null = null;
  private nextReq = 1;
  /** Main-thread fallback bakes used, per world (so repeated requests do not freeze the view again and again). */
  private readonly fallbackUsed = new Map<string, number>();
  /** Per world: the beds the latest request admitted (bed id to bed key). Only these are kept and stored. */
  private readonly admitted = new Map<string, Map<string, string>>();
  private refusals: Refusal[] = [];
  private readonly listeners = new Set<(e: ReadyEvent) => void>();
  private disposed = false;

  constructor(ctx: BaseAudioContext, opts: PaletteOptions = {}) {
    this.ctx = ctx;
    this.makeWorker = opts.workerFactory ?? defaultWorker;
    this.schedule = opts.schedule ?? ((fn) => void setTimeout(fn, 0));
  }

  /** Bakes the beds of this world in §9.4 order within the §9.5 budgets. A new call replaces the queue (re-bake or a
   * new world) and makes this world current; beds it no longer asks for are dropped. Other worlds stay cached (LRU of
   * CACHE_WORLDS). */
  request(beds: BedSpec[], air: AirModel): void {
    if (this.disposed) return;
    const worldKey = worldKeyOf(air);
    let world = this.worlds.get(worldKey);
    if (world) this.worlds.delete(worldKey);
    else world = new Map();
    this.worlds.set(worldKey, world);
    this.current = worldKey;
    this.evict();

    const sorted = beds
      .map((s, i) => ({ s, i }))
      .sort(
        (a, b) =>
          BED_PRIORITY[a.s.id] - BED_PRIORITY[b.s.id] || a.s.variant - b.s.variant || a.i - b.i,
      )
      .map((x) => x.s);
    const capBed = K.BED_MEMORY_MB * 1e6,
      capShot = K.ONE_SHOT_MEMORY_MB * 1e6;
    let usedBed = 0,
      usedShot = 0;
    this.refusals = [];
    this.queue = [];
    const admitted = new Map<string, string>();
    const ready: ReadyEvent[] = [];
    for (const s of sorted) {
      const bad = checkSpec(s, air);
      if (bad.length) {
        // Refused before the budget is charged, so an invalid spec cannot distort it (code review L5).
        this.refusals.push({
          source: s.id,
          reason: bakeRefusalText(s.id, bad.join(', ')),
        });
        continue;
      }
      const shot = isOneShot(s.id, s.variant),
        bytes = bytesOf(s);
      if (shot ? usedShot + bytes > capShot : usedBed + bytes > capBed) {
        this.refusals.push({
          source: s.id,
          reason: bakeRefusalText(s.id, `over the ${shot ? 'one-shot' : 'bed'} memory budget`),
        });
        continue;
      }
      if (shot) usedShot += bytes;
      else usedBed += bytes;
      const bid = bedId(s.id, s.variant);
      const key = `${worldKey}|${bid}|${specHash(s).toString(16)}`;
      admitted.set(bid, key);
      if (world.get(bid)?.key === key) continue; // cached
      // §9.6 re-bake: an older world of the same preset may hold exactly this sound (same spec, c0 and gv).
      const reused = this.findReusable(worldKey, reuseKey(s, air));
      if (reused) {
        world.set(bid, { ...reused, key });
        ready.push({ id: s.id, variant: s.variant, worldKey });
        continue;
      }
      if (this.inFlight?.item.key === key) continue; // already baking (code review L3)
      this.queue.push({ key, worldKey, spec: s, air });
    }
    // Beds this request no longer asks for are dropped, so the world stays inside its budget (code review M2) and a
    // refused bed is never served.
    for (const bid of [...world.keys()]) if (!admitted.has(bid)) world.delete(bid);
    this.admitted.set(worldKey, admitted);
    for (const ev of ready) this.emit(ev);
    this.pump();
  }

  /** The bed's AudioBuffer in the current world, or null. Never another world's bed (coordinator ruling 1): while a
   * bed (re)bakes the mixer gets null and fades, unless the same sound was reused unchanged (§9.6). */
  get(id: SourceId, variant: number): AudioBuffer | null {
    if (!this.current) return null;
    return this.worlds.get(this.current)?.get(bedId(id, variant))?.buf ?? null;
  }

  /** Called once per finished bed; returns the unsubscribe function. */
  onReady(cb: (e: ReadyEvent) => void): () => void {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }

  /** Beds of the current request that will not play: over budget, refused by the bake, or failed. */
  unavailable(): Refusal[] {
    return this.refusals.slice();
  }

  /** §14: bytes and beds held, and bake ms per bed of the current world. */
  stats(): {
    bytes: number;
    beds: number;
    msPerBed: Record<string, number>;
    notes: Record<string, string[]>;
  } {
    let bytes = 0,
      beds = 0;
    const seen = new Set<AudioBuffer>();
    for (const w of this.worlds.values())
      for (const e of w.values()) {
        beds++;
        if (seen.has(e.buf)) continue; // a reused bed shares one AudioBuffer between worlds
        seen.add(e.buf);
        bytes += e.bytes;
      }
    const msPerBed: Record<string, number> = {};
    const notes: Record<string, string[]> = {};
    const cur = this.current ? this.worlds.get(this.current) : undefined;
    if (cur)
      for (const [k, e] of cur) {
        msPerBed[k] = e.ms;
        if (e.notes.length) notes[k] = e.notes;
      }
    return { bytes, beds, msPerBed, notes };
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    this.queue = [];
    this.inFlight = null;
    this.worlds.clear();
    this.admitted.clear();
    this.listeners.clear();
    this.current = null;
  }

  // ------------------------------------------------------------------------------------------------------------

  private evict(): void {
    while (this.worlds.size > K.CACHE_WORLDS) {
      const oldest = [...this.worlds.keys()].find((k) => k !== this.current);
      if (oldest === undefined) break;
      this.worlds.delete(oldest);
      this.admitted.delete(oldest);
      this.fallbackUsed.delete(oldest);
    }
  }

  private findReusable(worldKey: string, reuse: string): Entry | null {
    const preset = presetOf(worldKey);
    for (const [k, w] of [...this.worlds].reverse()) {
      if (k === worldKey || presetOf(k) !== preset) continue;
      for (const e of w.values()) if (e.reuse === reuse) return e;
    }
    return null;
  }

  private emit(ev: ReadyEvent): void {
    for (const cb of [...this.listeners]) cb(ev);
  }

  private getWorker(): WorkerLike | null {
    if (this.worker || this.workerFailed) return this.worker;
    const w = this.makeWorker();
    if (!w) {
      this.workerFailed = true;
      return null;
    }
    w.onmessage = (e) => this.onResponse(e.data);
    w.onerror = () => {
      this.workerFailed = true;
      this.worker?.terminate();
      this.worker = null;
      const lost = this.inFlight;
      this.inFlight = null;
      if (lost) this.queue.unshift(lost.item);
      this.pump();
    };
    this.worker = w;
    return w;
  }

  private pump(): void {
    if (this.disposed || this.inFlight || !this.queue.length) return;
    const item = this.queue.shift()!;
    const reqId = this.nextReq++;
    this.inFlight = { reqId, item };
    const msg: BakeRequest = { id: reqId, key: item.key, spec: item.spec, air: item.air };
    const w = this.getWorker();
    if (w) {
      w.postMessage(msg);
      return;
    }
    // Never blank: no worker, so bake on the main thread, but only the first bed(s) by priority (each takes ~0.2–1 s).
    const used = this.fallbackUsed.get(item.worldKey) ?? 0;
    if (used >= K.MAIN_FALLBACK_MAX_BEDS) {
      this.inFlight = null;
      const rest = [item, ...this.queue];
      this.queue = [];
      for (const it of rest) {
        if (it.worldKey === this.current) {
          this.refusals.push({
            source: it.spec.id,
            reason: bakeRefusalText(it.spec.id, NO_WORKER_TEXT),
          });
        }
      }
      return;
    }
    this.fallbackUsed.set(item.worldKey, used + 1);
    this.schedule(() => {
      if (this.disposed) return;
      const res = handleBakeRequest(msg);
      releaseBakeCaches(); // do not keep the FFT scratch (about 45 MB) on the main thread
      this.onResponse(res);
    });
  }

  private onResponse(res: BakeResponse): void {
    if (this.disposed) return;
    const fl = this.inFlight;
    if (!fl || fl.reqId !== res.id) return;
    this.inFlight = null;
    const item = fl.item;
    const world = this.worlds.get(item.worldKey); // undefined if evicted meanwhile: drop the result
    const bid = bedId(item.spec.id, item.spec.variant);
    const wanted = this.admitted.get(item.worldKey)?.get(bid) === item.key;
    if ('result' in res) {
      if (world && wanted) {
        const r = res.result;
        const buf = this.ctx.createBuffer(2, r.L.length, r.sampleRate);
        buf.copyToChannel(r.L as Float32Array<ArrayBuffer>, 0);
        buf.copyToChannel(r.R as Float32Array<ArrayBuffer>, 1);
        world.set(bid, {
          key: item.key,
          reuse: reuseKey(item.spec, item.air),
          buf,
          bytes: r.L.length * 8,
          ms: r.ms,
          notes: res.notes,
        });
        this.emit({ id: r.id, variant: r.variant, worldKey: item.worldKey });
      }
    } else if (item.worldKey === this.current) {
      this.refusals.push({
        source: item.spec.id,
        reason: bakeRefusalText(item.spec.id, res.error),
      });
    }
    this.pump();
  }
}

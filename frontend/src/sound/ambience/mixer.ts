// §10 live mixing (R13.8) and the §11.7 harmonic branch (R13.9): the ambience node graph and its per-tick application.
//
// Graph (coordinator rulings C1 to C3, #116):
//   per bed:   AudioBufferSource(loop) → lowpass → highshelf (snow) → bedGain → [StereoPanner] → worldGain → ambience bus
//              harmonic beds also: bedGain → harmGain → send → harmonic branch (→ ambience bus)
//   per event: AudioBufferSource → lowpass → gain → [StereoPanner] → worldGain (thunder also → harmGain)
// One group (worldGain + harmGain) per world. Fades and crossfades write ONLY the group gains; `apply()` writes ONLY bed
// params. Every automation is setTargetAtTime (no SetValueCurve), so no param ever mixes automation kinds (red H3).
// Sources are stopped by a wall-clock timer after 7 time constants (−61 dB), never by a tick (C1, C3).
// The mixer never applies the master or ambience volume: the bus level node already carries it (R13.9 as built).
import { createHarmonicBranch, dbToGain, type HarmonicBranch } from '../audioGraph';
import { airAt } from './air';
import { presentOffsetDb, stageGainDb } from './levels';
import {
  EVENT_MAX,
  FADE_S,
  FADE_TAU_DIVISOR,
  FILTER_TAU_S,
  GAIN_TAU_S,
  LP_F_MAX,
  LP_F_MIN,
  MIX_DEADBAND_DB,
  MIX_DEADBAND_HZ_FRAC,
  MIX_DEADBAND_PAN,
  MIX_DEADBAND_RATE,
  PAN_MAX,
  REBAKE_XFADE_S,
  SILENT_DB,
  SNOW_SHELF_HZ,
  STOP_MARGIN_S,
  THUNDER_MAX_DELAY_S,
} from './tuning';
import type { AirModel, BedLevel, MixFrame, SourceId, Strike } from './types';
import { thunderParams } from './weather';

/** What the mixer needs from the palette (palette.ts `Palette` satisfies it). */
export interface BufferSource {
  get(id: SourceId, variant: number): AudioBuffer | null;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface MixerOptions {
  /** Connect the harmonic beds to the §11.7 harmonic branch (default true). */
  harmonic?: boolean;
  /** Extra send into the harmonic branch, dB (the sound-check page tunes it; the app passes nothing: 0). */
  harmonicSendDb?: number;
  /** Wall-clock timers (default: the global setTimeout / clearTimeout, read at call time so fake timers work). */
  timers?: Timers;
}

export interface FireOptions {
  /** Now on the strike clock (Strike.t0's clock, s). */
  nowS: number;
  /** Listener height, km. */
  z_km: number;
  /** Listener heading, rad clockwise from north. */
  head: number;
}

interface Voice {
  key: string;
  buf: AudioBuffer;
  src: AudioBufferSourceNode;
  lp: BiquadFilterNode;
  shelf: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode | null;
  last: { gainDb: number; lp: number; shelf: number; pan: number; rate: number };
}

interface EventVoice {
  src: AudioBufferSourceNode;
  nodes: AudioNode[];
  start: number;
  ended: boolean;
}

interface Group {
  key: string;
  gain: GainNode;
  harm: GainNode;
  voices: Map<string, Voice>;
  events: EventVoice[];
  /** Voices replaced by a new buffer of the same bed; stopped with the group or by their own timer. */
  retired: Voice[];
  stopTimer: unknown;
  /** The group is fading to silence and will be torn down by its timer. */
  fading: boolean;
}

const defaultTimers: Timers = {
  set: (fn, ms) => globalThis.setTimeout(fn, ms),
  clear: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

const clampPan = (p: number) => Math.max(-PAN_MAX, Math.min(PAN_MAX, Number.isFinite(p) ? p : 0));
const clampHz = (f: number) => Math.max(LP_F_MIN, Math.min(LP_F_MAX, Number.isFinite(f) ? f : LP_F_MAX));
const linear = (db: number) => (db <= SILENT_DB + 1e-9 || !Number.isFinite(db) ? 0 : dbToGain(db));

/** §10 the ambience mixer. One per AudioContext. */
export class AmbienceMixer {
  private readonly ctx: BaseAudioContext;
  private readonly bus: AudioNode;
  private readonly timers: Timers;
  private readonly harmonicOn: boolean;
  private branch: HarmonicBranch | null = null;
  private send: GainNode | null = null;
  private sendDb: number;
  private readonly groups = new Map<string, Group>();
  private current: string | null = null;
  private disposed = false;

  constructor(ctx: BaseAudioContext, bus: AudioNode, opts: MixerOptions = {}) {
    this.ctx = ctx;
    this.bus = bus;
    this.timers = opts.timers ?? defaultTimers;
    this.harmonicOn = opts.harmonic !== false;
    this.sendDb = opts.harmonicSendDb ?? 0;
  }

  /** The current world key (null before the first `setWorld`). */
  get world(): string | null {
    return this.current;
  }

  /** True while the current world's group is playing (not fading, not torn down). */
  get playing(): boolean {
    const g = this.current ? this.groups.get(this.current) : undefined;
    return !!g && !g.fading;
  }

  /**
   * §9.6 / C5: a new world key fades the old world's group out at once (whatever the new world has, airless included)
   * and the new group in over REBAKE_XFADE_S as its beds arrive. The same key keeps the group; if that group is still
   * fading (a remount of the same world, or a quick A → B → A), it is faded back in, not left to fall silent (m3).
   */
  setWorld(key: string): void {
    if (this.disposed) return;
    if (key !== this.current) {
      const old = this.current ? this.groups.get(this.current) : undefined;
      if (old) this.fadeGroup(old, REBAKE_XFADE_S);
      this.current = key;
    }
    this.fadeIn(); // a no-op unless the group for `key` exists and is fading
  }

  /** §10 step 3: one tick's bed levels. Buffers come from `palette.get` every tick (C4), so cached beds play at once. */
  apply(frame: MixFrame, palette: BufferSource): void {
    if (this.disposed || !this.current) return;
    const g = this.group(this.current);
    if (g.fading) return; // a fading group is only revived by fadeIn (red M13)
    const now = this.ctx.currentTime;
    const seen = new Set<string>();
    for (const bed of frame.beds) {
      if (bed.id === 'thunder') continue;
      const key = `${bed.id}|${bed.variant}`;
      seen.add(key);
      const buf = palette.get(bed.id, bed.variant);
      let v = g.voices.get(key);
      if (!buf) {
        if (v) this.writeGain(v, SILENT_DB, now);
        continue;
      }
      if (v && v.buf !== buf) {
        this.retire(g, v, now);
        v = undefined;
      }
      if (!v) {
        v = this.makeVoice(g, key, buf, bed, now);
        g.voices.set(key, v);
      }
      this.write(v, frame.silent ? { ...bed, gainDb: SILENT_DB } : bed, now);
    }
    for (const [key, v] of g.voices) if (!seen.has(key)) this.writeGain(v, SILENT_DB, now);
  }

  /**
   * §8.4 one thunder clap for a strike, at t0 + d/c on the audio clock, through the current world's group (so every
   * fade reaches it). Returns false when it is not played (no group, not baked, too far, disposed, or the listener is
   * above the silence ceiling: §11.7 physical silence is never lifted, PR #124 review N1).
   * Gain: the stage window over the world offset, stageGainDb(level_dB, presentOffsetDb) (red M9).
   */
  fire(strike: Strike, air: AirModel, palette: BufferSource, o: FireOptions): boolean {
    if (this.disposed || !this.current) return false;
    const g = this.groups.get(this.current);
    if (!g || g.fading) return false;
    // §11.7: no air at the listener, no thunder. Explicit, so it never rests on THUNDER_MAX_DELAY_S (review N1).
    if (airAt(air, o.z_km).silent) return false;
    const buf = palette.get('thunder', strike.variant);
    if (!buf) return false;
    const tp = thunderParams(air, strike.d_m, o.z_km);
    if (!(tp.delay_s <= THUNDER_MAX_DELAY_S)) return false;
    const now = this.ctx.currentTime;
    const start = now + Math.max(0, strike.t0 - o.nowS) + tp.delay_s;
    // §10 node budget: at most EVENT_MAX live or pending; the oldest goes (with a short fade, then stop).
    g.events = g.events.filter((e) => !e.ended);
    while (g.events.length >= EVENT_MAX) this.dropEvent(g.events.shift()!, now);

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = clampHz(tp.lowpassHz);
    lp.Q.value = Math.SQRT1_2;
    const gain = this.ctx.createGain();
    gain.gain.value = linear(stageGainDb(tp.level_dB, presentOffsetDb(air)));
    const pan = this.panner();
    src.connect(lp);
    lp.connect(gain);
    const nodes: AudioNode[] = [src, lp, gain];
    if (pan) {
      pan.pan.value = clampPan(Math.sin(strike.bearing - o.head));
      gain.connect(pan);
      pan.connect(g.gain);
      nodes.push(pan);
    } else gain.connect(g.gain);
    if (this.harmonicOn) gain.connect(g.harm);
    const ev: EventVoice = { src, nodes, start, ended: false };
    src.onended = () => {
      ev.ended = true;
      for (const n of nodes) n.disconnect();
      g.events = g.events.filter((e) => e !== ev);
    };
    src.start(start);
    g.events.push(ev);
    return true;
  }

  /**
   * §13 Fading: every group goes to silence over `s` on the audio clock (τ = s/7, −61 dB at the end), pending events
   * are stopped now, and the sources are stopped and disconnected by a wall-clock timer (C1, C3). No tick needed.
   */
  fadeOut(s = FADE_S): void {
    if (this.disposed) return;
    for (const g of this.groups.values()) this.fadeGroup(g, s);
  }

  /** Back from Fading before the timer fired: ramp the same group up again; no new sources (red M13). */
  fadeIn(): void {
    if (this.disposed || !this.current) return;
    const g = this.groups.get(this.current);
    if (!g || !g.fading) return;
    this.timers.clear(g.stopTimer);
    g.stopTimer = null;
    g.fading = false;
    const now = this.ctx.currentTime;
    g.gain.gain.setTargetAtTime(1, now, GAIN_TAU_S);
    g.harm.gain.setTargetAtTime(1, now, GAIN_TAU_S);
  }

  /** The sound-check page's harmonic send, dB. */
  setHarmonicSendDb(db: number): void {
    this.sendDb = db;
    if (this.send) this.send.gain.setTargetAtTime(dbToGain(db), this.ctx.currentTime, GAIN_TAU_S);
  }

  /** Counts for tests, the dev overlay and the §14 node budget. */
  stats(): { groups: number; voices: number; events: number; nodes: number } {
    let voices = 0,
      events = 0,
      nodes = this.branch ? 1 : 0;
    for (const g of this.groups.values()) {
      const vs = [...g.voices.values(), ...g.retired];
      voices += vs.length;
      const live = g.events.filter((e) => !e.ended);
      events += live.length;
      nodes += 2 + vs.reduce((n, v) => n + (v.pan ? 5 : 4), 0) + live.reduce((n, e) => n + e.nodes.length, 0);
    }
    return { groups: this.groups.size, voices, events, nodes };
  }

  /** Stop everything now and release every node. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const g of [...this.groups.values()]) this.teardown(g);
    this.groups.clear();
    this.branch?.dispose();
    this.branch = null;
    this.send?.disconnect();
    this.send = null;
    this.current = null;
  }

  // ------------------------------------------------------------------------------------------------------------

  private group(key: string): Group {
    let g = this.groups.get(key);
    if (g) return g;
    const now = this.ctx.currentTime;
    // A crossfade in (another group is still sounding) uses the re-bake time; a first start the gain time constant.
    const tau = this.groups.size > 0 ? REBAKE_XFADE_S / FADE_TAU_DIVISOR : GAIN_TAU_S;
    const gain = this.ctx.createGain();
    const harm = this.ctx.createGain();
    for (const p of [gain.gain, harm.gain]) {
      p.setValueAtTime(0, now); // a real GainNode starts at 1: never pop (red M15)
      p.setTargetAtTime(1, now, tau);
    }
    gain.connect(this.bus);
    const send = this.harmonicSend();
    if (send) harm.connect(send);
    g = { key, gain, harm, voices: new Map(), events: [], retired: [], stopTimer: null, fading: false };
    this.groups.set(key, g);
    return g;
  }

  private harmonicSend(): GainNode | null {
    if (!this.harmonicOn) return null;
    if (!this.branch) {
      this.branch = createHarmonicBranch(this.ctx);
      if (!this.branch) return null;
      this.send = this.ctx.createGain();
      this.send.gain.value = dbToGain(this.sendDb);
      this.send.connect(this.branch.input);
    }
    return this.send;
  }

  private panner(): StereoPannerNode | null {
    const c = this.ctx as BaseAudioContext & { createStereoPanner?: () => StereoPannerNode };
    return typeof c.createStereoPanner === 'function' ? c.createStereoPanner() : null;
  }

  private makeVoice(g: Group, key: string, buf: AudioBuffer, bed: BedLevel, now: number): Voice {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = bed.playbackRate;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = Math.SQRT1_2;
    lp.frequency.value = clampHz(bed.lowpassHz);
    const shelf = this.ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = SNOW_SHELF_HZ;
    shelf.gain.value = bed.shelfDb;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now); // fade in from silence (red M15)
    const pan = this.panner();
    src.connect(lp);
    lp.connect(shelf);
    shelf.connect(gain);
    if (pan) {
      pan.pan.value = clampPan(bed.pan);
      gain.connect(pan);
      pan.connect(g.gain);
    } else gain.connect(g.gain);
    if (bed.harmonic && this.harmonicOn) gain.connect(g.harm);
    src.start(now);
    return {
      key,
      buf,
      src,
      lp,
      shelf,
      gain,
      pan,
      // Filters and pan start at their targets; the gain starts silent so the first write always ramps it in.
      last: { gainDb: SILENT_DB, lp: clampHz(bed.lowpassHz), shelf: bed.shelfDb, pan: clampPan(bed.pan), rate: bed.playbackRate },
    };
  }

  private write(v: Voice, bed: BedLevel, now: number): void {
    this.writeGain(v, bed.gainDb, now);
    const lp = clampHz(bed.lowpassHz);
    if (Math.abs(lp - v.last.lp) > MIX_DEADBAND_HZ_FRAC * v.last.lp) {
      v.lp.frequency.setTargetAtTime(lp, now, FILTER_TAU_S);
      v.last.lp = lp;
    }
    if (Math.abs(bed.shelfDb - v.last.shelf) > MIX_DEADBAND_DB) {
      v.shelf.gain.setTargetAtTime(bed.shelfDb, now, FILTER_TAU_S);
      v.last.shelf = bed.shelfDb;
    }
    const pan = clampPan(bed.pan);
    if (v.pan && Math.abs(pan - v.last.pan) > MIX_DEADBAND_PAN) {
      v.pan.pan.setTargetAtTime(pan, now, GAIN_TAU_S);
      v.last.pan = pan;
    }
    if (Math.abs(bed.playbackRate - v.last.rate) > MIX_DEADBAND_RATE * v.last.rate) {
      v.src.playbackRate.setTargetAtTime(bed.playbackRate, now, GAIN_TAU_S);
      v.last.rate = bed.playbackRate;
    }
  }

  private writeGain(v: Voice, gainDb: number, now: number): void {
    const was = v.last.gainDb <= SILENT_DB;
    const is = gainDb <= SILENT_DB || !Number.isFinite(gainDb);
    if (was && is) return;
    if (!was && !is && Math.abs(gainDb - v.last.gainDb) <= MIX_DEADBAND_DB) return;
    v.gain.gain.setTargetAtTime(linear(gainDb), now, GAIN_TAU_S);
    v.last.gainDb = is ? SILENT_DB : gainDb;
  }

  private retire(g: Group, v: Voice, now: number): void {
    g.voices.delete(v.key);
    v.gain.gain.setTargetAtTime(0, now, REBAKE_XFADE_S / FADE_TAU_DIVISOR);
    g.retired.push(v);
    this.timers.set(() => {
      this.stopVoice(v);
      g.retired = g.retired.filter((r) => r !== v);
    }, (REBAKE_XFADE_S + STOP_MARGIN_S) * 1000);
  }

  private fadeGroup(g: Group, s: number): void {
    const now = this.ctx.currentTime;
    // Pending events (thunder still on its way) are cancelled at once (red M10).
    for (const e of g.events) if (!e.ended && e.start > now) this.dropEvent(e, now, true);
    if (!g.fading) {
      g.fading = true;
      const tau = s / FADE_TAU_DIVISOR;
      g.gain.gain.setTargetAtTime(0, now, tau);
      g.harm.gain.setTargetAtTime(0, now, tau);
    }
    if (g.stopTimer !== null) this.timers.clear(g.stopTimer);
    g.stopTimer = this.timers.set(() => {
      g.stopTimer = null;
      this.teardown(g);
      this.groups.delete(g.key);
    }, (s + STOP_MARGIN_S) * 1000);
  }

  private dropEvent(e: EventVoice, now: number, pending = false): void {
    e.ended = true;
    try {
      e.src.stop(pending ? 0 : now + STOP_MARGIN_S);
    } catch {
      // never started or already stopped
    }
    if (pending) for (const n of e.nodes) n.disconnect();
  }

  private stopVoice(v: Voice): void {
    try {
      v.src.stop();
    } catch {
      // already stopped
    }
    for (const n of [v.src, v.lp, v.shelf, v.gain, v.pan]) n?.disconnect();
  }

  private teardown(g: Group): void {
    if (g.stopTimer !== null) this.timers.clear(g.stopTimer);
    g.stopTimer = null;
    for (const v of [...g.voices.values(), ...g.retired]) this.stopVoice(v);
    for (const e of g.events) {
      try {
        e.src.stop();
      } catch {
        // already stopped
      }
      for (const n of e.nodes) n.disconnect();
    }
    g.voices.clear();
    g.retired = [];
    g.events = [];
    g.gain.disconnect();
    g.harm.disconnect();
  }
}

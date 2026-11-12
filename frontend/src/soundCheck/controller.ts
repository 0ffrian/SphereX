// R13.9 sound check: the audio side of the page. It uses the app's own chain end to end: Palette (worker bake) →
// AmbienceMixer → getBus('ambience') → 35 Hz HPF → duck → level → master → limiter, so what is tuned by ear here is
// exactly what plays in the fly view. Dev only (never in dist/: scripts/check-dist.js).
import {
  dbToGain,
  getBus,
  getMasterBus,
  holdDuck,
  refreshAmbienceLevel,
  setAmbienceLevelSource,
  sharedNodes,
} from '@/sound/audioGraph';
import { getAudioContext, unlockAudio } from '@/sound/audioContext';
import { AmbienceMixer } from '@/sound/ambience/mixer';
import { mixFrame, bedKey } from '@/sound/ambience/levels';
import { Palette, worldKeyOf } from '@/sound/ambience/palette';
import { isOneShot } from '@/sound/ambience/dsp';
import { selectBeds } from '@/sound/ambience/sources';
import { lightningRule } from '@/sound/ambience/weather';
import { THUNDER_VARIANT_D_M } from '@/sound/ambience/tuning';
import type { BedSpec, MixFrame, Refusal } from '@/sound/ambience/types';
import { HIGH_OUTPUT_LATENCY_S } from '@/sound/tuning';
import { clips, peakDb, PeakHold, rmsDb } from './meter';
import { playlist, type Step } from './playlist';
import { tuneFrame, type TuneState } from './tune';
import type { CheckWorld } from './worlds';
import './marker';

export interface MeterReading {
  rms: number;
  peak: number;
  hold: number;
  clips: number;
  /** "limiter out" or "master in (pre-limiter)". */
  tap: string;
}

export interface CheckStatus {
  started: boolean;
  sampleRate: number | null;
  outputLatency: number | null;
  baseLatency: number | null;
  bluetooth: boolean;
  world: string | null;
  specs: BedSpec[];
  ready: string[];
  refusals: Refusal[];
  frame: MixFrame | null;
  bakeMs: Record<string, number>;
  step: string | null;
}

const LEVEL = { ambience: 1 };

export class SoundCheckController {
  ctx: AudioContext | null = null;
  private mixer: AmbienceMixer | null = null;
  private palette: Palette | null = null;
  private analyser: AnalyserNode | null = null;
  private tap = 'none';
  private readonly hold = new PeakHold(1);
  private clipCount = 0;
  private world: CheckWorld | null = null;
  private specs = new Map<string, BedSpec>();
  private refusals: Refusal[] = [];
  private tick: ReturnType<typeof setInterval> | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private tones: AudioScheduledSourceNode[] = [];
  private stepLabel: string | null = null;
  private lastFrame: MixFrame | null = null;
  tune: TuneState;
  private readonly onChange: () => void;

  constructor(tune: TuneState, onChange: () => void) {
    this.tune = tune;
    this.onChange = onChange;
  }

  /** Call from a click (Q-73). */
  async start(): Promise<boolean> {
    const ok = await unlockAudio();
    const ctx = getAudioContext();
    if (!ok || !ctx) return false;
    this.ctx = ctx;
    // The page has no AppSound: register the ambience level itself (presentation level, volume 1).
    setAmbienceLevelSource(() => LEVEL.ambience);
    refreshAmbienceLevel(ctx);
    this.mixer = new AmbienceMixer(ctx, getBus(ctx, 'ambience'), {
      harmonic: this.tune.harmonicOn,
      harmonicSendDb: this.tune.harmonicSendDb,
    });
    this.palette = new Palette(ctx);
    this.palette.onReady(() => this.onChange());
    // Meter: fan an analyser out of the limiter (no re-routing of the shared graph, blue 25).
    const lim = sharedNodes(ctx).find(
      (n) => typeof DynamicsCompressorNode !== 'undefined' && n instanceof DynamicsCompressorNode,
    );
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    (lim ?? getMasterBus(ctx)).connect(this.analyser);
    this.tap = lim ? 'limiter out' : 'master in (pre-limiter)';
    this.tick = setInterval(() => this.applyNow(), 100);
    this.onChange();
    return true;
  }

  status(): CheckStatus {
    const ctx = this.ctx as (AudioContext & { outputLatency?: number }) | null;
    const ready = [...this.specs.values()]
      .filter((s) => this.palette?.get(s.id, s.variant))
      .map((s) => bedKey(s.id, s.variant));
    const lat = ctx?.outputLatency ?? null;
    return {
      started: !!ctx,
      sampleRate: ctx?.sampleRate ?? null,
      outputLatency: lat,
      baseLatency: ctx?.baseLatency ?? null,
      bluetooth: lat !== null && lat > HIGH_OUTPUT_LATENCY_S,
      world: this.world?.label ?? null,
      specs: [...this.specs.values()],
      ready,
      refusals: [...this.refusals, ...(this.palette?.unavailable() ?? [])],
      frame: this.lastFrame,
      bakeMs: this.palette?.stats().msPerBed ?? {},
      step: this.stepLabel,
    };
  }

  meter(nowS: number): MeterReading | null {
    if (!this.analyser) return null;
    const block = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(block);
    const peak = peakDb(block);
    this.clipCount += clips(block);
    return { rms: rmsDb(block), peak, hold: this.hold.update(peak, nowS), clips: this.clipCount, tap: this.tap };
  }

  /** Bake the world's beds (the palette is the app's: worker, priority, budgets). */
  load(w: CheckWorld): void {
    if (!this.palette || !this.mixer) return;
    this.stopAll();
    this.world = w;
    const sel = selectBeds(w.air, w.place);
    this.specs = new Map(sel.beds.map((s) => [bedKey(s.id, s.variant), s]));
    this.refusals = sel.refusals;
    this.palette.request(sel.beds, w.air);
    this.mixer.setWorld(worldKeyOf(w.air) + '|' + w.id);
    this.onChange();
  }

  private baked(): Set<string> {
    const out = new Set<string>();
    for (const [k, s] of this.specs) if (!isOneShot(s.id, s.variant) && this.palette?.get(s.id, s.variant)) out.add(k);
    return out;
  }

  /** The tuned frame the mixer applies (also used for the table). */
  frame(): MixFrame | null {
    const w = this.world;
    if (!w) return null;
    const raw = mixFrame(w.air, w.place, this.baked(), undefined, this.specs);
    this.lastFrame = raw;
    return tuneFrame(raw, w.air, w.place.features.z_km, this.tune);
  }

  private applyNow(): void {
    if (!this.mixer || !this.palette || !this.world || !this.playingBeds) return;
    const f = this.frame();
    if (f) this.mixer.apply(f, this.palette);
  }

  private playingBeds = false;

  /** "Play full mix": every present bed at its tuned presentation level. */
  playMix(): void {
    this.stopAll();
    this.mixer?.fadeIn();
    this.tune = { ...this.tune, solo: null };
    this.playingBeds = true;
    this.stepLabel = 'Full mix';
    this.applyNow();
    this.onChange();
  }

  /** The §11.7 sequence: each bed 5 s, thunder, then the data sound. */
  playSequence(chord: boolean): void {
    const w = this.world;
    if (!w || !this.ctx) return;
    this.stopAll();
    const rule = lightningRule(w.air, w.air.presetId);
    const thunderVariants = [...this.specs.values()]
      .filter((s) => s.id === 'thunder' && this.palette?.get('thunder', s.variant))
      .map((s) => s.variant);
    const raw = mixFrame(w.air, w.place, this.baked(), undefined, this.specs);
    const steps = playlist({ beds: raw.beds, baked: this.baked(), lightning: rule, thunderVariants, chord });
    let at = 0;
    for (const s of steps) {
      this.timers.push(setTimeout(() => this.runStep(s), at * 1000));
      at += s.seconds;
    }
    this.timers.push(
      setTimeout(() => {
        this.stopAll();
        this.stepLabel = 'Done';
        this.onChange();
      }, at * 1000),
    );
  }

  private runStep(s: Step): void {
    const w = this.world;
    if (!w || !this.ctx || !this.mixer || !this.palette) return;
    this.stepLabel = s.label;
    if (s.kind === 'bed') {
      this.tune = { ...this.tune, solo: `${s.id}|${s.variant}` };
      this.mixer.fadeIn();
      this.playingBeds = true;
      this.applyNow();
    } else {
      this.tune = { ...this.tune, solo: '__none__' };
      this.applyNow();
      if (s.kind === 'thunder') {
        const now = this.ctx.currentTime;
        s.variants.forEach((v, i) => {
          const d = THUNDER_VARIANT_D_M[v] ?? 1000;
          const ok = this.mixer!.fire(
            { t0: now, d_m: d, bearing: i % 2 ? -Math.PI / 3 : Math.PI / 3, seed: v, variant: v, flash: false },
            w.air,
            this.palette!,
            { nowS: now, z_km: w.place.features.z_km, head: 0 },
          );
          if (!ok) this.stepLabel = `${s.label}: variant ${v} skipped (too far or not baked)`;
        });
      } else if (s.kind === 'data') this.dataChord(s.seconds);
    }
    this.onChange();
  }

  /** Data-sound stand-in: a three-note chord on the spectrum bus at about −18 dBFS, holding the ambience duck. */
  private dataChord(seconds: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const duck = holdDuck(ctx, seconds + 1);
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, now);
    out.gain.setTargetAtTime(dbToGain(-18 - 4.8), now, 0.02);
    out.gain.setTargetAtTime(0, now + seconds - 0.3, 0.05);
    out.connect(getBus(ctx, 'spectrum'));
    for (const f of [220, 277.18, 329.63]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(out);
      o.start(now);
      o.stop(now + seconds);
      this.tones.push(o);
    }
    this.timers.push(setTimeout(() => duck.release(), seconds * 1000));
  }

  /** Reference tones on the ambience bus (blue 28): 1 kHz sine at −20 dBFS, pink noise, or a Left/Right ident. */
  tone(kind: 'sine' | 'pink' | 'lr'): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.stopAll();
    const bus = getBus(ctx, 'ambience');
    const now = ctx.currentTime;
    if (kind === 'sine') {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      g.gain.value = dbToGain(-20);
      o.frequency.value = 1000;
      o.connect(g).connect(bus);
      o.start(now);
      o.stop(now + 5);
      this.tones.push(o);
      this.stepLabel = '1 kHz sine, −20 dBFS peak (through the ambience chain)';
    } else if (kind === 'pink') {
      const n = Math.round(ctx.sampleRate * 5);
      const b = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = b.getChannelData(0);
      // Paul Kellet's pink filter, seeded LCG (deterministic), normalised to −24 dBFS RMS (≈ the −24 LUFS bed target).
      let s = 12345,
        b0 = 0,
        b1 = 0,
        b2 = 0,
        b3 = 0,
        b4 = 0,
        b5 = 0,
        b6 = 0,
        sum = 0;
      for (let i = 0; i < n; i++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        const w = s / 2147483648 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        const v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
        d[i] = v;
        sum += v * v;
      }
      const k = dbToGain(-24) / Math.sqrt(sum / n);
      for (let i = 0; i < n; i++) d[i] = (d[i] as number) * k;
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.connect(bus);
      src.start(now);
      this.tones.push(src);
      this.stepLabel = 'Pink noise, −24 dBFS RMS (≈ the bed target)';
    } else {
      [-0.8, 0.8].forEach((p, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const pan = ctx.createStereoPanner();
        pan.pan.value = p;
        g.gain.value = dbToGain(-20);
        o.frequency.value = 440;
        o.connect(g).connect(pan).connect(bus);
        o.start(now + i * 0.8);
        o.stop(now + i * 0.8 + 0.5);
        this.tones.push(o);
      });
      this.stepLabel = 'Left, then right (pan ±0.8)';
    }
    this.onChange();
  }

  setTune(t: TuneState): void {
    const harmonicChanged = t.harmonicOn !== this.tune.harmonicOn;
    this.tune = t;
    this.mixer?.setHarmonicSendDb(t.harmonicOn ? t.harmonicSendDb : -120);
    if (harmonicChanged) this.onChange();
    this.applyNow();
  }

  /** Panic: everything stops within 0.1 s (Escape too). */
  stopAll(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    for (const t of this.tones) {
      try {
        t.stop();
      } catch {
        // already stopped
      }
    }
    this.tones = [];
    this.playingBeds = false;
    this.mixer?.fadeOut(0.1);
    this.stepLabel = null;
  }

  dispose(): void {
    this.stopAll();
    if (this.tick) clearInterval(this.tick);
    this.mixer?.dispose();
    this.palette?.dispose();
  }
}

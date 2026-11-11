// "Hear it" synthesis (approved preview, panels-preview.html). Own AudioContext, a master gain at 0.9 (no
// global sound control exists in the app, Q-132) and an analyser the panel's waveform canvases read.
import { cutoffHz, freqAt, howlHz, loudness, SPEC_POINTS, SPEC_SECONDS, type AtmosphereModel } from './hearModel';

export const MASTER_GAIN = 0.9;

interface Bus {
  ctx: AudioContext;
  master: GainNode;
  analyser: AnalyserNode;
}
let bus: Bus | null = null;

function getBus(): Bus | null {
  if (bus) {
    if (bus.ctx.state === 'suspended') void bus.ctx.resume();
    return bus;
  }
  const Ctor: typeof AudioContext | undefined =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctor) return null;
  try {
    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    master.connect(analyser);
    analyser.connect(ctx.destination);
    bus = { ctx, master, analyser };
    if (ctx.state === 'suspended') void ctx.resume();
    return bus;
  } catch {
    return null;
  }
}

/** Fills `out` with the current waveform (-1..1); false when nothing is available. */
export function readWave(out: Float32Array<ArrayBuffer>): boolean {
  if (!bus || out.length !== bus.analyser.fftSize) return false;
  bus.analyser.getFloatTimeDomainData(out);
  return true;
}
export function waveSize(): number {
  return bus?.analyser.fftSize ?? 2048;
}
export function audioNow(): number {
  return bus?.ctx.currentTime ?? 0;
}

/** Seeded so the same sound is made every time (mulberry32). */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const len = ctx.sampleRate * 4;
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = 0x9e3779b9;
  let last = 0;
  for (let i = 0; i < len; i++) {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const wv = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
    last = (last + 0.02 * wv) / 1.02;
    d[i] = last * 3.5;
  }
  return b;
}

/** What the wind sounds like right now: pressure (bar), sound speed (m/s), wind level 0..1. */
export interface AtmosphereParams {
  P: number;
  c: number;
  s: number;
}
export interface AtmosphereHandle {
  stop(): void;
  /** Gust modulation; call every frame with a time in ms and the (already smoothed) parameters. */
  tick(tMs: number, p: AtmosphereParams): void;
}

/** Brown noise through a low-pass set by pressure; gusts by the wind level; a faint howl tied to the sound speed. */
export function startAtmosphere(m: AtmosphereModel): AtmosphereHandle | null {
  const b = getBus();
  if (!b) return null;
  const { ctx, master } = b;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = cutoffHz(m.P);
  lp.Q.value = 0.5;
  const gust = ctx.createGain();
  gust.gain.value = 0;
  const src2 = ctx.createBufferSource();
  src2.buffer = src.buffer;
  src2.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 14;
  bp.frequency.value = howlHz(m.c);
  const hg = ctx.createGain();
  hg.gain.value = 0;
  src.connect(lp);
  lp.connect(gust);
  gust.connect(master);
  src2.connect(bp);
  bp.connect(hg);
  hg.connect(master);
  src.start();
  src2.start(ctx.currentTime + 1.3);
  let alive = true;
  return {
    tick: (t, p) => {
      if (!alive) return;
      const { P, c, s } = p;
      let g = 0.5 + 0.5 * Math.sin(t * 0.0007 * (0.6 + s)) * Math.sin(t * 0.00031 + 1.3) + 0.25 * Math.sin(t * 0.0021 * s);
      g = Math.max(0.05, Math.min(1, 0.25 + g * s));
      const base = loudness(P) * (0.25 + 0.75 * s);
      const now = ctx.currentTime;
      gust.gain.setTargetAtTime(base * g, now, 0.12);
      lp.frequency.setTargetAtTime(cutoffHz(P) * (0.55 + 0.45 * g), now, 0.2);
      bp.frequency.setTargetAtTime(howlHz(c) * (0.8 + 0.6 * g * s), now, 0.3);
      hg.gain.setTargetAtTime(0.18 * s * s * g * loudness(P), now, 0.25);
    },
    stop: () => {
      if (!alive) return;
      alive = false;
      try {
        src.stop();
        src2.stop();
      } catch {
        /* already stopped */
      }
      src.disconnect();
      src2.disconnect();
      gust.disconnect();
      hg.disconnect();
    },
  };
}

export interface SpectrumHandle {
  stop(): void;
  /** Position 0..1 now (from the audio clock), and whether the sweep has finished. */
  position(): { pos: number; done: boolean };
}

/** Triangle plus a quieter sine octave sweeping 880 to 110 Hz over the rest of SPEC_SECONDS; gain from flux. */
export function startSpectrum(values: readonly (number | null)[], from: number): SpectrumHandle | null {
  const b = getBus();
  if (!b) return null;
  const { ctx, master } = b;
  let pos = from;
  let rest = (1 - pos) * SPEC_SECONDS;
  if (rest < 0.05) {
    pos = 0;
    rest = SPEC_SECONDS;
  }
  const now = ctx.currentTime + 0.03;
  const steps = Math.max(8, Math.round(rest * 60));
  const fr = new Float32Array(steps);
  const fr2 = new Float32Array(steps);
  const gn = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const p = pos + ((1 - pos) * i) / (steps - 1);
    const k = Math.min(SPEC_POINTS - 1, Math.round(p * (SPEC_POINTS - 1)));
    fr[i] = freqAt(p);
    fr2[i] = fr[i]! * 2;
    gn[i] = 0.02 + 0.22 * (values[k] ?? 0);
  }
  const o1 = ctx.createOscillator();
  const o2 = ctx.createOscillator();
  const g = ctx.createGain();
  const g2 = ctx.createGain();
  o1.type = 'triangle';
  o2.type = 'sine';
  g2.gain.value = 0.35;
  o1.connect(g);
  o2.connect(g2);
  g2.connect(g);
  g.connect(master);
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(gn[0]!, now + 0.05);
  o1.frequency.setValueCurveAtTime(fr, now, rest);
  o2.frequency.setValueCurveAtTime(fr2, now, rest);
  g.gain.setValueCurveAtTime(gn, now + 0.06, rest - 0.06 > 0.05 ? rest - 0.06 : 0.05);
  o1.start(now);
  o2.start(now);
  o1.stop(now + rest + 0.05);
  o2.stop(now + rest + 0.05);
  let alive = true;
  return {
    position: () => {
      const e = (ctx.currentTime - now) / rest;
      const p = Math.min(1, pos + (1 - pos) * Math.max(0, e));
      return { pos: p, done: p >= 1 };
    },
    stop: () => {
      if (!alive) return;
      alive = false;
      try {
        o1.stop();
        o2.stop();
      } catch {
        /* already stopped */
      }
      o1.disconnect();
      o2.disconnect();
      g.disconnect();
    },
  };
}

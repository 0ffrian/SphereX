// "Hear it" synthesis (approved preview, panels-preview.html). An analyser the panel's waveform
// canvases read, on the app's shared sound engine (#111, R13.9, Q-442): the shared AudioContext
// (sound/audioContext, unlocked inside the click that starts a sound, Q-73), the `spectrum` bus
// into the one limiter, and the Sound settings: Sound off silences it, Volume scales it. While the
// spectrum sweep plays it ducks the flyover ambience like every data sound.
import { getAudioContext, unlockAudio } from '@/sound/audioContext';
import { getBus as getSoundBus, holdDuck, type DuckHold } from '@/sound/audioGraph';
import { getSoundSettings, useSoundSettings, type SoundSettingsValues } from '@/sound/settings';
import { claimSpectrumSound, type SpectrumClaim } from '@/sound/spectrumExclusive';
import { DUCK_SAFETY_S } from '@/sound/tuning';
import { cutoffHz, freqAt, howlHz, loudness, SPEC_POINTS, SPEC_SECONDS, type AtmosphereModel } from './hearModel';

export const MASTER_GAIN = 0.9;

/** The panel's output gain for these settings: 0 when sound is off, else MASTER_GAIN × volume. */
export function hearGain(s: Pick<SoundSettingsValues, 'soundOn' | 'volume'>): number {
  if (!s.soundOn) return 0;
  const v = Number.isFinite(s.volume) ? Math.min(1, Math.max(0, s.volume)) : 0;
  return MASTER_GAIN * v;
}

interface Bus {
  ctx: AudioContext;
  master: GainNode;
  analyser: AnalyserNode;
  unsubscribe(): void;
}
let bus: Bus | null = null;

/** The panel's nodes on the shared context. Call from a click: it unlocks audio first (Q-73). */
function getBus(): Bus | null {
  void unlockAudio(); // creates or resumes the shared context synchronously inside the gesture
  const ctx = getAudioContext();
  if (!ctx) return null;
  if (bus && bus.ctx === ctx) return bus;
  bus?.unsubscribe();
  try {
    const master = ctx.createGain();
    master.gain.value = hearGain(getSoundSettings());
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    master.connect(analyser);
    analyser.connect(getSoundBus(ctx, 'spectrum'));
    // Follow the switch and the volume live (a slider drag: short glide, no piled-up events).
    const unsubscribe = useSoundSettings.subscribe((st) => {
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(hearGain(st), t, 0.02);
    });
    bus = { ctx, master, analyser, unsubscribe };
    return bus;
  } catch {
    return null;
  }
}

/** Tests: forget the panel's nodes (the next sound builds them on the current context). */
export function resetHearAudioForTests(): void {
  bus?.unsubscribe();
  bus = null;
  liveSpectrum = null;
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
/** The spectrum sweep that is sounding, if any: starting the wind ends it (one sound at a time). */
let liveSpectrum: SpectrumHandle | null = null;

export function startAtmosphere(m: AtmosphereModel): AtmosphereHandle | null {
  const b = getBus();
  if (!b) return null;
  liveSpectrum?.stop();
  liveSpectrum = null;
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

/**
 * Triangle plus a quieter sine an octave up (timbre only), the pitch from `pitch.ts` (Q-446: 1158 Hz at
 * 0.75 µm down to 220 Hz at 5 µm, as the chord and the Listen sweep), over the rest of SPEC_SECONDS;
 * gain from flux. It takes the one spectrum-sound slot (Q-446): the chord or the Listen sweep stops.
 */
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
  // Q-446: one spectrum sound at a time; the chord or the Listen sweep stops before this starts.
  let claim: SpectrumClaim | null = null;
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
  let stoppedAt: number | null = null;
  // R13.9: a data sound ducks the ambience until it ends or is stopped (safety: its length + 1 s).
  let duck: DuckHold | null = holdDuck(ctx, 0.03 + rest + 0.05 + DUCK_SAFETY_S);
  const letGo = () => {
    duck?.release();
    duck = null;
    claim?.release();
    claim = null;
  };
  o1.onended = letGo;
  const handle: SpectrumHandle = {
    position: () => {
      const e = ((stoppedAt ?? ctx.currentTime) - now) / rest;
      const p = Math.min(1, pos + (1 - pos) * Math.max(0, e));
      // Stopped from outside (the wind started): report done so the panel's play state ends.
      return { pos: p, done: p >= 1 || !alive };
    },
    stop: () => {
      if (!alive) return;
      alive = false;
      stoppedAt = ctx.currentTime;
      letGo();
      if (liveSpectrum === handle) liveSpectrum = null;
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
  liveSpectrum = handle;
  claim = claimSpectrumSound(() => handle.stop());
  return handle;
}

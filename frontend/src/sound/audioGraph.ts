// R8.9, D-10: the shared audio output. Every sound of the app (the haptics audio driver, the
// Listen sweep, the imagined drive) goes through one master bus per AudioContext: a gain into a
// single limiter into the destination, so sounds from different modules cannot add up past it.
// Plus the bell (`chime`) synthesis, shared by the audio driver and the Listen sweep.
// Nothing here runs at import time; the bus is made on first use for each context.
import {
  CHIME_DECAY_S,
  CHIME_PARTIAL_GAIN,
  CHIME_PARTIAL_RATIO,
  LIMITER_ATTACK_S,
  LIMITER_RATIO,
  LIMITER_RELEASE_S,
  LIMITER_THRESHOLD_DB,
  TONE_ATTACK_S,
} from './tuning';

const buses = new WeakMap<BaseAudioContext, AudioNode>();

/**
 * The one master bus of `ctx`: connect a module's own output (after its volume) to it. Made once
 * per context: gain → DynamicsCompressorNode limiter → destination, or gain → destination where
 * there is no compressor.
 */
export function getMasterBus(ctx: BaseAudioContext): AudioNode {
  const existing = buses.get(ctx);
  if (existing) return existing;
  const bus = ctx.createGain();
  if (typeof ctx.createDynamicsCompressor === 'function') {
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = LIMITER_THRESHOLD_DB;
    lim.knee.value = 0;
    lim.ratio.value = LIMITER_RATIO;
    lim.attack.value = LIMITER_ATTACK_S;
    lim.release.value = LIMITER_RELEASE_S;
    bus.connect(lim);
    lim.connect(ctx.destination);
  } else {
    bus.connect(ctx.destination);
  }
  buses.set(ctx, bus);
  return bus;
}

export interface BellOptions {
  freqHz: number;
  /** Start time on the context clock (s). */
  when: number;
  /** Peak gain. */
  gain: number;
  /** Default TONE_ATTACK_S. */
  attackS?: number;
  /** Default CHIME_DECAY_S. */
  decayS?: number;
  /** Second partial: frequency ratio and gain. Defaults CHIME_PARTIAL_RATIO, CHIME_PARTIAL_GAIN. */
  partialRatio?: number;
  partialGain?: number;
}

/** The nodes of one scheduled bell. Stop and disconnect them to cancel it; `end` is when it is silent. */
export interface ScheduledSound {
  readonly sources: AudioScheduledSourceNode[];
  readonly nodes: AudioNode[];
  readonly end: number;
}

/**
 * Schedule a bell into `dest`: two sine partials (f and ratio·f) under one envelope with a short
 * attack and an exponential decay. The sources are started and stopped here; the caller keeps the
 * returned nodes to cancel the bell or to disconnect them when it ends (`sources[0].onended`).
 */
export function playBell(ctx: BaseAudioContext, dest: AudioNode, o: BellOptions): ScheduledSound {
  const attack = o.attackS ?? TONE_ATTACK_S;
  const end = o.when + (o.decayS ?? CHIME_DECAY_S);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, o.when);
  env.gain.linearRampToValueAtTime(Math.max(o.gain, 0.0002), o.when + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  env.connect(dest);
  const o1 = ctx.createOscillator();
  o1.frequency.value = o.freqHz;
  o1.connect(env);
  const o2 = ctx.createOscillator();
  o2.frequency.value = o.freqHz * (o.partialRatio ?? CHIME_PARTIAL_RATIO);
  const g2 = ctx.createGain();
  g2.gain.value = o.partialGain ?? CHIME_PARTIAL_GAIN;
  o2.connect(g2);
  g2.connect(env);
  for (const s of [o1, o2]) {
    s.start(o.when);
    s.stop(end + 0.01);
  }
  return { sources: [o1, o2], nodes: [env, g2], end };
}

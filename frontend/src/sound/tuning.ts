// Every sound tuning constant, for the engine, the audio driver and the Listen sweep, in one file
// (D-13). The haptic constants went with D-39. These are display and perceptual scales, never
// physical values: a missing *data* reference refuses the sound and lists it in `missing` instead of
// falling back to a constant here.
//
// Markers:
//   SPEC                         the value is written in the spec section named next to it
//   [verify on the A15]          to be checked by ear on the A15 laptop (R12 item)
//   CREATIVE placeholder — Atish to decide (D-13)   a neutral stand-in; how it sounds is Atish's call

// ---------------------------------------------------------------- engine (R8.3, R8.8)
// DUCK_TAU_DIVISOR (below, R13.9) is also the tone stream's fade divisor.

/** SPEC R8.3: at most 40 events in any 1 s window; extra events are dropped, never queued. */
export const MAX_EVENTS_PER_SECOND = 40;
/** SPEC R8.3, R8.8: at least 25 ms between ticks (also applied to double and heartbeat). */
export const MIN_TICK_INTERVAL_MS = 25;
/** SPEC R8.3: pulse trains are issued as patterns covering 250 ms windows. */
export const TRAIN_WINDOW_MS = 250;
/**
 * Engineering: the train scheduler wakes up to this long before a window's first pulse, so timer
 * lateness does not slip the train's phase. Capped at half the pulse period.
 */
export const TRAIN_LEAD_MS = 20;
/** Engineering: a pulse more than this late (a throttled background timer) is skipped, not played late. */
export const TRAIN_LATE_TOLERANCE_MS = 40;
/** Engineering: train rates are clamped to this range so a bad rate cannot stall or flood the motor. */
export const TRAIN_MIN_RATE_HZ = 0.25;
export const TRAIN_MAX_RATE_HZ = 40;
/**
 * Engineering (Q-458): the most notes one `emitTogether` group may carry (an exposure's frames; 2 on
 * Eros). A longer group is refused, so it cannot be used to slip a burst past the R8.3 cap.
 */
export const MAX_GROUP_NOTES = 4;

// ---------------------------------------------------------------- tone stream (R8.8, Q-189)

/**
 * SPEC R8.8 (Q-189, proposed values): fade in over this time (s), read as a ~95 % settle time
 * (`setTargetAtTime` τ = time / DUCK_TAU_DIVISOR, as the duck). [verify on the A15] (R12)
 */
export const TONE_FADE_IN_S = 0.03;
/** SPEC R8.8 (Q-189): the time constant (s) of every pitch, gain and pan glide. [verify on the A15] */
export const TONE_GLIDE_S = 0.02;
/** SPEC R8.8 (Q-189): fade out over this time (s), read as TONE_FADE_IN_S is. [verify on the A15] */
export const TONE_FADE_OUT_S = 0.06;
/**
 * Engineering: after the fade out starts, the source stops this many fade-out times later (two
 * fade-out times = 6 τ, about −52 dB), so the stop itself cannot click.
 */
export const TONE_STOP_AFTER_FADES = 2;
/**
 * SPEC R8.8 (Q-189): updates are coalesced to about one per animation frame (60 Hz). Engineering: a
 * timer stands in for the frame, so the engine stays testable without a browser.
 */
export const TONE_UPDATE_MIN_MS = 16;
/**
 * R8.9 sustained timbre (Q-190, proposed): the Estimated tags' "softer sine … through a low-pass
 * filter". Cut-off (Hz). CREATIVE placeholder — Atish to decide (D-13).
 */
export const TONE_SOFT_LOWPASS_HZ = 1500;

// ---------------------------------------------------------------- audio driver (R8.9, D-10)

/** R8.9: lookahead added to `currentTime` before every scheduled sound. [verify on phones] (R8.9) */
export const AUDIO_LOOKAHEAD_S = 0.03;
/** R8.9: `outputLatency` above this suggests Bluetooth; advise the laptop speaker or wired output (Q-132). [verify on the A15] R12 #10 */
export const HIGH_OUTPUT_LATENCY_S = 0.1;
/** pitch 0 → this frequency (the mock-up's Listen sweep base). CREATIVE placeholder — Atish to decide (D-13). */
export const PITCH_MIN_HZ = 220;
/** pitch 1 → PITCH_MIN_HZ × 2^this (the mock-up's 2.4 octaves). CREATIVE placeholder — Atish to decide (D-13). */
export const PITCH_OCTAVES = 2.4;
/** Tone frequency when an event has no `pitch` (pitch 0.5). CREATIVE placeholder — Atish to decide (D-13). */
export const DEFAULT_PITCH = 0.5;
/**
 * R8.6/R8.9: pitch follows λ, over the SPHEREx band (0.75–5.0 µm, A3 data sources) so the same λ
 * sounds the same on every object (Q-70). Direction and range: CREATIVE placeholder — Atish to decide (D-13).
 */
export const PITCH_LAMBDA_MIN_UM = 0.75;
export const PITCH_LAMBDA_MAX_UM = 5.0;
/**
 * Q-430 (Atish, 12 Nov 2026; amends Q-70): long wavelength = LOW pitch for the sweep, the chord and
 * Track (Trayford et al. 2023). Short wavelengths sound high.
 */
export const PITCH_RISES_WITH_WAVELENGTH = false;

/** R8.9 `measured`: clean tone blip. Length (s) and attack (s): CREATIVE placeholder — Atish to decide (D-13). */
export const TONE_BLIP_S = 0.04;
export const TONE_ATTACK_S = 0.002;
/** R8.9 Estimated tags: "softer tone" — slower attack and lower gain. CREATIVE placeholder — Atish to decide (D-13). */
export const SOFT_TONE_ATTACK_S = 0.012;
export const SOFT_TONE_GAIN = 0.6;
/** SPEC R8.9 `artistic`: a 4 ms noise burst with a 2 ms decay. */
export const NOISE_BURST_S = 0.004;
export const NOISE_DECAY_S = 0.002;
/** Q-72: an `artistic` sound with a pitch is the noise burst through a band-pass at that pitch; its Q. CREATIVE placeholder — Atish to decide (D-13). */
export const GRAIN_BANDPASS_Q = 4;
/** D-12 ocean "surf": low-passed noise. Cut-off (Hz) and length (s): CREATIVE placeholder — Atish to decide (D-13). */
export const SURF_LOWPASS_HZ = 600;
export const SURF_DURATION_S = 0.25;
/** Bell (`chime`): two partials, the mock-up's f and 2.01 f, 1.1 s decay. CREATIVE placeholder — Atish to decide (D-13). */
export const CHIME_PARTIAL_RATIO = 2.01;
export const CHIME_PARTIAL_GAIN = 0.3;
export const CHIME_DECAY_S = 1.1;
/** Peak gain of one sound at strength 1 and volume 1, below clipping when pulses overlap. Engineering. */
export const AUDIO_PEAK_GAIN = 0.5;
/** Audible floor: strengths below this sound at this strength. CREATIVE placeholder — Atish to decide (D-13). */
export const AUDIO_FLOOR_STRENGTH = 0.08;
/** Default volume setting (R8.7 settings). CREATIVE placeholder — Atish to decide (D-13). */
export const DEFAULT_VOLUME = 0.7;
/** Engineering: at most this many sounds are scheduled or playing at once; the oldest is cut. */
export const MAX_AUDIO_VOICES = 32;
/** Engineering: a train's audio clock anchor is reset when it drifts by more than this (s). */
export const AUDIO_REANCHOR_TOLERANCE_S = 0.05;
/** SPEC R13.9 (§11.5): the master limiter (threshold −3 dB, knee 0, ratio 20, attack 3 ms, release 100 ms). */
export const LIMITER_THRESHOLD_DB = -3;
export const LIMITER_RATIO = 20;
export const LIMITER_ATTACK_S = 0.003;
export const LIMITER_RELEASE_S = 0.1;
/** Onsets of the double tick (crater rim) and the heartbeat (Mira) as on/off/on ms (was R8.3's vibrate patterns). */
export const DOUBLE_ONSETS_PATTERN_MS: readonly number[] = [12, 40, 12];
export const HEARTBEAT_ONSETS_PATTERN_MS: readonly number[] = [20, 120, 12];

// ---------------------------------------------------------------- engine strength multiplier

/** The engine's strength multiplier range (R8.7; no longer a user setting after D-39, stays at 1). */
export const STRENGTH_MULTIPLIER_MIN = 0.5;
export const STRENGTH_MULTIPLIER_MAX = 1.5;

// ---------------------------------------------------------------- spectrum mapping (R8.6)

/** SPEC R8.6: normalised flux below this is quiet (no event in either channel). */
export const SPECTRUM_QUIET_THRESHOLD = 0.2;
/** SPEC R8.6: σ/flux above this is noisy. */
export const SPECTRUM_NOISY_SIGMA_RATIO = 0.3;

// ---------------------------------------------------------------- Listen sweep (A8, R8.6, R8.9)
/** The mock-up's sweep: 6 s across the spectrum. CREATIVE placeholder — Atish to decide (D-13). */
export const SWEEP_DURATION_S = 6;
/** Fewest gain steps across the sweep (the mock-up's 90). Engineering. */
export const SWEEP_STEPS = 90;
/**
 * Sweep samples per spectrum point, so a dip one channel wide is quiet in the sweep as it is under
 * the finger (R8.6 item 3; issue #11 review M3). Engineering.
 */
export const SWEEP_SAMPLES_PER_POINT = 8;
/**
 * Most gain steps one sweep schedules (security review): 8 per point up to 512 points, far above a
 * SPHEREx spectrum's ~102, so a huge input cannot schedule millions of AudioParam events. Engineering.
 */
export const SWEEP_MAX_STEPS = 4096;
/** Gain ramp at the sweep's start and end and at every quiet edge, so it does not click (s). Engineering. */
export const SWEEP_EDGE_S = 0.008;
/** The mock-up's triangle oscillator. CREATIVE placeholder — Atish to decide (D-13). */
export const SWEEP_WAVE: OscillatorType = 'triangle';
/** Peak gain of the sweep tone at strength 1 and volume 1. CREATIVE placeholder — Atish to decide (D-13). */
export const SWEEP_PEAK_GAIN = 0.3;
/** Stereo travel, left to right (the mock-up's ±0.8). CREATIVE placeholder — Atish to decide (D-13). */
export const SWEEP_PAN = 0.8;
/** Gain of a gas-line chime. CREATIVE placeholder — Atish to decide (D-13). */
export const SWEEP_CHIME_GAIN = 0.3;

// ---------------------------------------------------------------- buses, ducking, stage (R13.9, Q-441)

/** SPEC R13.9: the ambience is ducked by this many dB while any data sound plays. CREATIVE placeholder — Atish to decide (D-13). */
export const AMBIENCE_DUCK_DB = -9;
/**
 * SPEC R13.9: duck attack and release (s), read as ~95 % settle times: `setTargetAtTime` uses
 * τ = time / DUCK_TAU_DIVISOR. CREATIVE placeholder — Atish to decide (D-13).
 */
export const AMBIENCE_DUCK_ATTACK_S = 0.05;
export const AMBIENCE_DUCK_RELEASE_S = 0.6;
export const DUCK_TAU_DIVISOR = 3;
/** Engineering (coordinator ruling): a duck hold is released this long after its longest voice should have ended. */
export const DUCK_SAFETY_S = 1;
/** SPEC R13.9 (§11.7): high-pass on the ambience bus, protects laptop and PA speakers. */
export const AMBIENCE_HIGHPASS_HZ = 35;
/** SPEC R13.9 (§11.5): default ambience volume (× the master volume). */
export const AMBIENCE_DEFAULT_VOLUME = 0.5;
/** Engineering: time constant (s) for ambience level changes (a slider drag). */
export const AMBIENCE_LEVEL_TAU_S = 0.05;
/** SPEC R13.9 (§11.7) harmonic branch: input band (Hz), shaper tanh(DRIVE·x), output band (Hz), mix (dB). */
export const HARMONIC_IN_LOW_HZ = 40;
export const HARMONIC_IN_HIGH_HZ = 120;
export const HARMONIC_OUT_LOW_HZ = 200;
export const HARMONIC_OUT_HIGH_HZ = 600;
export const HARMONIC_SHAPER_DRIVE = 3;
/**
 * Coordinator ruling (12 Nov): +18 dB before the shaper and the matching −18 dB make-up after it,
 * so beds at −24 LUFS reach the non-linear part of tanh. [verify by ear on the A15 and the venue PA] (R12)
 */
export const HARMONIC_PREGAIN_DB = 18;
/** SPEC R13.9 (§11.7): the branch is mixed at −12 dB. [verify by ear on the A15 and the venue PA] (R12) */
export const HARMONIC_MIX_DB = -12;
/** Engineering: points in the tanh curve (odd, so 0 maps to 0 exactly). */
export const HARMONIC_CURVE_POINTS = 1025;
/** Engineering: Q of each high-pass / low-pass in the branch and of the bus high-pass (Butterworth). */
export const BUTTERWORTH_Q = Math.SQRT1_2;

// ---------------------------------------------------------------- spectrum chord (R13.12, Q-443, Q-446)

/** SPEC R13.12 item 1: 12 equal-pitch bins over the Q-70 pitch range (equal-λ bins, pitch.ts is linear in λ). */
export const CHORD_BINS = 12;
/** SPEC R13.12 item 3: a 6 s seamless loop (every frequency on the 1/6 Hz grid). */
export const CHORD_LOOP_S = 6;
/** SPEC R13.12 item 3: 30 ms attack. */
export const CHORD_ATTACK_S = 0.03;
/** Engineering: release on stop, so it does not click. */
export const CHORD_RELEASE_S = 0.06;
/** SPEC R13.12 item 4: flux maps to level over this many dB. */
export const CHORD_RANGE_DB = 30;
/** SPEC R13.12 item 4: master about −18 dBFS RMS. [verify on the A15] (level against the sweep, R12) */
export const CHORD_TARGET_RMS_DBFS = -18;
/** SPEC R13.12 item 5: ISO 226 equal-loudness weights at this loudness level (phon). */
export const CHORD_ISO_PHON = 60;
/**
 * SPEC R13.12 item 5: the loudness correction is capped at this boost (dB). [verify on the A15]
 * Pre-agreed fallback (R12 #72): 3 dB if the venue PA check finds the two lowest notes rough
 * (240-cent neighbours near 236–311 Hz sit close to maximum Plomp–Levelt roughness). CREATIVE (D-13).
 */
export const CHORD_ISO_CAP_DB = 6;
/** SPEC R13.12 item 6: beat rate = MIN + SPAN·clamp(σ/flux, 0, 1) Hz, capped at MAX. */
export const CHORD_BEAT_MIN_HZ = 2;
export const CHORD_BEAT_SPAN_HZ = 4;
export const CHORD_BEAT_MAX_HZ = 6;
/** Depth of the beating (research §2.6 "capped at about 50 %"). CREATIVE placeholder — Atish to decide (D-13). */
export const CHORD_BEAT_DEPTH = 0.5;
/** Coordinator ruling (Q-446): Smooth = running median of log flux over this window (µm, centred). */
export const CHORD_SMOOTH_WINDOW_UM = 0.5;
/** Engineering (Q-446): linear A/B crossfade (s). */
export const CHORD_AB_FADE_S = 0.15;
/** Engineering: the seed of the partial and beat phases (determinism). Chosen from 1–12 for headroom: 12 equal partials peak at 0.47 (≤ −6 dBFS) at −18 dBFS RMS. */
export const CHORD_SEED = 11;

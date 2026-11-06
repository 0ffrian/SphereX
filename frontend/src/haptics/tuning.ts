// Every haptics and audio tuning constant, for the engine (#9) and all sources (#10, #11), in one
// file (D-13). These are display and perceptual scales, never physical values: a missing *data*
// reference refuses the haptic and lists it in `missing` instead of falling back to a constant here.
//
// Markers:
//   SPEC                         the value is written in the spec section named next to it
//   [verify on phones]           to be measured on the realme 14 Pro and the Samsung (R12 item)
//   CREATIVE placeholder — Atish to decide (D-13)   a neutral stand-in; how it feels is Atish's call

// ---------------------------------------------------------------- engine (R8.3, R8.8)

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

// ---------------------------------------------------------------- vibrate driver (R8.3, D-09)

/** SPEC R8.3: soft, medium, firm tick lengths in ms (soft = `minMs` after calibration). [verify on phones] R12 #7 */
export const VIBRATE_LEVELS_MS: readonly number[] = [8, 15, 25];
/** SPEC R8.3: the optional pulse-width whisper; used only when calibration finds it distinct. [verify on phones] R12 #13 */
export const WHISPER_PATTERN: readonly number[] = [4, 4, 4, 4, 4];
/** SPEC R8.3: double tick (crater rim). */
export const DOUBLE_PATTERN: readonly number[] = [12, 40, 12];
/** SPEC R8.3: heartbeat (Mira). */
export const HEARTBEAT_PATTERN: readonly number[] = [20, 120, 12];
/** SPEC R8.3: Chrome's pattern-length cap, believed about 99 entries. [verify on phones] R12 #9 */
export const MAX_PATTERN = 99;
/** SPEC R8.7 step 1: the faintest-pulse probe lengths in ms. [verify on phones] R12 #7 */
export const CALIBRATION_PROBE_MS: readonly number[] = [5, 10, 20];

// ---------------------------------------------------------------- strength anchors (R8.3–R8.5)

/** SPEC R8.3/R8.5 "firm tick": the top level whatever the level count. */
export const STRENGTH_FIRM = 1;
/**
 * "Soft tick" (R8.4 ice, R8.5 band boundary when no contrast is given). 0.3 lands in the soft bin
 * with 3 levels and with 4 (whisper + 3). CREATIVE placeholder — Atish to decide (D-13).
 */
export const STRENGTH_SOFT = 0.3;
/** SPEC R8.5 "lowest level" (ocean swell): strength 0 is always the lowest bin. */
export const STRENGTH_LOWEST = 0;

// ---------------------------------------------------------------- audio driver (R8.9, D-10)

/** R8.9: lookahead added to `currentTime` before every scheduled sound. [verify on phones] (R8.9) */
export const AUDIO_LOOKAHEAD_S = 0.03;
/** R8.9: `outputLatency` above this suggests Bluetooth; advise the speaker or wired earphones. [verify on phones] R12 #10 */
export const HIGH_OUTPUT_LATENCY_S = 0.1;
/** pitch 0 → this frequency (the mock-up's Listen sweep base). CREATIVE placeholder — Atish to decide (D-13). */
export const PITCH_MIN_HZ = 220;
/** pitch 1 → PITCH_MIN_HZ × 2^this (the mock-up's 2.4 octaves). CREATIVE placeholder — Atish to decide (D-13). */
export const PITCH_OCTAVES = 2.4;
/** Tone frequency when an event has no `pitch` (pitch 0.5). CREATIVE placeholder — Atish to decide (D-13). */
export const DEFAULT_PITCH = 0.5;
/**
 * R8.6/R8.9: pitch follows λ, over the SPHEREx band (0.75–5.0 µm, A3 data sources) so the same λ
 * sounds the same on every object (Q-58). Direction and range: CREATIVE placeholder — Atish to decide (D-13).
 */
export const PITCH_LAMBDA_MIN_UM = 0.75;
export const PITCH_LAMBDA_MAX_UM = 5.0;
/** Longer λ sounds higher when true. CREATIVE placeholder — Atish to decide (D-13). */
export const PITCH_RISES_WITH_WAVELENGTH = true;
/** D-12 gas giant bands: pitch follows latitude; north is higher when true. CREATIVE placeholder — Atish to decide (D-13). */
export const PITCH_RISES_TO_NORTH = true;

/** R8.9 `measured`: clean tone blip. Length (s) and attack (s): CREATIVE placeholder — Atish to decide (D-13). */
export const TONE_BLIP_S = 0.04;
export const TONE_ATTACK_S = 0.002;
/** R8.9 Estimated tags: "softer tone" — slower attack and lower gain. CREATIVE placeholder — Atish to decide (D-13). */
export const SOFT_TONE_ATTACK_S = 0.012;
export const SOFT_TONE_GAIN = 0.6;
/** SPEC R8.9 `artistic`: a 4 ms noise burst with a 2 ms decay. */
export const NOISE_BURST_S = 0.004;
export const NOISE_DECAY_S = 0.002;
/** Q-60: an `artistic` sound with a pitch is the noise burst through a band-pass at that pitch; its Q. CREATIVE placeholder — Atish to decide (D-13). */
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
/**
 * Audible floor: strengths below this sound at this strength, so the lowest vibrate level (e.g.
 * the ocean swell at STRENGTH_LOWEST) is also heard (R8.9: both channels or neither).
 * CREATIVE placeholder — Atish to decide (D-13).
 */
export const AUDIO_FLOOR_STRENGTH = 0.08;
/** Default volume setting (R8.7 settings). CREATIVE placeholder — Atish to decide (D-13). */
export const DEFAULT_VOLUME = 0.7;
/** Engineering: a train's audio clock anchor is reset when it drifts by more than this (s). */
export const AUDIO_REANCHOR_TOLERANCE_S = 0.05;
/** Engineering: limiter on the audio master so overlapping sounds do not clip. */
export const LIMITER_THRESHOLD_DB = -6;
export const LIMITER_RATIO = 20;
export const LIMITER_ATTACK_S = 0.003;
export const LIMITER_RELEASE_S = 0.1;

// ---------------------------------------------------------------- settings (R8.7)

/** SPEC R8.7: the strength multiplier's range. */
export const STRENGTH_MULTIPLIER_MIN = 0.5;
export const STRENGTH_MULTIPLIER_MAX = 1.5;

// ---------------------------------------------------------------- spectrum source (R8.6) — #10

/** SPEC R8.6: one tick every 8 px of travel. */
export const SPECTRUM_TICK_PX = 8;
/** SPEC R8.6: normalised flux below this is quiet (no event in either channel). */
export const SPECTRUM_QUIET_THRESHOLD = 0.2;
/** SPEC R8.6: σ/flux above this is noisy, and its tick spacing jitters. */
export const SPECTRUM_NOISY_SIGMA_RATIO = 0.3;
/** SPEC R8.3 "roughness": ±30% spacing jitter from a seeded RNG. */
export const JITTER_FRACTION = 0.3;

// ---------------------------------------------------------------- texture sources (R8.4, D-12) — #11

/** SPEC R8.4: rise threshold τ as a fraction of the local relief std (`profile.params.tau` wins). */
export const HEIGHT_TAU_FRACTION = 0.15;
/** SPEC R8.4: tick strength = clamp(rise / (this × τ), 0, 1). */
export const HEIGHT_STRENGTH_TAU_MULTIPLE = 3;
/** SPEC R8.4: hydrated objects scale strength by this. */
export const HYDRATED_STRENGTH_SCALE = 0.6;
/** Mirrors the baker's hydration rule, `band_depth_3um > 0.05` (backend/app/core/render/params.py, `hydration=`). Not tunable here. */
export const HYDRATED_BAND_DEPTH_3UM = 0.05;
/** SPEC R8.4: a face-normal turn above this (degrees) ticks … */
export const MESH_NORMAL_MIN_ANGLE_DEG = 12;
/** SPEC R8.4: … with strength = clamp(angle / this, 0, 1). */
export const MESH_NORMAL_FULL_ANGLE_DEG = 40;
/** SPEC R8.5/D-12: ocean swell rate range (Hz), at STRENGTH_LOWEST. */
export const OCEAN_SWELL_MIN_HZ = 1;
export const OCEAN_SWELL_MAX_HZ = 2;
/** R8.4 polar ice "dense, fine, soft ticks": tick spacing in px. CREATIVE placeholder — Atish to decide (D-13). */
export const ICE_TICK_SPACING_PX = 4;
/** SPEC D-12: jet rate = clamp(k · |wind| / max|wind|, 2, 20) Hz. [verify on phones] R12 #14 */
export const FLOW_JET_MIN_HZ = 2;
export const FLOW_JET_MAX_HZ = 20;
/** D-12 jet `k` when `profile.params.k` is absent. CREATIVE placeholder — Atish to decide (D-13). [verify on phones] R12 #14 */
export const FLOW_JET_K = 20;
/** R8.5/D-12 storm "swirl": rate at the edge and at the centre (Hz). CREATIVE placeholder — Atish to decide (D-13). */
export const STORM_SWIRL_EDGE_HZ = 4;
export const STORM_SWIRL_CENTRE_HZ = 16;
/** SPEC R8.4: comet field rate = clamp(k · Q / r, 2, 30) Hz (`profile.params.maxRateHz` wins for the top). */
export const FIELD_MIN_HZ = 2;
export const FIELD_MAX_HZ = 30;
/** R8.4 field `k` when `profile.params.k` is absent. CREATIVE placeholder — Atish to decide (D-13). */
export const FIELD_K = 1;

// ---------------------------------------------------------------- data sources (R8.5) — #11

/** SPEC R8.5: `teq_pulse` and `flux_pulse` rates span 2–12 Hz. */
export const DATA_PULSE_MIN_HZ = 2;
export const DATA_PULSE_MAX_HZ = 12;
/** R8.5 `teq_pulse`: the Teq display range (K) mapped onto 2–12 Hz. CREATIVE placeholder — Atish to decide (D-13). */
export const TEQ_DISPLAY_MIN_K = 200;
export const TEQ_DISPLAY_MAX_K = 2000;
/** R8.5 "holding still": the data train starts after the finger is still this long (ms) … CREATIVE placeholder — Atish to decide (D-13). */
export const HOLD_STILL_MS = 400;
/** … within this many px. Engineering. */
export const HOLD_STILL_TOLERANCE_PX = 4;
/** R8.5 `brown_dwarf_binary`: pulse rate of the warmer and the cooler body (Hz). CREATIVE placeholder — Atish to decide (D-13). */
export const BINARY_WARM_HZ = 8;
export const BINARY_COOL_HZ = 4;
/** R8.5 `star_ttauri`: steady pulse rate before dimming drops beats (Hz). CREATIVE placeholder — Atish to decide (D-13). */
export const TTAURI_PULSE_HZ = 4;

// ================================================================ #11 texture, data and sound
// Added by issue #11 (texture haptics per type, and sound). The constants above stay as #9 set them.

// ---------------------------------------------------------------- strengths without a data value
/**
 * R8.4/R8.5 say "tick" or "double tick" without a strength (ring gap, lava crack, nucleus is
 * "firm"). The middle of 0–1, so it lands in the medium bin with 3 levels. CREATIVE placeholder — Atish to decide (D-13).
 */
export const PLAIN_TICK_STRENGTH = 0.5;
/** R8.5 data pulses ("steady pulse": teq, flux, binary, field): their strength. CREATIVE placeholder — Atish to decide (D-13). */
export const DATA_PULSE_STRENGTH = 0.5;

// ---------------------------------------------------------------- relief (R8.4 height rule)
/**
 * R8.4 "0.15 of *local* relief std": the std is taken over square tiles of this many texels
 * (of a 512×256 map; scaled with the map). Engineering: "local" is not sized in the spec.
 */
export const RELIEF_STD_TILE_TEXELS = 16;
/** Tiles with fewer usable texels than this fall back to the whole map's std. Engineering. */
export const RELIEF_STD_MIN_TEXELS = 8;

// ---------------------------------------------------------------- terrain (R8.4, D-12)
/** A field mask (ocean, ice, lava) counts as "inside" at or above this; 0.5 is the drawn edge of its smoothstep. Engineering. */
export const MASK_THRESHOLD = 0.5;
/** D-12 open-ocean swell rate, inside OCEAN_SWELL_MIN_HZ–OCEAN_SWELL_MAX_HZ. CREATIVE placeholder — Atish to decide (D-13). [verify on phones] */
export const OCEAN_SWELL_HZ = 1.5;
/**
 * D-12 "lowest level". Strength 0 would make the paired surf sound silent (gain = strength), so a
 * small value that still lands in the lowest vibrate bin with 3 or 4 levels. CREATIVE placeholder — Atish to decide (D-13).
 */
export const OCEAN_SWELL_STRENGTH = 0.1;

// ---------------------------------------------------------------- flow (R8.4, D-12)
/**
 * "Inside a jet": |zonal wind| / max |zonal wind| at or above this. 0 = the jet train plays
 * wherever the wind blows (the 2 Hz floor covers the calm band edges). CREATIVE placeholder — Atish to decide (D-13).
 */
export const FLOW_JET_MIN_WIND = 0;
/** Ring gap: `ringGapAt(t)` at or above this is "in the gap" (its smoothstep edge). Engineering. */
export const RING_GAP_THRESHOLD = 0.5;

// ---------------------------------------------------------------- point density (nebula, nova; R8.4 item 4)
/** Radius (body units, cloud radius 1) of the disc around the finger's ray in which points are counted. CREATIVE placeholder — Atish to decide (D-13). */
export const DENSITY_RADIUS = 0.08;
/** rate = clamp(DENSITY_K · density ÷ uniform-disc density, FIELD_MIN_HZ, max). CREATIVE placeholder — Atish to decide (D-13). */
export const DENSITY_K = 4;

// ---------------------------------------------------------------- Listen sweep (A8, R8.6, R8.9)
/** The mock-up's sweep: 6 s across the spectrum. CREATIVE placeholder — Atish to decide (D-13). */
export const SWEEP_DURATION_S = 6;
/** Gain steps across the sweep (the mock-up's 90). Engineering. */
export const SWEEP_STEPS = 90;
/** The mock-up's triangle oscillator. CREATIVE placeholder — Atish to decide (D-13). */
export const SWEEP_WAVE: OscillatorType = 'triangle';
/** Peak gain of the sweep tone at strength 1 and volume 1. CREATIVE placeholder — Atish to decide (D-13). */
export const SWEEP_PEAK_GAIN = 0.3;
/** Stereo travel, left to right (the mock-up's ±0.8). CREATIVE placeholder — Atish to decide (D-13). */
export const SWEEP_PAN = 0.8;
/** Gain of a gas-line chime. CREATIVE placeholder — Atish to decide (D-13). */
export const SWEEP_CHIME_GAIN = 0.3;

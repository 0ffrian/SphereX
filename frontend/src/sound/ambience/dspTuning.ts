// Spec R13 §9, §11.4/§11.7, §16.7, §17 (bake rows): constants of the ambience bake engine (#113, T3). The physics
// constants that feed `BedSpec.params` (PM, Roshko, drop size, thunder f_m, sample rates, BED_N) belong to `tuning.ts`
// (#112, T2); this file holds only what the bake itself uses, so each fact has one owner. Do not define these again in
// `tuning.ts`: re-export them from here if needed.
//
// Kinds (§17): P physics, cited; C CREATIVE placeholder (D-13, tuned by ear on the A15); V [verify].
// Many C values come from Moon's prototype `Ambience Loop Lab.html` (DSP section), credited here; its PLANETS values
// are illustrative and are not copied.

// ---- Loudness and level (§11.4, §11.7) ----
/** C. Integrated loudness every looping bed is normalised to (§11.7, replaces −30 of §11.4). */
export const BED_LUFS = -24;
/** C. Sample-peak ceiling for a bed after normalisation; the gain is lowered instead of clipping (ruling 3). */
export const BED_PEAK_MAX_DBFS = -1;
/** C. Peak of a one-shot (thunder, vent burst) at gain 1. Meaning: gain 1 = an L_TARGET (70 dB) peak, so the +6 dB
 * stage window (§11.7) tops out at −10 dBFS, §11.7's thunder limit. Proposed Q- entry for T6. */
export const ONE_SHOT_PEAK_DBFS = -16;
/** P. BS.1770 absolute gate (LUFS); a bed below it is refused as silent. */
export const LUFS_ABS_GATE = -70;
/** P. BS.1770 relative gate (LU). */
export const LUFS_REL_GATE = -10;
/** P. BS.1770 gating block and step (s). */
export const LUFS_BLOCK_S = 0.4;
export const LUFS_STEP_S = 0.1;

// ---- Budgets and cache (§9.5) ----
/** C. Loop-bed memory per world, MB (1e6 bytes). */
export const BED_MEMORY_MB = 96;
/** C. One-shot memory per world (thunder variants, vent burst), MB, outside the bed cap (coordinator ruling 2). */
export const ONE_SHOT_MEMORY_MB = 24;
/** C. Worlds kept in the palette cache (LRU). */
export const CACHE_WORLDS = 2;
/** C, V. Bake time budget per bed on the A15 (s) [verify by measurement, §19 item 10]. */
export const BAKE_BUDGET_S = 1.5;
/** C. Beds baked on the main thread when no worker is available (never blank, without freezing the fly view). */
export const MAIN_FALLBACK_MAX_BEDS = 1;

// ---- Spectrum synthesis ----
/** C. Shape-table step in Hz (Moon used every 32 bins); in Hz so the spectrum does not depend on N. */
export const SHAPE_STEP_HZ = 1;
/** C. Highest frequency synthesised, as a fraction of the sample rate (pings above it are dropped). */
export const NYQ_GUARD = 0.47;
/** C. Control-rate envelope decimation (Moon: M = N/128). */
export const ENV_DECIM = 128;

// ---- Gusts (§7 S1, [SS 1.3]) ----
/** P/C. Number of gust sines (harmonics of the loop). */
export const GUST_SINES = 24;
/** P. Amplitude slope per harmonic, k^-0.83, so power falls as f^-5/3 [SS 1.3]. */
export const GUST_SLOPE = -0.83;
/** C, V. Integral time of the gusts (s). Recorded, not used to shape the spectrum (plan G2) [verify]. */
export const GUST_TIME_S = 12;
/** C. Envelope powers: pressure ∝ U² (rumble), ∝ U³ (hiss) [SS 1.1]; whistle uses the spec's "squared gust envelope". */
export const RUMBLE_ENV_POW = 2;
export const HISS_ENV_POW = 3;
export const WHISTLE_ENV_POW = 2;
/** C. Storm bed (S9) carries rumble and hiss under one envelope; the power sits between the two. */
export const STORM_ENV_POW = 2.5;
/** C. Hiss level relative to rumble in the storm bed (§11.3 "hiss −10 dB relative to rumble"). */
export const STORM_HISS_REL_DB = -10;
/** C. Gust depth on gas giants when `Iu` is not given. */
export const GAS_IU = 0.15;

// ---- Whistle (§7 S3) ----
/** C. Q of each aeolian tone (§7 S3: Q ≈ 25). */
export const WHISTLE_Q = 25;

// ---- Surf and sea (§7 S4/S5; Moon's character) ----
/** C. Moon's cliff behind the shore: distance (m) and echo gain, plus scattered taps. */
export const SURF_CLIFF_M = 110;
export const SURF_CLIFF_GAIN = 0.35;
export const SURF_SCATTER_TAPS = 14;
export const SURF_SCATTER_GAIN = 0.13;
/** C. Moon's caps on bubble ping counts and pitch. */
export const SEA_PINGS_PER_S = 40;
export const SEA_PINGS_MAX = 4000;

// ---- Rain (§7 S6) ----
/** C. Slow loudness wander of the rain hiss (Moon's gust depth 0.18). */
export const RAIN_ENV_DEPTH = 0.18;
/** C. Moon's patter and impact-drop rates on Earth (per second), scaled by rainPitch³. */
export const RAIN_PATTER_PER_S = 30;
export const RAIN_DROPS_PER_S = 70;
export const RAIN_DROPS_MAX = 6000;
/** P. Small-drop bubble ring on Earth, about 14 kHz [SS 4.3, Medwin et al. 1992], scaled by m_f. */
export const RAIN_RING_HZ_EARTH = 14000;
/** C. Share of impact drops that also ring. */
export const RAIN_RING_FRACTION = 0.25;

// ---- River (§7 S7) ----
/** P. Minnaert f0·R for air bubbles in water at 1 atm (Hz·m) [SS 3.1]. */
export const MINNAERT_FR = 3.26;
/** P. Bubble radii drawn from N(R) ∝ R^-3/2 (Deane & Stokes 2002) on this range (m). */
export const RIVER_R_MIN_M = 0.001;
export const RIVER_R_MAX_M = 0.005;
/** V. Bubble damping δ (thermal + viscous + radiation) [SS 3.1: 0.03–0.1, verify]. */
export const BUBBLE_DAMPING = 0.05;
/** C. Bubble pings per second in the river bed. */
export const RIVER_PINGS_PER_S = 60;

// ---- Lava (§7 S8) ----
/** C. Slow wander of the lava roar, and crust crackle clicks per second. */
export const LAVA_ROAR_DEPTH = 0.3;
export const LAVA_CRACKLE_PER_S = 6;
/** C. Vent burst one-shot (S8 variant 1): length of the burst and spatter (s). */
export const VENT_DUR_S = 3;

// ---- Sand (§7 S10) ----
/** C. Grain-click rate (per second) at the gust mean. */
export const SAND_CLICKS_PER_S = 40;

// ---- Gas giant (§7 S12) ----
/** C. Phaser sweep rate (§7 S12: 0.05 Hz), rounded to whole cycles per loop so the loop stays seamless. */
export const PHASER_HZ = 0.05;
export const PHASER_LO_HZ = 300;
export const PHASER_HI_HZ = 3000;

// ---- Thunder (§8.4) ----
/** P. Band-pass Q around f_m (§8.4). */
export const THUNDER_Q = 0.7;
/** P/C. Longest roll (s) (§8.4: 30–40 s). */
export const THUNDER_MAX_S = 35;
/** P. Close-strike crack: a broadband transient this long (s) (§8.4). */
export const THUNDER_CRACK_S = 0.15;
/** C. Silence before the onset, and the fade at the end (s). */
export const ONE_SHOT_PAD_S = 0.05;
export const ONE_SHOT_TAIL_S = 0.5;
/** C. Relative gains of the 20–60 Hz rumble and the crack. */
export const THUNDER_RUMBLE_GAIN = 0.7;
export const THUNDER_CRACK_GAIN = 0.8;

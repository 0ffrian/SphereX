// Ambience constants (spec R13 §17) used by the physics core (#112). Kinds: P = physics, cited; C = CREATIVE
// placeholder (D-13, tune by ear on the A15); V = [verify] before shipping. Bake, cache, loudness and memory budgets
// belong to #113 (dspTuning.ts / palette.ts) and are deliberately not repeated here.
//
// Conventions (contract amendments 2 and 3): bearings are radians clockwise from north (as fly.head); the local frame
// is the engine's flyCamera basis: up = [cos lat cos lon, sin lat, cos lat sin lon], east = normalize(cross(Y, up)),
// north = cross(up, east). dirDeg is the direction the wind blows FROM, degrees clockwise from north.

// ---------- air (§4) ----------
/** P: silence ceiling, Pa. Classical absorption alone removes 1 kHz within about 1 m below ~1.9 Pa [PA Q7]. */
export const P_FLOOR = 1;
/** P: molar gas constant, J mol^-1 K^-1. */
export const R_GAS = 8.314;
/** P/V: ratio of specific heats by class [PA Q4]. N2_WET: water-rich N2 class (mu < 25) [verify NIST]; H2 [verify ortho/para below 170 K]. */
export const GAMMA = { N2: 1.4, N2_WET: 1.33, CO2: 1.29, H2: 1.43 } as const;
/** P/V: rock vapour on a lava world (§4.2) [verify: Schaefer & Fegley 2009 suggest 1.4-1.67]. */
export const ROCK_VAPOUR_GAMMA = 1.4;
/** §3.2 composition thresholds (g/mol). */
export const MU_WET_BELOW = 25;
export const CO2_MU_MIN = 40;
export const H2_MU_MAX = 4;
/** H2/He solar mix molar mass used by the classical absorption term (absorption() has no mu argument) [PA Q4]. */
export const H2_MU_DEFAULT = 2.33;
/** §4.1 temperature floor as a share of T0. */
export const T_FLOOR_FRAC = 0.6;
/** §4.3 relative humidity assumed for ISO 9613-1 (inferred_from_analog). */
export const RH_ASSUMED = 0.5;
/** ASSUMPTION: ISO 9613-1 molar water fraction capped at 0.5 so hot steam worlds stay finite (ISO is not valid there). */
export const ISO_H_MAX = 0.5;
/** P: ISO 9613-1:1993 constants (reference pressure, reference T, triple point, coefficients). */
export const ISO = {
  pr: 101325,
  T0: 293.15,
  T01: 273.16,
  cl: 1.84e-11,
  aO: 0.01275,
  bO: 2239.1,
  aN: 0.1068,
  bN: 3352,
  psA: -6.8346,
  psB: 1.261,
  psC: 4.6151,
} as const;
/** Nepers to decibels. */
export const DB_PER_NP = 8.686;

/**
 * P/V: CO2 class absorption anchors (§4.3). Thin end fitted to Maurice et al. 2022 (Nature 605:653) at 600 Pa / 210 K;
 * thick end through Petculescu & Lueptow 2007 (Icarus 186:413) at Venus. The spec's claim that the thin end also
 * gives 3.5 dB/m at 15 kHz is not reproduced (the fit gives ~4.9 dB/m) [verify with Gillier et al. 2024, Zenodo
 * 10992306, and Petculescu 2016, JASA 140:1439].
 */
export const CO2_ABS = {
  aCl: 1.7e-9,
  fr: 240,
  pRef: 600,
  tRef: 210,
  alphaInf: 0.18,
  venusA100: 4.645e-4,
  venusExp: 1.19,
  venusP: 9.2e6,
} as const;
/** P/V: H2/He transport properties (§4.3) [verify NIST]. */
export const H2_TRANSPORT = {
  mu0: 6e-6,
  muExp: 0.7,
  k0: 0.12,
  kExp: 0.8,
  cp: 1.43e4,
  tRef: 150,
} as const;
/**
 * P/V: Sutherland viscosity law mu = mu0 (T/T0)^1.5 (T0 + S)/(T + S), White 2006 "Viscous Fluid Flow" Table 1-2
 * (N2: 1.663e-5 Pa s, S 107 K; CO2: 1.370e-5 Pa s, S 222 K). Only used for the S2/S3 Reynolds gate. The Mars
 * Re(4 mm) margin against 47 is ~4 %, so these decide R4 [verify].
 */
export const SUTHERLAND = {
  T0: 273.15,
  N2: { mu0: 1.663e-5, S: 107 },
  CO2: { mu0: 1.37e-5, S: 222 },
} as const;

/**
 * Earth reference air (§1 "Earth reference"). ASSUMPTION: fixed ISA-like constants (288 K, 1 atm, the engine's earth
 * preset mu 29, gamma 1.4) rather than the live engine Earth preset. Gives c 340 m/s, rho 1.227, Z 417.
 */
export const EARTH_REF = { T: 288, P: 101325, mu: 29, gamma: 1.4, g: 9.81 } as const;

// ---------- wind (§6.5) ----------
/** C: surface share of the thermal wind, Earth-calibrated (0.105 x 66.8 = 7.0 m/s). inferred_from_analog. */
export const K_SURF = 0.105;
/** C: circulation band amplitudes (trades, westerlies, polar easterlies, locked terminator). */
export const A_T = 0.7;
export const A_W = 1.0;
export const A_P = 0.4;
export const A_L = 1.2;
/** §6.5 item 2: westerlies end at min(2 phiH, 1.45 rad). */
export const POLAR_EDGE_MAX = 1.45;
/** C/P: sea-breeze gravity-current coefficient and boundary-layer depth (m) (Simpson 1994 [verify]). */
export const K_BR = 0.4;
export const H_BL = 500;
export const COAST_FADE_KM = 20;
/** C: wind floor where there is air, m/s. */
export const U_MIN = 0.3;
/** C: hill speed-up and shelter (Jackson & Hunt 1975 [verify]); relief at which speed-up saturates, km. */
export const SPEEDUP = 0.8;
export const SHELTER = 0.4;
export const RELIEF_SAT_KM = 1.0;
/** P: aerodynamic roughness lengths, m (log law). */
export const Z0_SEA = 2e-4;
export const Z0_LAND = 0.03;
/** C: jet height on Earth (km) and the Earth scale height it is scaled by (km). */
export const Z_JET_EARTH = 10;
export const H_EARTH_KM = 8.5;
/** C: modified Rankine core radius as a share of the storm radius; eye share of Rm; reach in storm radii. */
export const RANKINE_RM = 0.15;
export const EYE_FRAC = 0.4;
export const CYCLONE_REACH = 3;
/** C: turbulence intensity floor [SS §3]. */
export const I_U_MIN = 0.05;
/** C: Earth reference wind (§1), m/s, and the Earth 2 m land turbulence intensity [SS 1.3]. */
export const U_E_REF = 7;
export const IU_LAND = 0.24;
export const IU_SEA = 0.11;
/** C: gas-giant roar turbulence intensity; the same value #113 bakes S12 with (dspTuning GAS_IU), passed in the S12 params. */
export const GAS_IU = 0.15;
/** C (R8): flow beds below this wind are "still air" (silent), m/s. */
export const FLOW_MIN_U = 1;
/** C (R8): a present bed must be within this of the loudest present bed, dB. */
export const PRESENCE_RANGE_DB = 40;
/** C (blue F4a): a ground bed whose area and broadband loss exceeds this is absorption-dead, dB. */
export const ABS_DEAD_DB = 60;
/**
 * P: the engine's hurricane maximum (core.js worldUi): sqrt(eff (Tmax - To)/To Lv qst Ck), shown only for water with
 * EB.stats.max > 299.65 K and cyclones present.
 */
export const HURRICANE = {
  Tmin: 299.65,
  To: 200,
  eff: 0.9,
  Lv: 2.5e6,
  ck: 0.2,
  PsMin: 0.1,
  VmaxCap: 100,
} as const;
// R9: PsMin (bar) and VmaxCap (m/s, model_dependent: Emanuel potential intensity rarely exceeds ~90 m/s) are rulings.

// ---------- sources (§7) ----------
/** P: Roshko 1954 (NACA TN-3169) laminar shedding: St = A (1 - B/Re) for RE_MIN <= Re <= ROSHKO_RE_MAX, else ST_HIGH. */
export const ST_HIGH = 0.2;
export const RE_MIN = 47;
export const ROSHKO_A = 0.212;
export const ROSHKO_B = 21.2;
export const ROSHKO_RE_MAX = 200;
/** C (Moon): grit size for the hiss and ridge obstacle sizes for the whistles, m. */
export const HISS_D_M = 0.004;
export const WHISTLE_D_M = [0.006, 0.0035, 0.0022] as const;
/** P: Pierson-Moskowitz Hs = 0.22 U^2/g, Tp = 7.14 U/g [SS 2.1]. No fetch cap is applied (no fetch formula). */
export const PM_H = 0.22;
export const PM_T = 7.14;
/** P/V: wave onset wind, m/s. Water [verify]; methane Hayes et al. 2013. Others reuse water (no liquid viscosity in §4.4). */
export const U_WAVE_WATER = 1.5;
export const U_WAVE_METHANE = 0.6;
/** P: whitecap fraction W = A U^B (Monahan), zero below WHITECAP_MIN_U; event rate 0.35 (U/8)^3 per s (Moon). */
export const WHITECAP_A = 3.84e-6;
export const WHITECAP_B = 3.41;
export const WHITECAP_MIN_U = 3.5;
export const WHITECAP_RATE0 = 0.35;
export const WHITECAP_RATE_U = 8;
/** P (V spectrum): Bolin & Abom 2010 shore SPL 60 dB at Hs 0.4 m to 78 dB at 2 m. */
export const SURF_DB_H04 = 60;
export const SURF_DB_H2 = 78;
/** P: raindrop drag coefficient for large deformed drops [SS 4.2]; Earth max drop radius (R3) and water/air values. */
export const DROP_CD = 0.8;
export const DROP_R_EARTH_M = 3.25e-3;
/** P: Earth water reference for m_f and drop scaling (998 kg/m3, 0.0728 N/m). */
export const WATER_RHO = 998;
export const WATER_SIGMA = 0.0728;
/** P: R2 bubble size-break exponent (Deane & Stokes 2002 Hinze scale). */
export const MF_SIZE_EXP = 0.6;
/** C: rain gain terms, dB. */
export const RAIN_GAIN_DB = 58;
export const CNV_RAIN_DB = 4;
export const STORM_RAIN_DB = 8;
/** P/C: snow muffling above 1 kHz, dB. */
export const SNOW_DB = 8;
/** P/C/V: saltation threshold (Bagnold form, Earth-calibrated u*t 0.2 m/s), grain size, CO2 cohesion [verify]. */
export const SAND_DP = 1e-4;
export const SAND_A = 0.136;
export const SAND_U10_PER_USTAR = 23;
export const SAND_CO2_COHESION = 1.8;
export const SAND_RHO_SILICATE = 2650;
export const SAND_RHO_ORGANIC = 1000;
/** C: U_ref floor on rocky worlds (§9.4), m/s. */
export const U_REF_MIN = 2;
/** C: river discharge from hydro R (inverts the engine line width), reference flow and slope (ASSUMPTION). */
export const RIVER_Q0 = 50;
export const RIVER_Q_REF = 100;
export const RIVER_S_REF = 0.01;
/** C (ASSUMPTION): crust samples count this much towards the lava bed. */
export const CRUST_WEIGHT = 0.3;
/** C: bed length and §9.2 group sample rates, Hz. Thunder in the 29 kHz group so 2^20 samples (36.2 s) hold 35 s. */
export const BED_N = 2 ** 20;
export const BED_RATE = { wind: 32000, sea: 30000, rain: 31000, low: 29000 } as const;
/** C: thunder variants' representative distances, m (113 §4): two near cracks, two far rolls. */
export const THUNDER_VARIANT_D_M = [400, 800, 5000, 12000] as const;

// ---------- weather (§8) ----------
/** C: maximum flashes per minute inside the audible radius. */
export const LIGHTNING_MAX_PER_MIN = 6;
export const LIGHTNING_SEED_XOR = 0x5eed7;
/** §8.2 deep mixed-phase convection needed on rocky exoplanets. */
export const LIGHTNING_CNV_MIN = 0.3;
/** §8.3 Jupiter: lightning mostly poleward of 40 deg [SS W2]. */
export const JUPITER_LAT_DEG = 40;
export const JUPITER_LOW_LAT_FACTOR = 0.3;
/** §8.2 worlds with observed lightning (engine preset ids and their card aliases). */
export const LIGHTNING_OBSERVED = ['earth', 'jup', 'sat', 'ref-jupiter', 'ref-saturn'] as const;
export const JUPITER_IDS = ['jup', 'ref-jupiter'] as const;
/**
 * P: thunder peak (Few 1967 averaged 200 Hz on Earth; Few 1969 f_m = 0.63 c0 sqrt(P0/E_l)). E_l is calibrated so Earth
 * peaks at 200 Hz (1.16e5 J/m, ~17x below Few's physical 2-4e6 J/m); only ratios between worlds are used (derived, calibrated).
 */
export const THUNDER_FM_EARTH = 200;
export const THUNDER_FEW_K = 0.63;
/** P/C: roll duration, audible-range cap, loss for R_aud (30 dB = 3.45 Np), crack distance, level at 1 km. */
export const THUNDER_MAX_S = 35;
export const THUNDER_BASE_S = 0.5;
export const THUNDER_ROLL_K = 0.12;
export const THUNDER_RANGE_CAP_KM = 25;
export const THUNDER_LOSS_NP = 3.45;
export const THUNDER_CRACK_M = 1000;
export const THUNDER_L1KM_DB = 100;
/** C / WCAG 2.3.1: flash timing. */
export const FLASH_MS = 120;
export const FLASH_OPACITY = 0.25;
export const FLASH_MIN_GAP_S = 2;
/** C (ASSUMPTION): strikes older than this when a tick arrives (after a pause) are dropped. */
export const STRIKE_STALE_S = 1;
/** C: overlay rain rules (§8.5). */
export const RAIN_VIS_MIN = 0.05;
export const RAIN_VIS_FULL = 1.5;
export const RAIN_CNV_BOOST = 0.6;
export const RAIN_STREAKS_MAX = 600;
export const SNOW_FLAKES_MAX = 400;
export const SNOW_FALL_MS = 1;
export const CLOUD_BASE_DEFAULT_KM = 5;
/** C (ASSUMPTION): neutral grey the rain tint is mixed towards, and the mix share. */
export const TINT_GREY: readonly [number, number, number] = [0.55, 0.55, 0.57];
export const TINT_MIX = 0.7;

// ---------- weather overlay (§8.5, issue #117). Presentation only: every value here is `artistic`. ----------
/** §8.5: the overlay draws at most this often (every other frame at 60). */
export const OVERLAY_MAX_FPS = 30;
/** Red M7: the overlay is soft; it never draws above CSS resolution (the fly engine itself runs at DPR 1). */
export const OVERLAY_DPR_CAP = 1;
/** Blue 16 (ASSUMPTION): a weather snapshot older than this (s) is not drawn (tab hidden, ambience stopped). */
export const OVERLAY_SNAPSHOT_STALE_S = 0.5;
/** §8.5 rain layers: parallax per layer (spec), the depth of the near layer (m, artistic) and the layer shares. */
export const RAIN_PARALLAX: readonly [number, number, number] = [1, 0.6, 0.35];
export const RAIN_NEAR_M = 2;
export const RAIN_LAYER_SHARE: readonly [number, number, number] = [0.25, 0.35, 0.4];
/** Blue 18: widths (CSS px) and opacities per layer, raised for a projector [verify on the A15 + projector]. */
export const RAIN_WIDTH_PX: readonly [number, number, number] = [2, 1.5, 1.5];
export const RAIN_ALPHA: readonly [number, number, number] = [0.55, 0.4, 0.35];
/** Blue 22: the streak lean is clamped to this (rad). */
export const RAIN_LEAN_MAX_RAD = Math.PI / 3;
/** §8.5 snow: flake size per layer (CSS px), lateral wobble amplitude (px at the near layer) and rate (rad/s). */
export const SNOW_SIZE_PX: readonly [number, number, number] = [3, 2, 1.5];
export const SNOW_WOBBLE_PX = 6;
export const SNOW_WOBBLE_RAD_S = 1.3;
/** §8.5 bolt: return strokes per group (coordinator H1: 2 to 3, never 4), their spacing, bright time and fade (s). */
export const BOLT_STROKES_MIN = 2;
export const BOLT_STROKES_MAX = 3;
export const BOLT_STROKE_GAP_S = 0.05;
export const BOLT_BRIGHT_S = 0.03;
export const BOLT_FADE_S = 0.12;
/** H5: a strike delivered later than this after its t0 shows no strokes, only the glow. */
export const BOLT_LATE_S = 0.05;
/** §8.5: white with a faint blue tint. Colour is not from data (the card has no gas composition). */
export const BOLT_RGB: readonly [number, number, number] = [0.86, 0.91, 1];
/** Bolt core and glow line widths (CSS px). */
export const BOLT_CORE_PX = 2.5;
export const BOLT_GLOW_PX = 8;
/** Red 3: the bolt is clipped to the pane grown by this share of its height on every side. */
export const BOLT_CLIP_MARGIN = 0.25;
/** Blue 17: below this projected length (px) the bolt is not drawn, only its glow. */
export const BOLT_MIN_PX = 12;
/** Bolt shape: midpoint-displacement levels, lateral jitter (share of the segment length), branch count range. */
export const BOLT_LEVELS = 3;
export const BOLT_JITTER = 0.12;
export const BOLT_BRANCHES: readonly [number, number] = [1, 2];
/**
 * H4 / WCAG 2.3.1: the small-area limit, 25% of a 10 degree field at 1024 x 768 (341 x 256 px = 21 824 px2),
 * scaled to the pane. A bolt whose lit area is at or above it never restrikes (one flash per group).
 */
export const WCAG_SMALL_AREA_PX2 = 21824;
export const WCAG_REF_PX2 = 1024 * 768;
/** §8.5 glow: cloud glow 0.35 (spec), deck flicker and edge glow at FLASH_OPACITY; one pulse per group. */
export const CLOUD_GLOW_OPACITY = 0.35;
export const GLOW_ATTACK_S = 0.03;
export const GLOW_FADE_S = 0.15;
/** §8.5 safe glow (reduced motion or Flashes off): 1 s at 0.15 opacity, raised cosine. */
export const SAFE_GLOW_OPACITY = 0.15;
export const SAFE_GLOW_S = 1;
/** Glow sizes: radial radius as a share of the pane height, edge glow width as a share of its width. */
export const CLOUD_GLOW_R = 0.25;
export const DECK_GLOW_R = 0.3;
export const EDGE_GLOW_W = 0.15;
/** H2: near plane in camera space, km. */
export const NEAR_KM = 0.1;
/** H3: the engine's drawn deck (core.js uCloudKm = max(zc, 0.3)). */
export const DECK_MIN_KM = 0.3;

// ---------- levels (§11) ----------
/** C (ASSUMPTION): minimum slant distance, m (spec names D_MIN without a value). T4's place.ts uses the same value. */
export const D_MIN_M = 1;
export const L_TARGET = 70;
export const G_PRESENT_MAX = 30;
export const STAGE_WINDOW_DB = 24;
export const STAGE_HEADROOM_DB = 6;
export const LEVEL_NOTE_MIN_DB = 3;
export const PAN_MAX = 0.8;
/** §11.2 low-pass where alpha d = 0.3466 Np (-3 dB), searched over 20 Hz to 16 kHz; broadband loss at 250 Hz. */
export const LP_LOSS_NP = 0.3466;
export const LP_F_MIN = 20;
export const LP_F_MAX = 16000;
export const BROADBAND_F = 250;
/** Gain for a physically silent bed, dB (never windowed up). */
export const SILENT_DB = -120;
/** §11.1 reference listener height over the reference plane, m. */
export const REF_LISTENER_M = 2;
/** C: Earth reference levels, dB SPL (§11.3); surf follows Bolin & Abom. */
export const L_REF = {
  wind: 55,
  hissRel: -10,
  sea: 62,
  rain: 58,
  river: 60,
  lava: 65,
  sand: 50,
  gas: 60,
  thunder: 100,
} as const;
/** C: live-caption minimum interval (consumed by T6). */
export const CAPTION_MIN_S = 3;

// ---------- live mixing and lifecycle (§10, §13; #116) ----------
/** C: mixer tick rate, Hz (§10). */
export const AMBIENCE_UPDATE_HZ = 10;
/** C: bed gain and filter time constants, s (§10). */
export const GAIN_TAU_S = 0.15;
export const FILTER_TAU_S = 0.1;
/** C: fade-out on every Fading trigger, s (§13); re-bake crossfade, s; physics-change debounce, ms (§9.6). */
export const FADE_S = 0.6;
export const REBAKE_XFADE_S = 1.0;
export const REBAKE_DEBOUNCE_MS = 800;
/** C (#116, red H4): a fade's time constant is its length / 7, so the level is −61 dB when the sources stop. */
export const FADE_TAU_DIVISOR = 7;
/** C (#116): wall-clock margin after a fade before the sources are stopped and disconnected, s. */
export const STOP_MARGIN_S = 0.05;
/** C (§13): beds stay cached this long after the soundscape goes idle, ms. */
export const KEEP_ALIVE_MS = 120_000;
/** C (#116, ASSUMPTION): AudioParam dead bands; a smaller change is not written (keeps the tick under 1 ms). */
export const MIX_DEADBAND_DB = 0.25;
export const MIX_DEADBAND_HZ_FRAC = 0.02;
export const MIX_DEADBAND_PAN = 0.02;
export const MIX_DEADBAND_RATE = 0.005;
/** C (#116, ASSUMPTION): the snow high shelf's corner, Hz (§11: "8 dB above 1 kHz"). */
export const SNOW_SHELF_HZ = 1000;
/** C (§10 node budget): live plus pending events at once. */
export const EVENT_MAX = 4;
/** C (#116, blue 23): thunder further than this many seconds of travel is not played. */
export const THUNDER_MAX_DELAY_S = 15;
/** C (#116, C8): the strike scheduler runs this far ahead of now, so the overlay hears of a strike ≥ 150 ms early. */
export const STRIKE_LOOKAHEAD_S = 0.3;
/** V: lava vent-burst events per minute (§7 S8 gives no rate). null = not fired (refused, not invented). [verify] */
export const VENT_BURST_PER_MIN: number | null = null;

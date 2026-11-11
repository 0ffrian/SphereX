"""Text of the reviewed `// @deviation` blocks the world-engine extractor inserts between verbatim slices.

Generated from the committed engine files (PR #89 review, issue #93); extract-world-engine.py places each one.
Each block is copied byte for byte, from its `// @deviation` line to its `// @end-deviation` line.
"""

PRESETS_89_REVIEW_1 = r'''// @deviation (#89 review 1) water q 0.02 -> 0.01, outside the verbatim block so it stays byte-identical. With
// 0.02 an Earth-like world saturates at the ground ("Clouds form at: 0 km up"); 0.01 puts Earth's cloud base about
// 0.7 km up (the lifting condensation level is typically 0.5 to 1.5 km), the same value as physics/fluids.ts (Q-241).
FLUIDS.water.q = 0.01;
// @end-deviation'''

PRESETS_89_REVIEW_2 = r'''// @deviation (#89 review 2) CO2 liquid-vapour line. The prototype's `Tb` for CO2 is the sublimation point
// (194.7 K < Tt), so its boiling test can never give a liquid. These are the data core.js needs to draw the
// boiling curve up from the triple point instead: Lv, the molar enthalpy of vaporisation near the triple point
// (about 15.3 kJ/mol, NIST Chemistry WebBook, CO2 phase-change data, [verify]: not re-opened in this session),
// and the critical point (304.13 K, 7.3773 MPa; Span and Wagner 1996, J. Phys. Chem. Ref. Data 25, 1509),
// where the liquid-vapour line ends.
FLUIDS.co2.Lv = 15300;
FLUIDS.co2.Tc = 304.13;
FLUIDS.co2.Pc = 7.3773e6;
// @end-deviation'''

PRESETS_93_3_1 = r'''// @deviation (#93 3.1) critical points for every fluid, so no sea stands above its critical point (core.js caps the
// boiling line at Tc and calls the fluid supercritical above Tc and Pc). Handbook constants of the pure fluid, as the
// NIST Chemistry WebBook lists them: water 647.096 K, 22.064 MPa (IAPWS-95, Wagner and Pruss 2002); methane
// 190.564 K, 4.5992 MPa (Setzmann and Wagner 1991); ammonia 405.40 K, 11.333 MPa (Tillner-Roth et al. 1993);
// nitrogen 126.192 K, 3.3958 MPa (Span et al. 2000). Same values as physics/fluids.ts.
// The ammonia-water mixture has a critical locus between pure ammonia (405 K) and pure water (647 K) that depends
// on the mix, which the prototype does not set; the pure-ammonia end is used, so the engine never draws a liquid
// where the ammonia end would be supercritical (a conservative choice, model_dependent) [verify].
FLUIDS.water.Tc = 647.1; FLUIDS.water.Pc = 22.064e6;
FLUIDS.methane.Tc = 190.56; FLUIDS.methane.Pc = 4.599e6;
FLUIDS.ammonia.Tc = 405.4; FLUIDS.ammonia.Pc = 11.33e6;
FLUIDS.nitrogen.Tc = 126.19; FLUIDS.nitrogen.Pc = 3.3958e6;
FLUIDS.ammoniaWater.Tc = 405.4; FLUIDS.ammoniaWater.Pc = 11.33e6;
// @end-deviation'''

CORE_L1705_93_3_2 = r'''// @deviation L1705 (#93 3.2) the latent heat in the saturation pressure. The prototype used one heat for the whole
// curve: for water the 373 K heat of vaporisation (1,537 Pa at 288 K against 1,706 Pa measured), for CO2 the
// sublimation heat above the triple point too (3.36 MPa at 250 K against 1.79 MPa). Now:
//  - water: Murphy and Koop 2005 (QJRMS 131, 1539), eq. 7 over ice below the triple point and eq. 10 over liquid
//    above it (their fit is for 123 to 332 K; carried to 373.15 K it is 0.6 % above IAPWS-95). Above 373.15 K the
//    curve continues with Clausius-Clapeyron and the prototype's 373 K heat F.L, from the fit's value at 373.15 K.
//  - CO2 (any fluid with F.Lv): the vaporisation heat F.Lv above the triple point, the sublimation heat F.L below.
//  - other fluids: the prototype's line, unchanged. Same as physics/fluids.ts psatFn.
function psatMK(T) {
  if (T < 273.16) return Math.exp(9.550426 - 5723.265 / T + 3.53068 * Math.log(T) - 0.00728332 * T);
  var t = Math.min(T, 373.15), p = Math.exp(54.842763 - 6763.22 / t - 4.21 * Math.log(t) + 0.000367 * t + Math.tanh(0.0415 * (t - 218.8)) * (53.878 - 1331.22 / t - 9.44523 * Math.log(t) + 0.014025 * t));
  return T > 373.15 ? p * Math.exp(FLUIDS.water.L / 8.314 * (1 / 373.15 - 1 / T)) : p;
}
function psatFn(F) {
  if (F === FLUIDS.water) return psatMK;
  if (F.Lv > 0) return function (T) { return F.Pt * Math.exp((T >= F.Tt ? F.Lv : F.L) / 8.314 * (1 / F.Tt - 1 / T)); };
  return function (T) { return F.Pt * Math.exp(F.L / 8.314 * (1 / F.Tt - 1 / T)); };
}
// @end-deviation'''

CORE_L1727_89_REVIEW_2 = r'''// @deviation L1727 (#89 review 2): CO2 can be liquid. The prototype anchors the boiling point at the one-atmosphere
// point F.Tb, but for CO2 that is the sublimation point (194.7 K, below its triple point 216.58 K), so `F.Tb > F.Tt`
// was never true and CO2 was never liquid at any pressure. When Tb < Tt the liquid-vapour line is drawn up from the
// triple point instead, Clausius-Clapeyron with the enthalpy of vaporisation F.Lv (presets.js):
//   Tb(P) = [1/Tt - R ln(P/Pt) / Lv]^-1 for Pt < P, capped at the critical temperature F.Tc (no boiling above Pc).
// Every other fluid keeps the prototype's line exactly.
  var Pa = Ps * 1e5, subl = F.Tb < F.Tt, canLiquid = Pa > F.Pt && (subl ? F.Lv > 0 : F.Tb > F.Tt), Tb = !canLiquid ? F.Tt : subl ? (Pa >= F.Pc ? F.Tc : Math.min(F.Tc, 1 / (1 / F.Tt - 8.314 * Math.log(Pa / F.Pt) / F.Lv))) : 1 / (1 / F.Tb - 8.314 * Math.log(Pa / 101325) / F.L);
// @end-deviation'''

CORE_L1727_93_3_1 = r'''// @deviation L1727 (#93 3.1) every fluid's liquid-vapour line ends at its critical point (F.Tc, F.Pc in presets.js):
// the boiling point is capped at Tc, and at or above Pc it is Tc itself (no boiling: a compressed liquid below Tc,
// a supercritical fluid above it). Same rule as physics/fluids.ts boilingPointK.
  var superC = Pa >= F.Pc; if (canLiquid) Tb = superC ? F.Tc : Math.min(Tb, F.Tc);
// @end-deviation'''

CORE_L1734_93_3_6 = r'''// @deviation L1734 (#93 3.6) the inner edge (runaway greenhouse) depends on the planet's mass. Kopparapu et al. 2014
// (ApJL 787, L29, Table 1, checked against arXiv:1404.5292): S_eff = S0 + a T + b T^2 + c T^3 + d T^4, T = Teff -
// 5780 K, for 0.1, 1 and 5 Earth masses (the 1 Earth-mass row is the prototype's). Between rows the limit is
// interpolated in log mass; outside 0.1 to 5 Earth masses the nearest row is used (no extrapolation). measured
// coefficients of a published model: the limit is model_dependent. Same table as physics/climateBudget.ts.
  var KOP14 = [[0.1, 0.99, 1.209e-4, 1.404e-8, -7.418e-12, -1.713e-15], [1, 1.107, 1.332e-4, 1.58e-8, -8.308e-12, -1.931e-15], [5, 1.188, 1.433e-4, 1.707e-8, -8.968e-12, -2.084e-15]];
  var kopS = function (r) { return r[1] + r[2] * tS + r[3] * tS * tS + r[4] * tS * tS * tS + r[5] * tS * tS * tS * tS; };
  var lMe = clamp(Math.log(p.Me), Math.log(0.1), Math.log(5)), kLo = lMe < 0 ? KOP14[0] : KOP14[1], kHi = lMe < 0 ? KOP14[1] : KOP14[2];
  sIn = lerp(kopS(kLo), kopS(kHi), (lMe - Math.log(kLo[0])) / Math.log(kHi[0] / kLo[0]));
// @end-deviation'''

CORE_L1736_93_3_6 = r'''// @deviation L1736 (#93 3.6) a runaway greenhouse no longer keeps a mild surface (K2-18 b read "runaway" at 401 K).
// While the ocean evaporates the outgoing radiation is held at the steam limit, 282 W/m^2 (Goldblatt et al. 2013,
// Nat. Geosci. 6, 661; RUNAWAY.olrLim), so the surface warms until it radiates through the near-infrared windows:
// the post-runaway state. Its surface temperature depends on the steam column: about 1,500 K under 50 bar of steam and
// about 1,800 K under 260 bar (one Earth ocean), from the radiative-convective models of Boukrouche et al. 2021
// (ApJ 919, 130) as quoted by Dorn and Lichtenberg 2021 (ApJL 922, L4). The engine takes the steam pressure to be
// the surface pressure Ps and interpolates in ln P through those two points, extrapolated outside them [verify]:
// model_dependent. When that is hotter than the grey-greenhouse Ts, Ts takes it and tau is set so the grey model
// balances there (the energy budget sees both); the scale height follows Ts. ebStep holds each cell's outgoing
// radiation at olrLim until the cell reaches Tpost.
  var RUNAWAY = { olrLim: 282, P1: 50, T1: 1500, P2: 260, T2: 1800 }, Tpost = null;
  if (runaway) {
    Tpost = RUNAWAY.T1 + (RUNAWAY.T2 - RUNAWAY.T1) * Math.log(Ps / RUNAWAY.P1) / Math.log(RUNAWAY.P2 / RUNAWAY.P1);
    if (Tpost > Ts) { Ts = Tpost; tau = (Math.pow(Ts / Teq, 4) - 1) / 0.75; H = Rg * Ts / gv; } else Tpost = null;
  }
// @end-deviation'''

CORE_L1736_93_3_1 = r'''// @deviation L1736 (#93 3.1) above both its critical temperature and pressure the fluid is supercritical: one dense
// fluid, no sea surface. The state is set after the runaway test, so supercritical water still counts as boiled off.
  if (!gas && !airless && superC && Ts >= F.Tc && state === 'vapour') state = 'supercritical';
// @end-deviation'''

CORE_L1762_93_3_3 = r'''// @deviation L1762 (#93 3.3) the ORB[p.id] rename below: the tidal heating reads the preset's own orbit extras p.ob
// first (cardToWorld writes the host mass from the card's host_mass_msun, the eccentricity and the obliquity) and the
// prototype's ORB table, which knows only its own presets, after. Code: the @rename only.
// (#93 3.6) the runaway: rename below hands ebStep the post-runaway temperature and the outgoing-radiation limit.
// @end-deviation'''

CORE_L2101_93_3_6 = r'''// @deviation L2101 (#93 3.6) during a runaway greenhouse a cell's outgoing radiation cannot exceed the steam limit
// m.olrLim (282 W/m^2, Goldblatt et al. 2013) until it reaches the post-runaway temperature m.Tpost (worldModel).
        if (m.olrLim && m.Tpost && Tc < m.Tpost && olr > m.olrLim) { olr = m.olrLim; Bl = 0; }
// @end-deviation'''

CORE_L2389_93_3_1 = r'''// @deviation L2389 (#93 3.1) the supercritical state worldModel can now return.
  if (m.state === 'supercritical') state = F.label + ' is supercritical (past its critical point, no sea surface)';
// @end-deviation'''

CORE_L2424_93_3_1 = r'''// @deviation L2424 (#93 3.1) caption for a fluid past its critical point (the runaway caption keeps priority).
  if (!gas && !m.runaway && m.state === 'supercritical') c = F.label + ' is past its critical point here: too hot and too dense to keep a sea, it is one supercritical fluid from the ground up.';
// @end-deviation'''

CORE_L2446_93_3_3 = r'''// @deviation L2446 (#93 3.3) the ORB[p.id] rename below: eccentricity and obliquity come from the preset's own p.ob
// first (cardToWorld), the prototype's ORB table after. Code: the @rename only.
// @end-deviation'''

CORE_L2425_93_1_8 = r'''// @deviation L2425 (#93 1.8) the gas solver runs at most 3 steps a frame, so a giant that needs more (HD 189733 b about
// 4.7 at 60 fps) runs slower than one day per second. The caption then says the real rate (at 60 fps) instead of the
// prototype's fixed "one Earth day".
  if (gas && W.timeSec >= 1000 && GS && GS.dt) { var need93 = W.timeSec / 60 / (p.Rj * 71492e3 / Math.max(m.U, 1)) / GS.dt; if (need93 > 3) W.cap = W.cap.replace('One second here is one Earth day', 'One second here is about ' + fmt(86400 * 3 / need93 / 3600, 0) + ' hours (the simulation runs at most 3 steps a frame)'); }
// @end-deviation'''

GAS_89_REVIEW_7_8 = r'''// @deviation (#89 review 7, 8) the renames below:
//   Great Red Spot r 0.105 -> 0.083 planet radii and aspect 1.38 -> 1.49: about 11,000 x 16,350 km (Simon et al. 2024,
//   PSJ 5, 223); the old values drew it near its size of decades ago.
//   Cyclones (type 2) spin the other way: the stamped swirl is -sgn(lat) for anticyclones (the GRS, white ovals,
//   Oval BA) and must be +sgn(lat) for cyclones, so it is multiplied by -1 for type 2.'''

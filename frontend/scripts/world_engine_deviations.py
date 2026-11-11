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

CORE_L1736_93_3_1 = r'''// @deviation L1736 (#93 3.1) above both its critical temperature and pressure the fluid is supercritical: one dense
// fluid, no sea surface. The state is set after the runaway test, so supercritical water still counts as boiled off.
  if (!gas && !airless && superC && Ts >= F.Tc && state === 'vapour') state = 'supercritical';
// @end-deviation'''

CORE_L2389_93_3_1 = r'''// @deviation L2389 (#93 3.1) the supercritical state worldModel can now return.
  if (m.state === 'supercritical') state = F.label + ' is supercritical (past its critical point, no sea surface)';
// @end-deviation'''

CORE_L2424_93_3_1 = r'''// @deviation L2424 (#93 3.1) caption for a fluid past its critical point (the runaway caption keeps priority).
  if (!gas && !m.runaway && m.state === 'supercritical') c = F.label + ' is past its critical point here: too hot and too dense to keep a sea, it is one supercritical fluid from the ground up.';
// @end-deviation'''

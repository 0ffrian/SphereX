// Physical constants and unit conversions for the physics layer (A7). These are standard
// reference values (CODATA 2018 and IAU 2015 Resolution B3 nominal values), not object data.
// Thresholds and coefficients that come from the spec rules themselves sit in each family module,
// next to the rule that uses them, with the section they come from.

/** Newtonian constant of gravitation, m^3 kg^-1 s^-2 (CODATA 2018). */
export const G = 6.6743e-11;
/** Boltzmann constant, J/K (exact, SI 2019). */
export const K_B = 1.380649e-23;
/** Atomic mass constant, kg (CODATA 2018). */
export const AMU_KG = 1.6605390666e-27;

/** Nominal Jupiter equatorial radius, m (IAU 2015 B3). */
export const R_JUP_M = 7.1492e7;
/** Nominal Earth equatorial radius, m (IAU 2015 B3). */
export const R_EARTH_M = 6.3781e6;
/** Nominal Earth GM, m^3/s^2 (IAU 2015 B3). Earth masses convert through GM, so G cancels. */
export const GM_EARTH = 3.986004e14;
/** Nominal solar radius, m (IAU 2015 B3). */
export const R_SUN_M = 6.957e8;
/** Astronomical unit, m (IAU 2012 B2, exact). */
export const AU_M = 1.495978707e11;
/** Parsec, m (IAU 2015 B2, exact definition 648000/pi au). */
export const PC_M = (648000 / Math.PI) * AU_M;
/** Julian year, s. */
export const YEAR_S = 365.25 * 86400;
/** 10^51 erg in joules: the E51 unit of A7.5. */
export const E51_J = 1e44;

export const HOUR_S = 3600;

/**
 * A7.1 rule threshold shared by the physics layer and the viewer: lava glow starts near 700 K.
 * Both use `Teq > LAVA_START_K` (glow strength is 0 at exactly 700 K), so they never disagree.
 */
export const LAVA_START_K = 700;

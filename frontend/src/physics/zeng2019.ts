// Twin of `backend/app/core/classify/zeng2019.py` (EARTHLIKE_ROCKY only): the Zeng et al. 2019 mass-radius
// table for an Earth-like rocky planet (32.5% Fe + 67.5% MgSiO3 by mass). [verify] The values are copied
// unchanged from the backend (source: Zeng, Jacobsen, Sasselov et al. 2019, PNAS 116, 9723, arXiv:1906.04253,
// tables from https://lweb.cfa.harvard.edu/~lzeng/planetmodels.html, retrieved 2026-11-07, as recorded there).
// Mass in Earth masses, radius in Earth radii. Radius is linear in ln(mass) between rows; outside the table
// the curve is undefined and the functions return null (no extrapolation). The twin test
// (zeng2019.test.ts) compares the forward function with values the Python helper produced.

export const EARTHLIKE_ROCKY: readonly (readonly [number, number])[] = [
  [0.003, 0.1648],
  [0.0042, 0.1831],
  [0.0059, 0.2036],
  [0.0082, 0.2267],
  [0.0114, 0.2524],
  [0.0159, 0.281],
  [0.0221, 0.3128],
  [0.0306, 0.3476],
  [0.042, 0.3854],
  [0.0575, 0.4265],
  [0.0779, 0.4697],
  [0.1046, 0.515],
  [0.1393, 0.5625],
  [0.1831, 0.61],
  [0.2402, 0.6608],
  [0.3142, 0.715],
  [0.4093, 0.7725],
  [0.5304, 0.833],
  [0.6835, 0.8964],
  [0.8756, 0.9625],
  [1.115, 1.0309],
  [1.4114, 1.1015],
  [1.7763, 1.1741],
  [2.2233, 1.2485],
  [2.7682, 1.3245],
  [3.4297, 1.4019],
  [4.2296, 1.4806],
  [5.1932, 1.5604],
  [6.3505, 1.6412],
  [7.7363, 1.7228],
  [9.3912, 1.8052],
  [11.3628, 1.8883],
  [13.7066, 1.9719],
  [16.487, 2.0559],
  [19.7797, 2.1404],
  [23.6585, 2.2246],
  [28.152, 2.3063],
  [33.3138, 2.3848],
  [39.2487, 2.4602],
  [46.0693, 2.5325],
  [53.8965, 2.6019],
  [62.8692, 2.6683],
  [73.1339, 2.7319],
  [84.8337, 2.7924],
  [98.1197, 2.8497],
  [113.1545, 2.9034],
  [130.1162, 2.9536],
  [149.2054, 3.0002],
  [170.6534, 3.0431],
];

/** Radius (Earth radii) on the Earth-like rocky curve at `massMearth`; null outside the table. */
export function rockyRadiusForMass(massMearth: number): number | null {
  if (!(massMearth > 0) || !Number.isFinite(massMearth)) return null;
  const t = EARTHLIKE_ROCKY;
  if (massMearth < t[0]![0] || massMearth > t[t.length - 1]![0]) return null;
  let lo = 0;
  let hi = t.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid]![0] < massMearth) lo = mid + 1;
    else hi = mid;
  }
  if (t[lo]![0] === massMearth) return t[lo]![1];
  const [m0, r0] = t[lo - 1]!;
  const [m1, r1] = t[lo]!;
  return r0 + ((r1 - r0) * (Math.log(massMearth) - Math.log(m0))) / (Math.log(m1) - Math.log(m0));
}

/**
 * The mass (Earth masses) an Earth-like rocky planet of radius `radiusRearth` has: the inverse of
 * `rockyRadiusForMass` (radius rises with mass, so the table inverts exactly). Null outside the
 * table's radius range. Model-dependent: it assumes the Earth-like composition.
 */
export function rockyMassForRadius(radiusRearth: number): number | null {
  if (!(radiusRearth > 0) || !Number.isFinite(radiusRearth)) return null;
  const t = EARTHLIKE_ROCKY;
  if (radiusRearth < t[0]![1] || radiusRearth > t[t.length - 1]![1]) return null;
  let lo = 0;
  let hi = t.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid]![1] < radiusRearth) lo = mid + 1;
    else hi = mid;
  }
  if (t[lo]![1] === radiusRearth) return t[lo]![0];
  const [m0, r0] = t[lo - 1]!;
  const [m1, r1] = t[lo]!;
  const lnM = Math.log(m0) + ((radiusRearth - r0) / (r1 - r0)) * (Math.log(m1) - Math.log(m0));
  return Math.exp(lnM);
}

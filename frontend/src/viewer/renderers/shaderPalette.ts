// R7.7, A6: palettes for the shader-generated kinds, ported from the mock-up (GASK, keyed).
// These are artist colours, not spectra: every colour here is tagged `artistic`, whether it is
// keyed by the card's teq_K or the artist default.
export type Rgb = readonly [number, number, number];
export type KeyedStop = readonly [number, Rgb, Rgb, Rgb, Rgb];

/** Gas-giant palette keyed by equilibrium temperature in K: [T, c0, c1, c2, storm]. */
export const GASK: readonly KeyedStop[] = [
  [60, [0.5, 0.72, 0.78], [0.68, 0.86, 0.9], [0.88, 0.96, 0.98], [0.45, 0.66, 0.74]],
  [100, [0.1, 0.2, 0.55], [0.22, 0.4, 0.8], [0.55, 0.72, 0.95], [0.05, 0.1, 0.35]],
  [130, [0.42, 0.27, 0.17], [0.74, 0.58, 0.4], [0.94, 0.88, 0.76], [0.72, 0.28, 0.16]],
  [200, [0.6, 0.5, 0.32], [0.82, 0.72, 0.5], [0.95, 0.9, 0.74], [0.65, 0.45, 0.25]],
  [600, [0.04, 0.08, 0.28], [0.1, 0.2, 0.55], [0.3, 0.45, 0.8], [0.02, 0.05, 0.18]],
  [1100, [0.03, 0.03, 0.05], [0.1, 0.07, 0.08], [0.25, 0.14, 0.1], [0.02, 0.02, 0.03]],
  [1800, [0.12, 0.03, 0.02], [0.45, 0.14, 0.05], [0.95, 0.5, 0.18], [0.08, 0.02, 0.01]],
];

/** Artist default temperature for the palette when teq_K is unknown (mock-up `o.T || 140`). */
export const DEFAULT_PALETTE_T_K = 140;
/** Mock-up: bodies above this temperature get a self-glow term. Artistic threshold. */
export const GLOW_ABOVE_K = 900;

export type Palette4 = readonly [Rgb, Rgb, Rgb, Rgb];

/** Mock-up `keyed()`: linear interpolation between the two surrounding stops, clamped. */
export function keyed(keys: readonly KeyedStop[], T: number): Palette4 {
  let i = 0;
  while (i < keys.length - 2 && T > keys[i + 1]![0]) i++;
  const a = keys[i]!;
  const b = keys[i + 1]!;
  const t = Math.max(0, Math.min(1, (T - a[0]) / (b[0] - a[0])));
  const mix = (x: Rgb, y: Rgb): Rgb => [
    x[0] + (y[0] - x[0]) * t,
    x[1] + (y[1] - x[1]) * t,
    x[2] + (y[2] - x[2]) * t,
  ];
  return [mix(a[1], b[1]), mix(a[2], b[2]), mix(a[3], b[3]), mix(a[4], b[4])];
}

// Planet land / ocean colours from the mock-up TERRA_FS (artistic).
export const LAND_LOW: Rgb = [0.5, 0.27, 0.16];
export const LAND_LOW_GREEN: Rgb = [0.22, 0.3, 0.17];
export const LAND_HIGH: Rgb = [0.78, 0.6, 0.44];
export const LAND_HIGH_GREY: Rgb = [0.58, 0.57, 0.54];
export const OCEAN_SHALLOW: Rgb = [0.07, 0.32, 0.45];
export const OCEAN_DEEP: Rgb = [0.01, 0.05, 0.17];
export const ICE_COLOUR: Rgb = [0.92, 0.95, 0.98];
export const LAVA_COLOUR: Rgb = [1, 0.33, 0.06];
export const ATMOSPHERE_WATER: Rgb = [0.35, 0.6, 1];
export const ATMOSPHERE_ROCKY: Rgb = [1, 0.55, 0.25];

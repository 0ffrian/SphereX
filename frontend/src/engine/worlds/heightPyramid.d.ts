export interface HeightPyramid {
  w: number;
  h: number;
  data: Float32Array;
}
export const PYR: {
  W: number;
  H: number;
  LEVELS: number;
  TW: number;
  TH: number;
  WARP: number;
  DETAIL: number;
  FINE: number;
};
export function ceilKm(e: number): number;
export function buildPyramid(t: { W: number; H: number; data: Float32Array }): HeightPyramid | null;
export function pyramidCached(t: {
  W: number;
  H: number;
  data: Float32Array;
}): HeightPyramid | null;

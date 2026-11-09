// Issue #42, R7.4: the four colours of a brown dwarf's jets, from the class colour (the plan's
// tint) and the band contrast clamp(2 * ch4_depth_33, 0.1, 0.8) (derived). The darkest and brightest
// bands are the tint scaled down and up by the contrast; the storm colour is darker still. The
// multipliers are display choices (artistic); the tint is the plan's, not a value invented here.
import type { Palette4 } from './shaderPalette';

export function jetPalette(tint: readonly [number, number, number], contrast: number): Palette4 {
  const c = Math.min(0.8, Math.max(0.1, contrast));
  const scale = (k: number): [number, number, number] => [
    Math.min(1, tint[0] * k),
    Math.min(1, tint[1] * k),
    Math.min(1, tint[2] * k),
  ];
  return [scale(1 - 0.75 * c), scale(1 - 0.25 * c), scale(1 + 0.45 * c), scale(1 - 1.0 * c)];
}

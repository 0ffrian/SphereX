// R5.2, R7.5: plan tints are sRGB (what the card palette and the UI show). A shader that mixes or
// emits colour works in linear light, so it must be given the converted value, exactly once.
import { Color, SRGBColorSpace } from 'three/webgpu';
import type { Rgb } from '../planTypes';

/** The linear-light value of an sRGB triple (the same conversion `bodyMaterial` applies to its tint). */
export function srgbToLinear(rgb: Rgb): Rgb {
  const c = new Color().setRGB(rgb[0], rgb[1], rgb[2], SRGBColorSpace);
  return [c.r, c.g, c.b];
}

// R7.7, D-12: reading the shared CPU field from a shader. Moved out of ShaderBody.ts (issue #42) so
// the gas giant, the brown dwarf and the planets share one implementation of the texel lookup.
// The field arrays are uploaded as Float32 DataTextures and read with `textureLoad` (no sampler, so
// float32 filtering support does not matter) and filtered by hand.
/* eslint-disable @typescript-eslint/no-explicit-any -- TSL node graphs are built from untyped proxies */
import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three/webgpu';
import {
  acos,
  atan,
  clamp,
  floor,
  fract,
  ivec2,
  mix,
  mod,
  mx_fractal_noise_float,
  textureLoad,
} from 'three/tsl';

export const TWO_PI = Math.PI * 2;

export function floatTexture(data: Float32Array, w: number, h: number): DataTexture {
  const t = new DataTexture(data, w, h, RGBAFormat, FloatType);
  // Nearest + no mipmaps: the shader uses textureLoad and filters by hand, so float32 filtering
  // support does not matter (WebGPU needs 'float32-filterable' for linear filtering of f32).
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** R6.1 direction -> texel space, in the shader. Row 0 is the north pole. */
export function fieldUV(dir: any) {
  const u = fract(atan(dir.z, dir.x.negate()).div(TWO_PI));
  const v = acos(clamp(dir.y, -1, 1)).div(Math.PI);
  return { u, v };
}

export function bilinear(tex: DataTexture, u: any, v: any) {
  const W = tex.image.width;
  const H = tex.image.height;
  const px = u.mul(W).sub(0.5);
  const py = v.mul(H).sub(0.5);
  const x0 = floor(px);
  const y0 = floor(py);
  const fx = fract(px);
  const fy = fract(py);
  const tap = (dx: number, dy: number) =>
    textureLoad(tex, ivec2(mod(x0.add(dx + W), W).toInt(), clamp(y0.add(dy), 0, H - 1).toInt()));
  return mix(mix(tap(0, 0), tap(1, 0), fx), mix(tap(0, 1), tap(1, 1), fx), fy);
}

/** Visual-only noise, 0..1 centred on 0.5 (finer than the field; seen, not felt). */
export const vnoise3 = (p: any, octaves = 3) =>
  mx_fractal_noise_float(p, octaves, 2.0, 0.5).mul(0.5).add(0.5);

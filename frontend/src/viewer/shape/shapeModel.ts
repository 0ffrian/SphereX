// Issue #43, R7.1 / A7.4: pure logic for shape-model asteroids (no three, no DOM): the level of
// detail to load, the model's resolution, baked ambient occlusion sampling, the Lommel-Seeliger
// law (CPU mirror of the shader) and the rule for regolith detail. Tags are in the comments.
import type { TierName } from '../render/quality';

export type Vec3 = [number, number, number];

// ---- levels of detail --------------------------------------------------------------------------

/**
 * Backend convention (README "Shape models", registry.toml `lod1`): `<slug>.glb` is full detail
 * and `<slug>.lod1.glb` is half the grid (a quarter of the triangles). For a path that is not a
 * .glb or .gltf (an .obj has one level) `lod1` is null.
 */
export function lodUrls(url: string): { lod0: string; lod1: string | null } {
  const m = /^(.*?)(\.(?:glb|gltf))((?:\?.*)?)$/i.exec(url);
  if (!m) return { lod0: url, lod1: null };
  const [, stem, ext, query] = m as unknown as [string, string, string, string];
  if (/\.lod1$/i.test(stem)) return { lod0: url, lod1: url };
  return { lod0: url, lod1: `${stem}.lod1${ext}${query}` };
}

/** R5.5 / D-05: at most this many triangles on screen. Both backend levels are below it. */
export const SHAPE_TRIANGLE_BUDGET = 50_000;

/**
 * On-screen height below which the coarse level is indistinguishable from the fine one (display
 * choice, artistic): a body this small never needs the full-detail mesh.
 */
export const LOD1_MAX_SCREEN_PX = 160;

/**
 * Hysteresis of the 160 px rule: a body on the coarse level goes back to full detail only above
 * this many times `LOD1_MAX_SCREEN_PX`, so a zoom that hovers around the limit does not reload
 * the model every frame. Display choice.
 */
export const LOD_HYSTERESIS = 1.25;

export type LodLevel = 0 | 1;

/**
 * On-screen diameter in CSS pixels of a body of scene radius `radius` seen from `distance` with a
 * vertical field of view of `fovDeg` in a viewport `viewportPx` tall. Null if any input is not a
 * positive finite number (the 160 px rule then does not apply). Pure.
 */
export function bodyScreenPx(
  radius: number,
  distance: number,
  fovDeg: number,
  viewportPx: number,
): number | null {
  const ok = [radius, distance, fovDeg, viewportPx].every((v) => Number.isFinite(v) && v > 0);
  if (!ok || fovDeg >= 180) return null;
  const visibleHeight = 2 * distance * Math.tan((fovDeg * Math.PI) / 360);
  return ((2 * radius) / visibleHeight) * viewportPx;
}

/**
 * Level of detail to draw. The low quality level (phones, WebGL2) takes the coarse model so the
 * frame budget holds (R5.7); other levels take full detail unless the body is small on screen.
 * `screenPx` is the body's on-screen diameter in CSS pixels, when known. Falls back to level 0 when
 * the coarse file does not exist (`hasLod1` false). `current` is the level now drawn: with it, the
 * coarse level is kept until the body is `LOD_HYSTERESIS` times larger than the limit.
 */
export function chooseLod(
  tier: TierName,
  screenPx: number | null,
  hasLod1: boolean,
  current: LodLevel | null = null,
): LodLevel {
  if (!hasLod1) return 0;
  if (tier === 'low') return 1;
  if (screenPx !== null && screenPx > 0) {
    if (screenPx < LOD1_MAX_SCREEN_PX) return 1;
    if (current === 1 && screenPx < LOD1_MAX_SCREEN_PX * LOD_HYSTERESIS) return 1;
  }
  return 0;
}

// ---- size and resolution -----------------------------------------------------------------------

/**
 * Scale that turns a model with bounding-sphere radius `radius` (model units) into scene units
 * where that sphere has radius 1. 0 for a degenerate model (the caller keeps the placeholder).
 */
export function unitScale(radius: number): number {
  return radius > 0 && Number.isFinite(radius) ? 1 / radius : 0;
}

/**
 * Mean edge length of an indexed triangle mesh: the model's resolution, in model units. Every
 * triangle edge is counted once per triangle (shared edges twice; same mean for a closed mesh).
 * Null for an empty or malformed mesh.
 */
export function meanEdgeLength(
  positions: ArrayLike<number>,
  index: ArrayLike<number> | null,
): number | null {
  const triCount = index ? Math.floor(index.length / 3) : Math.floor(positions.length / 9);
  if (triCount === 0) return null;
  const at = (k: number) => (index ? index[k]! : k);
  let sum = 0;
  let n = 0;
  for (let t = 0; t < triCount; t++) {
    for (let e = 0; e < 3; e++) {
      const a = at(t * 3 + e) * 3;
      const b = at(t * 3 + ((e + 1) % 3)) * 3;
      if (b + 2 >= positions.length || a + 2 >= positions.length) return null;
      sum += Math.hypot(
        positions[a]! - positions[b]!,
        positions[a + 1]! - positions[b + 1]!,
        positions[a + 2]! - positions[b + 2]!,
      );
      n++;
    }
  }
  return n > 0 && sum > 0 ? sum / n : null;
}

// ---- regolith (tier 5, artistic) ---------------------------------------------------------------

/** Peak tilt of the regolith normal, radians (artistic display choice; the surface is not imaged). */
export const REGOLITH_MAX_TILT = 0.12;

/**
 * Spatial frequency (cycles per scene unit) above which regolith detail may be added: the finest
 * feature the mesh resolves has a wavelength of two edges (Nyquist), so detail is added only for
 * wavelengths shorter than that and never changes the silhouette (D-33). `edgeScene` is the mean
 * edge in scene units. Null when the resolution is unknown: no regolith is drawn.
 */
export function regolithMinFrequency(edgeScene: number | null): number | null {
  return edgeScene !== null && edgeScene > 0 ? 1 / (2 * edgeScene) : null;
}

// ---- Lommel-Seeliger (A7.4) --------------------------------------------------------------------

/**
 * A7.4 reflectance for dark airless rock: single scattering, radiance factor proportional to
 * `mu0 / (mu0 + mu)` with `mu0 = cos(incidence)` and `mu = cos(emission)`. Scaled by 2 / pi so
 * that at normal incidence and emission it equals the Lambert value 1 / pi (same exposure as the
 * rest of the viewer; the scale is a display choice). 0 on the night side or below the horizon.
 */
export function lommelSeeliger(mu0: number, mu: number): number {
  if (!(mu0 > 0) || !(mu > 0)) return 0;
  return ((2 / Math.PI) * mu0) / (mu0 + mu);
}

// ---- baked ambient occlusion -------------------------------------------------------------------

/**
 * `n` cosine-weighted directions on the hemisphere around +Z (Fibonacci spiral: deterministic, no
 * random numbers). Each direction carries equal weight under cosine weighting.
 */
export function hemisphereDirections(n: number): Vec3[] {
  const out: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n); // radius on the unit disc (Malley's method)
    const phi = i * golden;
    const x = r * Math.cos(phi);
    const y = r * Math.sin(phi);
    out.push([x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))]);
  }
  return out;
}

/**
 * Rays per vertex for the baked AO (display choice; baked once per model). The same for every
 * quality level: the AO is cached on the geometry shared between scenes, so a tier-dependent count
 * would make the picture depend on which tier happened to load the model first (determinism).
 */
export const AO_RAYS = 16;

/**
 * Whether the baked AO is drawn. Pure, so the honesty rule is testable: the AO is `derived`, so it
 * is drawn only when the plan asks for it (`shape.ao`, set from the visible tags) and every mesh
 * has the attribute. The attribute alone is not enough: a cached geometry keeps it after the
 * viewer switches back to Measured only (D-21, D-02).
 */
export function bakedAoDrawn(planAo: boolean | undefined, meshHasAo: readonly boolean[]): boolean {
  return planAo === true && meshHasAo.length > 0 && meshHasAo.every(Boolean);
}

/** Whether the shape material is needed at all, or the plain standard material is enough. */
export function needsShapeMaterial(
  shape: { lommelSeeliger: boolean; regolith: boolean },
  hasAo: boolean,
): boolean {
  return shape.lommelSeeliger || shape.regolith || hasAo;
}

/**
 * Visibility in [0, 1] of a surface point: the fraction of hemisphere directions (around
 * `normal`) that leave the body without hitting it. `blocked(dir)` answers one ray. 1 = open sky,
 * 0 = fully enclosed. The model is derived from the shape (formula: cosine-weighted visibility).
 */
export function aoVisibility(
  normal: Vec3,
  dirs: readonly Vec3[],
  blocked: (dir: Vec3) => boolean,
): number {
  if (dirs.length === 0) return 1;
  // Orthonormal frame (t, b, normal).
  const n = normal;
  const helper: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let tx = helper[1] * n[2] - helper[2] * n[1];
  let ty = helper[2] * n[0] - helper[0] * n[2];
  let tz = helper[0] * n[1] - helper[1] * n[0];
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl;
  ty /= tl;
  tz /= tl;
  const bx = n[1] * tz - n[2] * ty;
  const by = n[2] * tx - n[0] * tz;
  const bz = n[0] * ty - n[1] * tx;
  let open = 0;
  for (const d of dirs) {
    const dir: Vec3 = [
      tx * d[0] + bx * d[1] + n[0] * d[2],
      ty * d[0] + by * d[1] + n[1] * d[2],
      tz * d[0] + bz * d[1] + n[2] * d[2],
    ];
    if (!blocked(dir)) open++;
  }
  return open / dirs.length;
}

/** How much of the baked AO also darkens the direct light (the rest only dims the ambient). */
export const AO_DIRECT_WEIGHT = 0.5;

// ---- self-shadowing ----------------------------------------------------------------------------

export interface ShadowSettings {
  mapSize: number;
  /** Half-width of the orthographic shadow camera, scene units (the body has radius 1). */
  extent: number;
  bias: number;
  normalBias: number;
}

/**
 * Shadow-map settings by quality level (display choice). Crater rims need resolution at low Sun,
 * so High and Medium use 2048 (a 32-bit depth map, about 16 MB) and Low 1024 (about 4 MB, phone budget).
 */
export function shadowSettings(tier: TierName): ShadowSettings {
  return {
    mapSize: tier === 'low' ? 1024 : 2048,
    extent: 1.25,
    bias: -0.0004,
    normalBias: 0.01,
  };
}

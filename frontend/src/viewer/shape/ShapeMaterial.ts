// Issue #43, R7.1 / A7.4: material of a shape-model asteroid (three r187, `three/webgpu`, TSL).
//   - Lommel-Seeliger reflectance (A7.4) through a custom lighting model, so the shadow map
//     (DirectionalLight.castShadow) still multiplies the light colour: crater rims cast shadows.
//   - Baked ambient occlusion from a per-vertex `ao` attribute (shapeModel.bakeAo in ShapeAo.ts).
//   - Fine regolith normals (tier 5, artistic) only at wavelengths below the model's resolution.
// Pure visual shaders: the node graph is only compiled by a renderer, so a GPU is needed to see it.
/* eslint-disable @typescript-eslint/no-explicit-any -- TSL node graphs are built from untyped proxies */
import { LightingModel, MeshStandardNodeMaterial, type PhysicalLightingModel } from 'three/webgpu';
import {
  acos,
  attribute,
  diffuseColor,
  exp,
  float,
  length,
  mix,
  mx_noise_float,
  normalView,
  normalize,
  positionLocal,
  positionViewDirection,
  saturate,
  transformNormalToView,
  vec3,
} from 'three/tsl';
import {
  AO_DIRECT_WEIGHT,
  REGOLITH_TILT_PER_AXIS,
  ROCK_LAMBERT_BLEND,
  ROCK_PHASE_NORM,
  ROCK_PHASE_SLOPE,
  ROCK_PHASE_FLOOR,
} from './shapeModel';

/** A7.4 Lommel-Seeliger lighting: `2/pi * mu0 / (mu0 + mu)`, the CPU twin is `lommelSeeliger`. */
class LommelSeeligerModel extends LightingModel {
  constructor(
    private readonly aoDirect: any | null,
    private readonly rock: boolean = false,
  ) {
    super();
  }

  override direct(input: any): void {
    const { lightDirection, lightColor, reflectedLight } = input;
    const mu0 = saturate(normalView.dot(lightDirection));
    const mu = saturate(normalView.dot(positionViewDirection));
    const ls = mu0.div(mu0.add(mu).max(1e-4)).mul(2 / Math.PI);
    let brdf: any = ls;
    if (this.rock) {
      // Issue #71, Q-210: Lommel-Seeliger blended with Lambert (the CPU twin is `rockReflectance`),
      // dimmed with phase angle. A look (artistic): the weights come from the approved prototype.
      const alpha = acos(lightDirection.dot(positionViewDirection).clamp(-1, 1));
      const phase = exp(alpha.mul(-ROCK_PHASE_SLOPE))
        .add(ROCK_PHASE_FLOOR)
        .mul(1 / ROCK_PHASE_NORM);
      brdf = ls
        .mul(1 - ROCK_LAMBERT_BLEND)
        .add(mu0.mul(ROCK_LAMBERT_BLEND / Math.PI))
        .mul(phase);
    }
    let radiance: any = lightColor.mul(brdf).mul(diffuseColor.rgb);
    if (this.aoDirect) radiance = radiance.mul(this.aoDirect);
    reflectedLight.directDiffuse.addAssign(radiance);
  }

  override indirect(builder: any): void {
    const { ambientOcclusion, irradiance, reflectedLight } = builder.context;
    reflectedLight.indirectDiffuse.addAssign(irradiance.mul(diffuseColor.rgb).mul(1 / Math.PI));
    reflectedLight.indirectDiffuse.mulAssign(ambientOcclusion);
  }
}

export interface ShapeMaterialOptions {
  /** Lommel-Seeliger reflectance (A7.4); false keeps the standard physical lighting. */
  lommelSeeliger: boolean;
  /** The geometry carries a per-vertex `ao` attribute (0..1). */
  hasAo: boolean;
  /**
   * Regolith: cycles per scene unit of the coarsest detail added (from `regolithMinFrequency`), or
   * null for none. Tier 5, artistic.
   */
  regolithFrequency: number | null;
  /** Airless rock of a procedural body (issue #71): Lommel-Seeliger blend and a phase falloff. */
  rock?: boolean;
}

/** Standard-node material with Lommel-Seeliger lighting, baked AO and optional regolith normals. */
export class ShapeMaterial extends MeshStandardNodeMaterial {
  private readonly shapeOptions: ShapeMaterialOptions;

  constructor(options: ShapeMaterialOptions) {
    super();
    this.shapeOptions = options;
    this.roughness = 0.95; // R7.1 (unused by the Lommel-Seeliger model; kept for the spec value)
    if (options.hasAo) {
      // The AO also dims the ambient (context.ambientOcclusion) through the standard `aoNode`.
      this.aoNode = attribute('ao', 'float');
    }
    if (options.regolithFrequency !== null) {
      const p = positionLocal.mul(options.regolithFrequency);
      // Three decorrelated noise samples tilt the normal; amplitude is artistic (tier 5).
      const tilt = vec3(
        mx_noise_float(p.add(vec3(11.1, 0, 0))),
        mx_noise_float(p.add(vec3(0, 23.7, 0))),
        mx_noise_float(p.add(vec3(0, 0, 37.3))),
      ).mul(REGOLITH_TILT_PER_AXIS);
      // `tilt` is in model space (it is sampled at `positionLocal`, so the detail is glued to the
      // surface). Bring it to view space before adding it to `normalView`: the object spins, and
      // an untransformed tilt would slide over the surface as the body turns.
      // r187 `transformNormalToView` NORMALIZES its result, which would turn the small tilt into a
      // unit vector (a tilt of up to ~90 degrees). Keep the direction and restore the length.
      // The tiny z offset only keeps `normalize` away from a zero vector.
      const tiltView = transformNormalToView(tilt.add(vec3(0, 0, 1e-9))).mul(length(tilt));
      this.normalNode = normalize(normalView.add(tiltView));
    }
  }

  override setupLightingModel(): PhysicalLightingModel {
    if (!this.shapeOptions.lommelSeeliger) return super.setupLightingModel();
    const ao = this.shapeOptions.hasAo
      ? mix(float(1), attribute('ao', 'float'), float(AO_DIRECT_WEIGHT))
      : null;
    // The base class types the model as physical; the builder only calls start/direct/indirect.
    return new LommelSeeligerModel(
      ao,
      this.shapeOptions.rock === true,
    ) as unknown as PhysicalLightingModel;
  }
}

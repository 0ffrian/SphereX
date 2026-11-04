// R3.4 RenderParams (produced by the backend: GET /v1/objects/{id}/render-params).
import type { HapticProfile } from './haptics';
import type { ObjectType } from './objectCard';
import type { Tag } from './tags';

// ASSUMPTION: R3.4 references `VisibleMode` and `IRMode`, but no spec defines their fields
// (docs/uml/05-class-data-contract.md; decisions Q-12). They stay opaque until the backend
// contract defines them. Code must not read fields from them yet.
export type VisibleMode = Readonly<Record<string, unknown>>;
export type IRMode = Readonly<Record<string, unknown>>;

export interface Layer {
  id: string;
  tag: Tag;
  description: string;
  requires: string[];
}

export interface RenderTextures {
  albedo: string;
  height: string;
  normal: string;
  roughness?: string;
  height_bin?: string;
}

export interface RenderLighting {
  mode: 'sun' | 'self';
  sun_dir?: [number, number, number];
  phase_angle_deg?: number;
}

export interface RenderParams {
  id: string;
  type: ObjectType;
  generator_version: string;
  seed: number;
  scale_m: number; // physical radius in metres
  layers: Layer[]; // ordered, each with a tag
  textures?: RenderTextures;
  lighting: RenderLighting;
  view_modes: { visible: VisibleMode; spherex_ir?: IRMode };
  haptics: HapticProfile; // R8
  alt_text: string; // R9
  missing: string[]; // layers refused for missing data, shown to the user
}

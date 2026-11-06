// R7.1 `asteroid_shape` (Bennu, Eros, Vesta, DAMIT objects). Pure plan; renderers/build.ts draws it.
//   Requires shape_source and diameter_km. Mesh scaled to the measured diameter (measured), spin
//   from rot_period_h sped up with the factor shown on screen (measured), MeshStandardMaterial
//   with roughness 0.95 and no procedural detail. A mesh that cannot be loaded is a refused layer
//   and the body falls back to a plain sphere with a flat tint (never blank).
import { litBody, PlanBuilder, numberField, type PlanInput } from '../planCommon';
import type { RenderPlan } from '../planTypes';

/**
 * Spin speed-up. R7.1 shows "×1000" as its example of the factor on screen; the exact factor is
 * a display choice (tag: artistic), shown to the user next to the spin.
 */
export const SPIN_SPEEDUP = 1000;

const MESH_EXTENSIONS = /\.(glb|gltf|obj)(\?.*)?$/i;

/**
 * ASSUMPTION (Q-44): `shape_source` is "URL/DOI of mesh" (R3.2) and the renderer loads a mesh only
 * from a same-origin path (`/…` or `./…`) ending in .glb, .gltf or .obj. An http(s) address would
 * bypass the backend cache (D-25) and fail offline, so it is a refused layer, not fetched.
 */
export function isLoadableMeshUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  if (!/^(\/(?!\/)|\.\/)/.test(value)) return false;
  return MESH_EXTENSIONS.test(value);
}

export function planAsteroidMesh(input: PlanInput): RenderPlan {
  const b = new PlanBuilder(input);
  const bodyOk = b.body('diameter_km');

  const url = input.card.shape_source?.value ?? null;
  const meshDrawn = b.draw('mesh', { asset: isLoadableMeshUrl(url) ? url : null });
  const spinDrawn = b.draw('spin');
  b.draw('material');
  if (!bodyOk) b.dropDrawn();

  const period = numberField(input.card, 'rot_period_h');
  const useMesh = bodyOk && meshDrawn;
  if (bodyOk && !useMesh) {
    b.notes.push('Showing a plain sphere at the size on the card instead of the shape model.');
    b.legendBody('Plain sphere at the size on the card.');
  }

  return b.build({
    bodies: bodyOk
      ? [
          litBody('body', [1, 1, 1], b.tint.rgb, {
            meshUrl: useMesh ? url : null,
            segments: [64, 32],
          }),
        ]
      : [],
    spin:
      bodyOk && spinDrawn && period !== null && period > 0
        ? { periodH: period, speedup: SPIN_SPEEDUP }
        : null,
    relief: useMesh ? 'measured' : 'illustrative',
  });
}

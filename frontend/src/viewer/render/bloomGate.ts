// Issue #50 / render-performance roadmap 1.3: does a plan draw anything that can pass the bloom
// threshold? Pure: reads only the plan. Q-67 set the threshold to 2.0 so that only the artistic
// additive layers (nova and nebula cores, flares, loops, beams) reach it; every other body is LDR.
// The rule is conservative: anything not known to be LDR keeps bloom on. Skipping bloom on a frame
// with nothing above the threshold changes no pixel (bloom adds exactly 0 there), and
// e2e/bloomGate.spec.ts checks that byte for byte on every fixture this rule lets through.
import type { RenderPlan } from '../planTypes';
import { BLOOM_THRESHOLD } from './pipeline';

/** Generated kinds whose surfaces are lit or self-lit below the threshold (no additive cores). */
const LDR_SHADER_TYPES: ReadonlySet<string> = new Set([
  'planet_rocky',
  'planet_water',
  'gas_giant',
]);

/**
 * True when the plan may draw a pixel at or above `BLOOM_THRESHOLD` (bloom must run); false only for
 * plans made of lit or dim self-lit bodies and the LDR generated planets.
 */
export function planMayBloom(plan: RenderPlan): boolean {
  if (!plan.threeD) return false;
  // Star surfaces (flares and loops are HDR), brown-dwarf jets, Mira pulsation.
  if (plan.star || plan.jets || plan.pulsation) return true;
  // Additive extras: comet shells and volumes, discs, screens, trails and dust.
  if (
    plan.volumes.length > 0 ||
    plan.shells.length > 0 ||
    plan.discs.length > 0 ||
    plan.screens.length > 0 ||
    plan.trails.length > 0 ||
    plan.dust !== null
  )
    return true;
  if (plan.shader) return !LDR_SHADER_TYPES.has(plan.type);
  // A self-luminous body is drawn as tint x emissive (limb darkening only dims it). Half the
  // threshold is the margin: a body that could reach it keeps bloom.
  for (const b of plan.bodies) {
    if (b.emissive <= 0) continue;
    const peak = Math.max(b.tint[0], b.tint[1], b.tint[2]) * b.emissive;
    if (peak >= BLOOM_THRESHOLD / 2) return true;
  }
  return false;
}

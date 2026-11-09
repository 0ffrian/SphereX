// Issue #60: the "Build it" moulding animation, as pure data and math (no three.js, no DOM).
//
// The animation is a presentation of the real plan, never a second model. Each body type has the
// mock-up's numbered steps (`PLAN` in mockup/spherex-ui.html). A step reveals real plan layers
// (ids from `plan.drawn`) and drives knobs whose value 1 is the normal render:
//   - `base`: the whole body scales from .55 to 1 and a wireframe scaffold fades out (mock-up);
//   - `shape`: mesh bodies morph from a sphere to their real shape;
//   - `grow`: emission volumes grow from a small ball;
//   - `terrain`, `sea`, `colour`, `clouds`: the generated worlds' shader knobs (ShaderBody).
// Layers of later steps are held (`PlanContext.hold`) and not drawn. At the end nothing is held and
// every knob is 1, so the last frame is the normal render of the same plan and seed.
//
// Timing is the mock-up's: STAGE_S seconds per step, smoothstep easing, steps one after another.
import type { ObjectType } from '@/contract';
import type { RenderPlan } from '../planTypes';

/** Seconds per step (mock-up `STAGE_S`). UI pacing, not a physical value. */
export const STAGE_S = 2.3;
/** After the last step the mock-up waits this long before it says "done". */
export const DONE_AFTER_S = 0.3;

/** Mock-up `ease`: smoothstep, x²(3 − 2x). */
export function ease(x: number): number {
  return x * x * (3 - 2 * x);
}

/** Pseudo layer id: the body colour (plain grey until it is revealed). See PlanBuilder. */
export const TINT = 'tint';

export type MouldKnob = 'shape' | 'grow' | 'terrain' | 'sea' | 'colour' | 'clouds';

export interface MouldStepDef {
  label: string;
  /** Mock-up hint under the label (shown as the step's title text). */
  hint: string;
  /** Plan layer ids this step reveals (only those the plan draws count). */
  layers: readonly string[];
  /** Knobs this step runs from 0 to 1. */
  knobs?: readonly MouldKnob[];
  /** The wireframe scaffold fades out while this step runs (mock-up: `1 - P[i]`). */
  fadesWire?: boolean;
  /** Always shown, even with no layer of its own (the base mould is the body itself). */
  base?: boolean;
}

/** One step as shown: its definition plus the layers of this plan it really reveals. */
export interface MouldStep extends MouldStepDef {
  reveals: string[];
}

export interface MouldScript {
  /** Mock-up kind the timing and scale curve follow. */
  kind: MouldKind;
  steps: MouldStep[];
  /** Every revealed layer id, in step order (plus `tint` when the plan colours the body). */
  all: string[];
}

export type MouldKind =
  'asteroid' | 'comet' | 'star' | 'dwarf' | 'rocky' | 'water' | 'gas' | 'nebula' | 'nova';

const SHAPE_RELIEF = ['reflectance', 'self_shadow', 'baked_ao', 'regolith'];

/** Mock-up `PLAN`, mapped to the real layer ids of each renderer. */
const STEPS: Record<MouldKind, MouldStepDef[]> = {
  asteroid: [
    { label: 'Base mould', hint: 'A sphere of triangles', layers: ['body', 'spin'], base: true },
    {
      label: 'Shape',
      hint: 'Lumps and stretch from the light curve',
      layers: ['mesh', 'ellipsoid'],
      knobs: ['shape'],
    },
    {
      label: 'Relief',
      hint: 'Craters and grooves',
      layers: ['relief', 'displacement', ...SHAPE_RELIEF],
      fadesWire: true,
    },
    {
      label: 'Colour',
      hint: 'Tint from the infrared slope',
      layers: ['albedo_map', 'material', TINT],
    },
  ],
  comet: [
    { label: 'Base mould', hint: 'A sphere of triangles', layers: ['nucleus'], base: true },
    { label: 'Shape', hint: 'A stretched, lumpy core', layers: ['mesh'], knobs: ['shape'] },
    { label: 'Relief', hint: 'Craters and cracks', layers: SHAPE_RELIEF, fadesWire: true },
    { label: 'Colour', hint: 'Very dark, like soot', layers: [TINT] },
    {
      label: 'Tails',
      hint: 'Coma and tails',
      layers: ['gas_shells', 'dust', 'coma', 'ion_tail', 'dust_tail', 'tail'],
      knobs: ['grow'],
    },
  ],
  star: [
    { label: 'Base mould', hint: 'A sphere of triangles', layers: ['body', 'size'], base: true },
    {
      label: 'Surface',
      hint: 'Granulation cells',
      layers: ['granulation', 'faculae', 'limb_darkening'],
      fadesWire: true,
    },
    {
      label: 'Spots',
      hint: 'Dark patches',
      layers: ['spots', 'flares', 'prominences', 'prominence_strands'],
    },
    { label: 'Colour', hint: 'From temperature', layers: ['colour', 'glow', TINT] },
  ],
  dwarf: [
    { label: 'Base mould', hint: 'A sphere of triangles', layers: ['body'], base: true },
    { label: 'Bands', hint: 'Winds in stripes', layers: ['bands', 'jets'], fadesWire: true },
    { label: 'Storms', hint: 'Seeded spots', layers: ['cloud_cover'] },
    { label: 'Colour', hint: 'From temperature', layers: ['emissive', 'limb_darkening', TINT] },
  ],
  rocky: [
    { label: 'Base mould', hint: 'A sphere of triangles', layers: ['surface', 'body'], base: true },
    {
      // Issue #68 (Q-165): the host star's light colours the planet from the first step after the
      // base mould, so every later step is seen under it. Only a planet with a host temperature has it.
      label: 'Terrain',
      hint: 'Mountains and plains',
      layers: ['starlight'],
      knobs: ['terrain'],
      fadesWire: true,
    },
    {
      // The climate pattern (ice, bare ground or lava) is what the colour step reveals; the scenario
      // look and the planet's preset are the artist's way of colouring it (+ Artistic only).
      label: 'Colour',
      hint: 'Rock and lava cracks',
      layers: ['climate', 'look', 'look_preset'],
      knobs: ['colour'],
    },
    { label: 'Air', hint: 'A thin haze', layers: ['clouds'], knobs: ['clouds'] },
  ],
  water: [
    { label: 'Base mould', hint: 'A sphere of triangles', layers: ['surface', 'body'], base: true },
    {
      label: 'Terrain',
      hint: 'Land under the sea',
      layers: ['starlight'],
      knobs: ['terrain'],
      fadesWire: true,
    },
    { label: 'Oceans', hint: 'Water rises', layers: [], knobs: ['sea'] },
    {
      label: 'Colour',
      hint: 'Land, sea and ice',
      layers: ['climate', 'look', 'look_preset'],
      knobs: ['colour'],
    },
    { label: 'Clouds', hint: 'Clouds and sky', layers: ['clouds'], knobs: ['clouds'] },
  ],
  // Issue #62: a gas giant's surface is five layers (bands, flattening, colour, storms,
  // turbulence), each switched by the plan, so the steps reveal them one after another.
  gas: [
    { label: 'Base mould', hint: 'A sphere of triangles', layers: ['body'], base: true },
    {
      label: 'Bands',
      hint: 'Winds in stripes, flattened by the spin',
      layers: ['bands', 'flattening', 'jets', 'turbulence'],
      fadesWire: true,
    },
    { label: 'Storms', hint: 'Seeded spots', layers: ['storms', 'storm_drift'] },
    { label: 'Colour', hint: 'From temperature', layers: ['colour'] },
  ],
  nebula: [{ label: 'Volume', hint: 'A ball of glowing gas', layers: ['point_cloud'], base: true }],
  nova: [
    { label: 'Spark', hint: 'One hot point', layers: ['point_cloud'], base: true },
    { label: 'Blast', hint: 'The shell flies out', layers: [], knobs: ['grow'] },
  ],
};

const KIND_OF: Record<ObjectType, MouldKind | null> = {
  asteroid_shape: 'asteroid',
  asteroid_procedural: 'asteroid',
  comet: 'comet',
  brown_dwarf: 'dwarf',
  brown_dwarf_binary: 'dwarf',
  star: 'star',
  star_mira: 'star',
  star_ttauri: 'star',
  candidate: null,
  planet_rocky: 'rocky',
  planet_water: 'water',
  gas_giant: 'gas',
  nebula: 'nebula',
  nova: 'nova',
};

export function mouldKindOf(type: ObjectType): MouldKind | null {
  return KIND_OF[type] ?? null;
}

/** Knobs that only make sense when the body really has that part (no ocean, no step). */
function knobApplies(knob: MouldKnob, plan: RenderPlan): boolean {
  switch (knob) {
    case 'shape':
      // A real shape model, or an ellipsoid that is not a sphere.
      return plan.bodies.some((b) => b.meshUrl !== null || b.axes.some((a) => a !== b.axes[0]));
    case 'grow':
      return plan.volumes.length > 0 || plan.type === 'nova';
    case 'terrain':
    case 'colour':
      return plan.shader?.surface === true;
    case 'sea':
      // A water world draws its ocean as part of the surface.
      return plan.shader?.surface === true && plan.type === 'planet_water';
    case 'clouds':
      // The cloud shell and the air are part of the generated surface (with or without winds).
      return plan.shader?.surface === true;
  }
}

/**
 * The steps for a plan: the mock-up steps of its kind, each with the drawn layers it reveals. A step
 * that reveals no drawn layer and runs no knob that applies is left out (it would claim to build
 * something that is not there). Drawn layers no step names are revealed by the last step, so the
 * end is always the whole plan. Null for a plan with nothing to build (no 3D model, nothing drawn).
 */
export function mouldScript(plan: RenderPlan): MouldScript | null {
  const kind = mouldKindOf(plan.type);
  if (!kind || !plan.threeD) return null;
  const drawn = new Set(plan.drawn.map((d) => d.id));
  if (plan.bodies.length > 0 && plan.tintUsed && plan.tint.tag !== null) drawn.add(TINT);
  const named = new Set<string>();
  const steps: MouldStep[] = [];
  for (const def of STEPS[kind]) {
    const reveals = def.layers.filter((id) => drawn.has(id) && !named.has(id));
    for (const id of reveals) named.add(id);
    const knobs = (def.knobs ?? []).filter((k) => knobApplies(k, plan));
    if (!def.base && reveals.length === 0 && knobs.length === 0) continue;
    steps.push({ ...def, knobs, reveals });
  }
  if (steps.length === 0) return null;
  const rest = [...drawn].filter((id) => !named.has(id));
  steps[steps.length - 1]!.reveals.push(...rest);
  return { kind, steps, all: steps.flatMap((s) => s.reveals) };
}

/**
 * True when something of the plan is generated in the browser from the render params' seed (a
 * generated world, the star surface, brown-dwarf jets, emission volumes). A body that is only
 * baked textures or a fixed model (asteroids) looks the same for any seed, so "New seed" is
 * offered only when this is true.
 */
export function usesBrowserSeed(plan: RenderPlan): boolean {
  return (
    plan.shader !== null || plan.star !== null || plan.jets !== null || plan.volumes.length > 0
  );
}

/** Mock-up `loop`: progress of each step at time t (seconds), each eased from 0 to 1. */
export function stepProgress(t: number, n: number): number[] {
  const p: number[] = [];
  for (let i = 0; i < n; i++) p.push(ease(Math.max(0, Math.min(1, (t - i * STAGE_S) / STAGE_S))));
  return p;
}

/** Total time of a build, and when it counts as done (mock-up `t > n * STAGE_S + .3`). */
export function buildDuration(n: number): number {
  return n * STAGE_S;
}
export function isDone(t: number, n: number): boolean {
  return t > n * STAGE_S + DONE_AFTER_S;
}

/** Index of the step whose layers are being revealed at t: the last step that has started. */
export function stageAt(t: number, n: number): number {
  if (n <= 0) return 0;
  return Math.max(0, Math.min(n - 1, Math.floor(Math.max(0, t) / STAGE_S)));
}

/** Layer ids held back while `stage` runs: every layer of a later step. Empty at the last step. */
export function holdAt(script: MouldScript, stage: number): string[] {
  return script.steps.slice(stage + 1).flatMap((s) => s.reveals);
}

/** What the viewer applies at one moment of the build (all 1 / 0 = the normal render). */
export interface MouldPose {
  /** Whole-body scale (mock-up `.55 + .45 * P[0]`, per kind). 1 = normal. */
  scale: number;
  /** Wireframe scaffold opacity (mock-up `.9 * P[0] * (1 - P[k])`). 0 = none. */
  wire: number;
  /** Sphere-to-shape morph of mesh bodies. 1 = the real shape. */
  shape: number;
  /** Volume growth. 1 = full size. */
  grow: number;
  terrain: number;
  sea: number;
  colour: number;
  clouds: number;
}

export const NORMAL_POSE: Readonly<MouldPose> = {
  scale: 1,
  wire: 0,
  shape: 1,
  grow: 1,
  terrain: 1,
  sea: 1,
  colour: 1,
  clouds: 1,
};

/** Mock-up nova: final relative size (`nr * 1.05`) is the renderer's own NOVA_SCALE; start .03. */
const NOVA_START = 0.03;
const NOVA_FINAL = 0.925;

/** The pose for step progress `p` (from `stepProgress`). Every value is 1 (or 0) once all are 1. */
export function poseAt(script: MouldScript, p: readonly number[]): MouldPose {
  const pose: MouldPose = { ...NORMAL_POSE };
  const p0 = p[0] ?? 1;
  let fade = 1;
  script.steps.forEach((s, i) => {
    const v = p[i] ?? 1;
    for (const k of s.knobs ?? []) pose[k] = v;
    if (s.fadesWire) fade = v;
  });
  switch (script.kind) {
    case 'nebula':
      pose.scale = 0.4 + 0.6 * p0;
      break;
    case 'nova': {
      // Mock-up: scale .03 + (F - .03) * (1 - (1 - P[1])^3), relative to its final size F.
      const e = 1 - Math.pow(1 - pose.grow, 3);
      pose.scale = (NOVA_START + (NOVA_FINAL - NOVA_START) * e) / NOVA_FINAL;
      pose.grow = 1;
      break;
    }
    default:
      pose.scale = 0.55 + 0.45 * p0;
  }
  // No wireframe for the gas clouds (the mock-up has none there).
  const hasWire = script.kind !== 'nebula' && script.kind !== 'nova';
  const fadeStep = script.steps.some((s) => s.fadesWire);
  pose.wire = hasWire ? 0.9 * p0 * (1 - (fadeStep ? fade : p0)) : 0;
  return pose;
}

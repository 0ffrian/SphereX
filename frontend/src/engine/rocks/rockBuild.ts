// Issue #93 wave 1 (PR #101 roadmap 1.8): the rock engine's height-map build (the prototype's `rockModel` and
// `buildRock`, verbatim in source.ts, then a shape model's radii in place of the generated lumps) as one pure function
// of its request, so it runs the same on the main thread (tests, the parity harness) and in rockBuild.worker.ts. The
// worker has its own copy of the engine module, so the same request gives the same bytes on either side.
import * as E from './source';
import type { RockPreset } from './cardToRock';

const R: any = E.R;
const buildRock: any = E.buildRock;
const rockModel: any = E.rockModel;
const radialFn: any = E.radialFn;

/** What the engine's `rockModel` returns (the readouts and the draw read these). */
export interface RockModel {
  rad: number;
  gv: number;
  ratio: number;
  lump: number;
  limit: number;
  fast: boolean;
  kind: string;
  cov: number;
  bld: number;
  ax: [number, number, number];
  escape: number;
}

/** The engine's `R.built`: the height map (RG: height, fresh-crater brightness) and its extent. */
export interface RockBuilt {
  data: Float32Array;
  ext: number;
  craters: number;
  w: number;
  h: number;
}

export interface BuildRequest {
  preset: RockPreset;
  mode: 'rocky' | 'smooth';
  /** Surface age, 0..100 (the slider). */
  age: number;
  /** A shape model's radial heights (RadialMap.h, 1024 x 512), or null for the generated surface. */
  mesh: Float32Array | null;
}

export interface BuildResult {
  RM: RockModel;
  built: RockBuilt;
}

/**
 * The prototype's `rebuild` without the upload: sets the engine's body, mode and age, builds the model and the height
 * map, and with a shape model replaces the generated field by the model's radius over the engine's own radius (the
 * engine draws `radialFn(d) * (1 + h)`). Deterministic: the same request gives byte-identical `built.data`.
 */
export function buildField(req: BuildRequest): BuildResult {
  R.p = req.mesh ? { ...req.preset, ab: 1 } : req.preset;
  R.mode = req.mode;
  R.age = req.age;
  const RM = rockModel() as RockModel;
  buildRock(RM);
  const built = R.built as RockBuilt;
  const mesh = req.mesh;
  if (mesh) {
    // A shape model: the measured radius replaces the generated lumps and craters; the engine's fine ridges,
    // boulders, lighting, shadows and (for a comet) jets still apply.
    RM.ax = [1, 1, 1];
    const rf = radialFn(RM.ax, !!R.p.comet);
    const { w, h: rows, data } = built;
    let ext = 0;
    for (let j = 0; j < rows; j++) {
      const la = ((j + 0.5) / rows - 0.5) * Math.PI;
      const cl = Math.cos(la);
      const sl = Math.sin(la);
      for (let i = 0; i < w; i++) {
        const lo = ((i + 0.5) / w - 0.5) * 2 * Math.PI;
        const base = rf(cl * Math.cos(lo), sl, cl * Math.sin(lo));
        const k = j * w + i;
        const r = 1 + mesh[k]!;
        data[k * 2] = r / base - 1;
        data[k * 2 + 1] = 0;
        if (r > ext) ext = r;
      }
    }
    built.ext = ext;
  }
  return { RM, built };
}

export type BuildMessage = { id: number; req: BuildRequest };
export type BuildReply = ({ id: number } & BuildResult) | { id: number; error: string };

/** The worker's whole job, without the messaging, so it can be tested. */
export function handleBuild(msg: BuildMessage): BuildReply {
  try {
    return { id: msg.id, ...buildField(msg.req) };
  } catch (err) {
    return { id: msg.id, error: err instanceof Error ? err.message : String(err) };
  }
}

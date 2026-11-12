// The prototype's preset loader and slider and pill handlers, applied to an engine core. Shared by WorldEngine (a core
// that draws) and SimHost (a core that only simulates, issue #93 1.9 and 1.10), so both load a world the same way.
import type { Core } from './core.js';
import { WP } from './presets.js';
import type { EngineOverrides, WorldPreset } from './types';

/** A preset object, or the id of one of the prototype's example presets. */
export function resolvePreset(p: WorldPreset | string): WorldPreset {
  const pr = typeof p === 'string' ? (WP as WorldPreset[]).find((q) => q.id === p) : p;
  if (!pr) throw new Error('unknown preset ' + String(p));
  return pr;
}

/** Load a world into a core: its orbit extras and ocean share, then the prototype's setPreset (terrain, spin-up). */
export function loadPreset(core: Core, p: WorldPreset | string): void {
  const pr = resolvePreset(p);
  if (pr.ob) core.ORB[pr.id] = pr.ob;
  if (pr.oceanF != null) core.OCEANF[pr.id] = pr.oceanF;
  core.setPreset(pr);
}

/** Overrides that rebuild the world (fluid, spin and crust); the others only refresh the model or the picture. */
export function resetsWorld(o: EngineOverrides): boolean {
  return o.fluid != null || o.spin != null || o.tect != null;
}

/**
 * The prototype's slider and pill handlers, by name. Atmosphere and orbit sliders only refresh the model (as in the
 * prototype); fluid, spin and tect rebuild the world; overlay, clouds, zoom, yaw, pitch only redraw.
 */
export function applyOverrides(core: Core, o: EngineOverrides): void {
  const W = core.W;
  let model = false;
  if (o.Tstar != null) {
    W.Tstar = o.Tstar;
    model = true;
  }
  if (o.orbit != null) {
    W.orbit = o.orbit;
    model = true;
  }
  if (o.Ps != null) {
    W.Ps = o.Ps;
    model = true;
  }
  if (o.obl != null) {
    W.obl = o.obl;
    model = true;
  }
  if (o.ecc != null) {
    W.ecc = o.ecc;
    model = true;
  }
  if (o.co2 != null) {
    W.co2Therm = o.co2;
    model = true;
  }
  if (o.season != null) W.season = o.season;
  if (o.overlay != null) W.overlay = o.overlay;
  if (o.clouds != null) W.clouds = o.clouds;
  if (o.zoom != null) W.zoom = o.zoom;
  if (o.yaw != null) W.yaw = o.yaw;
  if (o.pitch != null) W.pitch = o.pitch;
  if (o.timeSec != null) {
    W.timeSec = o.timeSec;
    model = true;
  }
  if (o.fluid != null) W.fluid = o.fluid;
  if (o.spin != null) {
    W.spinMode = o.spin;
    W.p = core.applySpin(W.base);
  }
  if (o.tect != null) W.tect = o.tect;
  if (resetsWorld(o)) core.resetWorld();
  else if (model) {
    W.m = core.worldModel();
    core.worldUi();
  }
}

/**
 * Everything a simulation depends on, as one string: two cores with the same key run the same climate, gas flow and
 * rivers (issue #93 1.9). The view controls (overlay, clouds, zoom, yaw, pitch) are not in it.
 */
export function simKey(core: Core): string {
  const W = core.W;
  if (!W.p) return '';
  return [
    W.p.id,
    W.p.seed,
    W.p.seed3 ? W.p.seed3.join(',') : '',
    W.fluid,
    W.spinMode,
    W.tect,
    W.Ps,
    W.Tstar,
    W.orbit,
    W.obl,
    W.ecc,
    !!W.co2Therm,
    W.timeSec,
  ].join('|');
}

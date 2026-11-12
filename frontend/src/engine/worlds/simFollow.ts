// Issue #93 1.9 and 1.10: a drawing engine follows a SimHost's simulation (simHost.ts). It does not step the climate,
// the gas flow or the rivers itself: it replays the host's GPU-side calls in its own WebGL context, through the
// core's own WorldGL methods (uploadEb, cloudStep, uploadVel, gasStep, setHydro, setBand), so its textures hold what
// they would have held had it run the same simulation. The engine core is not edited for this (no @deviation).
import type { Core } from './core.js';
import type { SimOp, SimSnapshot, SimState } from './simHost';

/** Cloud-advection steps a view replays when it catches up (relaxation 0.05 forgets the start to 5% in 60 steps). */
export const RESYNC_CLOUD_STEPS = 60;
/** Gas tracer passes a view replays when it catches up, sharing the simulated time since the tracer started. */
export const RESYNC_GAS_PASSES = 32;
/** The prototype's gas solver step (gas.js GasSim dt), for the replay's step count. */
const GAS_DT = 0.0032;

/** Replay one op in this core's GL context. */
export function applySimOp(core: Core, op: SimOp): void {
  const W = core.W,
    EB = core.EB,
    gl = W.gl;
  switch (op.o) {
    case 'eb':
      EB.out = op.out;
      EB.out2 = op.out2;
      gl.uploadEb();
      return;
    case 'cloud':
      // The host's cyclones and step, so ebCyclones returns the host's list and the pass uses the host's uStep.
      EB.cyc = op.cyc;
      EB.cycAt = op.cycAt;
      W.step = op.step;
      gl.cloudStep(W.m, op.relax);
      return;
    case 'vel':
      gl.uploadVel(op.d);
      return;
    case 'gas':
      gl.gasStep(op.dt, op.init);
      return;
    case 'hydro':
      W.hydro = op.hd;
      gl.setHydro(op.hd);
      return;
    case 'band':
      gl.setBand(op.d);
      return;
  }
}

/** The host's scalar state after a tick: forming progress, the readouts' inputs, the one-time aim at the rivers. */
export function applySimState(
  core: Core,
  s: SimState,
  T: Float32Array | null,
  rain: Float32Array | null,
): void {
  const W = core.W,
    EB = core.EB;
  W.spinup = s.spinup;
  W.season = s.season;
  if (s.dt93) W.dt93 = s.dt93;
  if (s.stats) EB.stats = s.stats;
  EB.rainMax = s.rainMax;
  if (T) EB.T = T;
  if (rain) EB.rain = rain;
  // The prototype turns the globe once to face the biggest river system when the rivers first appear (WorldGL.tick).
  if (s.aimed && !W.aimed) {
    W.aimed = true;
    W.spin = s.spin;
    W.pitch = s.pitch;
  }
}

/**
 * Catch up at once: the climate grids, the river raster, and the clouds (or a giant's tracer) rebuilt from the
 * host's current state. The cloud pass restarts from its target at the host's step minus RESYNC_CLOUD_STEPS and
 * replays those steps; a giant's tracer restarts from its bands and is carried by the current velocity field over the
 * simulated time the host has run, in RESYNC_GAS_PASSES passes. So a view that opens on a formed world shows it formed
 * at once; its clouds and tracer swirls are rebuilt from the same fields, not copied from the other view's GPU.
 */
export function resyncSim(core: Core, snap: SimSnapshot): void {
  const W = core.W,
    EB = core.EB,
    gl = W.gl,
    s = snap.state;
  applySimState(core, s, snap.T, snap.rain);
  if (snap.hydro) {
    W.hydro = snap.hydro;
    gl.setHydro(snap.hydro);
  }
  if (!s.gas) {
    if (snap.out && snap.out2) {
      EB.out = snap.out;
      EB.out2 = snap.out2;
      gl.uploadEb();
    }
    EB.cyc = snap.cyc;
    EB.cycAt = snap.cycAt;
    const n = Math.min(s.step, RESYNC_CLOUD_STEPS);
    W.step = s.step - n;
    for (let i = 0; i < n; i++) gl.cloudStep(W.m, i === 0 ? 1 : s.spinup > 0 ? 0.05 : 0.012);
    W.step = s.step;
  } else if (snap.vel) {
    gl.uploadVel(snap.vel);
    gl.gasStep(0, true);
    const n = Math.min(RESYNC_GAS_PASSES, Math.ceil(s.gasT / (4 * GAS_DT)));
    for (let i = 0; i < n; i++) gl.gasStep(s.gasT / n, false);
  }
}

// Issue #71 stream X (D-37): the approved prototype's star and flare engine, run verbatim in the app.
//
// The four slices `protoStar1.js` to `protoStar4.js` are the prototype's lines 357 to 1211, byte for
// byte. They are plain script: their state lives in `var`s and their DOM is reached through `$`. Here
// each engine instance runs them inside ONE function scope (so the globals become that instance's own
// state, and two engines never share any), with `$` answered by small stand-in elements. The logic is
// therefore the prototype's, unedited; this file only supplies what the prototype's page supplied (the
// helpers on its lines 348 to 355, its canvases, its buttons) and reads the results back out.
//
// Two modes share the code. `globe` is the prototype's "Star surface" stage (surface, spots, loops, flares
// on the whole star); `closeup` is its "Solar flares" stage (the flare at the star's edge). Each mode owns
// three stacked canvases (the surface, the plasma, the lines); the other mode's canvases are inert.
// Everything is a function of the star, the step count and the step size: no wall clock except the
// prototype's own adaptive resolution.
//
// Issue #93 W1: the star program compiles in the background (deviation 8 in protoStar1.js; `whenReady`), the surface
// close-up (`surface: true`) keeps only its surface canvas (its plasma and lines can only be black there), and the
// other mode's inert canvases no longer log "no webgl2".
import S1 from './protoStar1.js?raw';
import S2 from './protoStar2.js?raw';
import S3 from './protoStar3.js?raw';
import S4 from './protoStar4.js?raw';
import type { BuildNote } from '@/app/build/BuildControls';
import type { StarPreset } from './cardToStar';
import { GLOBE_HALF, GLOBE_TILT, globeRot, pickSurface, viewPoint, type LatLon } from './starPick';

/** Whole star: the disc's radius as a fraction of the shorter side (loops are drawn 3 times larger in 'big', so it gets more room). */
const FRAME_TRUE = 0.36;
const FRAME_BIG = 0.31;
export type StarMode = 'globe' | 'closeup';
/** The prototype's "Light" pills: 3 Observatory view, 2 Enhanced colour, 0 True colour. */
export type StarLight = 0 | 2 | 3;
export type StarScaleView = 'big' | 'true' | 'close';
export type FlareKind = 'closed' | 'open';
export type FlareClass = 'c' | 'm' | 'x';

export interface StarOptions {
  mode: StarMode;
  /** Default: the user's setting. Under reduced motion the star starts paused. */
  reducedMotion?: boolean;
  /** Default 'true colour' (0): the star's own colour. */
  light?: StarLight;
  /**
   * Issue #93 W1 (render notes 0.5): the star's surface close-up (globe mode, always the `close` scale). Its plasma and
   * line canvases are inert, as the other mode's are: the prototype draws neither in the close-up (drawOverlay returns
   * before them), so this drops their WebGL 2 context, 3 render targets and about 5 passes a frame, and the picture is
   * unchanged. Not for a stage whose scale can change.
   */
  surface?: boolean;
}

/** How often a disposed engine checks whether its shader has finished compiling (UI pacing, ms). */
export const STAR_DISPOSE_POLL_MS = 100;
/**
 * Longest a disposed engine waits for a compile still running (ms). After it the engine stops polling and leaves the
 * context to the browser without `loseContext()`, which would block on that compile (as WorldEngine does).
 */
export const STAR_DISPOSE_MAX_WAIT_MS = 120_000;
export interface FlareState {
  kind: FlareKind;
  cls: FlareClass;
  /** 0..1 of the flare's 60 minutes. */
  t: number;
  playing: boolean;
  minutes: string;
  caption: string;
  tag: string;
}
export interface ChartData {
  /** Soft X-rays and the hard X-ray bursts, 241 samples each, 0..1. */
  soft: number[];
  hard: number[];
  open: boolean;
}
/** What the close-up sees at its target (see `StarEngine.closeInfo`). */
export interface CloseInfo {
  active: boolean;
  near: number;
  nearAt: LatLon | null;
  auto: boolean;
  flaring: boolean;
}
export interface Readout {
  label: string;
  value: string;
}

// The prototype's helpers (sculptor-preview-next.html, lines 348 to 355), copied verbatim.
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
function rng(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Listener = (e?: unknown) => void;
/** A stand-in for one DOM element of the prototype's page: it keeps what is written to it. */
class Stub {
  textContent = '';
  innerHTML = '';
  value: string | number = '';
  disabled = false;
  children: unknown[] = [];
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  private on = new Map<string, Listener[]>();
  addEventListener(type: string, fn: Listener) {
    this.on.set(type, [...(this.on.get(type) ?? []), fn]);
  }
  fire(type: string, e?: unknown) {
    for (const f of this.on.get(type) ?? []) f(e);
  }
  appendChild() {}
  setAttribute() {}
  setPointerCapture() {}
  getBoundingClientRect() {
    return { left: 0, width: 1 };
  }
}

/**
 * An inert canvas: it takes 2D drawing (the prototype's overlays need a context) but offers no GL. `onNoGL` is called
 * when the prototype asks it for a GL context, just before the prototype throws (and logs) its "no webgl2".
 */
function inertCanvas(onNoGL: () => void = () => {}): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const get = c.getContext.bind(c);
  const proxy = {
    clientWidth: 0,
    clientHeight: 0,
    width: 0,
    height: 0,
    getContext: (t: string) => {
      if (t === '2d') return get('2d');
      onNoGL();
      return null;
    },
  };
  return proxy as unknown as HTMLCanvasElement;
}

/** The prototype's error when a canvas gives no WebGL 2 context (StarGL and PlasmaGL). */
const NO_GL = 'no webgl2';

/** The prototype's notes ("How each part is worked out"), formulas and the placeholders line unchanged. */
const NOTE_STAR: BuildNote = {
  title: 'How each part of the star is worked out',
  lines: [
    'Colour: Planck’s law through the human colour-matching curves.',
    'Boiling cells: size is about 8 pressure scale heights, H = kT / (μ m_H g). Each cell is born, grows, splits and fades. Their contrast (±12 % in temperature) is exaggerated for looks, two to three times what is observed.',
    'Edge darkening: the Eddington approximation, T⁴ = ¾ Teff⁴ (μ + ⅔), so the edge goes darker and redder; the centre is about 6 % hotter than Teff.',
    'Magnetic field: Reiners et al. 2022, ⟨B⟩ = 199 G · Ro^−1.26, flattening to 2050 G · Ro^−0.11 for Ro below 0.13. It was fitted on M dwarfs, so using it for other stars is a model.',
    'Spots: field sets the spotted area. Sizes are lognormal, and leader and follower tilt by Joy’s law. The spot belt stays at one latitude: it does not drift through a cycle. A spot is cooler than the surface by an amount that shrinks for cooler stars (Berdyugina 2005): about 1,800 K on the Sun, a few hundred K on a red dwarf.',
    'Flares: each starts at a real spot group. Its energy comes from a power law, capped by the magnetic energy that group can store, E_max = 0.1 · (B²/8π) · A^(3/2).',
    'Plasma: the field is far stronger than the gas pressure (β = 8πp / B² ≪ 1), so plasma can only flow along field lines. Heated plasma surges up from the feet, cools, and drains back as rain. The fine wisps are added for looks.',
    'Open or closed: for two opposite poles a distance 2a apart, n = 3h² / (a² + h²). The flare erupts if its rope climbs past h = a, where n reaches 1.5.',
  ],
  placeholder:
    'Still placeholders: the field-to-spot scaling and the flare rate. Both need fitting to spot and flare surveys.',
};
const NOTE_FLARE: BuildNote = {
  title: 'How the star would decide',
  lines: [
    'This close-up is always a Sun-like star (5,772 K) with one fixed pair of spots, whichever star is chosen: it shows how a flare works, not this star’s own flare.',
    'Where: the largest flares start above the boundary between a spot group’s opposite polarities. Here a typical event is replayed on a Sun-like star.',
    'Open or closed: if the field above weakens quickly with height, the rope escapes. The test is the decay index n = −d ln B / d ln h, with a threshold near 1.5. Studies put it between about 1.3 and 1.9.',
    'How often: flare energies follow a power law, dN/dE ∝ E^−α, scaled by spot area.',
  ],
};
export const STAR_NOTES: Record<StarMode, BuildNote[]> = {
  globe: [NOTE_STAR],
  closeup: [NOTE_FLARE],
};

interface Inside {
  ST: { p: StarPreset; P: number; time: number; playing: boolean; filter: number; view: string };
  FL: { kind: FlareKind; cls: FlareClass; t: number; playing: boolean };
  vis: { star: boolean; flare: boolean };
  hasGL: () => { star: boolean; flare: boolean };
  poll: () => boolean;
  pending: () => boolean;
  model: () => { groups: unknown[]; conv: number };
  setStar(p: StarPreset): void;
  setLight(id: number): void;
  setScale(id: string): void;
  setLines(on: boolean): boolean;
  setKind(id: string): void;
  setClass(id: string): void;
  scrub(t: number): void;
  play(on: boolean): void;
  step(dt: number): void;
  draw(): void;
  series(): { s: number[]; h: number[] } | null;
  state(): Record<string, unknown>;
  pView(view: string, filter: number): void;
  pStep(n: number, dt: number): void;
  pFlare(kind: string, cls: string, t: number): void;
  pReset(): void;
  setAt(t: [number, number] | null): void;
  setFlareZoom(z: number): void;
  setAuto(on: boolean): void;
  setForce(i: number): void;
  cuInfo(): {
    active: boolean;
    near: number;
    nearAt: [number, number] | null;
    auto: boolean;
    flaring: boolean;
  };
  at(): [number, number];
  lines(): boolean;
}

// Wrapper hook for the close-up target: the one rename in protoStar1.js (`m.best=>(CLOSE_AT||m.best)`).
const PREFIX = 'var CLOSE_AT = null;\n';
const SRC = PREFIX + S1 + '\n' + S2 + '\n' + S3 + '\n' + S4;
// What the prototype's page does after its slices: nothing but the loop (stubbed) and these reads.
const SUFFIX = `
vis.star = MODE === 'globe'; vis.flare = MODE === 'closeup';
// Wrapper hooks (app level, the slices stay verbatim): the view's half height goes through HALF (framing the
// whole star, zooming the surface close-up), and the flare close-up's Light follows the star's (FLARE_FILTER).
if (starGL) { var _sd = starGL.draw; starGL.draw = function (o) { o.half = HALF(o.half); return _sd.call(starGL, o); }; }
var _od = drawOverlay; drawOverlay = function (r, t, h) { return _od(r, t, HALF(h)); };
if (flareGL) { var _fd = flareGL.draw; flareGL.draw = function (o) {
  o.filter = FLARE_FILTER(o.filter);
  if (MODE === 'closeup' && MODEL) {
    // The star's own surface at the target: its temperature, cell size (View: larger detail or true scale), spots and the
    // camera turn that puts the target in front of the horizon camera.
    cuUpdate();
    o.T = ST.p.T; o.conv = MODEL.conv; o.freq = ST.view === 'big' ? Math.min(MODEL.cells, BIG) : MODEL.cells;
    o.spots = MODEL.sp; o.n = MODEL.n; o.rot = CU.rot; o.tilt = CU.tilt; o.off = V.off; o.half = V.h;
  }
  return _fd.call(flareGL, o); }; }
// ---- Wrapper (app level; the slices stay verbatim): the flare close-up looks at the star's CURRENT TARGET ----
// The engine's flare view is an oblique horizon camera (V.off, V.h, proj(), the flare GL surface). Here it is driven
// from the star's own state at the target place: the surface shader gets the star's spots, cell size and rotation
// (so the camera sits over that lat/lon), the loops and the flare are anchored on the nearest spot group (only when
// one is in view), and the flare shown is the engine's own schedule event for that group.
var CU = { auto: true, G: -1, near: -1, ang: 9, k: 0.6, alpha: 1, rot: 0, tilt: 0, gv: null, ZK: 1, ev: null, sig: '' };
var CU_FORCE = -1;
var _pg = pickGroup;
pickGroup = function (r) { return CU_FORCE >= 0 && CU_FORCE < MODEL.groups.length ? CU_FORCE : _pg(r); };
function cuAt() { return CLOSE_AT || MODEL.best || [0.26, 0.5]; }
function cuVec(a) { var c = Math.cos(a[0]); return [c * Math.sin(a[1]), Math.sin(a[0]), c * Math.cos(a[1])]; }
function cuNearest(T) {
  var bi = -1, ba = 9;
  MODEL.groups.forEach(function (g, i) { var a = Math.acos(clamp(g.c[0] * T[0] + g.c[1] * T[1] + g.c[2] * T[2], -1, 1)); if (a < ba) { ba = a; bi = i; } });
  return { i: bi, a: ba };
}
// star-fixed vector -> the camera's view space: the inverse of the shader's ry(rx(n, tilt), rot)
function cuView(s) {
  var cr = Math.cos(-CU.rot), sr = Math.sin(-CU.rot), ct = Math.cos(-CU.tilt), st = Math.sin(-CU.tilt);
  var x = s[0] * cr + s[2] * sr, y = s[1], z = -s[0] * sr + s[2] * cr;
  return [x, y * ct - z * st, y * st + z * ct];
}
function cuPoint(A, L, w) {
  var g = CU.gv, k = CU.k, x = g.c[0] + (g.es[0] * A + g.en[0] * L) * k, y = g.c[1] + (g.es[1] * A + g.en[1] * L) * k, z = g.c[2] + (g.es[2] * A + g.en[2] * L) * k, s = (1 + w * k) / (Math.hypot(x, y, z) || 1);
  return [x * s, y * s, z * s];
}
function cuUpdate() {
  if (MODE !== 'closeup' || !MODEL) return;
  var T = cuVec(cuAt()), ty = clamp(T[1], -1, 1);
  // The camera: the view-space point C = (0, cos B0, sin B0) (where the canned flare sits) is the target.
  CU.tilt = Math.acos(ty) - B0; CU.rot = Math.atan2(T[0], T[2]);
  OV.rot = CU.rot; OV.tilt = CU.tilt;
  var n = MODEL.groups.length ? cuNearest(T) : { i: -1, a: 9 };
  CU.near = n.i; CU.ang = n.a;
  var reach = clamp(0.28 / CU.ZK, 0.08, 0.9), g = n.i >= 0 ? MODEL.groups[n.i] : null;
  CU.G = g && n.a < Math.max(reach, g.sep * 0.8) ? n.i : -1;
  if (CU.G >= 0) {
    var gx = sideOn(g);
    CU.gv = { c: cuView(g.c), es: cuView(gx.es), en: cuView(gx.en) };
    CU.k = clamp(g.sep / 0.185, 0.4, 3);
    CU.alpha = clamp(0.45 + 0.35 * Math.sqrt(g.area / MEAN_A), 0.5, 1);
  } else CU.gv = null;
  V.h = 0.17 * (CU.G >= 0 ? Math.max(0.75, CU.k) : 0.75) / CU.ZK;
  V.off[0] = 0; V.off[1] = cb + 0.63 * V.h;
}
if (MODE === 'closeup') {
  proj = function (A, L, w, W, H) { var q = cuPoint(A, L, w); return [W / 2 + (q[0] - V.off[0]) / V.h * H / 2, H / 2 - (q[1] - V.off[1]) / V.h * H / 2]; };
  atStage = function (a, l, h) { var q = cuPoint(a, l, h); AT.x = AT.W / 2 + (q[0] - V.off[0]) / V.h * AT.H / 2; AT.y = AT.H / 2 - (q[1] - V.off[1]) / V.h * AT.H / 2; AT.hid = false; };
  var _df = drawFlare;
  drawFlare = function () {
    cuUpdate();
    if (CU.G < 0) {
      // A quiet place: plain granulation, no loops, no plasma.
      var dpr = Math.min(devicePixelRatio || 1, 1.5), W = Math.round(fc.clientWidth * dpr), H = Math.round(fc.clientHeight * dpr);
      if (!W || !H) return;
      if (fc.width !== W || fc.height !== H) { fc.width = W; fc.height = H; }
      fx.clearRect(0, 0, W, H);
      if (flarePL) { PL.n = 0; flarePL.draw(W, H, PL.data, 0); }
      return;
    }
    fx.globalAlpha = CU.alpha; _df(); fx.globalAlpha = 1;
  };
  var _rf = resetFlares;
  resetFlares = function () {
    // The first (big) flare goes to the group at the target, so the close-up opens on it.
    if (MODEL.groups.length) CU_FORCE = cuNearest(cuVec(cuAt())).i;
    try { _rf(); } finally { CU_FORCE = -1; }
  };
}
function cuAuto() {
  if (MODE !== 'closeup' || !MODEL) return;
  cuUpdate();
  if (CU.auto) {
    var ev = null, t = 0.06, kind = FL.kind, cls = FL.cls;
    if (CU.G >= 0) OV.ev.forEach(function (e) { var u = (OV.clock - e.t0) / e.life; if (e.g === CU.G && u >= 0 && u < 1 && (!ev || e.t0 > ev.t0)) ev = e; });
    if (ev) { t = 0.18 + 0.78 * Math.min(1, (OV.clock - ev.t0) / ev.life); kind = ev.open ? 'open' : 'closed'; cls = ev.E >= 1e31 ? 'x' : ev.E >= 1e30 ? 'm' : 'c'; }
    if (kind !== FL.kind || cls !== FL.cls) { FL.kind = kind; FL.cls = cls; chartBase(); }
    FL.t = t; CU.ev = ev;
    var sig = [t.toFixed(3), kind, cls, CU.G, V.h.toFixed(4), CLOSE_AT ? CLOSE_AT[0] + ',' + CLOSE_AT[1] : ''].join('|');
    if (ST.playing || sig !== CU.sig) { CU.sig = sig; flareUi(); drawFlare(); }
  }
}
return {
  ST: ST, FL: FL, vis: vis,
  hasGL: function () { return { star: !!starGL, flare: !!flareGL }; },
  poll: function () { var g = MODE === 'globe' ? starGL : flareGL; return g ? g.poll() : false; },
  pending: function () { return !!(starGL && starGL.pending()) || !!(flareGL && flareGL.pending()); },
  lines: function () { return SHOW_LINES; },
  model: function () { return MODEL; },
  setStar: function (p) { ST.p = p; ST.P = p.P; refreshStar(); drawStar(); },
  setLight: function (id) { onFilter({ id: id }); },
  setScale: function (id) { onView({ id: id }); },
  setLines: function (on) { if (on !== SHOW_LINES) LINES_BTN.fire('click'); return SHOW_LINES; },
  // The close-up's own controls hold the flare (CU.auto off) until Play, Fire or a new target hands it back to the schedule.
  setKind: function (id) { CU.auto = false; FL.kind = id; FL.t = 0.1; FL.playing = true; flPlay(); chartBase(); flareUi(); drawFlare(); },
  setClass: function (id) { CU.auto = false; FL.cls = id; FL.t = 0.1; FL.playing = true; flPlay(); flareUi(); drawFlare(); },
  scrub: function (t) { CU.auto = false; FL.t = t; FL.playing = false; flPlay(); flareUi(); drawFlare(); drawFlareStar(); },
  setAuto: function (on) { CU.auto = on; CU.sig = ''; if (on) FL.playing = ST.playing; },
  setForce: function (i) { CU_FORCE = i; },
  cuInfo: function () { cuUpdate(); var g = CU.near >= 0 ? MODEL.groups[CU.near] : null; return { active: CU.G >= 0, near: CU.near, nearAt: g ? [Math.asin(clamp(g.c[1], -1, 1)), Math.atan2(g.c[0], g.c[2])] : null, auto: CU.auto, flaring: !!CU.ev }; },
  play: function (on) { FL.playing = on; flPlay(); },
  step: function (dt) {
    lastT = 0;
    // Close-up, live: the flare shown is the schedule's event at the target (cuAuto), so the verbatim player advance is off.
    if (MODE === 'closeup' && CU.auto) { FL.playing = false; frame(dt * 1000); FL.playing = ST.playing; cuAuto(); }
    else frame(dt * 1000);
  },
  draw: function () { drawStar(); drawFlareStar(); drawFlare(); },
  series: function () { return SER; },
  state: function () { return { ST: ST, OV: OV, PL: PL, FL: FL }; },
  // The parity harness (parity/CONTRACT.md C) drives the engine exactly as the artifact's test page does.
  pView: function (view, filter) { ST.view = view; ST.filter = filter; refreshStar(); },
  pStep: function (n, dt) { for (var i = 0; i < n; i++) { ST.time += dt * 0.2; OV.clock += dt; updateEvents(); } },
  pFlare: function (kind, cls, t) { FL.playing = false; FL.kind = kind; FL.cls = cls; FL.t = t; flareUi(); },
  setAt: function (t) { CLOSE_AT = t; CU.auto = true; CU.sig = ''; },
  // Wrapper-owned (not verbatim): the flare window's half height V.h is the flare close-up's own zoom variable.
  setFlareZoom: function (z) { CU.ZK = z; cuUpdate(); drawFlare(); drawFlareStar(); },
  at: function () { return CLOSE_AT || MODEL.best || [0.26, 0.5]; },
  pReset: function () { ST.playing = false; FL.playing = false; ST.time = 3; OV.clock = 0; OV.ev = []; OV.next = 0; OV.r = rng(1); OV.shown = null; OV.loops = []; PL.q = 1; }
};`;

export class StarEngine {
  readonly mode: StarMode;
  private readonly els = new Map<string, Stub>();
  private readonly canvases: HTMLCanvasElement[] = [];
  private readonly inside: Inside;
  private readonly lines = new Stub();
  private disposed = false;
  private isReady = false;
  private readyP: Promise<void> | null = null;
  private zoomK = 1;

  constructor(host: HTMLElement, opts: StarOptions) {
    this.mode = opts.mode;
    const reduced =
      opts.reducedMotion ??
      (() => {
        try {
          return matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch {
          return false;
        }
      })();
    const prefix = opts.mode === 'globe' ? 'star' : 'flare';
    const surface = opts.mode === 'globe' && !!opts.surface;
    const layer = (id: string, blend: boolean, label?: string) => {
      const c = document.createElement('canvas');
      c.style.cssText = `position:absolute;inset:0;width:100%;height:100%;display:block;${blend ? 'mix-blend-mode:screen;pointer-events:none;' : ''}`;
      if (label) {
        c.setAttribute('role', 'img');
        c.setAttribute('aria-label', label);
      } else c.setAttribute('aria-hidden', 'true');
      host.appendChild(c);
      this.canvases.push(c);
      return [id, c] as const;
    };
    const live = new Map<string, HTMLCanvasElement>(
      surface
        ? [layer('#star-c', false, 'Simulated close-up of the star’s surface')]
        : [
            layer(`#${prefix}-c`, false),
            layer(`#${prefix}-p`, true),
            layer(
              `#${prefix}-o`,
              true,
              opts.mode === 'globe'
                ? 'Live simulated star with magnetic loops and flares rising from its spot groups'
                : 'Simulated flare at the edge of the star',
            ),
          ],
    );
    // The prototype logs "no webgl2" for every inert canvas it asks for GL (the other mode's, and the surface
    // close-up's plasma): expected here, so dropped. A live canvas with no GL still logs.
    let inertAsked = 0;
    const askedInert = () => {
      inertAsked++;
    };
    const $ = (sel: string): unknown => {
      const c = live.get(sel);
      if (c) return c;
      if (/^#(star|flare)-[cpo]$/.test(sel)) return inertCanvas(askedInert);
      let s = this.els.get(sel);
      if (!s) this.els.set(sel, (s = new Stub()));
      return s;
    };
    const doc = {
      createElement: (t: string) => document.createElement(t),
      querySelectorAll: (sel: string) => (sel === '.lines-b' ? [this.lines] : []),
    };
    // The slices' own `console.log` chatter is dropped; errors and warnings reach the real console so a
    // failure inside the prototype code (a shader that will not compile, a missing element) is never silent.
    const quiet = {
      error: (...a: unknown[]) => {
        if (inertAsked > 0 && a.length === 1 && a[0] instanceof Error && a[0].message === NO_GL) {
          inertAsked--;
          return;
        }
        console.error('[star engine]', ...a);
      },
      warn: (...a: unknown[]) => console.warn('[star engine]', ...a),
      log: () => {},
    };
    // CSP: `new Function` needs 'unsafe-eval' in script-src. The slices stay plain script (byte-identical
    // to the prototype) and are scoped per instance here; turning them into a module closure (as
    // engine/worlds/core.js's createCore does) would need a generated wrapper file and is left for later.
    const make = new Function(
      '$',
      'rng',
      'lerp',
      'smooth',
      'clamp',
      'reduced',
      'console',
      'document',
      'requestAnimationFrame',
      'addEventListener',
      'MODE',
      'LINES_BTN',
      'HALF',
      'FLARE_FILTER',
      SRC + SUFFIX,
    ) as (...a: unknown[]) => Inside;
    this.inside = make(
      $,
      rng,
      lerp,
      smooth,
      clamp,
      reduced,
      quiet,
      doc,
      () => 0,
      () => {},
      opts.mode,
      this.lines,
      (h: number) => this.effHalf(h),
      (f: number) => (this.mode === 'closeup' ? this.lightNow() : f),
    );
    const light = opts.light ?? 0;
    if (light !== 3) this.inside.setLight(light);
  }

  private lightNow(): number {
    // The flare close-up's own H-alpha look is replaced by the star's Light setting (true colour, enhanced, observatory).
    return (this.inside as Inside | undefined)?.ST.filter ?? 0;
  }
  /**
   * The half height (in star radii) the view is drawn with. Whole star: wide enough that the disc and its loops
   * fit with margin (disc radius at most FRAME of the shorter side; the engine's own 1.28 gave 0.39 of the height and
   * cropped the loops). Surface close-up: the engine's half height divided by the zoom.
   */
  private effHalf(h: number): number {
    if (this.mode !== 'globe') return h;
    const view = (this.inside as Inside | undefined)?.ST.view;
    if (view === 'close') return h / this.zoomK;
    const c = this.canvases[0];
    const W = c?.clientWidth ?? 0,
      H = c?.clientHeight ?? 0;
    if (!W || !H) return h;
    return Math.max(h, H / (2 * (view === 'big' ? FRAME_BIG : FRAME_TRUE) * Math.min(W, H)));
  }
  /** The half height the whole-star view uses now (for picking and the marker). */
  globeHalf(): number {
    return this.effHalf(GLOBE_HALF);
  }
  /** The close-up's zoom limits (1 = as opened), or null when this view has none (the whole star). */
  get zoomRange(): [number, number] | null {
    if (this.mode === 'closeup') return [0.25, 4];
    return this.inside.ST.view === 'close' ? [0.5, 8] : null;
  }
  get zoom(): number {
    return this.zoomK;
  }
  /** Surface close-up: drives the engine's half height (drawStar's `half`, via HALF). Flare close-up: V.h = 0.17 / zoom. */
  setZoom(z: number): void {
    const r = this.zoomRange;
    if (!r || this.disposed) return;
    this.zoomK = clamp(z, r[0], r[1]);
    if (this.mode === 'closeup') this.inside.setFlareZoom(this.zoomK);
    else this.inside.draw();
  }

  /** True when this mode's surface canvas got WebGL 2 (else the caller keeps its fallback). Its shader may still be compiling. */
  get supported(): boolean {
    const g = this.inside.hasGL();
    return this.mode === 'globe' ? g.star : g.flare;
  }

  /** True once the star program is compiled and linked, so the engine draws (never waits for the driver). */
  get ready(): boolean {
    try {
      return this.pollReady();
    } catch {
      return false;
    }
  }

  /**
   * Issue #93 W1 (B7): true once the star program is linked. Never waits for the driver (KHR_parallel_shader_compile;
   * without the extension it links at once, which waits as the prototype did). Throws the compile or link log.
   */
  pollReady(): boolean {
    if (!this.isReady && !this.disposed) this.isReady = this.inside.poll();
    return this.isReady;
  }

  /**
   * Resolves when the star program is linked, checking every 16 ms so the page keeps running meanwhile, and draws the
   * star once then. Rejects with the compile or link log, when this mode has no WebGL 2, or on dispose.
   */
  whenReady(): Promise<void> {
    if (!this.readyP)
      this.readyP = new Promise<void>((resolve, reject) => {
        const check = () => {
          if (this.disposed)
            return reject(new Error('star engine disposed before its shader was ready'));
          if (!this.supported) return reject(new Error('this browser gave the star no WebGL 2'));
          try {
            if (this.pollReady()) {
              this.inside.draw();
              resolve();
            } else setTimeout(check, 16);
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        };
        check();
      });
    return this.readyP;
  }

  setStar(preset: StarPreset): void {
    this.inside.setStar(preset);
    // A star with no convective surface or no spots has no flares to fire.
  }
  /** Light and scale: the prototype's pills. */
  setLight(light: StarLight): void {
    this.inside.setLight(light);
  }
  setScale(view: StarScaleView): void {
    this.inside.setScale(view);
  }
  /** The prototype's own handler: it redraws the surface and the flare. */
  setView(v: { light?: StarLight; scale?: StarScaleView }): void {
    if (v.scale) this.inside.setScale(v.scale);
    if (v.light !== undefined) this.inside.setLight(v.light);
  }
  setPaused(paused: boolean): void {
    this.inside.ST.playing = !paused;
    this.inside.FL.playing = !paused;
    // Play hands the close-up back to the star's own flare schedule.
    if (!paused && this.mode === 'closeup') this.inside.setAuto(true);
  }
  get light(): StarLight {
    return this.inside.ST.filter as StarLight;
  }
  get scale(): StarScaleView {
    return this.inside.ST.view as StarScaleView;
  }
  get paused(): boolean {
    return !this.inside.ST.playing;
  }
  /**
   * The prototype's "Fire a big flare" button. `group` (an index into the star's spot groups) makes the flare start at
   * that group instead of the engine's weighted pick.
   */
  fireFlare(group?: number): void {
    this.inside.setForce(group ?? -1);
    try {
      this.el('#star-fire').fire('click');
    } finally {
      this.inside.setForce(-1);
    }
    if (this.mode === 'closeup') this.inside.setAuto(true);
  }
  /**
   * What the close-up sees at its target: whether a spot group is in view (`active`), the nearest group's index and
   * place, and whether it shows the live schedule (`auto`) or a flare the user chose.
   */
  closeInfo(): CloseInfo {
    const i = this.inside.cuInfo();
    return {
      active: i.active,
      near: i.near,
      nearAt: i.nearAt ? { lat: i.nearAt[0], lon: i.nearAt[1] } : null,
      auto: i.auto,
      flaring: i.flaring,
    };
  }
  setFieldLines(on: boolean): void {
    this.inside.setLines(on);
  }
  get fieldLines(): boolean {
    return this.inside.lines();
  }

  /** The "Latest flare on this star" card text. */
  latestFlare(): string {
    return this.el('#flare-now').textContent || 'No flare yet.';
  }
  /** Rotation period: the slider position 0..1000, its text, and whether the star uses it. */
  rotation(): { position: number; text: string; used: boolean } {
    const r = this.el('#rot');
    return {
      position: Number(r.value) || 0,
      text: this.el('#rot-v').textContent,
      used: !r.disabled,
    };
  }
  setRotationPosition(v: number): void {
    this.el('#rot').fire('input', { target: { value: v } });
  }
  caption(): string {
    return this.el('#star-cap').textContent;
  }
  /** The prototype's tag over the stage: "Sun · True colour". */
  stageTag(): string {
    return this.el('#star-tag').textContent;
  }
  /** The readouts beside the stage, as rows. */
  readouts(): Readout[] {
    const html = this.el('#star-read').innerHTML;
    return [...html.matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)].map((m) => ({
      label: m[1]!,
      value: m[2]!.replace(/<[^>]*>/g, ''),
    }));
  }
  /** "How each part is worked out", this mode's blocks. */
  notes(): BuildNote[] {
    return STAR_NOTES[this.mode];
  }
  hasFlares(): boolean {
    return this.inside.model().groups.length > 0;
  }

  // ---- the flare close-up ----
  flare(): FlareState {
    const f = this.inside.FL;
    return {
      kind: f.kind,
      cls: f.cls,
      t: f.t,
      playing: f.playing,
      minutes: this.el('#fl-tv').textContent,
      caption: this.el('#fl-cap').textContent,
      tag: this.el('#flare-tag').textContent,
    };
  }
  setFlareKind(k: FlareKind): void {
    this.inside.setKind(k);
  }
  setFlareClass(c: FlareClass): void {
    this.inside.setClass(c);
  }
  /** The scrubber and the chart: 0..1 of the 60 minutes (stops playing, as the prototype does). */
  setFlareTime(t: number): void {
    this.inside.scrub(clamp(t, 0, 1));
  }
  chart(): ChartData | null {
    const s = this.inside.series();
    return s ? { soft: s.s, hard: s.h, open: this.inside.FL.kind === 'open' } : null;
  }

  /** The close-up's target (lat, lon): a picked place, or the strongest spot group (`m.best`) when none is set. */
  setCloseTarget(t: LatLon | null): void {
    this.inside.setAt(t ? [t.lat, t.lon] : null);
    this.inside.draw();
  }
  closeTarget(): LatLon {
    const [lat, lon] = this.inside.at();
    return { lat, lon };
  }
  /** The place under a point of this (whole-star) view, `nx`, `ny` 0..1 from the canvas's top left; null on the limb or in space. */
  pick(nx: number, ny: number): LatLon | null {
    const c = this.canvases[0];
    if (!c || !c.clientHeight) return null;
    const q = viewPoint(nx, ny, c.clientWidth / c.clientHeight, this.globeHalf());
    return pickSurface(q, globeRot(this.inside.ST.time), GLOBE_TILT);
  }
  /** The artifact's own state objects (ST, OV, PL, FL), for the parity harness. */
  get state(): Record<string, unknown> {
    return this.inside.state();
  }
  /** The engine's canvases, surface first then the plasma and line overlays. */
  get layers(): HTMLCanvasElement[] {
    return this.canvases;
  }
  /** Parity harness (dev only): the artifact test page's reset, view, step and flare, in its order. */
  parity(c: {
    view?: StarScaleView;
    filter?: number;
    fire?: boolean;
    steps?: number;
    flare?: [FlareKind, FlareClass, number];
  }): void {
    const i = this.inside;
    i.pReset();
    if (this.mode === 'globe') {
      i.pView((c.view as string) ?? 'big', c.filter ?? 0);
      if (c.fire) this.fireFlare();
      i.pStep(c.steps ?? 0, 1 / 60);
    } else if (c.flare) i.pFlare(...c.flare);
  }

  /** Advance by `dt` seconds (the prototype caps one step at 0.06 s) and draw, as its frame does. */
  tick(dt: number): void {
    if (this.disposed) return;
    this.inside.step(Math.min(0.06, Math.max(0, dt)));
  }
  /** Draw now, without advancing. */
  draw(): void {
    if (!this.disposed) this.inside.draw();
  }

  /**
   * Release the GL contexts. Issue #93 W1 (B7): `loseContext()` waits for a shader compile still running in the
   * driver, so while the star program is still compiling the contexts are released once the driver reports it done
   * (polled every STAR_DISPOSE_POLL_MS, never blocking). After STAR_DISPOSE_MAX_WAIT_MS the engine gives up without
   * calling `loseContext()`; the browser reclaims the contexts with the detached canvases. The canvases leave the page
   * at once.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const canvases = [...this.canvases];
    this.canvases.length = 0;
    for (const c of canvases) c.remove();
    const lose = () => {
      for (const c of canvases)
        try {
          c.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
        } catch {
          /* context already gone */
        }
    };
    const pending = (): boolean => {
      try {
        return this.inside.pending();
      } catch {
        return false;
      }
    };
    const t0 = Date.now();
    const tryLose = () => {
      if (!pending()) lose();
      else if (Date.now() - t0 < STAR_DISPOSE_MAX_WAIT_MS)
        setTimeout(tryLose, STAR_DISPOSE_POLL_MS);
      else if (import.meta.env.DEV)
        console.warn(
          'star engine: shader still compiling after dispose; context left to the browser',
        );
    };
    tryLose();
  }

  private el(sel: string): Stub {
    let s = this.els.get(sel);
    if (!s) this.els.set(sel, (s = new Stub()));
    return s;
  }
}

/** True when this browser can start the engine (WebGL 2). The check is made once. */
let gl2: boolean | null = null;
export function starEngineSupported(): boolean {
  if (gl2 === null) {
    try {
      const c = document.createElement('canvas');
      gl2 = !!c.getContext('webgl2');
      c.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      gl2 = false;
    }
  }
  return gl2;
}

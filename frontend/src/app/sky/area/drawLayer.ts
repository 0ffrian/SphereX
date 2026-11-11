// Draws the Area layers on their 2D canvas (A18.1, A18.2): the drawn square or the prepared area's
// box, the draft square while dragging, the current visit's dots, the tracks with their join
// lines, labels and the selection bracket. Called from the SkyView render listener (positions from
// raDecToScreen with the camera of that frame) and on state changes; no allocation per dot. RA wrap:
// every point goes through the 3D projection, so a track across RA 0/360 is the short segment it
// is, and a segment with an end behind the camera is skipped.
import { raDecToScreen, type RaDec, type ScreenPoint, type SkyCamera } from '@/viewer/sky/skyMath';
import type { Rect } from '@/app/sky/safeRect';
import { boxCorners, type SkyBox, type SkySquare } from './geometry';
import type { ScreenSquare } from './drawSquare';
import {
  ACCENT,
  dotStyle,
  joinStyle,
  labelColor,
  MONO,
  NEUTRAL,
  tracksShown,
  type AreaScene,
  type SceneTrack,
} from './scene';

export type AreaCtx = Pick<
  CanvasRenderingContext2D,
  | 'clearRect'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'arc'
  | 'closePath'
  | 'stroke'
  | 'fill'
  | 'setLineDash'
  | 'strokeText'
  | 'fillText'
  | 'measureText'
  | 'strokeStyle'
  | 'fillStyle'
  | 'lineWidth'
  | 'font'
  | 'globalAlpha'
  | 'lineJoin'
  | 'textBaseline'
>;

/** Smallest glyph radius, CSS px (a dot stays visible at any zoom). Display value. */
export const DOT_RADIUS_PX = 4;
/** Labels hide when the view is wider than this (A18.2; fov is vertical, Q-406 (3)). */
export const LABEL_MAX_FOV_DEG = 30;
/** A click this close to a track's dot picks it (A18.2). */
export const HIT_RADIUS_PX = 20;
/** The selection bracket: at least the selected-object marker's 34 px box, 9 px legs. */
export const BRACKET_MIN_PX = 34;
export const BRACKET_LEG_PX = 9;
const HALO = 'rgba(0,0,0,0.65)';
const NO_DASH: number[] = [];
const LABEL_FONT = '600 11px system-ui, sans-serif';
const SIZE_FONT = '600 12px system-ui, sans-serif';

export type AreaOutline =
  | { kind: 'box'; box: SkyBox; label: string }
  | { kind: 'square'; square: SkySquare; label: string };

export interface AreaDrawInput {
  scene: AreaScene | null;
  visit: number;
  step: number;
  layers: { dots: boolean; tracks: boolean };
  measured: boolean;
  selected: string | null;
  outline: AreaOutline | null;
  draft: { square: ScreenSquare; label: string } | null;
  cam: SkyCamera;
  width: number;
  height: number;
  safe: Rect;
}

export interface AreaDrawStats {
  dots: number;
  tracks: number;
  joins: number;
  labels: number;
  bracket: boolean;
  outline: 'box' | 'square' | 'none';
  draft: boolean;
}

export function emptyStats(): AreaDrawStats {
  return { dots: 0, tracks: 0, joins: 0, labels: 0, bracket: false, outline: 'none', draft: false };
}

const P: ScreenPoint = { x: 0, y: 0, inFront: false };
const CORNERS: RaDec[] = [
  { ra: 0, dec: 0 },
  { ra: 0, dec: 0 },
  { ra: 0, dec: 0 },
  { ra: 0, dec: 0 },
];
const CX = new Float64Array(4);
const CY = new Float64Array(4);

/** Strokes the current path twice: a dark halo, then the colour (≥ 3:1 on a bright sky). */
function haloStroke(ctx: AreaCtx, color: string, width: number): void {
  ctx.lineWidth = width + 2;
  ctx.strokeStyle = HALO;
  ctx.stroke();
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function haloText(ctx: AreaCtx, text: string, x: number, y: number, color: string): void {
  ctx.lineWidth = 3;
  ctx.strokeStyle = HALO;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawOutline(ctx: AreaCtx, i: AreaDrawInput, stats: AreaDrawStats): void {
  const o = i.outline;
  if (!o) return;
  if (o.kind === 'box') boxCorners(o.box.ra, o.box.dec, o.box.width_deg, o.box.height_deg, CORNERS);
  else boxCorners(o.square.ra, o.square.dec, o.square.sideDeg, o.square.sideDeg, CORNERS);
  for (let k = 0; k < 4; k++) {
    const c = CORNERS[k]!;
    const p = raDecToScreen(i.cam, c.ra, c.dec, i.width, i.height, P);
    if (!p.inFront) return;
    CX[k] = p.x;
    CY[k] = p.y;
  }
  ctx.setLineDash(NO_DASH);
  ctx.beginPath();
  ctx.moveTo(CX[0]!, CY[0]!);
  for (let k = 1; k < 4; k++) ctx.lineTo(CX[k]!, CY[k]!);
  ctx.closePath();
  haloStroke(ctx, ACCENT, 1.5);
  const x = Math.min(CX[0]!, CX[1]!, CX[2]!, CX[3]!);
  const y = Math.min(CY[0]!, CY[1]!, CY[2]!, CY[3]!);
  ctx.font = SIZE_FONT;
  ctx.textBaseline = 'bottom';
  haloText(ctx, o.label, x, y - 4, ACCENT);
  stats.outline = o.kind;
}

const DRAFT_DASH = [6, 4];

function drawDraft(ctx: AreaCtx, i: AreaDrawInput, stats: AreaDrawStats): void {
  if (!i.draft) return;
  const { x, y, side } = i.draft.square;
  ctx.setLineDash(DRAFT_DASH);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + side, y);
  ctx.lineTo(x + side, y + side);
  ctx.lineTo(x, y + side);
  ctx.closePath();
  haloStroke(ctx, ACCENT, 1.5);
  ctx.setLineDash(NO_DASH);
  ctx.font = SIZE_FONT;
  ctx.textBaseline = 'bottom';
  haloText(ctx, i.draft.label, x, y - 4, ACCENT);
  stats.draft = true;
}

const onScreen = (p: ScreenPoint, w: number, h: number, m: number) =>
  p.inFront && p.x > -m && p.x < w + m && p.y > -m && p.y < h + m;

function drawDots(ctx: AreaCtx, i: AreaDrawInput, stats: AreaDrawStats): void {
  if (!i.scene || !i.layers.dots || i.step <= 0) return;
  const v = i.scene.visits.find((x) => x.visit === i.visit);
  if (!v) return;
  const r = DOT_RADIUS_PX;
  ctx.setLineDash(NO_DASH);
  // Rings, one path per colour (the dots are pre-grouped by colour).
  let colour: string | null = null;
  let open = false;
  const flush = () => {
    if (open && colour) haloStroke(ctx, colour, 1.5);
    open = false;
  };
  for (let k = 0; k < v.byColour.length; k++) {
    const d = v.dots[v.byColour[k]!]!;
    const style = dotStyle(d.label, i.step, i.measured);
    if (style === 'none' || style === 'cross') continue;
    const c = style === 'ring-white' ? NEUTRAL : style === 'ring-mono' ? MONO : d.color;
    const p = raDecToScreen(i.cam, d.ra, d.dec, i.width, i.height, P);
    if (!onScreen(p, i.width, i.height, r)) continue;
    if (c !== colour) {
      flush();
      colour = c;
    }
    if (!open) {
      ctx.beginPath();
      open = true;
    }
    ctx.moveTo(p.x + r, p.y);
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    stats.dots++;
  }
  flush();
  // Faint crosses for stars and fixed dots after the stars step.
  ctx.beginPath();
  let crosses = 0;
  for (const d of v.dots) {
    if (dotStyle(d.label, i.step, i.measured) !== 'cross') continue;
    const p = raDecToScreen(i.cam, d.ra, d.dec, i.width, i.height, P);
    if (!onScreen(p, i.width, i.height, r)) continue;
    ctx.moveTo(p.x - 3, p.y);
    ctx.lineTo(p.x + 3, p.y);
    ctx.moveTo(p.x, p.y - 3);
    ctx.lineTo(p.x, p.y + 3);
    crosses++;
  }
  if (crosses > 0) {
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    ctx.strokeStyle = NEUTRAL;
    ctx.stroke();
    ctx.globalAlpha = 1;
    stats.dots += crosses;
  }
}

/** Projects every point of a track into its screen cache (NaN when off the front). */
function projectTrack(t: SceneTrack, i: AreaDrawInput): void {
  let k = 0;
  for (const tl of t.tracklets) {
    for (let j = 0; j < tl.ra.length; j++, k++) {
      const p = raDecToScreen(i.cam, tl.ra[j]!, tl.dec[j]!, i.width, i.height, P);
      t.sx[k] = p.inFront ? p.x : Number.NaN;
      t.sy[k] = p.inFront ? p.y : Number.NaN;
    }
  }
}

function clearTrack(t: SceneTrack): void {
  t.sx.fill(Number.NaN);
  t.sy.fill(Number.NaN);
}

function drawTracks(ctx: AreaCtx, i: AreaDrawInput, stats: AreaDrawStats): void {
  if (!i.scene) return;
  const shown = tracksShown(i.step, i.layers.tracks, i.measured);
  for (const t of i.scene.tracks) {
    if (!shown) {
      clearTrack(t);
      continue;
    }
    projectTrack(t, i);
  }
  if (!shown) return;
  const neutral = i.step < 5;
  for (const t of i.scene.tracks) {
    // Tracklets: a short solid line through the exposures, and a dot per frame.
    ctx.setLineDash(NO_DASH);
    ctx.beginPath();
    let k = 0;
    for (const tl of t.tracklets) {
      let pen = false;
      for (let j = 0; j < tl.ra.length; j++, k++) {
        const x = t.sx[k]!;
        const y = t.sy[k]!;
        if (Number.isNaN(x)) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        pen = true;
      }
    }
    const color = neutral ? NEUTRAL : labelColor(t.verdict);
    haloStroke(ctx, color, 1.5);
    ctx.beginPath();
    for (let m = 0; m < t.sx.length; m++) {
      const x = t.sx[m]!;
      if (Number.isNaN(x)) continue;
      ctx.moveTo(x + 2, t.sy[m]!);
      ctx.arc(x, t.sy[m]!, 2, 0, Math.PI * 2);
    }
    ctx.fillStyle = color;
    ctx.fill();
    // Joins: last dot of one visit to the first of the next, one segment per visit pair.
    const js = t.status === 'track' ? joinStyle(t.verdict, i.step) : null;
    if (js && t.tracklets.length > 1) {
      ctx.setLineDash(js.dash as number[]);
      ctx.beginPath();
      let start = 0;
      for (let n = 0; n < t.tracklets.length - 1; n++) {
        const a = start + t.tracklets[n]!.ra.length - 1;
        const b = a + 1;
        start += t.tracklets[n]!.ra.length;
        if (a < 0 || Number.isNaN(t.sx[a]!) || Number.isNaN(t.sx[b]!)) continue;
        ctx.moveTo(t.sx[a]!, t.sy[a]!);
        ctx.lineTo(t.sx[b]!, t.sy[b]!);
        stats.joins++;
      }
      haloStroke(ctx, js.color, 1.5);
      ctx.setLineDash(NO_DASH);
    }
    stats.tracks++;
  }
}

function drawLabels(ctx: AreaCtx, i: AreaDrawInput, stats: AreaDrawStats): void {
  if (!i.scene || i.step < 5 || !tracksShown(i.step, i.layers.tracks, i.measured)) return;
  if (i.cam.fovDeg > LABEL_MAX_FOV_DEG) return;
  ctx.font = LABEL_FONT;
  ctx.textBaseline = 'bottom';
  ctx.setLineDash(NO_DASH);
  for (const t of i.scene.tracks) {
    const last = lastPoint(t);
    if (last < 0) continue;
    const tw = ctx.measureText(t.label).width;
    const pos = clampLabel(t.sx[last]! + 8, t.sy[last]! - 8, tw, 14, i.safe);
    haloText(ctx, t.label, pos.x, pos.y, labelColor(t.verdict));
    stats.labels++;
  }
}

function lastPoint(t: SceneTrack): number {
  for (let k = t.sx.length - 1; k >= 0; k--) if (!Number.isNaN(t.sx[k]!)) return k;
  return -1;
}

/** A label's baseline-left point kept inside the safe rectangle (A21.2). */
export function clampLabel(
  x: number,
  y: number,
  textWidth: number,
  textHeight: number,
  safe: Rect,
): { x: number; y: number } {
  const minX = safe.x + 2;
  const maxX = Math.max(minX, safe.x + safe.w - textWidth - 2);
  const minY = safe.y + textHeight;
  const maxY = Math.max(minY, safe.y + safe.h - 2);
  return { x: Math.min(maxX, Math.max(minX, x)), y: Math.min(maxY, Math.max(minY, y)) };
}

function drawBracket(ctx: AreaCtx, i: AreaDrawInput, stats: AreaDrawStats): void {
  if (!i.scene || !i.selected || !tracksShown(i.step, i.layers.tracks, i.measured)) return;
  const t = i.scene.tracks.find((x) => x.id === i.selected);
  if (!t) return;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const any = t.pointVisit.some((v) => v === i.visit);
  for (let k = 0; k < t.sx.length; k++) {
    if (any && t.pointVisit[k] !== i.visit) continue;
    const x = t.sx[k]!;
    if (Number.isNaN(x)) continue;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, t.sy[k]!);
    y1 = Math.max(y1, t.sy[k]!);
  }
  if (!Number.isFinite(x0)) return;
  const side = Math.max(BRACKET_MIN_PX, x1 - x0 + 16, y1 - y0 + 16);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const l = cx - side / 2;
  const r = cx + side / 2;
  const tp = cy - side / 2;
  const b = cy + side / 2;
  const g = BRACKET_LEG_PX;
  ctx.setLineDash(NO_DASH);
  ctx.beginPath();
  ctx.moveTo(l, tp + g);
  ctx.lineTo(l, tp);
  ctx.lineTo(l + g, tp);
  ctx.moveTo(r - g, tp);
  ctx.lineTo(r, tp);
  ctx.lineTo(r, tp + g);
  ctx.moveTo(r, b - g);
  ctx.lineTo(r, b);
  ctx.lineTo(r - g, b);
  ctx.moveTo(l + g, b);
  ctx.lineTo(l, b);
  ctx.lineTo(l, b - g);
  haloStroke(ctx, ACCENT, 2);
  stats.bracket = true;
}

/** Clears and draws everything; returns what was drawn (tests, the e2e hook). */
export function drawArea(ctx: AreaCtx, i: AreaDrawInput): AreaDrawStats {
  const stats = emptyStats();
  ctx.clearRect(0, 0, i.width, i.height);
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 1;
  drawOutline(ctx, i, stats);
  drawDots(ctx, i, stats);
  drawTracks(ctx, i, stats);
  drawLabels(ctx, i, stats);
  drawBracket(ctx, i, stats);
  drawDraft(ctx, i, stats);
  return stats;
}

/**
 * The track whose drawn dot is nearest (x, y), within HIT_RADIUS_PX; null when none. Reads the
 * screen caches of the last draw (cleared while tracks are hidden).
 */
export function hitTestTracks(scene: AreaScene | null, x: number, y: number): string | null {
  if (!scene) return null;
  let best: string | null = null;
  let bestD = HIT_RADIUS_PX;
  for (const t of scene.tracks) {
    for (let k = 0; k < t.sx.length; k++) {
      const sx = t.sx[k]!;
      if (Number.isNaN(sx)) continue;
      const d = Math.hypot(sx - x, t.sy[k]! - y);
      if (d <= bestD) {
        bestD = d;
        best = t.id;
      }
    }
  }
  return best;
}

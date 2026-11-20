// §8.5 the weather overlay (issue #117): a transparent 2D canvas over the fly view that draws rain, snow, lightning
// bolts and glows from the weather the sound pipeline publishes on the weather bus. It never catches input
// (pointer-events none), is hidden from assistive tech (aria-hidden; "What is drawn" lists it), draws at most 30 fps,
// clears once and stops when there is nothing to draw, and works with the sound muted (the bus publishes regardless).
// Flash safety lives in flashGate.ts; geometry in weatherDraw.ts.
import { useEffect, useRef, useState } from 'react';
import { useSoundSettings } from '@/sound/settings';
import { FlashGate, groupGlowMax, safeGlow, strokeEnvMax, type FlashGroup } from '../flashGate';
import {
  BOLT_CLIP_MARGIN,
  BOLT_CORE_PX,
  BOLT_GLOW_PX,
  BOLT_MIN_PX,
  BOLT_RGB,
  CLOUD_GLOW_OPACITY,
  CLOUD_GLOW_R,
  DECK_GLOW_R,
  EDGE_GLOW_W,
  FLASH_OPACITY,
  OVERLAY_DPR_CAP,
  OVERLAY_MAX_FPS,
  OVERLAY_SNAPSHOT_STALE_S,
  RAIN_ALPHA,
  RAIN_STREAKS_MAX,
  RAIN_WIDTH_PX,
  SAFE_GLOW_OPACITY,
  SNOW_FLAKES_MAX,
} from '../tuning';
import type { WeatherSnapshot } from '../weatherBus';
import { getWeather, onStrike, subscribeWeather } from '../weatherBus';
import {
  boltPolyline,
  buildRain,
  clipToRect,
  buildSnow,
  classifyStrike,
  clipSegmentNear,
  deckRadius,
  edgeSide,
  focalPx,
  particleCount,
  polylineLength,
  projectPx,
  rainLean,
  smallAreaLimitPx2,
  strikeWorld,
  tintCss,
  type Basis,
  type StrikeWorld,
} from '../weatherDraw';

/** The on-screen label while weather is drawn (§8.5 honesty; colour and placement are artistic). */
export const WEATHER_CAPTION =
  'Weather: artist’s impression from the simulated climate · colour not from data';

/** The engine surface the overlay reads (WorldEngine implements it; tests fake it). */
export interface OverlayEngine {
  readonly fly: { lon: number; lat: number; alt: number; head: number };
  flyCameraBasis(): Basis | null;
  groundKm(lon: number, lat: number): number;
  state(): { gas: boolean; clouds: boolean };
}

/** The canvas calls the overlay makes (a CanvasRenderingContext2D satisfies it; tests record it). */
export type Ctx2D = Pick<
  CanvasRenderingContext2D,
  | 'clearRect'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'stroke'
  | 'fill'
  | 'rect'
  | 'fillRect'
  | 'setTransform'
  | 'createRadialGradient'
  | 'createLinearGradient'
  | 'strokeStyle'
  | 'fillStyle'
  | 'lineWidth'
  | 'lineCap'
>;

const fin = (...xs: number[]): boolean => xs.every(Number.isFinite);

/** H2: every gradient is built from finite numbers only, so one bad value never throws out of the frame. */
function radial(
  ctx: Ctx2D,
  x: number,
  y: number,
  r: number,
  rgb: readonly number[],
  a: number,
): void {
  if (!fin(x, y, r, a) || !(r > 0) || !(a > 0)) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, tintCss(rgb, a));
  g.addColorStop(1, tintCss(rgb, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
}

function edge(
  ctx: Ctx2D,
  side: 1 | -1,
  W: number,
  H: number,
  rgb: readonly number[],
  a: number,
): void {
  const w = EDGE_GLOW_W * W;
  if (!fin(w, W, H, a) || !(w > 0) || !(a > 0)) return;
  const x0 = side > 0 ? W : 0;
  const x1 = side > 0 ? W - w : w;
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, tintCss(rgb, a));
  g.addColorStop(1, tintCss(rgb, 0));
  ctx.fillStyle = g;
  ctx.fillRect(side > 0 ? W - w : 0, 0, w, H);
}

function polyline(ctx: Ctx2D, lines: readonly Float32Array[]): void {
  ctx.beginPath();
  for (const l of lines) {
    if (l.length < 4) continue;
    ctx.moveTo(l[0]!, l[1]!);
    for (let i = 2; i + 1 < l.length; i += 2) ctx.lineTo(l[i]!, l[i + 1]!);
  }
}

export interface DrawState {
  W: number;
  H: number;
  rain: Float32Array;
  snow: Float32Array;
  worlds: Map<FlashGroup, StrikeWorld | null>;
  bolts: Map<FlashGroup, { key: string; lines: Float32Array[] }>;
  /** §8.5 the world's seed (WorldPreset.seed, artistic): rain and snow are rng32(seed ^ frameBucket), per world. */
  seed: number;
}

export function newDrawState(seed = 0): DrawState {
  return {
    seed: seed >>> 0,
    W: 0,
    H: 0,
    rain: new Float32Array(RAIN_STREAKS_MAX * 4),
    snow: new Float32Array(SNOW_FLAKES_MAX * 3),
    worlds: new Map(),
    bolts: new Map(),
  };
}

/**
 * One overlay frame at `t` (s, performance clock); `dt` is the time since the last drawn frame. Returns true while
 * something is drawn or waiting (rain, snow, a group not yet ended), so the loop keeps running.
 */
export function drawWeatherFrame(
  ctx: Ctx2D,
  st: DrawState,
  engine: OverlayEngine,
  snap: WeatherSnapshot | null,
  gate: FlashGate,
  t: number,
  dt: number,
): boolean {
  const { W, H } = st;
  ctx.clearRect(0, 0, W, H);
  const groups = gate.active(t);
  for (const g of [...st.worlds.keys()]) if (!groups.includes(g)) st.worlds.delete(g);
  for (const g of [...st.bolts.keys()]) if (!groups.includes(g)) st.bolts.delete(g);
  const b = engine.flyCameraBasis();
  if (!b || !(W > 0) || !(H > 0)) return groups.length > 0;
  const es = engine.state();
  const fresh =
    !!snap && t - snap.tS <= OVERLAY_SNAPSHOT_STALE_S && t - snap.tS >= -OVERLAY_SNAPSHOT_STALE_S;
  const frame = fresh ? snap.frame : null;
  const zc = snap ? snap.frame.zc_km : null;
  const camR = Math.hypot(b.cam[0], b.cam[1], b.cam[2]);
  const deckR = deckRadius(zc, b.ex, b.rkm);
  // H3 / blue 16: the engine draws the fly deck whenever clouds are on, at max(zc, 0.3) km, or 3.5 km when zc is null
  // (core.js uCloudKm); deckRadius applies the same default. Rain also needs #116's frame (real-height cut, Q-449).
  const deckDrawn = es.clouds;
  const aboveDeck = deckDrawn && camR >= deckR;
  const fpx = focalPx(H, b.fov);
  let drew = false;

  const rain = frame?.rain ?? null;
  if (rain && !aboveDeck && !es.gas) {
    const N = particleCount(rain.density, rain.snow);
    const seed = st.seed; // PR #125 review N5: the world's seed, not a constant
    if (!rain.snow) {
      const lean = snap ? rainLean(snap.windDirDeg, snap.U10, engine.fly.head, rain.vt) : 0;
      const counts = buildRain(st.rain, N, seed, Math.floor(t * 60), W, H, fpx, rain.vt, lean);
      let o = 0;
      ctx.lineCap = 'round';
      for (let L = 0; L < 3; L++) {
        ctx.beginPath();
        for (let i = 0; i < counts[L]!; i++, o += 4) {
          ctx.moveTo(st.rain[o]!, st.rain[o + 1]!);
          ctx.lineTo(st.rain[o + 2]!, st.rain[o + 3]!);
        }
        ctx.strokeStyle = tintCss(rain.tint, RAIN_ALPHA[L]!);
        ctx.lineWidth = RAIN_WIDTH_PX[L]!;
        ctx.stroke();
      }
    } else {
      const counts = buildSnow(st.snow, N, seed, t, W, H, fpx, rain.vt);
      let o = 0;
      for (let L = 0; L < 3; L++) {
        ctx.beginPath();
        for (let i = 0; i < counts[L]!; i++, o += 3) {
          const s = st.snow[o + 2]!;
          ctx.rect(st.snow[o]! - s / 2, st.snow[o + 1]! - s / 2, s, s);
        }
        ctx.fillStyle = tintCss([0.95, 0.96, 1], RAIN_ALPHA[L]! + 0.2);
        ctx.fill();
      }
    }
    drew = N > 0;
  }

  const { lon, lat, alt, head } = engine.fly;
  for (const g of groups) {
    const tau = t - g.tv;
    if (tau < -dt) continue; // not started yet
    let w = st.worlds.get(g);
    if (w === undefined) {
      w = strikeWorld(
        g.strike,
        lon,
        lat,
        alt,
        b,
        zc,
        es.gas ? null : (a, c) => engine.groundKm(a, c),
      );
      st.worlds.set(g, w);
    }
    const lo = tau - dt,
      hi = tau;
    const glow = g.safe ? safeGlow(tau) * SAFE_GLOW_OPACITY : groupGlowMax(lo, hi, g.n);
    if (!(glow > 0)) continue;
    const cls = w ? classifyStrike(b, W, H, w, aboveDeck, es.gas) : 'edge';
    const side = edgeSide(w?.bearing ?? g.strike.bearing, head);
    if (cls === 'edge') {
      edge(ctx, side, W, H, BOLT_RGB, g.safe ? glow : glow * FLASH_OPACITY);
      continue;
    }
    if (cls === 'deck') {
      const p = w ? projectPx(b, W, H, w.deck) : null;
      // Red 9: the glow in the deck under the listener; off screen, at the bottom centre.
      const on = p && p[0] >= 0 && p[0] <= W && p[1] >= 0 && p[1] <= H;
      radial(
        ctx,
        on ? p[0] : W / 2,
        on ? p[1] : H,
        DECK_GLOW_R * H,
        BOLT_RGB,
        g.safe ? glow : glow * FLASH_OPACITY,
      );
      continue;
    }
    // In view: clip the bolt at the near plane, then project its two ends (H2).
    const seg = clipSegmentNear(b, w!.top, w!.foot);
    const pa = seg ? projectPx(b, W, H, seg[0]) : null;
    const pb = seg ? projectPx(b, W, H, seg[1]) : null;
    // Red 3: keep only the part of the bolt near the pane; the glow sits where the bolt enters it.
    const cs = pa && pb ? clipToRect(pa[0], pa[1], pb[0], pb[1], W, H, BOLT_CLIP_MARGIN * H) : null;
    if (!cs) {
      edge(ctx, side, W, H, BOLT_RGB, g.safe ? glow : glow * FLASH_OPACITY);
      continue;
    }
    radial(
      ctx,
      cs[0],
      cs[1],
      CLOUD_GLOW_R * H,
      BOLT_RGB,
      g.safe ? glow : glow * CLOUD_GLOW_OPACITY,
    );
    if (g.safe || g.n === 0 || Math.hypot(cs[2] - cs[0], cs[3] - cs[1]) < BOLT_MIN_PX) continue;
    // Blue 12: one polyline per group while its ends stay on the same whole pixels.
    const key = cs.map(Math.round).join(',');
    let cached = st.bolts.get(g);
    if (!cached || cached.key !== key) {
      cached = { key, lines: boltPolyline(g.strike.seed, cs[0], cs[1], cs[2], cs[3]) };
      st.bolts.set(g, cached);
    }
    const lines = cached.lines;
    // H4: a bolt at or above the small-area limit never restrikes; it follows the one group pulse.
    const area = polylineLength(lines) * (BOLT_CORE_PX + BOLT_GLOW_PX);
    const a =
      area < smallAreaLimitPx2(W, H) ? strokeEnvMax(lo, hi, g.n) : groupGlowMax(lo, hi, g.n);
    if (!(a > 0)) continue;
    polyline(ctx, lines);
    ctx.lineCap = 'round';
    ctx.strokeStyle = tintCss(BOLT_RGB, 0.25 * a);
    ctx.lineWidth = BOLT_GLOW_PX;
    ctx.stroke();
    ctx.strokeStyle = tintCss(BOLT_RGB, a);
    ctx.lineWidth = BOLT_CORE_PX;
    ctx.stroke();
  }
  return drew || groups.length > 0;
}

function prefersReducedMotion(): MediaQueryList | null {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
  } catch {
    return null;
  }
}

/**
 * Mounted in WorldFlyStage over the fly canvas (inset 0 on the host, which is the fly pane). `active` is false while
 * the surface view is not entered or the close-up is closed: the canvas is cleared and nothing runs.
 */
export function WeatherOverlay({
  engine,
  active,
  reduced,
  seed,
}: {
  engine: OverlayEngine | null;
  active: boolean;
  reduced: boolean;
  /** The world's seed (WorldPreset.seed): the same world draws the same rain, another world different rain. */
  seed: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reducedRef = useRef(reduced);
  // Red 5: one gate for the life of the overlay, so a pause and unpause never resets the 2 s spacing.
  const gateRef = useRef<FlashGate | null>(null);
  const [drawing, setDrawing] = useState(false);

  useEffect(() => {
    const cv = ref.current;
    let got: Ctx2D | null;
    try {
      got = (cv?.getContext('2d') ?? null) as Ctx2D | null;
    } catch {
      got = null; // no 2D canvas (tests, old browsers): no overlay, nothing else changes
    }
    if (!cv || !got || typeof got.clearRect !== 'function') return;
    const ctx: Ctx2D = got;
    const st = newDrawState(seed);
    let shownNow = false;
    const setShown = (v: boolean) => {
      if (v === shownNow) return;
      shownNow = v;
      setDrawing(v);
    };
    const clear = () => {
      try {
        ctx.clearRect(0, 0, st.W, st.H);
      } catch {
        /* nothing to clear */
      }
    };
    if (!engine || !active) {
      clear();
      gateRef.current?.clearGroups(); // the previous run's cleanup already hid the caption
      return;
    }
    const gate = (gateRef.current ??= new FlashGate());
    const mq = prefersReducedMotion();
    const isSafe = () =>
      reducedRef.current || !!mq?.matches || !useSoundSettings.getState().flashesOn;
    const onSafe = () => {
      if (isSafe()) gate.makeSafe();
    };
    const resize = () => {
      const w = cv.clientWidth,
        h = cv.clientHeight;
      const dpr = Math.min(
        typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1,
        OVERLAY_DPR_CAP,
      );
      st.W = w;
      st.H = h;
      cv.width = Math.max(1, Math.round(w * dpr));
      cv.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      kick();
    };
    let raf = 0;
    let last = -Infinity;

    let snap: WeatherSnapshot | null = getWeather();
    const loop = () => {
      raf = 0;
      let more = true;
      try {
        const t = performance.now() / 1000;
        if (t - last < 1 / OVERLAY_MAX_FPS - 0.002) return;
        const dt = Math.min(Number.isFinite(last) ? t - last : 1 / OVERLAY_MAX_FPS, 0.1);
        last = t;
        const t0 = performance.now();
        more = drawWeatherFrame(ctx, st, engine, snap, gate, t, dt);
        setShown(more);
        if (import.meta.env.DEV) cv.dataset.ms = (performance.now() - t0).toFixed(2);
        // When nothing is left, drawWeatherFrame has cleared the canvas once; the loop stops until a kick.
      } catch {
        clear();
        more = true; // H2: one bad frame never stops the overlay
      } finally {
        if (more) raf = requestAnimationFrame(loop);
      }
    };
    function kick() {
      if (!raf) raf = requestAnimationFrame(loop);
    }
    const offWeather = subscribeWeather((s) => {
      snap = s;
      if (s?.frame.rain) kick();
    });
    const offStrike = onStrike((s) => {
      // Red M4: an accepted strike starts the loop itself.
      if (gate.offer(s, performance.now() / 1000, isSafe())) kick();
    });
    const offSettings = useSoundSettings.subscribe(onSafe);
    mq?.addEventListener?.('change', onSafe);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    ro?.observe(cv);
    resize();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      offWeather();
      offStrike();
      offSettings();
      mq?.removeEventListener?.('change', onSafe);
      ro?.disconnect();
      gate.clearGroups();
      setShown(false);
      clear();
    };
  }, [engine, active, seed]);

  // Reduced motion turned on through the prop: groups already showing become safe at once.
  useEffect(() => {
    reducedRef.current = reduced;
    if (reduced) gateRef.current?.makeSafe();
  }, [reduced]);

  return (
    <>
      <canvas
        ref={ref}
        aria-hidden="true"
        data-testid="weather-overlay"
        className="absolute inset-0 h-full w-full"
        style={{ pointerEvents: 'none' }}
      />
      {drawing && active && (
        // Coordinator ruling 2: the label the stage audience sees while weather is drawn (the panel rows are folded).
        // PR #125 review B2: bottom-left (.sx-wx-cap in index.css), clear of #116's Sound chip (.sx-amb, top-left).
        <p data-testid="weather-caption" className="sx-wx-cap">
          {WEATHER_CAPTION}
        </p>
      )}
    </>
  );
}

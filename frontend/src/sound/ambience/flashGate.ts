// §8.3 / §8.5 flash safety for the weather overlay (issue #117): which strikes may light the screen, and how bright each
// layer is at a time t. Pure and clocked by the caller (performance.now() / 1000, the clock of Strike.t0).
//
// Rules (WCAG 2.3.1, coordinator rulings H1, H4, H5):
// - a strike lights the screen only if StrikeScheduler marked it `flash`, its t0 is at least FLASH_MIN_GAP_S after the
//   last accepted t0, AND its glow would start at least FLASH_MIN_GAP_S after the last glow started on this clock;
// - one large-area pulse per group (`groupGlow`); only the thin bolt restrikes (2 to 3 strokes, `strokeEnv`);
// - reduced motion or Flashes off: no bolt, no strokes, a 1 s raised-cosine glow (`safeGlow`); a group that turns safe
//   stays safe;
// - a strike delivered later than BOLT_LATE_S after its t0 shows no strokes: glow only, starting on arrival.
import type { Strike } from './types';
import { hash32 } from './hash';
import {
  BOLT_BRIGHT_S, BOLT_FADE_S, BOLT_LATE_S, BOLT_STROKE_GAP_S, BOLT_STROKES_MAX, BOLT_STROKES_MIN, FLASH_MIN_GAP_S,
  GLOW_ATTACK_S, GLOW_FADE_S, SAFE_GLOW_S, STRIKE_STALE_S,
} from './tuning';

export interface FlashGroup {
  strike: Strike;
  /** When the picture starts (s): t0, or the arrival time for a late strike. */
  tv: number;
  /** Return strokes the bolt shows: 2 to 3, or 0 (safe mode or late). */
  n: number;
  /** Reduced motion or Flashes off: the slow glow only. */
  safe: boolean;
}

/** 2 or 3 return strokes, from the strike's own seed (deterministic). */
export function strokeCount(seed: number): number {
  const span = BOLT_STROKES_MAX - BOLT_STROKES_MIN + 1;
  return BOLT_STROKES_MIN + (hash32(seed >>> 0, 'strokes') % span);
}

/** One stroke: 1 while bright, then a linear fade. Non-increasing for tau >= 0. */
function stroke1(tau: number): number {
  if (tau < 0) return 0;
  if (tau < BOLT_BRIGHT_S) return 1;
  const f = 1 - (tau - BOLT_BRIGHT_S) / BOLT_FADE_S;
  return f > 0 ? f : 0;
}

/** The bolt's brightness at tau (s after tv): the brightest of its n strokes, BOLT_STROKE_GAP_S apart. */
export function strokeEnv(tau: number, n: number): number {
  let m = 0;
  for (let k = 0; k < n; k++) m = Math.max(m, stroke1(tau - k * BOLT_STROKE_GAP_S));
  return m;
}

/**
 * Red M10: the brightest the bolt is anywhere in [tauLo, tauHi] (one drawn frame), in closed form, so a 30 ms stroke
 * is never lost between two 33 ms frames.
 */
export function strokeEnvMax(tauLo: number, tauHi: number, n: number): number {
  let m = 0;
  for (let k = 0; k < n; k++) {
    const o = k * BOLT_STROKE_GAP_S;
    if (tauHi < o) continue;
    m = Math.max(m, stroke1(Math.max(tauLo, o) - o));
  }
  return m;
}

/** Where the group glow is at full brightness: [attack end, last stroke's bright end]. */
function glowPlateau(n: number): [number, number] {
  const last = (Math.max(n, 1) - 1) * BOLT_STROKE_GAP_S + BOLT_BRIGHT_S;
  return [GLOW_ATTACK_S, Math.max(GLOW_ATTACK_S, last)];
}

/** One pulse for the whole group (0..1): attack, hold to the last stroke, fade. Every large-area layer uses it. */
export function groupGlow(tau: number, n: number): number {
  if (tau < 0) return 0;
  const [p0, p1] = glowPlateau(n);
  if (tau < p0) return tau / p0;
  if (tau <= p1) return 1;
  const f = 1 - (tau - p1) / GLOW_FADE_S;
  return f > 0 ? f : 0;
}

/** The brightest the group glow is in [tauLo, tauHi] (unimodal, so closed form). */
export function groupGlowMax(tauLo: number, tauHi: number, n: number): number {
  const [p0, p1] = glowPlateau(n);
  if (tauHi < p0) return groupGlow(tauHi, n);
  if (tauLo > p1) return groupGlow(tauLo, n);
  return 1;
}

/** The safe glow (0..1): sin^2 over SAFE_GLOW_S, so it rises and falls slowly (no flash). */
export function safeGlow(tau: number): number {
  if (tau <= 0 || tau >= SAFE_GLOW_S) return 0;
  const s = Math.sin((Math.PI * tau) / SAFE_GLOW_S);
  return s * s;
}

/** How long a group lights the screen (s after tv). */
export function groupDuration(g: Pick<FlashGroup, 'n' | 'safe'>): number {
  if (g.safe) return SAFE_GLOW_S;
  const strokes = g.n > 0 ? (g.n - 1) * BOLT_STROKE_GAP_S + BOLT_BRIGHT_S + BOLT_FADE_S : 0;
  return Math.max(strokes, glowPlateau(g.n)[1] + GLOW_FADE_S);
}

export class FlashGate {
  private lastT0 = -Infinity;
  private lastGlow = -Infinity;
  private seen = new Set<string>();
  private groups: FlashGroup[] = [];

  /**
   * Offer a strike at `now`. Returns the group it opens, or null: not a flash, a duplicate, stale, or too soon after
   * the last one (on the scheduler's t0 and on this clock).
   */
  offer(s: Strike, now: number, safe: boolean): FlashGroup | null {
    const key = `${s.t0}:${s.seed}`;
    if (this.seen.has(key)) return null;
    this.seen.add(key);
    if (this.seen.size > 64) this.seen = new Set([key]);
    if (!s.flash || !Number.isFinite(s.t0)) return null;
    if (s.t0 < now - STRIKE_STALE_S) return null;
    if (s.t0 - this.lastT0 < FLASH_MIN_GAP_S) return null;
    const late = now > s.t0 + BOLT_LATE_S;
    const tv = late ? now : s.t0;
    if (tv - this.lastGlow < FLASH_MIN_GAP_S) return null;
    this.lastT0 = s.t0;
    this.lastGlow = tv;
    const g: FlashGroup = { strike: s, tv, n: safe || late ? 0 : strokeCount(s.seed), safe };
    this.groups.push(g);
    return g;
  }

  /** The overlay was closed: drop the groups, keep the spacing memory (red 5). */
  clearGroups(): void {
    this.groups = [];
  }

  /** Reduced motion or Flashes off turned on: every group still showing becomes safe (never the other way). */
  makeSafe(): void {
    for (const g of this.groups) {
      g.safe = true;
      g.n = 0;
    }
  }

  /** The groups still to show or showing at `now` (ended ones are dropped). */
  active(now: number): FlashGroup[] {
    this.groups = this.groups.filter((g) => now < g.tv + groupDuration(g));
    return this.groups;
  }

  /** Something is showing or waiting to show. */
  busy(now: number): boolean {
    return this.active(now).length > 0;
  }
}

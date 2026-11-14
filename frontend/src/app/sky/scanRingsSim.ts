// The scanning rings (issue #173, approved mock-up "Scanning Square Rings"): thin rings that come
// and go at random spots inside the square being analysed, as the square's loader (D-38). They mark
// no detection: no label, no fill, the analysing blue (Q-483).
// Each ring lives on its own: it appears at a random moment and spot, lingers 0.7 to 2 s while it
// widens, and fades out on its own time. The number on screen drifts between about 5 and a busier
// 10 or 20 about every 1.4 s: new rings trickle in to reach it, and extra ones simply die out.
// This file is the clock-free model (positions in the square's own 0..1 coordinates, so a ring stays
// pinned to the sky when it moves); ScanRings.tsx draws it.

export interface Ring {
  /** Where in the square, 0..1 along its first and second edges. */
  u: number;
  v: number;
  /** Birth time and life (ms). */
  born: number;
  life: number;
  /** Its radius when fully grown (px). */
  rMax: number;
}

export interface RingSim {
  rings: Ring[];
  /** How many rings the crowd is heading for now. */
  target: number;
  nextTargetAt: number;
  nextSpawnAt: number;
  /** Where the crowd's rhythm is: calm (5) or busy (10 or 20). */
  busy: boolean;
  rand: () => number;
}

export const RING_LIFE_MS = [700, 2000] as const;
export const RING_RADIUS_PX = [6, 14] as const;
export const CROWD_STEP_MS = 1400;
export const CALM = 5;
export const BUSY = [10, 20] as const;
/** The gap between two new rings while the crowd is short (ms). */
const SPAWN_GAP_MS = [40, 160] as const;

/** A small seeded random source (mulberry32), so the model can be tested. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (r: () => number, [lo, hi]: readonly [number, number]) => lo + r() * (hi - lo);

export function newSim(now: number, rand: () => number = Math.random): RingSim {
  return {
    rings: [],
    target: CALM,
    nextTargetAt: now + CROWD_STEP_MS,
    nextSpawnAt: now,
    busy: false,
    rand,
  };
}

/** Moves the crowd on to `now`: old rings die, the target drifts, new rings trickle in. */
export function stepSim(s: RingSim, now: number): void {
  s.rings = s.rings.filter((r) => now < r.born + r.life);
  if (now >= s.nextTargetAt) {
    s.busy = !s.busy;
    s.target = s.busy ? (s.rand() < 0.5 ? BUSY[0] : BUSY[1]) : CALM;
    s.nextTargetAt = now + CROWD_STEP_MS;
  }
  // One ring at a time, so they trickle in rather than arrive as a set.
  if (s.rings.length < s.target && now >= s.nextSpawnAt) {
    s.rings.push({
      u: between(s.rand, [0.08, 0.92]),
      v: between(s.rand, [0.08, 0.92]),
      born: now,
      life: between(s.rand, RING_LIFE_MS),
      rMax: between(s.rand, RING_RADIUS_PX),
    });
    s.nextSpawnAt = now + between(s.rand, SPAWN_GAP_MS);
  }
}

/** A ring's look at `now`: it widens as it ages, fades in quickly and out slowly. */
export function ringLook(r: Ring, now: number): { radius: number; opacity: number } {
  const a = Math.min(1, Math.max(0, (now - r.born) / r.life));
  const grow = 1 - (1 - a) * (1 - a);
  const radius = r.rMax * (0.45 + 0.55 * grow);
  const opacity = 0.85 * Math.min(1, a / 0.15) * Math.min(1, (1 - a) / 0.4);
  return { radius, opacity };
}

type Pt = { x: number; y: number };
/** The point at (u, v) in a quad given as its corners in order (bilinear). */
export function quadPoint(q: readonly Pt[], u: number, v: number): Pt {
  const [a, b, c, d] = q as [Pt, Pt, Pt, Pt];
  const top = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  const bot = { x: d.x + (c.x - d.x) * u, y: d.y + (c.y - d.y) * u };
  return { x: top.x + (bot.x - top.x) * v, y: top.y + (bot.y - top.y) * v };
}

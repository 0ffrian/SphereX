// Visits and blink (A18.3; Q-408). Pure helpers; the timer and its stop conditions live in
// useAreaLifecycle.ts.
import type { AreaDots, AreaSummary } from '@/contract';

/** A18.3: one visit every 750 ms, under 3 Hz (WCAG 2.3.1). UI pacing, not data. */
export const BLINK_MS = 750;

/** The visit numbers of an area, ascending: from the summary's frames, else from /dots. */
export function visitNumbers(summary: AreaSummary | null, dots: AreaDots | null): number[] {
  const set = new Set<number>();
  if (summary) for (const f of summary.frames) set.add(f.visit);
  else if (dots) for (const v of dots.visits) set.add(v.visit);
  return [...set].sort((a, b) => a - b);
}

/** The visit after `current`, cycling 1 → 2 → … → n → 1 (Q-408). */
export function nextVisit(visits: readonly number[], current: number): number {
  if (visits.length === 0) return current;
  const i = visits.indexOf(current);
  return visits[(i + 1) % visits.length] ?? visits[0]!;
}

/** The earliest frame time of each visit (ISO strings compare in time order when all end in Z). */
export function visitTimes(summary: AreaSummary | null): Map<number, string> {
  const out = new Map<number, string>();
  if (!summary) return out;
  for (const f of summary.frames) {
    const t = out.get(f.visit);
    if (t === undefined || Date.parse(f.time) < Date.parse(t)) out.set(f.visit, f.time);
  }
  return out;
}

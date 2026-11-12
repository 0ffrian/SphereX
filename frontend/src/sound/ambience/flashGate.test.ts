// §8.3 / §8.5 flash safety (issue #117): the rate limiter, reduced motion, strokes and late strikes.
import { describe, expect, it } from 'vitest';
import {
  FlashGate, groupDuration, groupGlow, groupGlowMax, safeGlow, strokeCount, strokeEnv, strokeEnvMax, type FlashGroup,
} from './flashGate';
import { FLASH_MIN_GAP_S, SAFE_GLOW_OPACITY } from './tuning';
import type { Strike } from './types';

const strike = (t0: number, seed = 7, flash = true): Strike => ({ t0, d_m: 3000, bearing: 0, seed, variant: 2, flash });

/** Drive a gate at 30 fps for `dur` s, offering each strike 0.15 s before its t0; returns the large-area light trace. */
function run(strikes: Strike[], dur: number, safe: boolean, lead = 0.15) {
  const gate = new FlashGate();
  const dt = 1 / 30;
  const trace: number[] = [];
  const accepted: FlashGroup[] = [];
  const pending = [...strikes].sort((a, b) => a.t0 - b.t0);
  for (let t = 0; t < dur; t += dt) {
    while (pending.length && pending[0]!.t0 - lead <= t) {
      const g = gate.offer(pending.shift()!, t, safe);
      if (g) accepted.push(g);
    }
    let light = 0;
    for (const g of gate.active(t)) {
      const tau = t - g.tv;
      light = Math.max(light, g.safe ? safeGlow(tau) * SAFE_GLOW_OPACITY : groupGlowMax(tau - dt, tau, g.n));
    }
    trace.push(light);
  }
  return { trace, accepted, dt };
}

describe('flash rate limiter (WCAG 2.3.1)', () => {
  it('600 strikes 0.1 s apart, all flagged: groups at least 2 s apart, at most one light pulse per 2 s', () => {
    const strikes = Array.from({ length: 600 }, (_, i) => strike(1 + i * 0.1, i + 1));
    const { trace, accepted, dt } = run(strikes, 62, false);
    expect(accepted.length).toBeGreaterThan(20);
    for (let i = 1; i < accepted.length; i++) {
      expect(accepted[i]!.tv - accepted[i - 1]!.tv).toBeGreaterThanOrEqual(FLASH_MIN_GAP_S - 1e-9);
    }
    // Rises of the large-area light (0 -> above 0.1).
    const rises: number[] = [];
    for (let i = 1; i < trace.length; i++) if (trace[i - 1]! <= 0.1 && trace[i]! > 0.1) rises.push(i * dt);
    for (let i = 1; i < rises.length; i++) expect(rises[i]! - rises[i - 1]!).toBeGreaterThan(FLASH_MIN_GAP_S - 2 * dt);
    for (const g of accepted) expect(g.n).toBeLessThanOrEqual(3);
  });

  it('strikes not flagged, stale or repeated never open a group', () => {
    const gate = new FlashGate();
    expect(gate.offer(strike(10, 1, false), 9.9, false)).toBeNull();
    expect(gate.offer(strike(5, 2), 9.9, false)).toBeNull(); // stale
    expect(gate.offer(strike(10, 3), 9.9, false)).not.toBeNull();
    expect(gate.offer(strike(10, 3), 9.9, false)).toBeNull(); // the same strike again
    expect(gate.offer(strike(11.5, 4), 11.4, false)).toBeNull(); // too soon
  });

  it('a late strike then an on-time one: glows still start at least 2 s apart on the overlay clock', () => {
    const gate = new FlashGate();
    const a = gate.offer(strike(10, 1), 10.9, false); // delivered 0.9 s late
    expect(a).not.toBeNull();
    expect(a!.tv).toBeCloseTo(10.9);
    expect(a!.n).toBe(0); // late: no strokes, glow only
    expect(gate.offer(strike(12.0, 2), 11.85, false)).toBeNull(); // 2 s after t0 but 1.1 s after the glow
    expect(gate.offer(strike(13.0, 3), 12.85, false)).not.toBeNull();
  });
});

describe('reduced motion and Flashes off', () => {
  it('no strokes, peak 0.15, 1 s long, no step bigger than 0.016 per 30 fps frame, still 1 per 2 s', () => {
    const strikes = Array.from({ length: 100 }, (_, i) => strike(1 + i * 0.3, i + 1));
    const { trace, accepted } = run(strikes, 32, true);
    for (const g of accepted) {
      expect(g.safe).toBe(true);
      expect(g.n).toBe(0);
      expect(groupDuration(g)).toBe(1);
    }
    expect(Math.max(...trace)).toBeLessThanOrEqual(SAFE_GLOW_OPACITY + 1e-9);
    expect(Math.max(...trace)).toBeGreaterThan(0.14);
    for (let i = 1; i < trace.length; i++) expect(Math.abs(trace[i]! - trace[i - 1]!)).toBeLessThanOrEqual(0.016);
    for (let i = 1; i < accepted.length; i++) expect(accepted[i]!.tv - accepted[i - 1]!.tv).toBeGreaterThanOrEqual(2 - 1e-9);
  });

  it('turning safe mid-group switches the group to the glow (never back)', () => {
    const gate = new FlashGate();
    const g = gate.offer(strike(10), 9.85, false)!;
    expect(g.n).toBeGreaterThanOrEqual(2);
    gate.makeSafe();
    expect(g.safe).toBe(true);
    expect(g.n).toBe(0);
  });
});

describe('strokes', () => {
  it('2 or 3 strokes per group for 10 000 seeds, deterministic', () => {
    const seen = new Set<number>();
    for (let s = 0; s < 10000; s++) {
      const n = strokeCount(s);
      expect(n === 2 || n === 3).toBe(true);
      expect(strokeCount(s)).toBe(n);
      seen.add(n);
    }
    expect(seen.size).toBe(2);
  });

  it('strokes 50 ms apart, 30 ms bright then a 120 ms fade', () => {
    expect(strokeEnv(0.01, 3)).toBe(1);
    expect(strokeEnv(0.04, 1)).toBeCloseTo(1 - 0.01 / 0.12);
    expect(strokeEnv(0.06, 3)).toBe(1); // second stroke
    expect(strokeEnv(0.11, 3)).toBe(1); // third stroke
    expect(strokeEnv(0.4, 3)).toBe(0);
  });

  it('red M10: at 30 fps every stroke reaches at least 0.8 in some frame, whatever the phase', () => {
    const dt = 1 / 30;
    for (let ph = 0; ph < dt; ph += dt / 17) {
      for (let k = 0; k < 3; k++) {
        let best = 0;
        for (let t = -ph; t < 0.5; t += dt) {
          // brightness of stroke k alone over this frame
          const o = k * 0.05;
          best = Math.max(best, strokeEnvMax(t - dt - o, t - o, 1));
        }
        expect(best).toBeGreaterThanOrEqual(0.8);
      }
    }
  });

  it('the group glow is one pulse: rises once, falls once', () => {
    let rises = 0;
    let prev = 0;
    for (let t = 0; t < 0.6; t += 0.001) {
      const v = groupGlow(t, 3);
      if (v > prev + 1e-12 && (rises === 0 || prev === 0)) rises += prev === 0 ? 1 : 0;
      prev = v;
    }
    expect(rises).toBe(1);
  });
});

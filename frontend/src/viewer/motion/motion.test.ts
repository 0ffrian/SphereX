// Issue #42, R5.7, D-32, D-34: the tier chain for motion rates and the "no speed-up, no motion" rule.
import { describe, expect, it } from 'vitest';
import { fixture } from '../renderers/fixtures.testutil';
import { phasePair, wrap } from './phase';
import { cappedSpinSpeedup } from './planMotion';
import { MOTION_CONFIG, resolveMotion, resolveRate, weakestTag } from './motion';

describe('resolveMotion', () => {
  it('reads rates, tiers and speed-ups from the star fixture', () => {
    const { card, params } = fixture('star');
    const m = resolveMotion(card, params);
    expect(m.processes.map((p) => [p.id, p.speedup, p.tier])).toEqual([
      ['spin', 86400, 4],
      ['spots', 86400, 3],
      ['flares', 86400, 4],
    ]);
    // diff_rotation is not in the fixture and no rung answers: refused, never filled in.
    expect(m.rates.diff_rotation).toBeUndefined();
    expect(m.missing.map((x) => x.id)).toEqual(['dynamics:diff_rotation']);
  });

  it('a body with no dynamics stays still and says so', () => {
    const { card, params } = fixture('star');
    const m = resolveMotion(card, { ...params, dynamics: undefined });
    expect(m.processes).toEqual([]);
    expect(m.missing).toEqual([]);
    expect(m.notes.join(' ')).toMatch(/stays still/);
  });

  it('a process with no stated speed-up is not animated', () => {
    const { card, params } = fixture('gas_giant');
    const dyn = structuredClone(params.dynamics!);
    delete dyn.speedup.winds;
    const m = resolveMotion(card, { ...params, dynamics: dyn });
    expect(m.processes.map((p) => p.id)).toEqual(['spin']);
  });

  it('a stated speed-up without its rate is refused as dynamics:<key>', () => {
    const { card, params } = fixture('gas_giant');
    const dyn = structuredClone(params.dynamics!);
    delete dyn.jet_speed_ms;
    const m = resolveMotion(card, { ...params, dynamics: dyn });
    expect(m.processes.map((p) => p.id)).toEqual(['spin']);
    expect(m.missing.map((x) => x.id)).toContain('dynamics:jet_speed_ms');
  });

  it('a measured card field wins over dynamics (tier 1, R3.4)', () => {
    const { card, params } = fixture('star');
    card.rot_period_h = { value: 3480, tag: 'measured', source: 'test' };
    const r = resolveRate('spin_period_h', card, params)!;
    expect(r).toMatchObject({ value: 3480, tier: 1, via: 'card' });
  });

  it('a record whose tag and tier disagree is not trusted', () => {
    const { card, params } = fixture('star');
    params.dynamics!.spin_period_h = { ...params.dynamics!.spin_period_h!, tier: 1 };
    expect(resolveRate('spin_period_h', card, params)).toBeNull();
  });

  it('rung 4 (typical by class) answers nothing until it is verified, and is labelled when set', () => {
    const { card, params } = fixture('star');
    const bare = { ...params, dynamics: { speedup: {} } };
    expect(resolveRate('diff_rotation', card, bare)).toBeNull();
    const cfg = { typical: { star: { diff_rotation: { value: 0.2, source: 'test' } } } };
    expect(resolveRate('diff_rotation', card, bare, cfg)).toMatchObject({
      tag: 'inferred_from_analog',
      tier: 4,
      via: 'class',
    });
    expect(MOTION_CONFIG.typical).toEqual({});
  });

  it('Mira pulsation runs on the measured period', () => {
    const { card, params } = fixture('star_mira');
    const m = resolveMotion(card, params);
    expect(m.processes[0]).toMatchObject({ id: 'pulsation', tier: 1, speedup: 86400 });
  });

  it('the weakest input tag wins and never goes upward', () => {
    expect(weakestTag(['derived', 'inferred_from_analog', 'measured'])).toBe(
      'inferred_from_analog',
    );
  });
});

describe('phases', () => {
  it('flow-map weights are triangle waves and the two copies are half a period apart', () => {
    const p = phasePair(0, 10);
    expect(p).toEqual({ a: 0, b: 5, w: 0 });
    expect(phasePair(5, 10).w).toBe(1);
    expect(phasePair(12.5, 10).a).toBeCloseTo(2.5);
    // Time is bounded however long the clock runs (Q-68).
    expect(phasePair(1e12 + 3, 10).a).toBeLessThan(10);
    expect(wrap(-1, 10)).toBe(9);
  });
});

describe('spin cap', () => {
  it('keeps the drawn spin at or below one revolution a second', () => {
    expect(cappedSpinSpeedup(3600, 10)).toBe(3600);
    const s = cappedSpinSpeedup(1e6, 1);
    expect(s / 3600).toBeLessThanOrEqual(1);
  });
});

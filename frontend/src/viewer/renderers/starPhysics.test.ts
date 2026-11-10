// Issue #71 stream C: the physical star surface through the plan, the CPU model and the body.
import { describe, expect, it } from 'vitest';
import { defaultContext } from '../renderPlan';
import { fixture } from './fixtures.testutil';
import { LOW_TIER_MAX_GROUPS, STAR_CONFIG, planStar } from './Star';
import { StarBody } from './StarBody';
import { STAR_SURFACE, STILL_STAR_RATES, configFromModel, regionsAt } from '../bodies/starModel';
import { discRadiusFromArea, AREA_SPLIT } from '@/physics/stellar';
import type { StarColourView } from '@/physics/stellar';
import type { HonestyState } from '../honesty';

const mass = () => ({ value: 0.7, tag: 'measured' as const, source: 'test mass' });
const config = { ...STAR_CONFIG, massMsun: mass };
const plan = (ctx: Parameters<typeof defaultContext>[0] = {}, cfg = config) => {
  const { card, params } = fixture('star');
  // A fast rotator so there are spots: the fixture's 600 h is slow, the physics only needs a period.
  return planStar({ card, params, ctx: defaultContext({ honesty: 'artistic', ...ctx }) }, cfg);
};
const tier = (p: ReturnType<typeof plan>, id: string) => p.drawn.find((d) => d.id === id)?.tier;

describe('star surface physics in the plan', () => {
  it('without a mass the physics is refused, the look is the placeholder, and it says why', () => {
    const p = planStar(
      {
        ...(({ card, params }) => ({ card, params }))(fixture('star')),
        ctx: defaultContext({ honesty: 'artistic' }),
      },
      STAR_CONFIG,
    );
    expect(p.star?.physics).toBeNull();
    expect(p.star?.config).toBeNull();
    expect(p.notes.join(' ')).toMatch(/no stellar mass/);
  });

  it('with a mass the groups come from the physics and replace the fixed four', () => {
    const p = plan();
    const phys = p.star!.physics!;
    expect(phys).not.toBeNull();
    expect(p.star!.config!.regionCount).toBe(phys.groups.length);
    expect(p.star!.config!.groups).toBe(phys.groups);
    expect(phys.fieldG).not.toBeNull();
    expect(phys.coverage).toBeGreaterThan(0);
  });

  it('enlarged cells are artistic; true-scale cells are model_dependent; the tier follows', () => {
    const big = plan({ starScale: 'enlarged' });
    expect(big.star!.cellsEnlarged).toBe(true);
    expect(tier(big, 'granulation')).toBe(5);
    const real = plan({ starScale: 'true' });
    expect(real.star!.cellsEnlarged).toBe(false);
    expect(tier(real, 'granulation')).toBe(3);
    // Whole star at true scale: the cells average out. Close-up: they show.
    expect(real.star!.granuleVisibility).toBe(0);
    expect(plan({ starScale: 'close' }).star!.granuleVisibility).toBeGreaterThan(0.9);
  });

  it('views default to true colour and enlarged, and false colour is named as an artist look', () => {
    const p = plan();
    expect(p.star!.colourView).toBe('true');
    expect(p.star!.scale).toBe('enlarged');
    expect(plan({ starColour: 'observatory' }).notes.join(' ')).toMatch(/false-colour/);
  });

  it('the low tier draws fewer groups', () => {
    const low = plan({ qualityTier: 'low' });
    expect(low.star!.physics!.groups.length).toBeLessThanOrEqual(LOW_TIER_MAX_GROUPS);
  });

  it('is deterministic for a card and seed', () => {
    expect(plan().star!.physics).toEqual(plan().star!.physics);
  });
});

describe('physical regions', () => {
  const phys = plan().star!.physics!;
  const cfg = configFromModel(phys, STAR_SURFACE);

  it('slot i is group i: its leader radius follows the group area', () => {
    const regions = regionsAt(3, 0, STILL_STAR_RATES, cfg);
    expect(regions).toHaveLength(phys.groups.length);
    regions.forEach((r, i) => {
      const g = phys.groups[i]!;
      const leader = r.discs[0]!;
      expect(leader.kind).toBe('leader');
      expect(leader.radius).toBeGreaterThan(0);
      expect(leader.radius).toBeLessThanOrEqual(
        discRadiusFromArea(g.areaFraction * AREA_SPLIT.leader) + 1e-12,
      );
      expect(r.lat).toBeCloseTo(g.latRad, 9);
      expect(r.discs).toHaveLength(5);
    });
  });

  it('the follower is nearer the pole than the leader (Joy)', () => {
    for (const r of regionsAt(3, 0, STILL_STAR_RATES, cfg)) {
      const leader = r.discs.find((d) => d.kind === 'leader')!;
      const follower = r.discs.find((d) => d.kind === 'follower')!;
      expect(Math.abs(follower.center[1])).toBeGreaterThan(Math.abs(leader.center[1]));
    }
  });

  it('a star with no groups has no regions and no flares', () => {
    expect(regionsAt(3, 0, STILL_STAR_RATES, { ...cfg, regionCount: 0, groups: [] })).toEqual([]);
  });
});

describe('StarBody with the physics', () => {
  for (const view of ['true', 'enhanced', 'observatory'] as StarColourView[]) {
    for (const honesty of ['artistic'] as HonestyState[]) {
      it(`builds in the ${view} view and poses the same groups twice`, () => {
        const p = plan({ starColour: view, honesty });
        const make = () =>
          new StarBody(p.star!, {
            tint: p.bodies[0]!.tint,
            emissive: 1,
            limbU: 0.6,
            octaves: 3,
            axes: [1, 1, 1],
            segments: [16, 8],
          });
        const a = make();
        const b = make();
        a.setTime(() => 1e6);
        b.setTime(() => 1e6);
        expect(a.lastRegions).toHaveLength(p.star!.physics!.groups.length);
        expect(a.lastRegions).toEqual(b.lastRegions);
        a.dispose();
        b.dispose();
      });
    }
  }
});

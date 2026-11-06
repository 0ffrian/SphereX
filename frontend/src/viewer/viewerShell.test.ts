// Shell modules (honesty, scale bar, lighting, alt text) and the three.js scene builder, tested
// without a GPU: building objects needs no renderer.
import { describe, expect, it } from 'vitest';
import { TAGS, type Tag } from '@/contract';
import { BAKED_NAMES, fixture } from '@/test/sharedFixtures';
import {
  buildAltText,
  canvasLabel,
  epochAnnouncement,
  honestyAnnouncement,
  modeAnnouncement,
} from './altText';
import {
  allowedTags,
  badgeForTag,
  DEFAULT_HONESTY,
  effectiveHonesty,
  filterByHonesty,
  HONESTY_LABEL,
  HONESTY_STATES,
  isTagShown,
  stateThatShows,
} from './honesty';
import {
  buildLights,
  directionFromPhaseAngle,
  MAX_AMBIENT_INTENSITY,
  planLighting,
} from './lighting';
import { defaultContext, planRender } from './renderPlan';
import { buildScene, dustPositions, shellPositions, spinRateRadPerS } from './renderers/build';
import { COMPARISONS, formatLength, pickComparison, scaleBarFor } from './scaleBar';

describe('honesty (R5.3, D-21)', () => {
  it('has three states and starts at + Estimated', () => {
    expect(HONESTY_STATES).toEqual(['measured', 'derived', 'artistic']);
    expect(DEFAULT_HONESTY).toBe('derived');
    expect(effectiveHonesty(null)).toBe('derived');
    expect(effectiveHonesty('artistic')).toBe('artistic');
    expect(Object.values(HONESTY_LABEL)).toEqual(['Measured only', '+ Estimated', '+ Artistic']);
  });

  it('shows exactly the tags D-21 lists for each state', () => {
    expect(allowedTags('measured')).toEqual(['measured']);
    expect([...allowedTags('derived')].sort()).toEqual(
      ['derived', 'inferred_from_analog', 'measured', 'model_dependent'].sort(),
    );
    expect([...allowedTags('artistic')].sort()).toEqual([...TAGS].sort());
  });

  it('maps the five tags to the three badges (D-02)', () => {
    const badges: Record<Tag, string> = {
      measured: 'Measured',
      derived: 'Estimated',
      model_dependent: 'Estimated',
      inferred_from_analog: 'Estimated',
      artistic: 'Default',
    };
    for (const t of TAGS) expect(badgeForTag(t)).toBe(badges[t]);
  });

  it('filters by tag and names the state that shows a tag', () => {
    const items = TAGS.map((tag) => ({ tag }));
    expect(filterByHonesty(items, 'measured').shown.map((i) => i.tag)).toEqual(['measured']);
    expect(filterByHonesty(items, 'derived').hidden.map((i) => i.tag)).toEqual(['artistic']);
    expect(isTagShown('derived', 'artistic')).toBe(false);
    expect(stateThatShows('measured')).toBe('measured');
    expect(stateThatShows('model_dependent')).toBe('derived');
    expect(stateThatShows('artistic')).toBe('artistic');
  });
});

describe('scale bar (R5.4)', () => {
  it('returns null when the size is unknown', () => {
    expect(scaleBarFor(null)).toBeNull();
    expect(scaleBarFor(0)).toBeNull();
    expect(scaleBarFor(Number.NaN)).toBeNull();
  });

  it('formats lengths in m, km and million km', () => {
    expect(formatLength(556)).toBe('556 m');
    expect(formatLength(5000)).toBe('5 km');
    expect(formatLength(12_742_000)).toBe('12,742 km');
    expect(formatLength(1.39e9)).toBe('1.39 million km');
  });

  it('picks the closest familiar comparison in log size', () => {
    expect(pickComparison(300).id).toBe('le_morne');
    expect(pickComparison(10_000).id).toBe('le_morne'); // 10 km: nearer 556 m than 12,742 km
    expect(pickComparison(1.2e7).id).toBe('earth');
    expect(pickComparison(1.4e8).id).toBe('jupiter');
    expect(pickComparison(1.4e9).id).toBe('sun');
  });

  it('does not offer Mauritius while its length is [verify]', () => {
    expect(COMPARISONS.find((c) => c.id === 'mauritius')?.lengthM).toBeNull();
    for (const size of [1e3, 6.5e4, 1e5, 1e6])
      expect(pickComparison(size).id).not.toBe('mauritius');
  });

  it('gives the size, one comparison and bar fractions that fit', () => {
    const bar = scaleBarFor(5000)!; // radius 5 km: 10 km across
    expect(bar.diameterText).toBe('10 km');
    expect(bar.comparison.name).toBe('Le Morne Brabant');
    expect(bar.comparison.text).toMatch(/times Le Morne Brabant \(556 m tall\)/);
    expect(bar.bodyFraction).toBe(1);
    expect(bar.comparisonFraction).toBeCloseTo(556 / 10_000);
    const jup = scaleBarFor(69_910_000)!; // 1 Jupiter radius
    expect(jup.comparison.id).toBe('jupiter');
    expect(jup.comparison.text).toMatch(/same size as Jupiter/);
    const small = scaleBarFor(100)!; // 200 m
    expect(small.comparison.text).toMatch(/^about 1\/2\.78 of Le Morne Brabant/);
    expect(small.comparisonFraction).toBe(1);
    expect(small.bodyFraction).toBeLessThan(1);
  });
});

describe('lighting (R5.1)', () => {
  it('puts the light at the phase angle from the view direction', () => {
    expect(directionFromPhaseAngle(0)).toEqual([0, 0, 1]);
    const [x, , z] = directionFromPhaseAngle(90);
    expect(x).toBeCloseTo(1);
    expect(z).toBeCloseTo(0);
  });

  it('builds a Sun light and an ambient light at most 0.03, or nothing for stars', () => {
    const a = fixture('asteroid_shape');
    const lights = buildLights(planLighting(a.params, a.card));
    expect(lights).toHaveLength(2);
    const ambient = lights.find((l) => l.type === 'AmbientLight') as unknown as {
      intensity: number;
    };
    expect(ambient.intensity).toBeLessThanOrEqual(MAX_AMBIENT_INTENSITY);
    const sun = lights.find((l) => l.type === 'DirectionalLight')!;
    expect(sun.position.x).toBeGreaterThan(0);
    const s = fixture('star');
    expect(buildLights(planLighting(s.params, s.card))).toEqual([]);
  });
});

describe('alt text and announcements (R9)', () => {
  it('follows the R9 template', () => {
    const { card, params } = fixture('asteroid_shape');
    const plan = planRender(card, params, defaultContext({ mode: 'visible' }));
    const alt = buildAltText(plan);
    expect(alt.startsWith(`${card.name}, asteroid with a shape model, `)).toBe(true);
    expect(alt).toContain('asteroid with a shape model');
    expect(alt).toContain('10 km across (measured)');
    expect(alt).toContain('colour from Gaia (estimated)');
    expect(alt).toContain('viewed at 30°');
    expect(alt).toMatch(/Surface relief: illustrative\.$/);
  });

  it('changes with the mode and with the honesty state', () => {
    const { card, params } = fixture('asteroid_shape');
    const vis = buildAltText(planRender(card, params, defaultContext({ mode: 'visible' })));
    const ir = buildAltText(planRender(card, params, defaultContext({ mode: 'spherex_ir' })));
    expect(ir).toContain('SPHEREx infrared false colour (measured)');
    expect(ir).not.toBe(vis);
    const grey = buildAltText(
      planRender(card, params, defaultContext({ mode: 'visible', honesty: 'measured' })),
    );
    expect(grey).toContain('plain grey, no colour data shown');
  });

  it('says a self-luminous star has no phase angle, and a candidate has no 3D', () => {
    const s = fixture('star');
    expect(buildAltText(planRender(s.card, s.params, defaultContext()))).toContain(
      'self-luminous, so no phase angle',
    );
    const c = fixture('candidate');
    expect(buildAltText(planRender(c.card, c.params, defaultContext()))).toContain(
      'Not enough data for a 3D model',
    );
  });

  it('the canvas label adds the controls help, and has a placeholder form', () => {
    const { card, params } = fixture('comet');
    const plan = planRender(card, params, defaultContext());
    expect(canvasLabel(plan)).toContain('arrow keys to rotate');
    expect(canvasLabel(plan)).toContain(buildAltText(plan));
    expect(canvasLabel(null)).toContain('no object loaded');
  });

  it('builds mode, epoch and honesty messages', () => {
    const { card, params } = fixture('comet');
    const plan = planRender(card, params, defaultContext({ epoch: '2025-08' }));
    expect(modeAnnouncement('spherex_ir', plan)).toMatch(
      /^SPHEREx infrared view\. SPHEREx infrared/,
    );
    expect(epochAnnouncement('2025-08', plan)).toMatch(/August 2025\. Gas shells: CO₂, H₂O, CO\./);
    expect(epochAnnouncement('2025-08', plan)).toContain('No tail is drawn');
    const measured = planRender(card, params, defaultContext({ honesty: 'measured' }));
    expect(honestyAnnouncement('measured', measured)).toMatch(
      /^Measured only\. \d+ layers? shown\. 1 layer hidden\./,
    );
  });
});

describe('scene builder (no GPU)', () => {
  for (const name of BAKED_NAMES) {
    it(`${name}: builds and disposes without throwing`, () => {
      const { card, params } = fixture(name);
      const plan = planRender(
        card,
        params,
        defaultContext({ honesty: 'artistic', epoch: '2025-08' }),
      );
      const failures: string[] = [];
      const built = buildScene(plan, {
        onLoadFailed: (id) => failures.push(id),
        onChange: () => {},
      });
      expect(built.group.children.length).toBe(
        plan.bodies.length +
          plan.shells.length +
          (plan.dust ? 1 : 0) +
          plan.discs.length +
          plan.screens.length +
          plan.trails.length,
      );
      if (!plan.threeD) expect(built.group.children).toHaveLength(0);
      expect(() => built.dispose()).not.toThrow();
      expect(built.group.children).toHaveLength(0);
    });
  }

  it('shell points are deterministic, inside the coma, and counted as planned', () => {
    const { card, params } = fixture('comet');
    const plan = planRender(card, params, defaultContext({ epoch: '2025-08' }));
    const shell = plan.shells[0]!;
    const a = shellPositions(shell);
    const b = shellPositions({ ...shell });
    expect(Array.from(b)).toEqual(Array.from(a));
    expect(a).toHaveLength(shell.count * 3);
    for (let i = 0; i < shell.count; i++) {
      const r = Math.hypot(a[i * 3]!, a[i * 3 + 1]!, a[i * 3 + 2]!);
      expect(r).toBeGreaterThanOrEqual(shell.innerRadius - 1e-6);
      expect(r).toBeLessThanOrEqual(shell.outerRadius + 1e-6);
    }
    // Another seed gives another cloud.
    expect(Array.from(shellPositions({ ...shell, seed: shell.seed + 1 }))).not.toEqual(
      Array.from(a),
    );
  });

  it('dust points lie on the Sun side', () => {
    const pos = dustPositions({
      id: 'dust',
      direction: [1, 0, 0],
      count: 500,
      seed: 3,
      tint: [1, 1, 1],
    });
    let sumX = 0;
    for (let i = 0; i < 500; i++) sumX += pos[i * 3]!;
    expect(sumX / 500).toBeGreaterThan(0.2);
  });

  it('the spin rate is 2 pi over the period, times the shown factor, and zero without a spin', () => {
    expect(spinRateRadPerS(null)).toBe(0);
    expect(spinRateRadPerS({ periodH: 1, speedup: 1 })).toBeCloseTo((2 * Math.PI) / 3600);
    expect(spinRateRadPerS({ periodH: 1, speedup: 1000 })).toBeCloseTo((2000 * Math.PI) / 3600);
    expect(spinRateRadPerS({ periodH: 0, speedup: 1000 })).toBe(0);
  });
});

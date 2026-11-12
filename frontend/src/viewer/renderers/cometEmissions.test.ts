// Issue #71 F: the 3I/ATLAS demo asset drawn at chosen times (gas by epoch, modelled tails).
import { describe, expect, it } from 'vitest';
import type { ObjectCard, RenderParams } from '@/contract';
import { EPOCH_JD } from '@/physics/cometGas';
import { defaultContext, planRender } from '../renderPlan';

const asset = Object.values(
  import.meta.glob('../../../../backend/assets/comet/sbdb-1004083.json', {
    eager: true,
    import: 'default',
  }),
)[0] as { card: ObjectCard; render_params: RenderParams };

const plan = (over: Parameters<typeof defaultContext>[0]) =>
  planRender(
    structuredClone(asset.card),
    structuredClone(asset.render_params),
    defaultContext(over),
  );

describe('comet emissions plan', () => {
  it('draws the December gas and both tails, tagged by what they rest on', () => {
    const p = plan({ epoch: '2025-12' });
    expect(p.shells.length).toBe(3);
    const ion = p.drawn.find((d) => d.id === 'ion_tail')!;
    const dust = p.drawn.find((d) => d.id === 'dust_tail')!;
    expect(ion.tag).toBe('derived');
    expect(dust.tag).toBe('model_dependent');
    // The ion tail is anti-solar: its axis is minus the light direction.
    const axis = p.volumes.find((v) => v.id === 'ion_tail')!.axis!;
    const sun = p.lighting.direction!;
    expect(axis[0] * sun[0] + axis[1] * sun[1] + axis[2] * sun[2]).toBeCloseTo(-1, 6);
  });
  it('draws no dust tail in August: too little time to grow', () => {
    const p = plan({ epoch: '2025-08' });
    expect(p.drawn.some((d) => d.id === 'dust_tail')).toBe(false);
    expect(p.missing.some((m) => m.id === 'dust_tail')).toBe(true);
    expect(p.drawn.some((d) => d.id === 'ion_tail')).toBe(true);
  });
  it('between the epochs the gas is interpolated and the plan says so', () => {
    const jd = (EPOCH_JD['2025-08'] + EPOCH_JD['2025-12']) / 2;
    const p = plan({ epoch: '2025-12', cometJd: jd });
    expect(p.notes.join(' ')).toMatch(/guess/);
    const aug = plan({ epoch: '2025-08', cometJd: EPOCH_JD['2025-08'] });
    const dec = plan({ epoch: '2025-12', cometJd: EPOCH_JD['2025-12'] });
    const h2o = (x: typeof p) => x.shells.find((s) => s.id === 'h2o')!.brightness;
    expect(h2o(aug)).toBeLessThan(h2o(p));
    expect(h2o(p)).toBeLessThan(h2o(dec));
  });
  it('refuses gas outside the observed times, and is deterministic', () => {
    const early = plan({ epoch: '2025-08', cometJd: EPOCH_JD['2025-08'] - 20 });
    expect(early.shells).toEqual([]);
    const a = plan({ epoch: '2025-12', cometJd: 2460990 });
    const b = plan({ epoch: '2025-12', cometJd: 2460990 });
    expect(JSON.stringify(a.volumes)).toBe(JSON.stringify(b.volumes));
  });
  it('water near perihelion is the SOHO/SWAN value, thinned by its Haser break-up', () => {
    const p = plan({ epoch: '2025-12', cometJd: 2460986.0 });
    expect(p.notes.join(' ')).toMatch(/SOHO\/SWAN/);
    expect(p.notes.join(' ')).toMatch(/above the top of the brightness scale/);
    const haser = p.drawn.find((d) => d.id === 'h2o_breakup')!;
    expect(haser.tag).toBe('model_dependent');
    // Only water is thinned: CO2 keeps its pure 1/r^2 share.
    const h2o = p.shells.find((s) => s.id === 'h2o')!;
    expect(h2o.brightness).toBeLessThan(1);
    const dec = plan({ epoch: '2025-12' });
    expect(dec.notes.join(' ')).toMatch(/570, 114, 28\.5 and 5\.7/);
  });
});

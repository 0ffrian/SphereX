// Issue #43: plans for shape-model asteroids, displaced ellipsoids, comets with tails and the
// volume specs of remnants and nebulae. Pure: no GPU. Mesh and shader drawing is covered by the
// e2e frames.
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import cardSchema from '../../../shared/schemas/object-card.schema.json';
import paramsSchema from '../../../shared/schemas/render-params.schema.json';
import type { Layer, ObjectCard, Tag } from '@/contract';
import { fixture } from '@/test/sharedFixtures';
import { epochAnnouncement } from './altText';
import { weakerOf } from './honesty';
import { directionFromPhaseAngle } from './lighting';
import { defaultContext, planRender } from './renderPlan';
import { displacementActive, reliefAmpOf } from './renderers/AsteroidProcedural';
import { ellipsoidAxes } from './planCommon';
import type { PlanContext } from './planTypes';
import {
  cssToLinear,
  dustConeVolume,
  dustTailVolume,
  H_ALPHA_RGB,
  ionTailVolume,
  nebulaVolume,
  OIII_RGB,
  remnantShell,
  remnantVolume,
  TAIL_LENGTH_COMA_RADII,
} from './volume/volumeSpecs';
import { TAGS } from '@/contract';

const MESH = '/data/shapes/eros-gaskell.glb';
const missing = (p: { missing: { id: string; reason?: string }[] }, id: string) =>
  p.missing.find((m) => m.id === id);
const drawnTag = (p: { drawn: { id: string; tag: Tag }[] }, id: string) =>
  p.drawn.find((d) => d.id === id)?.tag;

function erosPlan(ctx: Partial<PlanContext> = {}) {
  const { card, params } = fixture('asteroid_shape');
  card.shape_source = { value: MESH, tag: 'measured', source: 'test' };
  return planRender(card, params, defaultContext(ctx));
}

describe('shape-model asteroid (R7.1, A7.4)', () => {
  it('draws every detail layer at + Artistic, each with its own tag', () => {
    const plan = erosPlan({ honesty: 'artistic' });
    expect(plan.shape).toEqual({
      lommelSeeliger: true,
      shadows: true,
      ao: true,
      regolith: true,
    });
    expect(drawnTag(plan, 'reflectance')).toBe('model_dependent');
    expect(drawnTag(plan, 'self_shadow')).toBe('derived');
    expect(drawnTag(plan, 'baked_ao')).toBe('derived');
    expect(drawnTag(plan, 'regolith')).toBe('artistic');
    for (const d of plan.drawn) expect(TAGS).toContain(d.tag);
  });

  it('the regolith is tier 5: hidden at + Estimated, listed as not drawn', () => {
    const plan = erosPlan({ honesty: 'derived' });
    expect(plan.shape?.regolith).toBe(false);
    expect(plan.shape?.shadows).toBe(true);
    expect(missing(plan, 'regolith')).toMatchObject({ reason: 'honesty', tag: 'artistic' });
  });

  it('shadows are not derived when the Sun direction is a default', () => {
    const { card, params } = fixture('asteroid_shape');
    card.shape_source = { value: MESH, tag: 'measured', source: 'test' };
    delete params.lighting.phase_angle_deg;
    delete params.lighting.sun_dir;
    const artistic = planRender(card, params, defaultContext({ honesty: 'artistic' }));
    expect(artistic.lighting.source).toBe('view');
    expect(drawnTag(artistic, 'self_shadow')).toBe('artistic');
    const estimated = planRender(card, params, defaultContext({ honesty: 'derived' }));
    expect(estimated.shape?.shadows).toBe(false);
    expect(missing(estimated, 'self_shadow')).toMatchObject({ reason: 'honesty', tag: 'artistic' });
  });

  it('at Measured only the mesh is the real shape and nothing modelled is drawn on it', () => {
    const plan = erosPlan({ honesty: 'measured' });
    expect(plan.bodies[0]?.meshUrl).toBe(MESH);
    expect(plan.shape).toEqual({
      lommelSeeliger: false,
      shadows: false,
      ao: false,
      regolith: false,
    });
    for (const id of ['reflectance', 'self_shadow', 'baked_ao', 'regolith']) {
      expect(missing(plan, id)?.reason).toBe('honesty');
    }
  });

  it('with no loadable mesh there is no shape plan: a plain sphere, nothing invented', () => {
    const { card, params } = fixture('asteroid_shape'); // fixture:// address
    const plan = planRender(card, params, defaultContext({ honesty: 'artistic' }));
    expect(plan.bodies[0]?.meshUrl).toBeNull();
    expect(plan.shape).toBeNull();
    expect(plan.drawn.some((d) => d.id === 'self_shadow')).toBe(false);
  });

  it('a mesh that failed to load drops the shape plan too', () => {
    const plan = erosPlan({ honesty: 'artistic', failed: ['mesh'] });
    expect(plan.shape).toBeNull();
  });

  it('the Sun direction comes from the phase angle', () => {
    const plan = erosPlan({ honesty: 'artistic' });
    const phase = plan.lighting.phaseAngleDeg;
    expect(phase).not.toBeNull();
    expect(plan.lighting.direction).toEqual(directionFromPhaseAngle(phase!));
  });

  it('the same card and seed give the same plan (determinism)', () => {
    expect(JSON.stringify(erosPlan({ honesty: 'artistic' }))).toBe(
      JSON.stringify(erosPlan({ honesty: 'artistic' })),
    );
  });
});

describe('asteroid without a model: ellipsoid and displacement (R7.2)', () => {
  it('the ellipsoid follows the light-curve amplitude: a/b = 10^(0.4 A)', () => {
    const [a, b, c] = ellipsoidAxes(0.5);
    expect(a / b).toBeCloseTo(Math.pow(10, 0.4 * 0.5), 12);
    expect(c).toBe(b);
    expect(ellipsoidAxes(0)).toEqual([1, 1, 1]);
    expect(ellipsoidAxes(null)).toEqual([1, 1, 1]);
    expect(ellipsoidAxes(-1)).toEqual([1, 1, 1]);
  });

  it('refuses displacement while relief_amp is unknown (no value invented)', () => {
    const { card, params } = fixture('asteroid_procedural');
    const plan = planRender(card, params, defaultContext({ honesty: 'artistic' }));
    expect(plan.bodies[0]?.displacementScale).toBeNull();
    expect(plan.bodies[0]?.heightUrl).toBeNull();
    expect(missing(plan, 'displacement')).toMatchObject({ reason: 'backend' });
    expect(missing(plan, 'displacement')).not.toHaveProperty('fields');
  });

  it('relief_amp is a declared field: params that carry it validate against the schema', () => {
    const ajv = new Ajv({ allErrors: true, strict: true });
    ajv.addSchema(cardSchema);
    ajv.addSchema(paramsSchema);
    const validate = ajv.getSchema('render-params.schema.json')!;
    const { params } = fixture('asteroid_procedural');
    expect(validate(params), JSON.stringify(validate.errors)).toBe(true);
    params.textures!.relief_amp = 0.03;
    expect(validate(params), JSON.stringify(validate.errors)).toBe(true);
    params.textures!.relief_amp = -1;
    expect(validate(params)).toBe(false);
  });

  it('displaces by the baked height map once the backend gives relief_amp', () => {
    const { card, params } = fixture('asteroid_procedural');
    params.textures!.relief_amp = 0.03;
    expect(reliefAmpOf(params)).toBe(0.03);
    const plan = planRender(card, params, defaultContext({ honesty: 'artistic' }));
    expect(plan.bodies[0]?.heightUrl).toBe(params.textures?.height);
    expect(plan.bodies[0]?.displacementScale).toBe(0.03);
    expect(missing(plan, 'displacement')).toBeUndefined();
    // It has a legend entry and a tag of its own.
    expect(drawnTag(plan, 'displacement')).toBe('derived');
  });

  it('refuses displacement when its load failed, and draws none in Measured only', () => {
    const { card, params } = fixture('asteroid_procedural');
    params.textures!.relief_amp = 0.03;
    const failed = planRender(
      card,
      params,
      defaultContext({ honesty: 'artistic', failed: ['displacement'] }),
    );
    expect(missing(failed, 'displacement')).toMatchObject({ reason: 'load' });
    expect(failed.drawn.some((d) => d.id === 'displacement')).toBe(false);
    expect(failed.bodies[0]?.heightUrl).toBeNull();
    expect(failed.bodies[0]?.displacementScale).toBeNull();

    const measured = planRender(card, params, defaultContext({ honesty: 'measured' }));
    // The relief is already hidden there, so there is nothing to displace.
    expect(measured.drawn.some((d) => d.id === 'displacement')).toBe(false);
    expect(measured.bodies[0]?.heightUrl ?? null).toBeNull();
  });

  it('is on for desktop levels only, and never for a bad scale', () => {
    expect(displacementActive('high', 0.03)).toBe(true);
    expect(displacementActive('medium', 0.03)).toBe(true);
    expect(displacementActive('low', 0.03)).toBe(false);
    expect(displacementActive('high', null)).toBe(false);
    expect(displacementActive('high', 0)).toBe(false);
  });

  it('reads no relief_amp from a bad value', () => {
    const { params } = fixture('asteroid_procedural');
    for (const v of [NaN, -1, 0, '0.03', null]) {
      // Deliberately outside the type: the viewer must ignore what the schema would reject.
      (params.textures as unknown as { relief_amp: unknown }).relief_amp = v;
      expect(reliefAmpOf(params)).toBeNull();
    }
  });
});

function tailLayer(id: string, tag: Tag): Layer {
  return { id, tag, tier: tag === 'artistic' ? 5 : 2, description: id, requires: [] };
}

function cometDecember(extra: Layer[] = []): {
  card: ObjectCard;
  plan: ReturnType<typeof planRender>;
} {
  const { card, params } = fixture('comet');
  card.epochs = ['2025-12'];
  params.layers.push(tailLayer('dust', 'artistic'), ...extra);
  const plan = planRender(card, params, defaultContext({ honesty: 'artistic', epoch: '2025-12' }));
  return { card, plan };
}

describe('comet volumes and tails (R7.3)', () => {
  it('the dust cone takes the tag of the backend dust layer', () => {
    for (const tag of ['derived', 'model_dependent'] as const) {
      const { card, params } = fixture('comet');
      card.epochs = ['2025-12'];
      params.layers.push(tailLayer('dust', tag));
      const plan = planRender(
        card,
        params,
        defaultContext({ honesty: 'artistic', epoch: '2025-12' }),
      );
      expect(plan.volumes.find((v) => v.kind === 'dust')?.tag).toBe(tag);
      expect(drawnTag(plan, 'dust')).toBe(tag);
    }
  });

  it('draws the coma and the dust as volumes, from the same data as the haptic shells', () => {
    const { plan } = cometDecember();
    const kinds = plan.volumes.map((v) => v.kind);
    expect(kinds).toContain('coma');
    expect(kinds).toContain('dust');
    const coma = plan.volumes.find((v) => v.kind === 'coma')!;
    expect(coma.emitters.map((e) => e.label)).toEqual(plan.shells.map((s) => s.label));
    expect(coma.emitters.map((e) => e.gain)).toEqual(plan.shells.map((s) => s.brightness));
  });

  it('draws no tail when the backend offers none (3I/ATLAS has no published tail)', () => {
    const { plan } = cometDecember();
    expect(plan.volumes.some((v) => v.kind === 'ion_tail' || v.kind === 'dust_tail')).toBe(false);
    expect(plan.notes.join(' ')).toContain('No tail is drawn');
  });

  it('draws a straight ion tail away from the Sun and a curved dust tail when offered', () => {
    const { plan } = cometDecember([
      tailLayer('ion_tail', 'derived'),
      tailLayer('dust_tail', 'artistic'),
    ]);
    const ion = plan.volumes.find((v) => v.kind === 'ion_tail')!;
    const dust = plan.volumes.find((v) => v.kind === 'dust_tail')!;
    const sun = plan.lighting.direction!;
    expect(ion.axis).toEqual(sun.map((x) => -x));
    expect(ion.bendFraction).toBe(0);
    expect(ion.tag).toBe('derived');
    expect(dust.axis).toEqual(ion.axis);
    expect(dust.bendFraction).toBeGreaterThan(0);
    expect(dust.bend).not.toBeNull();
    // Away from the Sun means the tail's end lies on the far side of the nucleus.
    const end = ion.center.map((c, i) => c + ion.axis![i]! * ion.halfExtent[0]);
    const along = end.reduce((s, x, i) => s + x * sun[i]!, 0);
    expect(along).toBeCloseTo(-TAIL_LENGTH_COMA_RADII, 9);
    expect(plan.extent).toBeGreaterThanOrEqual(TAIL_LENGTH_COMA_RADII);
  });

  it('a tail claims no more than the weaker of the backend tag and its own shape', () => {
    // The dust tail's bend is a display choice (artistic): a stronger backend tag does not lift it.
    const { plan, card } = cometDecember([tailLayer('dust_tail', 'derived')]);
    expect(plan.volumes.find((v) => v.kind === 'dust_tail')?.tag).toBe('artistic');
    expect(drawnTag(plan, 'dust_tail')).toBe('artistic');
    // So it is hidden at + Estimated, with the tag it really has.
    const { params } = fixture('comet');
    params.layers.push(tailLayer('dust', 'artistic'), tailLayer('dust_tail', 'derived'));
    const estimated = planRender(
      card,
      params,
      defaultContext({ honesty: 'derived', epoch: '2025-12' }),
    );
    expect(estimated.volumes.some((v) => v.kind === 'dust_tail')).toBe(false);
    expect(missing(estimated, 'dust_tail')).toMatchObject({ reason: 'honesty', tag: 'artistic' });
    // An ion tail rests on the backend tag when that is the weaker one.
    const weakIon = cometDecember([tailLayer('ion_tail', 'artistic')]).plan;
    expect(weakIon.volumes.find((v) => v.kind === 'ion_tail')?.tag).toBe('artistic');
  });

  it('the epoch announcement says "No tail is drawn" only when none is drawn', () => {
    const none = cometDecember().plan;
    expect(epochAnnouncement('2025-12', none)).toContain('No tail is drawn.');
    const both = cometDecember([
      tailLayer('ion_tail', 'derived'),
      tailLayer('dust_tail', 'artistic'),
    ]).plan;
    const said = epochAnnouncement('2025-12', both);
    expect(said).not.toContain('No tail is drawn');
    expect(said).toContain('Tails drawn: gas tail and dust tail.');
    const ionOnly = cometDecember([tailLayer('ion_tail', 'derived')]).plan;
    expect(epochAnnouncement('2025-12', ionOnly)).toContain('Tails drawn: gas tail.');
  });

  it('weakerOf picks the tag that claims less', () => {
    expect(weakerOf('measured', 'derived')).toBe('derived');
    expect(weakerOf('artistic', 'derived')).toBe('artistic');
    expect(weakerOf('derived', 'derived')).toBe('derived');
    expect(weakerOf('model_dependent', 'inferred_from_analog')).toBe('inferred_from_analog');
  });

  it('a tail is refused (not guessed) when the Sun direction is unknown', () => {
    const { card, params } = fixture('comet');
    card.epochs = ['2025-12'];
    params.layers.push(tailLayer('ion_tail', 'derived'));
    delete card.phase_angle_deg;
    delete card.sun_vector;
    params.lighting = { mode: 'sun' };
    const plan = planRender(
      card,
      params,
      defaultContext({ honesty: 'artistic', epoch: '2025-12' }),
    );
    expect(plan.volumes.some((v) => v.kind === 'ion_tail')).toBe(false);
    expect(missing(plan, 'ion_tail')).toMatchObject({ reason: 'data' });
  });

  it('the tail layer follows the honesty toggle through its own tag', () => {
    const { card, params } = fixture('comet');
    card.epochs = ['2025-12'];
    params.layers.push(tailLayer('dust_tail', 'artistic'));
    const plan = planRender(card, params, defaultContext({ honesty: 'derived', epoch: '2025-12' }));
    expect(plan.volumes.some((v) => v.kind === 'dust_tail')).toBe(false);
    expect(missing(plan, 'dust_tail')?.reason).toBe('honesty');
  });
});

describe('volume specs', () => {
  it('every volume carries one of the five tags and an emitter', () => {
    const specs = [
      nebulaVolume(1),
      remnantVolume({ seed: 1, ageYr: null, axisRatio: null }),
      ionTailVolume([0, 0, 1], 1)!,
      dustTailVolume([0, 0, 1], 1)!,
      dustConeVolume(
        { id: 'dust', direction: [0, 0, 1], count: 1, seed: 1, tint: [1, 1, 1] },
        'artistic',
      ),
    ];
    for (const s of specs) {
      expect(TAGS).toContain(s.tag);
      expect(s.emitters.length).toBeGreaterThan(0);
    }
  });

  it('nebula and remnant use H-alpha red and [O III] teal', () => {
    for (const v of [nebulaVolume(3), remnantVolume({ seed: 3, ageYr: null, axisRatio: null })]) {
      const labels = v.emitters.map((e) => e.label);
      expect(labels).toContain('H-alpha');
      expect(labels).toContain('[O III]');
      expect(v.emitters.find((e) => e.label === 'H-alpha')!.rgb).toEqual(H_ALPHA_RGB);
      expect(v.emitters.find((e) => e.label === '[O III]')!.rgb).toEqual(OIII_RGB);
    }
    // Red is red and teal is blue-green.
    expect(H_ALPHA_RGB[0]).toBeGreaterThan(H_ALPHA_RGB[2] * 5);
    expect(OIII_RGB[1]).toBeGreaterThan(OIII_RGB[0] * 5);
  });

  it('the remnant has a core glow emitter, a dust lane strength and artistic tag (D-12)', () => {
    const r = remnantVolume({ seed: 1, ageYr: null, axisRatio: null });
    expect(r.emitters.map((e) => e.label)).toContain('Synchrotron');
    expect(r.dust).toBeGreaterThan(0);
    expect(r.tag).toBe('artistic');
  });

  it('the remnant outline follows the axis ratio and the shell follows the age', () => {
    const round = remnantVolume({ seed: 1, ageYr: null, axisRatio: null });
    const oval = remnantVolume({ seed: 1, ageYr: null, axisRatio: 0.6 });
    expect(round.halfExtent).toEqual([1, 1, 1]);
    expect(oval.halfExtent[0]).toBe(1);
    expect(oval.halfExtent[1]).toBeCloseTo(0.6, 12);
    const young = remnantVolume({ seed: 1, ageYr: 1000, axisRatio: null });
    const old = remnantVolume({ seed: 1, ageYr: 50_000, axisRatio: null });
    expect(young.shell).toBeLessThan(old.shell);
    expect(old.shell).toBeLessThanOrEqual(0.9);
    expect(remnantShell(null)).toBe(0.9);
    expect(remnantShell(100_000)).toBeCloseTo(0.9, 12);
  });

  it('is deterministic: the same input gives the same spec', () => {
    expect(JSON.stringify(nebulaVolume(7))).toBe(JSON.stringify(nebulaVolume(7)));
    expect(nebulaVolume(7).seed).not.toBe(nebulaVolume(8).seed);
  });

  it('refuses a tail for a zero Sun vector', () => {
    expect(ionTailVolume([0, 0, 0], 1)).toBeNull();
    expect(dustTailVolume([0, 0, 0], 1)).toBeNull();
  });

  it('keeps the bent dust tail inside its box', () => {
    const t = dustTailVolume([0, 0, 1], 1)!;
    // Centre line offset at the end plus the shader's widest half-width stays within the box.
    expect(t.bendFraction + 0.3).toBeLessThanOrEqual(1);
    expect(t.halfExtent[1]).toBeCloseTo(t.halfExtent[2], 12);
  });

  it('converts a css colour to linear RGB', () => {
    expect(cssToLinear('#ffffff')).toEqual([1, 1, 1]);
    expect(cssToLinear('#000000')).toEqual([0, 0, 0]);
    expect(cssToLinear('#808080')[0]).toBeCloseTo(0.2159, 3);
    expect(cssToLinear('nonsense')).toEqual([1, 1, 1]);
  });
});

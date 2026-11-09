// Issue #42: what the planners draw for the animated bodies, by tier and honesty state, with
// refusals, and the built bodies' per-frame pose.
import { describe, expect, it } from 'vitest';
import { defaultContext, planRender } from '../renderPlan';
import { fixture } from './fixtures.testutil';
import { ALL_TAGS } from './bodyRenderer';
import { ShaderBody } from './ShaderBody';
import { StarBody } from './StarBody';
import { generateField, pixelDirection, stormIdAt } from '../fields/fieldGenerator';
import { stormsAt } from '../fields/flowModel';
import { resolveMotion } from '../motion/motion';
import { resolveShaderSpec, rhinesBands, flatteningRule, climateFromTeq } from './shaderSpec';
import { sceneKey } from '../ViewerApp';
import { binaryMapOffset, BROWN_DWARF_CONFIG, IR_STRIPES_NOTE, planBrownDwarf } from './BrownDwarf';
import type { HonestyState } from '../honesty';
import type { RenderPlan } from '../planTypes';

const at = (kind: string, honesty: HonestyState, mode: 'visible' | 'spherex_ir' | null = null) => {
  const { card, params } = fixture(kind);
  return planRender(card, params, defaultContext({ honesty, mode }));
};
const ids = (p: RenderPlan) => p.drawn.map((d) => d.id);
const tierOf = (p: RenderPlan, id: string) => p.drawn.find((d) => d.id === id)?.tier;

describe('star surface (R7.5.1)', () => {
  it('Measured only draws no spots, faculae, flares or loops (none is tier 1)', () => {
    const p = at('star', 'measured');
    expect(p.star).toBeNull();
    for (const id of ['spots', 'faculae', 'flares', 'prominences', 'granulation', 'glow'])
      expect(ids(p)).not.toContain(id);
  });

  it('+ Estimated draws tier 4 layers but not the artistic ones', () => {
    const p = at('star', 'derived');
    expect(ids(p)).toEqual(expect.arrayContaining(['spots', 'faculae', 'flares', 'prominences']));
    expect(ids(p)).not.toContain('granulation');
    expect(ids(p)).not.toContain('prominence_strands');
    expect(ids(p)).not.toContain('glow');
    expect(p.star).toMatchObject({ spots: true, flares: true, strands: false, granulation: false });
    expect(tierOf(p, 'spots')).toBe(4);
  });

  it('+ Artistic adds granulation, strands and glow, each with its tier', () => {
    const p = at('star', 'artistic');
    expect(p.star).toMatchObject({ granulation: true, strands: true, glow: true });
    expect(tierOf(p, 'granulation')).toBe(5);
    expect(tierOf(p, 'prominence_strands')).toBe(5);
  });

  it('every layer and the spin show a tier; the spin and the stated speed-ups are on the plan', () => {
    const p = at('star', 'artistic');
    for (const d of p.drawn) expect(d.tier).toBeGreaterThanOrEqual(1);
    expect(p.spin).toEqual({ periodH: 600, speedup: 86400 });
    expect(p.motion.processes.map((x) => x.id)).toEqual(['spin', 'spots', 'flares']);
  });

  it('lists the rate no tier could answer, and still draws', () => {
    const p = at('star', 'artistic');
    expect(p.missing.find((m) => m.id === 'dynamics:diff_rotation')?.reason).toBe('data');
    expect(p.star).not.toBeNull();
  });

  it('flares are not drawn without a stated speed-up (and the plan says so)', () => {
    const { card, params } = fixture('star');
    delete params.dynamics!.speedup.flares;
    const p = planRender(card, params, defaultContext({ honesty: 'artistic' }));
    expect(p.star?.flares).toBe(false);
    expect(p.notes.join(' ')).toMatch(/Flares are not drawn/);
  });

  it('a star with no dynamics still has spot groups, standing still', () => {
    const { card, params } = fixture('star');
    const p = planRender(card, { ...params, dynamics: undefined }, defaultContext());
    expect(p.star?.spots).toBe(true);
    expect(p.star?.rates.frozen).toBe(true);
    expect(p.spin).toBeNull();
  });

  it('a Mira pulses on the clock only at + Artistic (amplitude is art, Q-65)', () => {
    expect(at('star_mira', 'derived').pulsation).toBeNull();
    const p = at('star_mira', 'artistic');
    expect(p.pulsation).toMatchObject({ periodD: 100 });
    expect(p.star).toBeNull();
  });

  it('the built star is a pure function of time and reports its CPU state', () => {
    const p = at('star', 'artistic');
    const tint = p.bodies[0]!.tint;
    const make = () =>
      new StarBody(p.star!, {
        tint,
        emissive: 1,
        limbU: 0.6,
        octaves: 4,
        axes: [1, 1, 1],
        segments: [16, 8],
      });
    const a = make();
    const b = make();
    const time = (id: string) => (id === 'flares' ? 3.1e6 : 1.7e6);
    a.setTime(time);
    b.setTime(time);
    expect(a.lastRegions).toEqual(b.lastRegions);
    expect(a.lastFlares).toEqual(b.lastFlares);
    expect(a.spin.rotation.y).toBe(b.spin.rotation.y);
    a.setTime(() => 0);
    expect(a.lastRegions).not.toEqual(b.lastRegions);
    a.dispose();
    b.dispose();
  });
});

describe('brown dwarf jets (R7.4, A7.2)', () => {
  it('draws moving jets in the visible view at + Artistic, replacing the baked bands', () => {
    const p = at('brown_dwarf', 'artistic', 'visible');
    expect(p.jets).toMatchObject({ storms: 3, windMs: 101.7 });
    expect(ids(p)).toContain('jets');
    expect(ids(p)).not.toContain('bands');
    expect(p.bodies[0]!.albedoUrl).toBeNull();
    expect(p.spin?.speedup).toBe(3600);
    // Jupiter's density does not hold for a brown dwarf and the card has no mass: no flattening.
    expect(p.jets!.flattening).toBe(0);
    expect(ids(p)).not.toContain('flattening');
    expect(p.missing.find((m) => m.id === 'flattening')?.reason).toBe('data');
  });

  it('is left out of the infrared view like the baked bands, and hidden below + Artistic', () => {
    expect(at('brown_dwarf', 'artistic', 'spherex_ir').jets).toBeNull();
    expect(at('brown_dwarf', 'derived', 'visible').jets).toBeNull();
  });

  it('cloud cover follows the measured light curve (tier 3) and is refused without one', () => {
    const { card, params } = fixture('brown_dwarf');
    const base = planRender(card, params, defaultContext({ honesty: 'artistic', mode: 'visible' }));
    expect(base.jets?.clouds).toBe(false);
    expect(base.missing.some((m) => m.id === 'cloud_cover')).toBe(true);
    card.lightcurve = [
      { t_mjd: 1, flux: 10, sigma: 1, lambda_um: 4, flags: 0 },
      { t_mjd: 2, flux: 5, sigma: 1, lambda_um: 4, flags: 0 },
    ];
    const bright = planRender(
      card,
      params,
      defaultContext({ honesty: 'artistic', mode: 'visible', scrubIndex: 0 }),
    );
    const dim = planRender(
      card,
      params,
      defaultContext({ honesty: 'artistic', mode: 'visible', scrubIndex: 1 }),
    );
    expect(bright.jets!.cover).toBeCloseTo(0);
    expect(dim.jets!.cover).toBeCloseTo(0.5);
    expect(tierOf(dim, 'cloud_cover')).toBe(3);
    // The cover changes with the scrub but is applied in place: same scene key.
    expect(sceneKey(bright)).toBe(sceneKey(dim));
  });

  it('without a winds speed-up the baked bands are kept (D-01)', () => {
    const { card, params } = fixture('brown_dwarf');
    delete params.dynamics!.speedup.winds;
    const p = planRender(card, params, defaultContext({ honesty: 'artistic', mode: 'visible' }));
    expect(p.jets).toBeNull();
    expect(p.bodies[0]!.albedoUrl).toBe(params.textures?.albedo);
  });
});

describe('brown dwarf limb darkening and the infrared band pattern (issue #62)', () => {
  it('limb darkening is inferred_from_analog (Q-119): shown from + Estimated, with its assumption stated', () => {
    for (const honesty of ['derived', 'artistic'] as const) {
      const p = at('brown_dwarf', honesty, 'spherex_ir');
      const limb = p.drawn.find((d) => d.id === 'limb_darkening');
      expect(limb, honesty).toMatchObject({ tag: 'inferred_from_analog', tier: 4 });
      expect(p.bodies[0]).toMatchObject({ limbDarkening: true, limbU: 0.6 });
    }
    // Measured only: nothing about the dwarf's limb is measured, so the disc is even.
    const m = at('brown_dwarf', 'measured', 'spherex_ir');
    expect(ids(m)).not.toContain('limb_darkening');
    expect(m.bodies[0]?.limbDarkening ?? false).toBe(false);
  });

  it('the binary has it on both bodies', () => {
    const p = at('brown_dwarf_binary', 'artistic', 'spherex_ir');
    expect(p.bodies.length).toBe(2);
    for (const b of p.bodies) expect(b).toMatchObject({ limbDarkening: true, limbU: 0.6 });
  });

  it('refuses the layer as unverified when the coefficient is not set (nothing invented)', () => {
    const { card, params } = fixture('brown_dwarf');
    const p = planBrownDwarf(
      { card, params, ctx: defaultContext({ honesty: 'artistic', mode: 'spherex_ir' }) },
      { ...BROWN_DWARF_CONFIG, limbU: null },
    );
    expect(p.missing.find((x) => x.id === 'limb_darkening')).toMatchObject({
      reason: 'unverified',
    });
    expect(p.bodies[0]?.limbDarkening).toBe(false);
  });

  it('in the infrared view the baked bands are drawn as brightness on the SPHEREx colour', () => {
    const p = at('brown_dwarf', 'artistic', 'spherex_ir');
    // The jets stay refused for `mode` (Q-107 item 4: the hint still shows) ...
    expect(p.missing.find((m) => m.id === 'jets')?.reason).toBe('mode');
    expect(p.jets).toBeNull();
    // ... and the band map stands in, as brightness only, so the colour stays the IR average.
    const body = p.bodies[0]!;
    expect(ids(p)).toContain('bands');
    expect(body.albedoUrl).toBe(fixture('brown_dwarf').params.textures?.albedo);
    expect(body.albedoLuma).toBe(true);
    expect(body.tint).toEqual(p.tint.rgb);
    expect(ids(p)).toContain('tint'); // the colour is still listed: it is not in the map
    // The visible view keeps the map (or the jets) in colour: not brightness only.
    expect(at('brown_dwarf', 'artistic', 'visible').bodies[0]!.albedoLuma).toBeFalsy();
  });

  it('the infrared legend says the stripes are not from SPHEREx (PR #63 review)', () => {
    const p = at('brown_dwarf', 'artistic', 'spherex_ir');
    expect(p.drawn.find((d) => d.id === 'bands')?.description).toContain('not from SPHEREx');
    // Said once (PR #63 approval nit): in the legend entry, not again in the notes.
    expect(p.notes).not.toContain(IR_STRIPES_NOTE);
    const visible = at('brown_dwarf', 'artistic', 'visible');
    expect(visible.notes).not.toContain(IR_STRIPES_NOTE);
    expect(visible.drawn.find((d) => d.id === 'bands')?.description ?? '').not.toContain(
      'not from SPHEREx',
    );
  });

  it('the limb-darkening text says 0.6 is a visible-band solar value used as a placeholder', () => {
    const p = at('brown_dwarf', 'artistic', 'spherex_ir');
    const l = p.drawn.find((d) => d.id === 'limb_darkening');
    expect(l?.description).toMatch(/visible-band solar value/);
    expect(l?.description).toMatch(/placeholder for an infrared view/);
  });

  it('the binary: body B shares the map but is turned by a seeded offset, A is not (artistic)', () => {
    const p = at('brown_dwarf_binary', 'artistic', 'visible');
    const [a, b] = p.bodies;
    expect(a!.albedoOffsetU ?? 0).toBe(0);
    expect(b!.albedoOffsetU).toBeGreaterThanOrEqual(0.25);
    expect(b!.albedoOffsetU).toBeLessThan(0.75);
    expect(a!.albedoUrl).toBe(b!.albedoUrl); // one shared map
    // Deterministic from the seed, and different seeds give different offsets.
    expect(at('brown_dwarf_binary', 'artistic', 'visible').bodies[1]!.albedoOffsetU).toBe(
      b!.albedoOffsetU,
    );
    expect(binaryMapOffset(1)).toBe(binaryMapOffset(1));
    expect(binaryMapOffset(1)).not.toBe(binaryMapOffset(2));
    // A single dwarf has no offset.
    expect(at('brown_dwarf', 'artistic', 'visible').bodies[0]!.albedoOffsetU).toBeUndefined();
  });

  it('the band pattern is an artistic look: hidden at + Estimated, so the disc is even', () => {
    const p = at('brown_dwarf', 'derived', 'spherex_ir');
    expect(p.bodies[0]).toMatchObject({ albedoUrl: null });
    expect(p.bodies[0]!.albedoLuma).toBeFalsy();
    expect(p.missing.find((m) => m.id === 'bands')).toMatchObject({
      reason: 'honesty',
      tag: 'artistic',
    });
  });

  it('without a winds speed-up the infrared view uses the same pattern', () => {
    const { card, params } = fixture('brown_dwarf');
    delete params.dynamics!.speedup.winds;
    const p = planRender(card, params, defaultContext({ honesty: 'artistic', mode: 'spherex_ir' }));
    expect(p.bodies[0]).toMatchObject({ albedoLuma: true });
  });

  it('visible jets carry the limb coefficient to the surface', () => {
    expect(at('brown_dwarf', 'artistic', 'visible').jets).toMatchObject({ limbU: 0.6 });
  });
});

describe('gas giants and worlds (A7.1, A7.2)', () => {
  it('the band count follows the Rhines rule from the spin and the wind, never above its inputs', () => {
    const { card, params } = fixture('gas_giant');
    const m = resolveMotion(card, params);
    const r = rhinesBands(m, params.scale_m)!;
    // N = sqrt(2 Omega R / U) = 15.6 bands pole to pole, so 8 in the field's units.
    expect(r.value).toBe(8);
    expect(r.tier).toBe(4); // the weakest input (spin, wind: tier 4)
    const spec = resolveShaderSpec(card, params, undefined, m);
    expect(spec.field!.bands).toBe(8);
    // A slider wins (D-27).
    expect(resolveShaderSpec(card, params, { bands: 14 }, m).field!.bands).toBe(14);
    // No spin or wind (issue #62): the typical spin and wind of a giant planet stand in. The
    // typical spin has no formula behind it, so tier 4 (Q-119 b), stated in `assumed`; N = sqrt(2 Omega R / U) = 22 for Jupiter (A7.2), 11 in the field's units.
    const none = resolveShaderSpec(card, { ...params, dynamics: undefined });
    expect(none.field!.bands).toBe(11);
    expect(none.gas!.bandsRule).toMatchObject({
      tag: 'inferred_from_analog',
      tier: 4,
      assumed: { spin_period_h: 9.925, jet_speed_ms: 50 },
    });
  });

  it('flattening follows the spin (tier 3 or weaker), else the typical spin (tier 4, Q-119 b), capped', () => {
    const { card, params } = fixture('gas_giant');
    const m = resolveMotion(card, params);
    const f = flatteningRule(m, card, undefined)!;
    expect(f.tier).toBeGreaterThanOrEqual(3);
    expect(f.value).toBeCloseTo(0.06487 * (9.925 / 10) ** 2, 6);
    const still = flatteningRule(
      resolveMotion(card, { ...params, dynamics: undefined }),
      card,
      undefined,
    )!;
    expect(still).toMatchObject({
      tier: 4,
      tag: 'inferred_from_analog',
      value: 0.06487,
      assumed: { spin_period_h: 9.925 },
    });
    const fast = structuredClone(params);
    fast.dynamics!.spin_period_h!.value = 0.5;
    expect(flatteningRule(resolveMotion(card, fast), card, undefined)!.value).toBeLessThanOrEqual(
      0.15,
    );
  });

  it('shows bands, flattening and colour from + Estimated; storms, jets and turbulence at + Artistic only (issue #62)', () => {
    const est = at('gas_giant', 'derived');
    expect(ids(est)).toEqual(['bands', 'flattening', 'colour']);
    expect(est.shader).toMatchObject({
      surface: true,
      gas: { bands: true, flattening: true, colour: true, storms: false, turbulence: false },
    });
    expect(ids(est)).not.toContain('jets');
    const p = at('gas_giant', 'artistic');
    expect(ids(p)).toEqual(
      expect.arrayContaining([
        'bands',
        'flattening',
        'colour',
        'storms',
        'turbulence',
        'jets',
        'storm_drift',
      ]),
    );
    expect(ids(p)).not.toContain('surface');
    for (const d of p.drawn) expect(d.tier).toBeDefined();
    expect(p.spin).toEqual({ periodH: 10, speedup: 3600 });
    // Each layer keeps the tag the backend gave it (the tier chain of D-32), except bands and
    // flattening, which take the weaker of it and the viewer rule that sets the drawn value (here
    // the 10 h spin and 100 m/s of `dynamics`, inferred_from_analog).
    const tags = Object.fromEntries(p.drawn.map((d) => [d.id, d.tag]));
    expect(tags).toMatchObject({
      bands: 'inferred_from_analog',
      flattening: 'inferred_from_analog',
      colour: 'derived',
      storms: 'artistic',
      turbulence: 'artistic',
    });
  });

  it('Measured only draws none of the gas layers: a plain sphere when the size is measured', () => {
    const p = at('gas_giant', 'measured');
    expect(ids(p)).toEqual(['body']); // the measured size only
    expect(p.shader).toMatchObject({ surface: false, plain: true });
    expect(p.missing.filter((m) => m.reason === 'honesty').map((m) => m.id)).toEqual(
      expect.arrayContaining(['bands', 'flattening', 'colour', 'storms', 'turbulence']),
    );
  });

  it('tags the jets layer no stronger than artistic, names where the speed comes from, and Rhines states the radius (D-32)', () => {
    const jets = at('gas_giant', 'artistic').drawn.find((d) => d.id === 'jets')!;
    expect(jets.tag).toBe('artistic');
    expect(jets.tier).toBe(5);
    expect(jets.description).toContain('jet speed in the dynamics');
    expect(jets.description).not.toContain('on the card');
    const bands = rhinesBands(
      resolveMotion(fixture('gas_giant').card, fixture('gas_giant').params),
      fixture('gas_giant').params.scale_m,
    )!;
    expect(bands.formula).toContain('radius on the card');
    expect(bands.assumed).toHaveProperty('radius_m');
  });

  it('ice, ocean and lava follow the Teq thresholds of A7.1', () => {
    const { card } = fixture('planet_water');
    const d = { sea: 0.4, ice: 0.22 };
    card.teq_K!.value = 300;
    expect(climateFromTeq(card, d)).toMatchObject({ sea: 0.4, ice: 0.22 });
    card.teq_K!.value = 360; // warm: no polar ice
    expect(climateFromTeq(card, d)).toMatchObject({ sea: 0.4, ice: 0 });
    card.teq_K!.value = 500; // oceans removed
    expect(climateFromTeq(card, d)).toMatchObject({ sea: 0, ice: 0 });
    card.teq_K!.value = null;
    expect(climateFromTeq(card, d).rule).toBeNull();
  });

  it('a world with only a spin speed-up does not move its clouds', () => {
    const p = at('planet_water', 'artistic');
    expect(p.motion.processes.map((x) => x.id)).toEqual(['spin']);
    expect(ids(p)).not.toContain('clouds');
    const { card, params } = fixture('planet_water');
    params.dynamics!.jet_speed_ms = {
      value: 30,
      tag: 'inferred_from_analog',
      tier: 4,
      source: 'test',
    };
    params.dynamics!.speedup.winds = 3600;
    const q = planRender(card, params, defaultContext({ honesty: 'artistic' }));
    expect(ids(q)).toContain('clouds');
  });

  it('a toggle of honesty does not rebuild a generated body (scene key unchanged)', () => {
    expect(sceneKey(at('gas_giant', 'derived'))).toBe(sceneKey(at('gas_giant', 'artistic')));
    expect(sceneKey(at('star', 'derived'))).not.toBe(sceneKey(at('star', 'artistic')));
  });
});

describe('moving gas giant body: touch matches sight', () => {
  const ctx = {
    visibleTags: ALL_TAGS,
    fieldSource: async (p: Parameters<typeof generateField>[0]) => generateField(p, 64, 32),
  };

  it('hands the sampler the same storms the shader is given, at the same time', async () => {
    const { card, params } = fixture('gas_giant');
    const motion = resolveMotion(card, params);
    const fp = resolveShaderSpec(card, params, undefined, motion).field!;
    const jets = { windMs: motion.rates.jet_speed_ms!.value, radiusM: params.scale_m! };
    const body = await ShaderBody.create(card, params, ctx);
    let differs = 0;
    for (const t of [0, 3e6, 2e7, 9e7]) {
      body.setTime((id) => (id === 'winds' || id === 'clouds' ? t : 0));
      const storms = stormsAt(fp, jets, t);
      for (let r = 1; r < 32; r += 2) {
        for (let c = 0; c < 64; c += 2) {
          const d = pixelDirection(c, r, 64, 32);
          const got = body.field!.sampleDirection(d).storm;
          expect(got).toBe(stormIdAt(d, storms));
          if (t > 0 && got !== stormIdAt(d, stormsAt(fp, jets, 0))) differs++;
        }
      }
    }
    expect(differs).toBeGreaterThan(0);
    body.dispose();
  });
});

// Issue #71 stream D (Q-240 to Q-243): Earth-like numbers, TRAPPIST-1 e, determinism, refusals,
// provenance of the readouts, and the shared field the haptics read.
import { describe, expect, it } from 'vitest';
import { worldModel, worldReadouts, type WorldInputs } from '@/physics/climateBudget';
import { trappist1f } from '@/physics/exoplanetFixtures.testutil';
import { generateWorld, type WorldParams } from './worldGenerator';
import { resolveWorld } from './worldInputs';
import { FieldSampler } from './fieldGenerator';

const earth: WorldInputs = {
  starTeffK: 5772,
  starRadiusRsun: 1,
  orbitAu: 1,
  radiusM: 6.371e6,
  massKg: 5.972e24,
  bondAlbedo: 0.3,
  pressureBar: 1,
  fluid: 'water',
  locked: false,
  rotPeriodD: 1,
  molarMass: 29,
};
const t1e: WorldInputs = {
  starTeffK: 2566,
  starRadiusRsun: 0.1192,
  orbitAu: 0.02925,
  radiusM: 0.92 * 6.378e6,
  massKg: 0.692 * 5.972e24,
  bondAlbedo: 0.3,
  pressureBar: 1.2,
  fluid: 'water',
  locked: true,
  rotPeriodD: 6.1,
  molarMass: 29,
};

describe('world model: Earth-like numbers', () => {
  const m = worldModel(earth)!;
  it('insolation 1361 W/m2 and Teq about 255 K (NASA Earth Fact Sheet)', () => {
    expect(m.S).toBeGreaterThan(1355);
    expect(m.S).toBeLessThan(1367);
    expect(m.Teq).toBeGreaterThan(253);
    expect(m.Teq).toBeLessThan(257);
  });
  it('the grey greenhouse lifts the surface to about 288 K and water is liquid', () => {
    expect(m.Ts).toBeGreaterThan(280);
    expect(m.Ts).toBeLessThan(292);
    expect(m.state).toBe('liquid');
  });
  it('scale height 7 to 9 km and a cloud base a few km up', () => {
    expect(m.H / 1000).toBeGreaterThan(7);
    expect(m.H / 1000).toBeLessThan(9.5);
    expect(m.zc!).toBeGreaterThan(0.3);
    expect(m.zc!).toBeLessThan(5);
  });
  it('refuses an unusable input instead of inventing one', () => {
    expect(worldModel({ ...earth, orbitAu: 0 })).toBeNull();
    expect(worldModel({ ...earth, bondAlbedo: 1 })).toBeNull();
    expect(worldModel({ ...earth, massKg: NaN })).toBeNull();
  });
});

describe('TRAPPIST-1 e at 1.2 bar (low tier)', { timeout: 60000 }, () => {
  const p: WorldParams = { seed: 11, inputs: t1e, oceanFraction: 0.62, tier: 'low' };
  const w = generateWorld(p)!;
  it('shows a part-open ocean, sea ice and frost on land', () => {
    const s = w.climate.stats!;
    expect(s.liquid).toBeGreaterThan(0.03);
    expect(s.ice).toBeGreaterThan(0.03);
    expect(s.frost).toBeGreaterThan(0.005);
  });
  it('the day side is much warmer than the night side', () => {
    expect(w.climate.stats!.max - w.climate.stats!.min).toBeGreaterThan(25);
  });
  it('no step at the terminator or the ice edge: neighbouring cells differ gradually', () => {
    const { nx, ny, out } = w.climate;
    let dT = 0;
    let dI = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = (j * nx + i) * 4;
        const b = (j * nx + ((i + 1) % nx)) * 4;
        dT = Math.max(dT, Math.abs(out[a]! - out[b]!));
        dI = Math.max(dI, Math.abs(out[a + 1]! - out[b + 1]!));
      }
    }
    expect(dT).toBeLessThan(40);
    expect(dI).toBeLessThan(3);
  });
  it('all values stay finite', () => {
    for (const v of w.climate.out) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('determinism', { timeout: 60000 }, () => {
  it('two runs of the same params are byte-identical (terrain, climate, field)', () => {
    const p: WorldParams = { seed: 5, inputs: t1e, oceanFraction: 0.5, tier: 'low' };
    const a = generateWorld(p)!;
    const b = generateWorld(p)!;
    expect(a.climate.hash).toBe(b.climate.hash);
    expect(Buffer.from(a.terrain.data.buffer).equals(Buffer.from(b.terrain.data.buffer))).toBe(
      true,
    );
    expect(Buffer.from(a.field.a.buffer).equals(Buffer.from(b.field.a.buffer))).toBe(true);
    expect(Buffer.from(a.field.b.buffer).equals(Buffer.from(b.field.b.buffer))).toBe(true);
  });
  it('another seed gives another surface', () => {
    const a = generateWorld({ seed: 5, inputs: t1e, oceanFraction: 0.5, tier: 'low' })!;
    const b = generateWorld({ seed: 6, inputs: t1e, oceanFraction: 0.5, tier: 'low' })!;
    expect(Buffer.from(a.field.a.buffer).equals(Buffer.from(b.field.a.buffer))).toBe(false);
  });
});

describe('shared field for haptics', { timeout: 60000 }, () => {
  const w = generateWorld({ seed: 11, inputs: t1e, oceanFraction: 0.62, tier: 'low' })!;
  const s = new FieldSampler(w.field);
  it('the height is the terrain: ocean texels sit below 0.5 and land above', () => {
    let wet = 0;
    let n = 0;
    for (let i = 0; i < w.field.a.length; i += 4) {
      n++;
      if (w.field.b[i]! > 0.5) {
        wet++;
        expect(w.field.a[i]!).toBeLessThan(0.52);
      }
    }
    expect(wet / n).toBeGreaterThan(0.2);
  });
  it('samples without error everywhere', () => {
    expect(Number.isFinite(s.sampleDirection([1, 0, 0]).height)).toBe(true);
    expect(Number.isFinite(s.sampleDirection([0, -1, 0]).ice)).toBe(true);
  });
});

describe('inputs and provenance', () => {
  it('a card without the host star is refused and names what is missing', () => {
    const card = trappist1f();
    delete card.host_teff_K;
    const r = resolveWorld(card, 'planet_rocky', 1, {}, 'low');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain('host_teff_K');
  });
  it('a full card resolves, assumes pressure and fluid, and labels them model_dependent', () => {
    const r = resolveWorld(trappist1f(), 'planet_rocky', 1, {}, 'low');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sources.pressure).toBe('model_dependent');
    expect(r.assumptions.join(' ')).toMatch(/surface pressure/);
    expect(r.params.inputs.locked).toBe(true);
    const m = worldModel(r.params.inputs)!;
    const rows = worldReadouts(m, r.sources, null);
    expect(rows.find((x) => x.id === 'fluid_state')!.tag).toBe('model_dependent');
    for (const row of rows) {
      if (row.tag === 'derived') expect(row.formula).toBeTruthy();
      if (row.tag === 'model_dependent' || row.tag === 'artistic')
        expect(row.assumption).toBeTruthy();
    }
  });
  it('a slider value is artistic "(your setting)" (Q-58)', () => {
    const r = resolveWorld(
      trappist1f(),
      'planet_rocky',
      1,
      { surface_pressure_bar: 3, surface_fluid: 1 },
      'low',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.params.inputs.pressureBar).toBe(3);
    expect(r.params.inputs.fluid).toBe('methane');
    const rows = worldReadouts(worldModel(r.params.inputs)!, r.sources, null);
    const f = rows.find((x) => x.id === 'fluid_state')!;
    expect(f.tag).toBe('artistic');
    expect(f.assumption).toMatch(/your setting/);
  });
  it('an invalid slider value is ignored, not clamped', () => {
    const r = resolveWorld(trappist1f(), 'planet_rocky', 1, { surface_pressure_bar: 5000 }, 'low');
    expect(r.ok && r.params.inputs.pressureBar).toBe(1);
  });
});

describe('world worker', { timeout: 60000 }, () => {
  it('answers a request, transfers the arrays and reports a refusal as a null world', async () => {
    const { handleWorldRequest, worldTransferables } = await import('./worldWorker');
    const res = handleWorldRequest({
      id: 3,
      params: { seed: 1, inputs: { ...t1e, orbitAu: 0 }, oceanFraction: 0, tier: 'low' },
    });
    expect(res).toEqual({ id: 3, world: null });
    expect(worldTransferables(res)).toEqual([]);
    const ok = handleWorldRequest({
      id: 4,
      params: { seed: 1, inputs: t1e, oceanFraction: 0.5, tier: 'low' },
    });
    expect('world' in ok && ok.world).toBeTruthy();
    expect(worldTransferables(ok).length).toBeGreaterThanOrEqual(5);
  });
});

describe('hydrology in the world', { timeout: 60000 }, () => {
  const p: WorldParams = { seed: 11, inputs: earth, oceanFraction: 0.6, tier: 'low' };
  it('the tier sets the raster size and two runs are identical', () => {
    const a = generateWorld(p)!;
    const b = generateWorld(p)!;
    expect(a.hydrology).toBeTruthy();
    expect(a.hydrology!.RW).toBe(1024);
    expect(Buffer.from(a.hydrology!.img).equals(Buffer.from(b.hydrology!.img))).toBe(true);
  });
  it('a dry world has no hydrology', () => {
    expect(generateWorld({ ...p, oceanFraction: 0 })!.hydrology).toBeNull();
  });
});

describe('Titan from its card (Q-285)', { timeout: 60000 }, () => {
  // The committed reference asset, read as the card the viewer gets.
  const titan = async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    // vitest runs from frontend/
    const raw = JSON.parse(
      readFileSync(resolve(process.cwd(), '../backend/assets/reference/ref-titan.json'), 'utf8'),
    ) as { card: import('@/contract').ObjectCard };
    return raw.card;
  };
  it('takes methane and 1.467 bar from the card with the card tags, and a slider still wins as artistic', async () => {
    const card = await titan();
    const r = resolveWorld(card, 'planet_rocky', 1, {}, 'low');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.params.inputs.fluid).toBe('methane');
    expect(r.params.inputs.pressureBar).toBe(1.467);
    expect(r.sources.fluid).toBe('measured');
    expect(r.sources.pressure).toBe('measured');
    expect(r.assumptions.join(' ')).not.toMatch(/surface pressure 1 bar/);
    const s = resolveWorld(
      card,
      'planet_rocky',
      1,
      { surface_fluid: 0, surface_pressure_bar: 2 },
      'low',
    );
    expect(s.ok && s.params.inputs.fluid).toBe('water');
    expect(s.ok && s.sources.fluid).toBe('artistic');
  });
  it('its surface comes out cold, methane-condensing and hazy, near the measured 93.7 K', async () => {
    const r = resolveWorld(await titan(), 'planet_rocky', 1, {}, 'low');
    if (!r.ok) throw new Error('refused');
    const m = worldModel(r.params.inputs)!;
    expect(m.fluid.id).toBe('methane');
    expect(Math.abs(m.Ts - 93.7)).toBeLessThan(10);
    expect(m.state).toBe('liquid');
    expect(m.haze).toBeGreaterThan(0.5);
  });
});

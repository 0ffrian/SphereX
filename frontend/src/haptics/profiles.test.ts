// R8.5 per-type profiles for every shared fixture, and the R11 haptics honesty test through the
// real engine (D-21): in Measured only, gas giant and planet texture haptics are silent, the
// teq_pulse plays only when teq_K is `measured`, and procedural texture is silent.
import { describe, expect, it } from 'vitest';
import type { ObjectCard, ObjectType, RenderParams, Tag } from '@/contract';
import { FakeClock, FakeDriver } from '@/test/fakeHaptics';
import { RecordingSink, sampleAt, sampleUV } from '@/test/hapticRecorder';
import { FIXTURE_NAMES, fixture } from '@/test/sharedFixtures';
import { FieldSampler, generateField } from '@/viewer/fields/fieldGenerator';
import type { HonestyState } from '@/viewer/honesty';
import type { PointSet } from '@/viewer/renderers/pointClouds';
import { resolveShaderSpec } from '@/viewer/renderers/shaderSpec';
import { HapticEngine } from './haptics';
import {
  buildHaptics,
  cometQNorm,
  MISSING,
  shaderProbeOptions,
  TouchHaptics,
  type HapticBody,
  type HapticsBuild,
} from './profiles';
import { TouchProbe } from './probe';
import { HeightGrid } from './sources/heightMap';
import { createTouchSample, type TouchSample } from './sources/types';
import { HOLD_STILL_MS, HOLD_STILL_TOLERANCE_PX } from './tuning';

function cloud(): Readonly<Record<string, PointSet>> {
  // A 20×20 grid of points in the plane z = 0, across the middle of the view.
  const n = 400;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[3 * i] = (i % 20) / 20 - 0.5;
    positions[3 * i + 1] = Math.floor(i / 20) / 20 - 0.5;
  }
  return { glow: { count: n, positions, colors: new Float32Array(n * 3) } };
}

/** A body like ShaderBody's, with a small field generated from the same spec. */
function bodyFor(card: ObjectCard, params: RenderParams): HapticBody | null {
  const type = params.type;
  if (type === 'nebula' || type === 'nova') {
    return { field: null, pointSets: cloud(), worldToBody: (p) => p };
  }
  if (type !== 'gas_giant' && type !== 'planet_rocky' && type !== 'planet_water') return null;
  const spec = resolveShaderSpec(card, params);
  return {
    field: new FieldSampler(generateField(spec.field!, 128, 64)),
    pointSets: null,
    worldToBody: (p) => p,
  };
}

/** A 2:1 grid with ridges, for asteroid_procedural. */
function ridges(): HeightGrid {
  const W = 64;
  const H = 32;
  const d = new Float32Array(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c += 8) d[r * W + c] = 1;
  return new HeightGrid(W, H, d);
}

/** The comet plan's nucleus body (scene units, coma radius 1), as planComet draws the fixture. */
const NUCLEUS = [{ id: 'nucleus', axes: [0.02, 0.02, 0.02] as [number, number, number] }];

function build(name: string, sink = new RecordingSink()): HapticsBuild {
  const { card, params } = fixture(name);
  return buildHaptics(sink, params, card, bodyFor(card, params), {
    overrides: {},
    heightGrid: ridges(),
    planBodies: NUCLEUS,
  });
}

interface Expect {
  texture: string | null;
  data: string | null;
  dataTag?: Tag;
  missing: string[];
}

// The R8.5 table for the shared fixtures (shared/fixtures/params/*.json).
const TABLE: Record<ObjectType, Expect> = {
  asteroid_shape: { texture: null, data: null, missing: [MISSING.meshNormals] },
  asteroid_procedural: { texture: 'height', data: null, missing: [MISSING.craterRims] },
  comet: { texture: null, data: 'field', dataTag: 'model_dependent', missing: [] },
  brown_dwarf: { texture: null, data: null, missing: [MISSING.bands, MISSING.flux] },
  brown_dwarf_binary: {
    texture: null,
    data: 'binary_pulse',
    dataTag: 'measured',
    missing: [MISSING.bands],
  },
  star_mira: { texture: null, data: 'heartbeat', dataTag: 'measured', missing: [] },
  star_ttauri: { texture: null, data: 'dimming', dataTag: 'measured', missing: [] },
  star: { texture: null, data: null, missing: [MISSING.motion] },
  candidate: { texture: null, data: null, missing: [MISSING.detections] },
  gas_giant: { texture: 'flow', data: 'teq_pulse', dataTag: 'measured', missing: [] },
  planet_water: { texture: 'terrain', data: 'teq_pulse', dataTag: 'derived', missing: [] },
  planet_rocky: { texture: 'terrain', data: null, missing: [] },
  nebula: { texture: null, data: 'field', dataTag: 'artistic', missing: [] },
  nova: { texture: null, data: 'field', dataTag: 'artistic', missing: [] },
};

describe('buildHaptics: every shared fixture (R8.5)', () => {
  it('covers all 14 object types', () => {
    expect(FIXTURE_NAMES.sort()).toEqual(Object.keys(TABLE).sort());
  });

  it.each(FIXTURE_NAMES)('%s', (name) => {
    const want = TABLE[name as ObjectType];
    const got = build(name);
    expect(got.texture?.id ?? null).toBe(want.texture);
    expect(got.data?.id ?? null).toBe(want.data);
    expect(got.missing.sort()).toEqual([...want.missing].sort());
    if (got.texture) {
      expect(got.texture.channel).toBe('texture');
      expect(got.texture.tag).toBe(fixture(name).params.haptics.texture_tag);
    }
    if (got.data) {
      expect(got.data.channel).toBe('data');
      if (want.dataTag) expect(got.data.tag).toBe(want.dataTag);
    }
  });
});

describe('buildHaptics refusals (refuse rather than invent)', () => {
  it('asteroid_procedural without its height.bin: height refused, crater rims refused', () => {
    const { card, params } = fixture('asteroid_procedural');
    const got = buildHaptics(new RecordingSink(), params, card, null, { overrides: {} });
    expect(got.texture).toBeNull();
    expect(got.missing.sort()).toEqual([MISSING.craterRims, MISSING.height].sort());
  });

  it('shader kinds without a field (refused or not built yet) refuse their texture', () => {
    for (const name of ['gas_giant', 'planet_water'] as const) {
      const { card, params } = fixture(name);
      const got = buildHaptics(new RecordingSink(), params, card, null, { overrides: {} });
      expect(got.texture).toBeNull();
      expect(got.missing).toContain(params.haptics.texture);
    }
  });

  it('teq_pulse is refused when teq_K is null, and follows teq_K.tag otherwise', () => {
    const { card, params } = fixture('gas_giant');
    card.teq_K = { value: null, tag: 'derived', source: 't', formula: 'f' };
    const opts = { overrides: {} };
    expect(
      buildHaptics(new RecordingSink(), params, card, bodyFor(card, params), opts).missing,
    ).toEqual([MISSING.teq]);
    card.teq_K = { value: 1200, tag: 'derived', source: 't', formula: 'f' };
    expect(
      buildHaptics(new RecordingSink(), params, card, bodyFor(card, params), opts).data?.tag,
    ).toBe('derived');
  });

  it('flux_pulse plays only with a verified flux_45um reference', () => {
    const { card, params } = fixture('brown_dwarf');
    const sink = new RecordingSink();
    const got = buildHaptics(sink, params, card, null, { overrides: {}, flux45Reference: 200 });
    expect(got.data?.id).toBe('flux_pulse');
    expect(got.missing).toEqual([MISSING.bands]);
  });

  it('binary with classes that cannot be ordered is refused', () => {
    const { card, params } = fixture('brown_dwarf_binary');
    card.spectral_class = { value: 'T5', tag: 'measured', source: 't' };
    const got = buildHaptics(new RecordingSink(), params, card, null, { overrides: {} });
    expect(got.data).toBeNull();
    expect(got.missing).toContain(MISSING.binary);
  });

  it('comet: Q per selected epoch and gas; no Q for the epoch → field refused (Q-42 shape rule)', () => {
    const { card, params } = fixture('comet');
    expect(cometQNorm(card, '2025-08')).toBe(1);
    expect(cometQNorm(card, '2025-12')).toBeNull();
    const dec = buildHaptics(new RecordingSink(), params, card, null, {
      overrides: {},
      epoch: '2025-12',
      planBodies: NUCLEUS,
    });
    expect(dec.data).toBeNull();
    expect(dec.missing).toEqual([MISSING.field]);
    // Epoch-keyed Q (Q-42 proposal): December denser than August, per gas.
    (card as { gas_Q: unknown }).gas_Q = {
      '2025-08': { co2: { value: 1e25, tag: 'measured', source: 't' } },
      '2025-12': {
        co2: { value: 4e25, tag: 'measured', source: 't' },
        h2o: { value: 2e25, tag: 'measured', source: 't' },
      },
    };
    expect(cometQNorm(card, '2025-08', 'co2')).toBeCloseTo(0.25);
    expect(cometQNorm(card, '2025-12', 'co2')).toBe(1);
    expect(cometQNorm(card, '2025-12', 'h2o')).toBeCloseTo(0.5);
    expect(cometQNorm(card, '2025-08', 'h2o')).toBeNull();
    // A selected gas with no Q in the epoch refuses the field too.
    const h2oAug = buildHaptics(new RecordingSink(), params, card, null, {
      overrides: {},
      epoch: '2025-08',
      gas: 'h2o',
      planBodies: NUCLEUS,
    });
    expect(h2oAug.missing).toEqual([MISSING.field]);

    // R8.4: December feels denser than August, at the default k, half-way out and near the edge.
    const rateAt = (epoch: '2025-08' | '2025-12', r: number) => {
      const sink = new RecordingSink();
      const b = buildHaptics(sink, params, card, null, {
        overrides: {},
        epoch,
        gas: 'co2',
        planBodies: NUCLEUS,
      });
      const s = sampleAt([0, 0, 1], { bodyId: null });
      s.centreDistance = r;
      b.data!.move(s);
      return sink.current!.rateHz;
    };
    expect(rateAt('2025-12', 0.5)).toBeGreaterThan(rateAt('2025-08', 0.5));
    expect(rateAt('2025-12', 0.9)).toBeGreaterThan(rateAt('2025-08', 0.9));
  });

  it('comet: the felt nucleus is the drawn nucleus body; without the plan the tick is refused', () => {
    const { card, params } = fixture('comet');
    const none = buildHaptics(new RecordingSink(), params, card, null, { overrides: {} });
    expect(none.data?.id).toBe('field');
    expect(none.missing).toEqual([MISSING.nucleus]);
    const sink = new RecordingSink();
    const big = buildHaptics(sink, params, card, null, {
      overrides: {},
      planBodies: [{ id: 'nucleus', axes: [0.5, 0.5, 0.5] }],
    });
    const s = sampleAt([0, 0, 1], { bodyId: null });
    s.centreDistance = 0.4; // inside a 0.5 drawn nucleus (the plan's size when the coma is unknown)
    big.data!.move(s);
    expect(sink.ticks()).toHaveLength(1);
    expect(sink.activeTrainId).toBeNull();
  });

  it('asteroid_shape: mesh haptics only with real mesh normals (no bounding-sphere stand-in)', () => {
    const { card, params } = fixture('asteroid_shape');
    const off = buildHaptics(new RecordingSink(), params, card, null, { overrides: {} });
    expect(off.texture).toBeNull();
    expect(off.missing).toEqual([MISSING.meshNormals]);
    const on = buildHaptics(new RecordingSink(), params, card, null, {
      overrides: {},
      meshNormals: true,
    });
    expect(on.texture?.id).toBe('mesh');
    expect(on.missing).toEqual([]);
  });

  it('gas giant rings: one flag for the source and the probe, from the overrides', () => {
    const { card, params } = fixture('gas_giant');
    const body = bodyFor(card, params)!;
    const plain = buildHaptics(new RecordingSink(), params, card, body, { overrides: {} });
    expect(plain.rings).toBe(false);
    expect(shaderProbeOptions(body, plain).rings).toBe(false);
    const ringed = buildHaptics(new RecordingSink(), params, card, body, {
      overrides: { rings: 0.8 },
    });
    expect(ringed.rings).toBe(true);
    expect(shaderProbeOptions(body, ringed).rings).toBe(true);
  });

  it('nebula without point sets refuses the field', () => {
    const { card, params } = fixture('nebula');
    expect(
      buildHaptics(new RecordingSink(), params, card, null, { overrides: {} }).missing,
    ).toEqual([MISSING.field]);
  });
});

// ---------------------------------------------------------------- R11 honesty through the engine

interface Rig {
  clock: FakeClock;
  driver: FakeDriver;
  engine: HapticEngine;
}

function rig(honesty: HonestyState): Rig {
  const clock = new FakeClock();
  const driver = new FakeDriver(clock.clock);
  const engine = new HapticEngine([driver], {
    clock: clock.clock,
    timers: clock,
    honesty,
    debugTarget: null,
  });
  return { clock, driver, engine };
}

/** Drag across the body and off its right limb, back on, then hold still. */
function dragThenHold(r: Rig, touch: TouchHaptics, probe: TouchProbe): void {
  const s = createTouchSample();
  for (let i = 0; i <= 100; i++) {
    const x = i <= 90 ? -0.95 + (2.35 * i) / 90 : 1.4 - (1.4 * (i - 90)) / 10;
    probe.fromWorldRay([x, 0.3 * Math.sin(i / 5), 5], [0, 0, -1], i * 10, 0, x, r.clock.now, s);
    touch.move(s);
    r.clock.advance(30);
  }
  // Hold still: no pointermove; the frame loop polls.
  for (let k = 0; k < 40; k++) {
    r.clock.advance(20);
    touch.poll(r.clock.now);
  }
  r.clock.advance(600);
}

function played(r: Rig): { tags: Tag[]; texture: number; windows: number } {
  const tags = [...r.driver.events.map((e) => e.tag), ...r.driver.windows.map((w) => w.tag)];
  return { tags, texture: r.driver.events.length, windows: r.driver.windows.length };
}

function feel(name: string, honesty: HonestyState, edit?: (card: ObjectCard) => void) {
  const r = rig(honesty);
  const { card, params } = fixture(name);
  edit?.(card);
  const body = bodyFor(card, params);
  const b = buildHaptics(r.engine, params, card, body, {
    overrides: {},
    heightGrid: ridges(),
    planBodies: NUCLEUS,
  });
  const probe = new TouchProbe(
    body
      ? shaderProbeOptions(body, b)
      : { bodies: [{ id: 'body', position: [0, 0, 0], axes: [1, 1, 1] }] },
  );
  const touch = new TouchHaptics(b);
  dragThenHold(r, touch, probe);
  touch.release();
  return played(r);
}

describe('R11 honesty: haptics follow the D-21 filter (through the real engine)', () => {
  it('Measured only: gas giant texture silent; teq_pulse plays because teq_K is measured', () => {
    const p = feel('gas_giant', 'measured');
    expect(p.texture).toBe(0); // no band, storm or ring ticks
    expect(p.windows).toBeGreaterThan(0); // the held teq pulse
    expect(new Set(p.tags)).toEqual(new Set(['measured']));
  });

  it('Measured only: a derived teq_K is silent too, so nothing plays on the gas giant', () => {
    const p = feel('gas_giant', 'measured', (c) => {
      c.teq_K = { value: 900, tag: 'derived', source: 't', formula: 'A7.1' };
    });
    expect(p.tags).toEqual([]);
  });

  it('Measured only: planet_water (teq derived) and planet_rocky are fully silent', () => {
    expect(feel('planet_water', 'measured').tags).toEqual([]);
    expect(feel('planet_rocky', 'measured').tags).toEqual([]);
  });

  it('+ Estimated: the derived teq pulse plays, the artistic texture is still silent', () => {
    const p = feel('planet_water', 'derived');
    expect(p.texture).toBe(0);
    expect(p.windows).toBeGreaterThan(0);
    expect(new Set(p.tags)).toEqual(new Set(['derived']));
  });

  it('+ Artistic: the planet and gas giant textures play (artistic)', () => {
    for (const name of ['gas_giant', 'planet_water'] as const) {
      const p = feel(name, 'artistic');
      expect(p.tags).toContain('artistic');
    }
  });

  it('procedural relief is silent in Measured only and + Estimated, felt in + Artistic', () => {
    expect(feel('asteroid_procedural', 'measured').tags).toEqual([]);
    expect(feel('asteroid_procedural', 'derived').tags).toEqual([]);
    const art = feel('asteroid_procedural', 'artistic');
    expect(art.texture).toBeGreaterThan(0);
    expect(new Set(art.tags)).toEqual(new Set(['artistic']));
  });

  it('asteroid_shape without mesh normals is silent in Measured only and listed as refused', () => {
    const p = feel('asteroid_shape', 'measured');
    expect(p.tags).toEqual([]);
    expect(build('asteroid_shape').missing).toEqual([MISSING.meshNormals]);
  });

  it('with real mesh normals, a measured shape model ticks in Measured only', () => {
    const r = rig('measured');
    const { card, params } = fixture('asteroid_shape');
    const b = buildHaptics(r.engine, params, card, null, { overrides: {}, meshNormals: true });
    const touch = new TouchHaptics(b);
    // Synthetic normals from the viewer's mesh raycast: a 30 degree face turn, then off the silhouette.
    const steps: [[number, number, number], boolean][] = [
      [[0, 0, 1], true],
      [[0, Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)], true],
      [[0, 0, 1], false],
    ];
    for (const [n, onBody] of steps) {
      const s = sampleAt([0, 0, 1], { bodyId: onBody ? 'body' : null, x: r.clock.now });
      s.normal = [...n];
      touch.move(s);
      r.clock.advance(50);
    }
    const p = played(r);
    expect(p.texture).toBe(2);
    expect(new Set(p.tags)).toEqual(new Set(['measured']));
  });

  it('nebula and nova fields are artistic: silent below + Artistic', () => {
    expect(feel('nebula', 'derived').tags).toEqual([]);
    expect(feel('nebula', 'artistic').windows).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- holding still

describe('R8.2 channel labels: texture events say texture, data events say data (Q-85)', () => {
  /** Drive ONE source alone on its own sink, so every event and train it makes is its own. */
  function driveAlone(name: string, which: 'texture' | 'data'): RecordingSink {
    const sink = new RecordingSink();
    const src = build(name, sink)[which];
    if (!src) return sink;
    for (let i = 0; i <= 120; i++) {
      const s = sampleUV(i / 120, 0.3 + 0.4 * Math.sin(i / 7) ** 2, { t: i * 30, x: i * 6 });
      s.centreDistance = 0.01 + i / 140;
      s.rayOrigin = [-0.6 + i / 100, 0, 5];
      s.rayDir = [0, 0, -1];
      src.move(s);
      src.hold?.(s);
      src.scrub?.(i % 3);
    }
    return sink;
  }

  const cases = [
    'gas_giant',
    'planet_water',
    'planet_rocky',
    'asteroid_procedural',
    'comet',
    'nebula',
    'brown_dwarf_binary',
    'star_mira',
    'star_ttauri',
  ];
  it.each(cases)('%s', (name) => {
    const b = build(name);
    let checked = 0;
    for (const which of ['texture', 'data'] as const) {
      if (!b[which]) continue;
      const sink = driveAlone(name, which);
      const made = [
        ...sink.events.map((e) => e.channel),
        ...sink.trains.filter((t) => t.params).map((t) => t.params!.channel),
      ];
      expect(made.length, `${name} ${which} made nothing`).toBeGreaterThan(0);
      for (const ch of made) expect(ch, `${name} ${which}`).toBe(which);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('TouchHaptics: moving gives texture, holding still gives the data pulse', () => {
  function rigGas() {
    const sink = new RecordingSink();
    const b = build('gas_giant', sink);
    return { sink, touch: new TouchHaptics(b) };
  }

  const at = (t: number, x = 0): TouchSample => sampleAt([0.2, 0.1, 1], { t, x });

  it('the data train starts only after HOLD_STILL_MS without moving', () => {
    const { sink, touch } = rigGas();
    touch.move(at(0));
    expect(sink.activeTrainId).not.toBe('data');
    touch.poll(HOLD_STILL_MS - 1);
    expect(touch.isHolding).toBe(false);
    touch.poll(HOLD_STILL_MS);
    expect(touch.isHolding).toBe(true);
    expect(sink.activeTrainId).toBe('data');
    expect(sink.current!.tag).toBe('measured');
  });

  it('jitter within the tolerance keeps holding; moving stops the pulse and texture resumes', () => {
    const { sink, touch } = rigGas();
    touch.move(at(0));
    touch.poll(HOLD_STILL_MS);
    touch.move(at(HOLD_STILL_MS + 10, HOLD_STILL_TOLERANCE_PX - 1));
    expect(sink.activeTrainId).toBe('data');
    touch.move(at(HOLD_STILL_MS + 20, HOLD_STILL_TOLERANCE_PX * 4));
    expect(touch.isHolding).toBe(false);
    expect(sink.activeTrainId).toBe('flow:jet');
  });

  it('release stops everything; a scrub source ignores the finger', () => {
    const { sink, touch } = rigGas();
    touch.move(at(0));
    touch.poll(HOLD_STILL_MS);
    touch.release();
    expect(sink.activeTrainId).toBeNull();

    const s2 = new RecordingSink();
    const t2 = new TouchHaptics(build('star_ttauri', s2));
    t2.move(at(0));
    t2.poll(HOLD_STILL_MS * 2);
    expect(s2.trains).toEqual([]);
    t2.scrub(1);
    expect(s2.activeTrainId).toBe('dimming');
    t2.release(); // finger up on the canvas does not stop the scrubber's pulse
    expect(s2.activeTrainId).toBe('dimming');
    t2.endScrub();
    expect(s2.activeTrainId).toBeNull();
  });

  it('the probe → sample → source path works with UV samples too', () => {
    const sink = new RecordingSink();
    const b = build('planet_water', sink);
    const touch = new TouchHaptics(b);
    for (let i = 0; i < 50; i++) touch.move(sampleUV(i / 50, 0.5, { t: i * 30, x: i * 10 }));
    expect(sink.events.length + sink.trains.length).toBeGreaterThan(0);
  });
});

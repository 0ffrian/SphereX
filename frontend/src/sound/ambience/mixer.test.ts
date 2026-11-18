// R13.11 test 9 (mixer.ts, FakeAudioContext): the node graph per bed, fades on the audio clock with stops on wall-clock
// timers (no ticks), no node per tick, dead bands, world crossfades on the group gain only, events, the harmonic tap,
// pan limits (the mono check, blue 14) and ducking through the shared bus.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FakeAudioContext,
  FakeFilter,
  FakeGain,
  FakeNode,
  FakeParam,
  FakePanner,
} from '@/test/fakeAudio';
import { getBus, holdDuck } from '../audioGraph';
import { earthAir } from './fakeEngine.testutil';
import { AmbienceMixer, type BufferSource } from './mixer';
import {
  EVENT_MAX,
  FADE_S,
  FADE_TAU_DIVISOR,
  GAIN_TAU_S,
  PAN_MAX,
  REBAKE_XFADE_S,
  SILENT_DB,
  STOP_MARGIN_S,
} from './tuning';
import type { BedLevel, MixFrame, SourceId, Strike } from './types';

const buf = (tag: string) => ({ tag }) as unknown as AudioBuffer;

function palette(
  entries: Record<string, AudioBuffer | null>,
): BufferSource & { set(k: string, b: AudioBuffer | null): void } {
  const m = new Map(Object.entries(entries));
  return {
    get: (id: SourceId, v: number) => m.get(`${id}|${v}`) ?? null,
    set: (k, b) => void m.set(k, b),
  };
}

function bed(id: SourceId, o: Partial<BedLevel> = {}): BedLevel {
  return {
    id,
    variant: 0,
    trueDb: 60,
    gainDb: -6,
    lowpassHz: 8000,
    shelfDb: 0,
    pan: 0.2,
    playbackRate: 1,
    harmonic: false,
    ...o,
  };
}

function frame(beds: BedLevel[], silent = false): MixFrame {
  return {
    beds,
    presentOffsetDb: 0,
    silent,
    caption: { line: '', heard: [], levelNote: null, silentReason: null },
  };
}

let ctx: FakeAudioContext;
let bus: FakeGain;

beforeEach(() => {
  vi.useFakeTimers();
  ctx = new FakeAudioContext();
  bus = ctx.createGain();
});
afterEach(() => vi.useRealTimers());

const mk = (o = {}) => new AmbienceMixer(ctx.asAudioContext(), bus as unknown as AudioNode, o);
const sources = () => ctx.sources();
const gainsInto = (n: FakeNode) => ctx.nodes.filter((x) => x.outputs.includes(n));

describe('AmbienceMixer graph', () => {
  it('builds source → lowpass → highshelf → gain → panner → worldGain → bus per bed', () => {
    const m = mk({ harmonic: false });
    m.setWorld('w1');
    m.apply(frame([bed('S5')]), palette({ 'S5|0': buf('sea') }));
    const [src] = sources();
    expect(src).toBeDefined();
    expect(src!.loop).toBe(true);
    const lp = src!.outputs[0] as FakeFilter;
    expect(lp.type).toBe('lowpass');
    const shelf = lp.outputs[0] as FakeFilter;
    expect(shelf.type).toBe('highshelf');
    const g = shelf.outputs[0] as FakeGain;
    expect(g.nodeType).toBe('gain');
    const pan = g.outputs[0] as FakePanner;
    expect(pan.nodeType).toBe('panner');
    const world = pan.outputs[0] as FakeGain;
    expect(world.outputs).toContain(bus);
    expect(src!.startAt).toBe(0);
  });

  it('works without StereoPanner (4 nodes per bed, centred)', () => {
    ctx = new FakeAudioContext({ stereoPanner: false });
    bus = ctx.createGain();
    const m = mk({ harmonic: false });
    m.setWorld('w1');
    m.apply(frame([bed('S5')]), palette({ 'S5|0': buf('sea') }));
    const g = sources()[0]!.outputs[0]!.outputs[0]!.outputs[0] as FakeGain;
    expect(g.outputs[0]!.outputs).toContain(bus);
    expect(m.stats().nodes).toBe(2 + 4);
  });

  it('a new voice starts silent (no pop) and ramps to its level', () => {
    const m = mk({ harmonic: false });
    m.setWorld('w1');
    m.apply(frame([bed('S5', { gainDb: -6 })]), palette({ 'S5|0': buf('sea') }));
    const g = sources()[0]!.outputs[0]!.outputs[0]!.outputs[0] as FakeGain;
    expect(g.gain.calls[0]).toEqual(['set', 0, 0]);
    expect(g.gain.targets.at(-1)!.v).toBeCloseTo(10 ** (-6 / 20));
    expect(g.gain.targets.at(-1)!.tau).toBe(GAIN_TAU_S);
  });

  it('creates no node per tick and writes nothing inside the dead band', () => {
    const m = mk({ harmonic: false });
    m.setWorld('w1');
    const p = palette({ 'S5|0': buf('sea'), 'S1_land|0': buf('wind') });
    m.apply(frame([bed('S5'), bed('S1_land')]), p);
    const n = ctx.nodes.length;
    const g = sources()[0]!.outputs[0]!.outputs[0]!.outputs[0] as FakeGain;
    const writes = g.gain.calls.length;
    for (let i = 0; i < 20; i++) m.apply(frame([bed('S5', { gainDb: -6.1 }), bed('S1_land')]), p);
    expect(ctx.nodes.length).toBe(n);
    expect(g.gain.calls.length).toBe(writes);
    m.apply(frame([bed('S5', { gainDb: -9 }), bed('S1_land')]), p);
    expect(g.gain.calls.length).toBe(writes + 1);
  });

  it('a bed with no buffer yet is skipped; when the palette has it (cached or new) it plays at once (C4)', () => {
    const m = mk({ harmonic: false });
    m.setWorld('w1');
    const p = palette({ 'S5|0': null });
    m.apply(frame([bed('S5')]), p);
    expect(sources()).toHaveLength(0);
    p.set('S5|0', buf('sea'));
    m.apply(frame([bed('S5')]), p);
    expect(sources()).toHaveLength(1);
  });

  it('a silent frame (no air at this height) drives every bed to linear 0', () => {
    const m = mk({ harmonic: false });
    m.setWorld('w1');
    const p = palette({ 'S5|0': buf('sea') });
    m.apply(frame([bed('S5')]), p);
    m.apply(frame([bed('S5')], true), p);
    const g = sources()[0]!.outputs[0]!.outputs[0]!.outputs[0] as FakeGain;
    expect(g.gain.targets.at(-1)!.v).toBe(0);
  });

  it('harmonic beds tap the harmonic branch; others do not', () => {
    const m = mk();
    m.setWorld('w1');
    m.apply(
      frame([bed('S1_land', { harmonic: true }), bed('S5')]),
      palette({ 'S1_land|0': buf('w'), 'S5|0': buf('s') }),
    );
    const [wind, sea] = sources();
    const gw = wind!.outputs[0]!.outputs[0]!.outputs[0] as FakeGain;
    const gs = sea!.outputs[0]!.outputs[0]!.outputs[0] as FakeGain;
    expect(gw.outputs).toHaveLength(2); // panner + harmonic group gain
    expect(gs.outputs).toHaveLength(1);
    expect(ctx.nodes.some((n) => n.nodeType === 'waveshaper')).toBe(true);
  });

  it('every pan write stays within ±PAN_MAX (mono safety, blue 14)', () => {
    const m = mk({ harmonic: false });
    m.setWorld('w1');
    const p = palette({ 'S5|0': buf('s') });
    m.apply(frame([bed('S5', { pan: 3 })]), p);
    m.apply(frame([bed('S5', { pan: -3 })]), p);
    const pan = sources()[0]!.outputs[0]!.outputs[0]!.outputs[0]!.outputs[0] as FakePanner;
    expect(Math.abs(pan.pan.value)).toBeLessThanOrEqual(PAN_MAX);
    for (const t of pan.pan.targets) expect(Math.abs(t.v)).toBeLessThanOrEqual(PAN_MAX);
  });

  it('never applies the master volume (the bus level does)', () => {
    const m = mk({ harmonic: false });
    m.setWorld('w1');
    m.apply(frame([bed('S5', { gainDb: 0 })]), palette({ 'S5|0': buf('s') }));
    const g = sources()[0]!.outputs[0]!.outputs[0]!.outputs[0] as FakeGain;
    expect(g.gain.targets.at(-1)!.v).toBeCloseTo(1);
  });
});

describe('AmbienceMixer fades (C1 to C3: audio clock + wall-clock stop, no ticks)', () => {
  const BUFS = { 'S5|0': buf('s'), 'S1_land|0': buf('w') };
  function playing() {
    const m = mk({ harmonic: false });
    m.setWorld('w1');
    m.apply(frame([bed('S5'), bed('S1_land')]), palette(BUFS));
    return m;
  }
  const worldGain = () => gainsInto(bus)[0] as FakeGain;

  it('fadeOut ramps only the group gain to silence with tau = FADE_S/7 and stops after the timer, with no tick', () => {
    const m = playing();
    const voiceGains = sources().map((s) => s.outputs[0]!.outputs[0]!.outputs[0] as FakeGain);
    const before = voiceGains.map((g) => g.gain.calls.length);
    m.fadeOut();
    const t = worldGain().gain.targets.at(-1)!;
    expect(t.v).toBe(0);
    expect(t.tau).toBeCloseTo(FADE_S / FADE_TAU_DIVISOR);
    // −61 dB at the stop: exp(-7) ≤ −60 dB
    expect(20 * Math.log10(Math.exp(-FADE_S / t.tau))).toBeLessThan(-60);
    expect(voiceGains.map((g) => g.gain.calls.length)).toEqual(before); // never a voice param (C2)
    expect(sources().every((s) => s.stopCalls === 0)).toBe(true); // no stop scheduled at fade start
    vi.advanceTimersByTime((FADE_S + STOP_MARGIN_S) * 1000 - 1);
    expect(sources().every((s) => s.stopCalls === 0)).toBe(true);
    vi.advanceTimersByTime(2);
    expect(sources().every((s) => s.stopCalls === 1 && s.disconnected)).toBe(true);
    expect(m.stats().groups).toBe(0);
  });

  it('coming back during the fade ramps the same group up; no new sources, nothing stopped (red M13)', () => {
    const m = playing();
    const n = ctx.nodes.length;
    m.fadeOut();
    vi.advanceTimersByTime(300);
    m.fadeIn();
    expect(worldGain().gain.targets.at(-1)!.v).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(sources().every((s) => s.stopCalls === 0)).toBe(true);
    m.apply(frame([bed('S5'), bed('S1_land')]), palette(BUFS));
    expect(ctx.nodes.length).toBe(n);
  });

  it('setWorld with the same key while its group fades fades it back in, with no new sources (m3)', () => {
    const m = playing();
    const n = ctx.nodes.length;
    m.fadeOut();
    vi.advanceTimersByTime(300);
    expect(m.playing).toBe(false);
    m.setWorld('w1');
    expect(m.playing).toBe(true);
    expect(worldGain().gain.targets.at(-1)!.v).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(sources().every((s) => s.stopCalls === 0)).toBe(true);
    m.apply(frame([bed('S5'), bed('S1_land')]), palette(BUFS));
    expect(ctx.nodes.length).toBe(n);
  });

  it('a quick A → B → A revives A while it still fades (m3)', () => {
    const m = playing();
    const a = worldGain();
    m.setWorld('w2');
    vi.advanceTimersByTime(200);
    m.setWorld('w1');
    expect(m.playing).toBe(true);
    expect(a.gain.targets.at(-1)!.v).toBe(1);
  });

  it('after a full fade the next apply rebuilds the beds from the palette at once', () => {
    const m = playing();
    m.fadeOut();
    vi.advanceTimersByTime(1000);
    m.apply(frame([bed('S5')]), palette({ 'S5|0': buf('s') }));
    expect(sources()).toHaveLength(3);
    expect(m.playing).toBe(true);
  });

  it('a world change crossfades on the group gains only and releases the old world (C5, red M11)', () => {
    const m = playing();
    const one = m.stats().nodes;
    const oldGroup = worldGain();
    for (let i = 2; i <= 6; i++) {
      m.setWorld(`w${i}`);
      m.apply(
        frame([bed('S5'), bed('S1_land')]),
        palette({ 'S5|0': buf(`s${i}`), 'S1_land|0': buf(`w${i}`) }),
      );
      vi.advanceTimersByTime((REBAKE_XFADE_S + STOP_MARGIN_S) * 1000 + 1);
    }
    expect(oldGroup.gain.targets.at(-1)).toMatchObject({
      v: 0,
      tau: REBAKE_XFADE_S / FADE_TAU_DIVISOR,
    });
    expect(m.stats().nodes).toBe(one);
    expect(m.stats().groups).toBe(1);
    // no param anywhere received a value curve (the overlap rule)
    for (const n of ctx.nodes) {
      for (const p of Object.values(n).filter((x): x is FakeParam => x instanceof FakeParam)) {
        expect(p.calls.some((c) => c[0] === 'curve')).toBe(false);
      }
    }
  });

  it('a change to a world with no beds still fades the old one (airless, red H5)', () => {
    const m = playing();
    m.setWorld('airless');
    m.apply(frame([]), palette({}));
    vi.advanceTimersByTime(2000);
    expect(sources().every((s) => s.stopCalls === 1)).toBe(true);
  });

  it('dispose twice is safe and stops everything', () => {
    const m = playing();
    m.dispose();
    m.dispose();
    expect(sources().every((s) => s.stopCalls >= 1)).toBe(true);
  });

  it('the ambience bus duck still applies under the mixer (holdDuck)', () => {
    const c = ctx.asAudioContext();
    const m = new AmbienceMixer(c, getBus(c, 'ambience'), { harmonic: false });
    m.setWorld('w1');
    m.apply(frame([bed('S5')]), palette({ 'S5|0': buf('s') }));
    const h = holdDuck(c);
    const duck = ctx.nodes
      .filter((n): n is FakeGain => n instanceof FakeGain)
      .find((g) => g.gain.calls.some((x) => x[0] === 'target' && x[1] < 0.5 && x[1] > 0.2));
    expect(duck).toBeDefined();
    h.release();
  });
});

describe('AmbienceMixer events (thunder)', () => {
  const strike = (o: Partial<Strike> = {}): Strike => ({
    t0: 10,
    d_m: 2000,
    bearing: Math.PI / 2,
    seed: 1,
    variant: 2,
    flash: true,
    ...o,
  });
  const air = earthAir();
  const opts = { nowS: 9.7, z_km: 0.3, head: 0 };
  function live() {
    const m = mk();
    m.setWorld('w1');
    const p = palette({ 'S5|0': buf('s'), 'thunder|2': buf('t2') });
    m.apply(frame([bed('S5')]), p);
    return { m, p };
  }

  it('plays at t0 + d/c on the audio clock through a 4-node chain into the group, tapping the harmonic group', () => {
    const { m, p } = live();
    ctx.currentTime = 5;
    expect(m.fire(strike(), air, p, opts)).toBe(true);
    const ev = sources().at(-1)!;
    expect(ev.startAt!).toBeGreaterThan(5 + 0.3 + 5.5); // 2 km at ~340 m/s ≈ 5.9 s
    expect(ev.startAt!).toBeLessThan(5 + 0.3 + 6.5);
    const gain = ev.outputs[0]!.outputs[0] as FakeGain;
    expect(gain.outputs).toHaveLength(2);
    ev.end();
    expect(ev.disconnected).toBe(true);
  });

  it('is not played when unbaked or further than THUNDER_MAX_DELAY_S', () => {
    const { m, p } = live();
    expect(m.fire(strike({ variant: 3 }), air, p, opts)).toBe(false);
    expect(m.fire(strike({ d_m: 20000 }), air, p, opts)).toBe(false);
  });

  it('never fires above the silence ceiling, even for a near strike (§11.7, PR #124 review N1)', () => {
    const { m, p } = live();
    const n = sources().length;
    for (const z_km of [100, 120, 400])
      expect(m.fire(strike({ d_m: 50 }), air, p, { ...opts, z_km })).toBe(false);
    expect(m.fire(strike({ d_m: 50 }), { ...air, airOK: false }, p, opts)).toBe(false);
    expect(sources().length).toBe(n);
    expect(m.stats().events).toBe(0);
    expect(m.fire(strike({ d_m: 50 }), air, p, { ...opts, z_km: 90 })).toBe(true); // just under the ~97 km ceiling
  });

  it('keeps at most EVENT_MAX live or pending', () => {
    const { m, p } = live();
    for (let i = 0; i < EVENT_MAX + 2; i++) m.fire(strike(), air, p, opts);
    expect(m.stats().events).toBe(EVENT_MAX);
  });

  it('fadeOut and a world change cancel pending thunder (red M10)', () => {
    const { m, p } = live();
    m.fire(strike(), air, p, opts);
    const ev = sources().at(-1)!;
    m.fadeOut();
    expect(ev.stopCalls).toBe(1);
    expect(ev.stopAt).toBe(0);
    expect(ev.disconnected).toBe(true);

    const b = live();
    b.m.fire(strike(), air, b.p, opts);
    const ev2 = sources().at(-1)!;
    b.m.setWorld('other');
    expect(ev2.disconnected).toBe(true);
  });

  it('thunder gain uses the stage window over the world offset, never above +6 dB', () => {
    const { m, p } = live();
    m.fire(strike({ d_m: 500 }), air, p, opts);
    const gain = sources().at(-1)!.outputs[0]!.outputs[0] as FakeGain;
    expect(gain.gain.value).toBeLessThanOrEqual(10 ** (6 / 20) + 1e-9);
    expect(gain.gain.value).toBeGreaterThan(0);
  });

  it('a silent bed level never lifts a voice', () => {
    const m = mk({ harmonic: false });
    m.setWorld('w1');
    m.apply(frame([bed('S5', { gainDb: SILENT_DB })]), palette({ 'S5|0': buf('s') }));
    const g = sources()[0]!.outputs[0]!.outputs[0]!.outputs[0] as FakeGain;
    expect(g.gain.targets).toHaveLength(0);
  });
});

// §14 main-thread mixer tick budget (≤ 1.0 ms at 10 Hz on the A15). Opt-in (blue 16): SX_AMB_BENCH=1 npx vitest run
// ambienceLoop.bench. The place comes from the §6.2 fixture pattern, so samplePlace's own cost (≈ 0.25 ms measured in
// #114 with ring reuse) is NOT included: add it to the median printed here. Measure on the A15 before the event.
import { describe, expect, it } from 'vitest';
import { FakeAudioContext } from '@/test/fakeAudio';
import { createAmbienceLoop, type PaletteLike } from './ambienceLoop';
import { earthAir, makePlace, makeWind, makeWorld } from './fakeEngine.testutil';
import { AmbienceMixer } from './mixer';
import type { WorldEngineWithSpinup } from './place';
import type { BedSpec } from './types';

const ON = typeof process !== 'undefined' && process.env.SX_AMB_BENCH === '1';

describe.skipIf(!ON)('ambience tick bench (§14)', () => {
  it('median tick on the Earth coast with every bed baked', () => {
    const ctx = new FakeAudioContext();
    const mixer = new AmbienceMixer(ctx.asAudioContext(), ctx.createGain() as unknown as AudioNode);
    let beds: BedSpec[] = [];
    const buf = {} as AudioBuffer;
    const palette: PaletteLike = {
      request: (b) => void (beds = b),
      get: (id, v) => (beds.some((s) => s.id === id && s.variant === v) ? buf : null),
      unavailable: () => [],
    };
    let clock = 0;
    const place = makePlace(0.05, ({ bearing }) => ({ cls: bearing > 1.6 && bearing < 4.7 ? 'sea' : 'land' }), {
      wind: makeWind({ U10: 9, Uz: 9 }),
      rainRate: 1,
      precipPhase: 'rain',
      cnv: 0.8,
      cnvRing: 0.8,
    });
    const e = { spinup: 0, state: () => ({ Ps: 1, fluid: 'water', gas: false, locked: false }) };
    const loop = createAmbienceLoop(
      {
        engine: () => e as unknown as WorldEngineWithSpinup,
        world: () => makeWorld(),
        palette: () => palette,
        mixer: () => mixer,
        publish: () => {},
        strike: () => {},
        onUi: () => {},
        clockS: () => clock,
        timers: { set: () => 0, clear: () => {} },
        buildAir: () => earthAir(),
        sample: () => place,
      },
      { entered: true, artistic: true, soundOn: true, ambienceOn: true, audioRunning: true },
    );
    const t: number[] = [];
    for (let i = 0; i < 600; i++) {
      clock += 0.1;
      loop.tick();
      if (i > 50) t.push(loop.lastTickMs());
    }
    t.sort((a, b) => a - b);
    const median = t[t.length >> 1]!;
    console.log(`ambience tick median ${median.toFixed(3)} ms, p95 ${t[Math.floor(t.length * 0.95)]!.toFixed(3)} ms (+ samplePlace)`);
    expect(median).toBeLessThan(1.0);
  });
});

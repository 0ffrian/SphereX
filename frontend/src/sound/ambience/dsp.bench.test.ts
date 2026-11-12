// @vitest-environment node
// §9.5, §14, §19 item 10: bake time per bed at full size (2^20). Opt-in: SX_BAKE_BENCH=1 npx vitest run dsp.bench.
// SX_BAKE_WAV=<dir> also writes each bed as 16-bit WAV for ear checks (dev only, D-13).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bakeBedDetailed } from './dsp';
import { BAKE_BUDGET_S } from './dspTuning';
import {
  ALL_LOOP_BEDS,
  EARTH_AIR,
  EARTH_PARAMS,
  TITAN_AIR,
  TITAN_MF,
  TITAN_RAIN_PITCH,
  spec,
} from './bakeFixtures.testutil';
import type { AirModel, BedSpec } from './types';

const ON = typeof process !== 'undefined' && process.env.SX_BAKE_BENCH === '1';
const WAV = typeof process !== 'undefined' ? process.env.SX_BAKE_WAV : undefined;

function wav(L: Float32Array, R: Float32Array, sr: number): Uint8Array {
  const n = L.length,
    buf = new ArrayBuffer(44 + n * 4),
    v = new DataView(buf);
  const str = (o: number, s: string) =>
    [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 4, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 4, true);
  const q = (x: number) => Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 4, q(L[i]!), true);
    v.setInt16(46 + i * 4, q(R[i]!), true);
  }
  return new Uint8Array(buf);
}

describe.skipIf(!ON)('bake bench (2^20)', () => {
  const specs: BedSpec[] = [
    ...ALL_LOOP_BEDS.map((id) => spec(id, 1 << 20)),
    spec('S8', 1 << 20, { variant: 1 }),
    spec('thunder', 1 << 20, { variant: 0 }),
    spec('thunder', 1 << 20, {
      variant: 1,
      params: { ...EARTH_PARAMS.thunder, d_m: 800, dur_s: 20.1, crack: 1 },
    }),
    spec('thunder', 1 << 20, {
      variant: 2,
      params: { ...EARTH_PARAMS.thunder, d_m: 5000, dur_s: 35, crack: 0 },
    }),
    spec('thunder', 1 << 20, {
      variant: 3,
      params: { ...EARTH_PARAMS.thunder, d_m: 12000, dur_s: 35, crack: 0 },
    }),
  ];
  // Worst cases (code review S7): heavy rain at rainPitch 2, and Titan-like rain and rough sea.
  const worst: [string, BedSpec, AirModel][] = [
    ['S6 rainPitch 2', spec('S6', 1 << 20, { params: { rainPitch: 2, mf: 1 } }), EARTH_AIR],
    [
      'S6 Titan',
      spec('S6', 1 << 20, { params: { rainPitch: TITAN_RAIN_PITCH, mf: TITAN_MF } }),
      TITAN_AIR,
    ],
    [
      'S5 Titan 2/s',
      spec('S5', 1 << 20, { params: { Hs_m: 2, Tp_s: 20, mf: TITAN_MF, whitecapRate_per_s: 2 } }),
      TITAN_AIR,
    ],
  ];
  it('logs ms and FFT count per bed', () => {
    const rows: string[] = [];
    let total = 0;
    for (const s of specs) {
      const out = bakeBedDetailed(s, EARTH_AIR);
      total += out.result.ms;
      rows.push(
        `${`${s.id}/${s.variant}`.padEnd(10)} ${out.result.ms.toFixed(0).padStart(6)} ms  ffts ${out.ffts}  ` +
          `lufs ${out.result.lufs.toFixed(2)}  peak ${out.peakDbfs.toFixed(1)} dBFS  ${out.notes.join('; ')}`,
      );
      if (WAV)
        writeFileSync(
          join(WAV, `${s.id}_${s.variant}.wav`),
          wav(out.result.L, out.result.R, s.sampleRate),
        );
      expect(out.result.ms).toBeLessThan(4 * BAKE_BUDGET_S * 1000);
    }
    rows.push(`Earth world total, serial in the worker: ${total.toFixed(0)} ms`);
    for (const [label, s, air] of worst) {
      const out = bakeBedDetailed(s, air);
      rows.push(
        `${label.padEnd(14)} ${out.result.ms.toFixed(0).padStart(6)} ms  ffts ${out.ffts}  ${out.notes.join('; ')}`,
      );
      expect(out.result.ms).toBeLessThan(4 * BAKE_BUDGET_S * 1000);
    }
    console.log(rows.join('\n'));
  }, 120_000);
});

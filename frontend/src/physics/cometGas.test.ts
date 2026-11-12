import { describe, expect, it } from 'vitest';
import type { ObjectCard } from '@/contract';
import {
  daysFromPerihelion,
  EPOCH_JD,
  gasRatesAt,
  h2oScaleLengthKm,
  haserShellFraction,
  hasKeyedEpochs,
  PERIHELION_JD,
  RATE_ANCHORS_BY_CARD,
  timeRange,
} from './cometGas';

const tv = (value: number, err?: number) => ({
  value,
  err,
  tag: 'measured' as const,
  source: 'test',
});
function card(over: Record<string, unknown> = {}): ObjectCard {
  return {
    id: 'c',
    name: 'c',
    type: 'comet',
    gas_Q: {
      '2025-08': { h2o: tv(3.2e26, 6.4e25), co2: tv(1.6e27), co: tv(1e26) },
      '2025-12': { h2o: tv(1.4e28), co2: tv(3e27), co: tv(7.6e27) },
    },
    ...over,
  } as unknown as ObjectCard;
}

describe('gasRatesAt (Q-262)', () => {
  it('gives the measured values inside an observing window', () => {
    const r = gasRatesAt(card(), EPOCH_JD['2025-08']).rates.find((x) => x.key === 'h2o')!;
    expect(r.value).toBe(3.2e26);
    expect(r.tag).toBe('measured');
    expect(r.err).toBe(6.4e25);
    expect(gasRatesAt(card(), EPOCH_JD['2025-12']).rates.find((x) => x.key === 'co')!.value).toBe(
      7.6e27,
    );
  });
  it('interpolates in log Q between the windows and calls it model_dependent', () => {
    const mid = (EPOCH_JD['2025-08'] + EPOCH_JD['2025-12']) / 2;
    const r = gasRatesAt(card(), mid).rates.find((x) => x.key === 'h2o')!;
    expect(r.value).toBeCloseTo(Math.sqrt(3.2e26 * 1.4e28), -20);
    expect(r.tag).toBe('model_dependent');
    expect(r.assumption).toMatch(/Nothing was observed/);
    expect(r.err).toBeNull();
  });
  it('refuses outside the two epochs and for a gas measured in one epoch only', () => {
    expect(gasRatesAt(card(), EPOCH_JD['2025-08'] - 30).rates).toEqual([]);
    const one = card({
      gas_Q: { '2025-08': { h2o: tv(3.2e26) }, '2025-12': { h2o: tv(1.4e28), co: tv(7.6e27) } },
    });
    const mid = (EPOCH_JD['2025-08'] + EPOCH_JD['2025-12']) / 2;
    const out = gasRatesAt(one, mid);
    expect(out.rates.map((r) => r.key)).toEqual(['h2o']);
    expect(out.refused.map((r) => r.key).sort()).toEqual(['co', 'co2']);
  });
  it('is deterministic and needs a card keyed by epoch', () => {
    expect(gasRatesAt(card(), 2460950)).toEqual(gasRatesAt(card(), 2460950));
    const flat = card({ gas_Q: { h2o: tv(1e26) }, epochs: ['2025-08'] });
    expect(hasKeyedEpochs(flat)).toBe(false);
    expect(timeRange(flat)).toBeNull();
    expect(timeRange(card())).toEqual({ startJd: EPOCH_JD['2025-08'], endJd: EPOCH_JD['2025-12'] });
  });
});

describe('SOHO/SWAN water near perihelion (3I/ATLAS)', () => {
  const atlas = () => card({ id: 'sbdb-1004083' });
  const swan = RATE_ANCHORS_BY_CARD['sbdb-1004083']![0]!;
  it('is a measured water point with its own instrument and the re-analysis in the note', () => {
    const r = gasRatesAt(atlas(), swan.jd).rates;
    const h2o = r.find((x) => x.key === 'h2o')!;
    expect(h2o.value).toBe(3.2e29);
    expect(h2o.tag).toBe('measured');
    expect(h2o.instrument).toBe('SOHO/SWAN');
    expect(h2o.source).toMatch(/arXiv:2512\.22354/);
    expect(h2o.source).toMatch(/arXiv:2601\.15443/);
    // CO2 and CO stay SPHEREx-only: interpolated between the two SPHEREx epochs.
    expect(r.find((x) => x.key === 'co2')!.kind).toBe('interpolated');
  });
  it('the water path rises to the perihelion peak instead of a straight Aug-Dec line', () => {
    const jd = (EPOCH_JD['2025-08'] + swan.jd) / 2;
    const withPeak = gasRatesAt(atlas(), jd).rates.find((x) => x.key === 'h2o')!.value;
    const straight = gasRatesAt(card(), jd).rates.find((x) => x.key === 'h2o')!.value;
    expect(withPeak).toBeCloseTo(Math.sqrt(3.2e26 * 3.2e29), -24);
    expect(withPeak).toBeGreaterThan(straight * 5);
    // At the SWAN date the old straight line was about 65 times too low. Another card id gets no anchor.
    const old = gasRatesAt(card(), swan.jd).rates.find((x) => x.key === 'h2o')!;
    expect(old.kind).toBe('interpolated');
    expect(swan.value / old.value).toBeGreaterThan(50);
    expect(swan.value / old.value).toBeLessThan(80);
  });
  it('perihelion is 2025-Oct-29.48 TDB (JPL)', () => {
    expect(PERIHELION_JD).toBe(2460977.98);
    expect(Math.round(daysFromPerihelion(swan.jd))).toBe(8);
  });
});

describe('Haser break-up of water', () => {
  it('scale length L = v tau r_h^2 with v = 0.85/sqrt(r_h) km/s and tau = 8.3e4 s', () => {
    expect(h2oScaleLengthKm(1)).toBeCloseTo(0.85 * 8.3e4, 6);
    expect(h2oScaleLengthKm(2.1)!).toBeGreaterThan(1.9e5);
    expect(h2oScaleLengthKm(2.1)!).toBeLessThan(2.3e5);
    expect(h2oScaleLengthKm(0)).toBeNull();
  });
  it('the share inside the coma is 1 for an infinite L and drops as L shrinks', () => {
    expect(haserShellFraction(0.03, 1, Infinity)).toBe(1);
    const big = haserShellFraction(0.03, 1, 2);
    const small = haserShellFraction(0.03, 1, 0.3);
    expect(big).toBeLessThan(1);
    expect(small).toBeLessThan(big);
    // Exact: L (e^{-a/L} - e^{-b/L}) / (b - a).
    expect(small).toBeCloseTo((0.3 * (Math.exp(-0.1) - Math.exp(-1 / 0.3))) / 0.97, 12);
  });
});

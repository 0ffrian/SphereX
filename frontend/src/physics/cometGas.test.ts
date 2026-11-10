import { describe, expect, it } from 'vitest';
import type { ObjectCard } from '@/contract';
import { EPOCH_JD, gasRatesAt, hasKeyedEpochs, timeRange } from './cometGas';

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

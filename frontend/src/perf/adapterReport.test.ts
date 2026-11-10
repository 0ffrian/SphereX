import { describe, expect, it, vi } from 'vitest';
import { describeAdapter, formatReport, NOT_REPORTED, probeAdapters } from './adapterReport';
import type { GpuLike, ThreeAdapterOptions } from './adapterReport';

function fakeAdapter(info: object, core = true, maxTex = 8192): GPUAdapter {
  return {
    info,
    features: new Set(core ? ['core-features-and-limits'] : []),
    limits: { maxTextureDimension2D: maxTex },
  } as unknown as GPUAdapter;
}

describe('describeAdapter', () => {
  it('turns empty strings into "not reported" and never guesses', () => {
    expect(describeAdapter({ vendor: 'v', architecture: '', device: '', description: '' })).toEqual(
      {
        vendor: 'v',
        architecture: NOT_REPORTED,
        device: NOT_REPORTED,
        description: NOT_REPORTED,
        isFallbackAdapter: false,
      },
    );
  });
});

describe('probeAdapters', () => {
  it('reports a missing navigator.gpu with a reason', async () => {
    const r = await probeAdapters(undefined);
    expect(r.webgpu).toEqual([]);
    expect(r.webgpuMissing).toContain('navigator.gpu missing');
  });

  it('first request is exactly three r187 call, then the two preferences in order', async () => {
    const requestAdapter = vi.fn((o?: ThreeAdapterOptions) =>
      Promise.resolve(fakeAdapter({ vendor: 'x', o })),
    );
    const r = await probeAdapters({ requestAdapter } as GpuLike);
    expect(requestAdapter.mock.calls[0]?.[0]).toEqual({
      powerPreference: undefined,
      featureLevel: 'compatibility',
      xrCompatible: false,
    });
    const prefs = requestAdapter.mock.calls.map((c) => c[0]?.powerPreference);
    expect(prefs).toEqual([undefined, 'low-power', 'high-performance']);
    expect(r.webgpu.map((p) => p.powerPreference)).toEqual([
      'default',
      'low-power',
      'high-performance',
    ]);
  });

  it('reports core-features-and-limits and the texture limit per adapter', async () => {
    const r = await probeAdapters({
      requestAdapter: async () => fakeAdapter({ vendor: 'x' }, false, 4096),
    });
    expect(r.webgpu[0]?.adapter).toMatchObject({
      coreFeaturesAndLimits: false,
      maxTextureDimension2D: 4096,
      vendor: 'x',
      device: NOT_REPORTED,
    });
  });

  it('records a null adapter and a throwing request', async () => {
    let n = 0;
    const r = await probeAdapters({
      requestAdapter: async () => {
        n += 1;
        if (n === 2) throw new Error('boom');
        return null;
      },
    });
    expect(r.webgpu[0]).toMatchObject({ adapter: null, note: 'requestAdapter returned null' });
    expect(r.webgpu[1]).toMatchObject({ adapter: null, note: 'boom' });
  });
});

describe('formatReport', () => {
  it('is stable for equal input', () => {
    const a = { b: 1, a: [1, 2] };
    expect(formatReport(a)).toBe(formatReport({ b: 1, a: [1, 2] }));
    expect(formatReport(a)).toBe(JSON.stringify(a, null, 2));
  });
});

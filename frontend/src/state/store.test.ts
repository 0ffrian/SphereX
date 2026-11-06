import { beforeEach, describe, expect, it } from 'vitest';
import type { ObjectCard, RenderParams } from '@/contract';
import { initialAppData, useAppStore } from './store';

// Minimal fixtures. Values are test data only, not physical claims.
const card: ObjectCard = { id: 'test-1', name: 'Test body', type: 'candidate' };
// An asteroid card, so the spin sliders (rot_period_h, bulk_density_kg_m3) apply to it.
const asteroid: ObjectCard = { id: 'test-2', name: 'Test asteroid', type: 'asteroid_shape' };
const params: RenderParams = {
  id: 'test-1',
  type: 'candidate',
  generator_version: 'test',
  seed: 1,
  scale_m: 1,
  layers: [],
  lighting: { mode: 'sun' },
  view_modes: {
    visible: { available: false, badge: 'Test', rgb: null, source: 'class_palette' },
  },
  haptics: {
    texture: 'none',
    texture_tag: 'artistic',
    data: 'none',
    data_tag: 'artistic',
    params: {},
  },
  alt_text: 'Test body',
  missing: ['mesh'],
};

describe('app store', () => {
  beforeEach(() => {
    useAppStore.setState(initialAppData);
  });

  it('starts empty, with no honesty default (Q-08)', () => {
    const s = useAppStore.getState();
    expect(s.card).toBeNull();
    expect(s.params).toBeNull();
    expect(s.honesty).toBeNull();
    expect(s.overrides).toEqual({});
    expect(s.rendererStatus).toBe('starting');
  });

  it('setObject stores card and params and clears overrides', () => {
    useAppStore.getState().setObject(asteroid, params);
    useAppStore.getState().setOverride('rot_period_h', 5);
    expect(useAppStore.getState().overrides).toEqual({ rot_period_h: 5 });
    useAppStore.getState().setObject(card, params);
    const s = useAppStore.getState();
    expect(s.card).toBe(card);
    expect(s.params).toBe(params);
    expect(s.overrides).toEqual({});
  });

  it('keeps overrides apart from the card, and Reset restores the data values (D-02)', () => {
    useAppStore.getState().setObject(asteroid, params);
    useAppStore.getState().setOverride('rot_period_h', 5);
    useAppStore.getState().setOverride('bulk_density_kg_m3', 2000);
    expect(useAppStore.getState().overrides).toEqual({ rot_period_h: 5, bulk_density_kg_m3: 2000 });
    expect(useAppStore.getState().card).toEqual(asteroid);

    useAppStore.getState().resetOverrides();
    expect(useAppStore.getState().overrides).toEqual({});
    expect(useAppStore.getState().card).toEqual(asteroid);
  });

  it('setOverride stores only valid values for the loaded type (D-27)', () => {
    useAppStore.getState().setOverride('rot_period_h', 5); // no card loaded
    expect(useAppStore.getState().overrides).toEqual({});

    useAppStore.getState().setObject(asteroid, params);
    useAppStore.getState().setOverride('rot_period_h', Number.NaN);
    useAppStore.getState().setOverride('bulk_density_kg_m3', 1e9); // out of range
    useAppStore.getState().setOverride('zonal_wind_ms', 50); // gas giants only
    expect(useAppStore.getState().overrides).toEqual({});
  });

  it('setOverride(key, undefined) clears one slider and keeps the others', () => {
    useAppStore.getState().setObject(asteroid, params);
    useAppStore.getState().setOverride('rot_period_h', 5);
    useAppStore.getState().setOverride('bulk_density_kg_m3', 2000);
    useAppStore.getState().setOverride('rot_period_h', undefined);
    expect(useAppStore.getState().overrides).toEqual({ bulk_density_kg_m3: 2000 });
  });

  it('sets each honesty state', () => {
    for (const h of ['measured', 'derived', 'artistic'] as const) {
      useAppStore.getState().setHonesty(h);
      expect(useAppStore.getState().honesty).toBe(h);
    }
  });

  it('clearObject empties card, params and overrides', () => {
    useAppStore.getState().setObject(asteroid, params);
    useAppStore.getState().setOverride('rot_period_h', 5);
    useAppStore.getState().clearObject();
    const s = useAppStore.getState();
    expect(s.card).toBeNull();
    expect(s.params).toBeNull();
    expect(s.overrides).toEqual({});
  });

  it('records the renderer status', () => {
    useAppStore.getState().setRendererStatus('webgl2');
    expect(useAppStore.getState().rendererStatus).toBe('webgl2');
  });
});

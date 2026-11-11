import { describe, expect, it } from 'vitest';
import {
  altToSlider,
  sliderToAlt,
  worldNotes,
  WORLD_HONESTY,
  WORLD_NOTE_LINES,
} from './WorldEngineStage';
import { useWorldStore } from './worldStore';
import { cardToWorld } from '@/engine/worlds/cardToWorld';
import type { ObjectCard } from '@/contract';

describe('altitude slider', () => {
  it('maps the artifact range logarithmically and back', () => {
    const r: [number, number] = [0.3, 3000];
    expect(altToSlider(0.3, r)).toBe(0);
    expect(altToSlider(3000, r)).toBe(1000);
    expect(sliderToAlt(altToSlider(400, r), r)).toBeCloseTo(400, -1);
    const g: [number, number] = [50, 80000];
    expect(sliderToAlt(0, g)).toBeCloseTo(50, 5);
  });
});

describe('notes', () => {
  it('carry the artifact list and its honesty line, then what was filled in', () => {
    const card = {
      id: 'x-planet',
      name: 'X b',
      type: 'planet_rocky',
      radius_rjup: { value: 0.1, tag: 'measured' },
      mass_mearth: { value: 1, tag: 'measured' },
      orbit_au: { value: 0.05, tag: 'measured' },
      orbital_period_d: { value: 5, tag: 'measured' },
      host_teff_K: { value: 3000, tag: 'measured' },
      host_radius_rsun: { value: 0.2, tag: 'measured' },
      host_mass_msun: { value: 0.2, tag: 'measured' },
      rot_period_h: { value: 120, tag: 'measured' },
    } as unknown as ObjectCard;
    const w = cardToWorld(card);
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const n = worldNotes(w);
    expect(n[0]!.lines).toBe(WORLD_NOTE_LINES);
    expect(n[0]!.placeholder).toBe(WORLD_HONESTY);
    expect(n[1]!.title).toBe('Filled in, not measured');
    expect(n[1]!.lines.some((l) => l.startsWith('fluid = water'))).toBe(true);
  });
});

describe('world store', () => {
  it('applies a change to both canvases and remembers it for a close-up that opens later', () => {
    const calls: string[] = [];
    const fake = (name: string) =>
      ({
        setOverrides: (o: object) => calls.push(`${name}:${JSON.stringify(o)}`),
        state: () => ({ gas: false }),
        spinup: 0,
        draw: () => calls.push(`${name}:draw`),
        playing: true,
      }) as never;
    const st = useWorldStore.getState();
    st.setGlobe(fake('g'));
    st.setFly(fake('f'));
    useWorldStore.getState().apply({ Tstar: 3000 });
    expect(calls).toEqual(['g:{"Tstar":3000}', 'f:{"Tstar":3000}', 'g:draw', 'f:draw']);
    expect(useWorldStore.getState().applied).toEqual({ Tstar: 3000 });
    useWorldStore.getState().setGlobe(null);
    useWorldStore.getState().setFly(null);
  });
  it('a click on the globe carries a new sequence number each time', () => {
    useWorldStore.getState().pick(1, 0.5);
    const a = useWorldStore.getState().target!.seq;
    useWorldStore.getState().pick(1, 0.5);
    expect(useWorldStore.getState().target!.seq).toBe(a + 1);
  });
});

// The 3D viewer panel with a fake renderer (no GPU): controls, legend, badges, refused layers,
// canvas label and live announcements (R5.3, R7.3, R9, D-02, D-21).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialAppData, useAppStore } from '@/state/store';
import { fixture } from '@/test/sharedFixtures';
import type { RenderPlan } from '@/viewer/planTypes';
import { CANDIDATE_MESSAGE } from '@/viewer/renderPlan';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const shown: RenderPlan[] = [];
const fake = {
  backend: 'webgl2' as const,
  showPlan: vi.fn((p: RenderPlan) => void shown.push(p)),
  clearObject: vi.fn(),
  setLoadFailedHandler: vi.fn(),
  setMeshMeasuredHandler: vi.fn(),
  setCloseUpHandler: vi.fn(),
  openCloseUp: vi.fn(),
  closeUpOff: vi.fn(),
  requestRender: vi.fn(),
  pickGlobe: vi.fn(),
  orbitView: null,
  setOverrides: vi.fn(),
  setSpinPaused: vi.fn(),
  setMotionOverride: vi.fn(),
  setQualityChangeHandler: vi.fn(),
  setIdleChangeHandler: vi.fn(),
  resumeFromIdle: vi.fn(),
  timeLapses: vi.fn(() => []),
  rotate: vi.fn(),
  zoom: vi.fn(),
  resetView: vi.fn(),
  setStarCloseUp: vi.fn(),
  latestFlareText: vi.fn(() => null),
  fireFlare: vi.fn(),
  setFieldLines: vi.fn(),
  setEngineOwned: vi.fn(),
  dispose: vi.fn(),
};

// The star engine needs WebGL 2 (absent in jsdom): a test can hand the panel a star the engine "draws".
const engine = vi.hoisted(() => ({ star: null as unknown, pane: false }));
vi.mock('./StarEngineStage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./StarEngineStage')>();
  return {
    ...actual,
    useEngineStar: () => engine.star,
    StarGlobeStage: () => <div data-testid="star-engine-stub" />,
  };
});

vi.mock('@/viewer/ViewerApp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/viewer/ViewerApp')>();
  // In the build pane the panel calls many more viewer methods: a test that mounts it there asks for a
  // fake that answers every other method with a no-op (never `then`: the fake is awaited).
  const noop = new Map<string, () => void>();
  const paneFake = () =>
    new Proxy(fake, {
      get: (t, k) =>
        k in t || typeof k !== 'string' || !/^set[A-Z]/.test(k)
          ? (t as Record<string | symbol, unknown>)[k]
          : (noop.get(k) ?? noop.set(k, () => {}).get(k)),
    });
  return { ...actual, ViewerApp: { create: vi.fn(async () => (engine.pane ? paneFake() : fake)) } };
});

// Imported after the mock is registered (vi.mock is hoisted).
import { ageFromLog, IR_JETS_HINT, ViewerPanel } from './ViewerPanel';

let container: HTMLDivElement;
let root: Root;

async function mount() {
  await act(async () => {
    root.render(<ViewerPanel />);
  });
  await act(async () => {}); // let ViewerApp.create resolve
}

const text = (id: string) => container.querySelector(`[data-testid="${id}"]`)?.textContent ?? '';
const button = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === name) as
    HTMLButtonElement | undefined;
const click = async (name: string) => {
  const b = button(name);
  expect(b, `button "${name}"`).toBeDefined();
  await act(async () => {
    b!.click();
  });
};
const canvasLabel = () => container.querySelector('canvas')?.getAttribute('aria-label') ?? '';

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  useAppStore.setState(initialAppData);
  shown.length = 0;
  engine.star = null;
  engine.pane = false;
  Object.values(fake).forEach((f) => typeof f === 'function' && 'mockClear' in f && f.mockClear());
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('ViewerPanel', () => {
  it('mounts the prototype engines only at + Artistic; below it the three.js viewer draws (PR #89 review)', async () => {
    const { card, params } = fixture('star');
    engine.pane = true;
    engine.star = {
      preset: { id: card.id, label: card.name, T: 5772, R: 1, M: 1, P: 25.4, dwarf: true },
    };
    useAppStore.getState().setObject(card, params);
    const stub = () => container.querySelector('[data-testid="star-engine-stub"]');
    const pane = { seq: 0, animate: false, seedOffset: 0 };
    useAppStore.getState().setHonesty('derived');
    await act(async () => {
      root.render(<ViewerPanel pane={pane} />);
    });
    await act(async () => {});
    expect(stub()).toBeNull();
    expect(fake.setEngineOwned).not.toHaveBeenCalledWith(true);
    expect(fake.setEngineOwned).toHaveBeenLastCalledWith(false);
    await act(async () => useAppStore.getState().setHonesty('artistic'));
    expect(stub()).not.toBeNull();
    expect(fake.setEngineOwned).toHaveBeenLastCalledWith(true);
    await act(async () => useAppStore.getState().setHonesty('measured'));
    expect(stub()).toBeNull();
    expect(fake.setEngineOwned).toHaveBeenLastCalledWith(false);
  });

  it('announces a governor tier drop in plain words, but not a manual tier change', async () => {
    await mount();
    const handler = fake.setQualityChangeHandler.mock.calls.at(-1)?.[0] as
      ((e: { from: string; to: string; auto: boolean }) => void) | null | undefined;
    expect(handler).toBeTypeOf('function');
    await act(async () => handler!({ from: 'high', to: 'medium', auto: false }));
    expect(text('viewer-announcer')).toBe('');
    await act(async () => handler!({ from: 'high', to: 'medium', auto: true }));
    expect(text('viewer-announcer')).toBe('Lowered render quality to keep motion smooth');
  });

  it('says where each time-lapse rate comes from, not that the speed-up was measured', async () => {
    const { card, params } = fixture('star');
    useAppStore.getState().setObject(card, params);
    useAppStore.getState().setHonesty('artistic');
    await mount();
    const notes = [...container.querySelectorAll('[data-testid="time-lapse-note"]')].map(
      (e) => e.textContent,
    );
    expect(notes).toEqual([
      'Spin: period taken from a typical value; shown 86,400\u00d7 faster.',
      'Spot changes: lifetime worked out with a model; shown 86,400\u00d7 faster.',
      'Flares: rate taken from a typical value; shown 86,400\u00d7 faster.',
    ]);
    expect(container.textContent).not.toMatch(/sped up/);
  });

  it('a star opens in True colour (Q-290); Close-up from Observatory moves to Enhanced colour and the camera follows', async () => {
    const { card, params } = fixture('star');
    useAppStore.getState().setObject(card, params);
    useAppStore.getState().setHonesty('artistic');
    await mount();
    const pressed = (n: string) => button(n)?.getAttribute('aria-pressed');
    expect(pressed('True colour')).toBe('true');
    expect(pressed('Whole star, larger detail')).toBe('true');
    await click('Observatory view');
    expect(pressed('Observatory view')).toBe('true');
    await click('Close-up');
    expect(pressed('Enhanced colour')).toBe('true');
    expect(pressed('Observatory view')).toBe('false');
    expect(fake.setStarCloseUp).toHaveBeenLastCalledWith(
      expect.objectContaining({ halfWidth: expect.any(Number) }),
    );
    expect(text('viewer-announcer')).toMatch(/Enhanced colour.*Close-up/);
    await click('Whole star, true scale');
    expect(fake.setStarCloseUp).toHaveBeenLastCalledWith(null);
    expect(container.querySelector('[data-testid="star-readouts"]')?.textContent).toMatch(
      /Surface gravity/,
    );
  });

  it('shows no note for a process whose layer is not drawn (Measured only)', async () => {
    const { card, params } = fixture('star');
    useAppStore.getState().setObject(card, params);
    useAppStore.getState().setHonesty('measured');
    await mount();
    expect(container.querySelector('[data-testid="time-lapse-note"]')).toBeNull();
    expect(button('Pause motion')).toBeUndefined();
  });

  it('a brown dwarf in the infrared view hints that the visible view moves, and only then', async () => {
    const { card, params } = fixture('brown_dwarf');
    useAppStore.getState().setObject(card, params);
    useAppStore.getState().setHonesty('artistic'); // the jets are an artist's layer (R7.4)
    await mount();
    const region = () => container.querySelector('[data-testid="ir-jets-hint"]');
    // Opens in the infrared view.
    expect(canvasLabel()).toContain('SPHEREx infrared');
    expect(region()?.getAttribute('role')).toBe('status');
    expect(region()?.getAttribute('aria-live')).toBe('polite');
    expect(text('ir-jets-hint')).toBe(IR_JETS_HINT);
    expect(button('Visible colour')?.getAttribute('aria-describedby')).toBe('ir-jets-hint');
    expect(text('ir-jets-hint')).not.toMatch(/\b[RAQD]-?\d/);
    // Visible view draws the jets: the region stays, the text goes.
    await click('Visible colour');
    expect(button('Visible colour')?.hasAttribute('aria-describedby')).toBe(false);
    expect(region()).not.toBeNull();
    expect(text('ir-jets-hint')).toBe('');
    // Back to infrared: the hint returns. At the default level the visible view would not draw
    // the jets either (the layer is hidden), so there is nothing to switch for.
    await click('SPHEREx infrared');
    expect(text('ir-jets-hint')).toBe(IR_JETS_HINT);
    await click('+ Estimated');
    expect(text('ir-jets-hint')).toBe('');
    // Another type in the infrared view: no hint.
    const other = fixture('asteroid_shape');
    useAppStore.getState().setObject(other.card, other.params);
    await act(async () => {});
    await click('SPHEREx infrared');
    expect(text('ir-jets-hint')).toBe('');
  });

  it('shows no hint when the brown dwarf jets are refused for missing methane depth', async () => {
    const { card, params } = fixture('brown_dwarf');
    const noDepth = { ...card, ch4_depth_33: undefined } as typeof card;
    useAppStore.getState().setObject(noDepth, params);
    useAppStore.getState().setHonesty('artistic');
    await mount();
    expect(canvasLabel()).toContain('SPHEREx infrared');
    expect(text('ir-jets-hint')).toBe('');
  });

  it('shows no hint when the brown dwarf body is refused, since the visible view draws nothing', async () => {
    const { card, params } = fixture('brown_dwarf');
    const noSize = { ...card, radius_rjup: undefined } as typeof card;
    useAppStore.getState().setObject(noSize, params);
    useAppStore.getState().setHonesty('artistic');
    await mount();
    expect(text('ir-jets-hint')).toBe('');
  });

  it('shows no hint when the visible mode is unavailable, since there is nothing to switch to', async () => {
    const { card, params } = fixture('brown_dwarf');
    const noVisible = {
      ...params,
      view_modes: {
        ...params.view_modes,
        visible: { ...params.view_modes.visible, available: false },
      },
    } as typeof params;
    useAppStore.getState().setObject(card, noVisible);
    useAppStore.getState().setHonesty('artistic');
    await mount();
    expect(canvasLabel()).toContain('SPHEREx infrared');
    expect(text('ir-jets-hint')).toBe('');
  });

  it('shows the placeholder when no object is loaded', async () => {
    await mount();
    expect(container.textContent).toContain('Viewer placeholder: no object loaded');
    expect(canvasLabel()).toContain('no object loaded');
    expect(container.querySelector('[role="group"][aria-label="Honesty level"]')).toBeNull();
  });

  it('starts at + Estimated and gives each layer a badge, with refused layers in plain words', async () => {
    const { card, params } = fixture('asteroid_procedural');
    useAppStore.getState().setObject(card, params);
    await mount();
    expect(button('+ Estimated')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Measured only')?.getAttribute('aria-pressed')).toBe('false');
    const badges = [
      ...container.querySelectorAll('[data-testid="legend"] [data-testid="provenance-badge"]'),
    ];
    expect(badges.length).toBeGreaterThan(0);
    expect(badges.map((b) => b.textContent)).toEqual(expect.arrayContaining(['Estimated']));
    expect(text('missing-list')).toContain(
      'Surface relief: hidden at this level. This layer is marked “Default”.',
    );
    expect(text('missing-list')).toContain('Switch to “+ Artistic”');
    expect(canvasLabel()).toContain(card.name);
    expect(shown.at(-1)?.honesty).toBe('derived');
  });

  it('Measured only draws nothing but measured layers, updates the label and announces it', async () => {
    const { card, params } = fixture('asteroid_shape');
    useAppStore.getState().setObject(card, params);
    await mount();
    const before = canvasLabel();
    await click('Measured only');
    expect(useAppStore.getState().honesty).toBe('measured');
    const last = shown.at(-1)!;
    expect(last.drawn.every((l) => l.tag === 'measured')).toBe(true);
    // The fixtures are synthetic, so a measured tag reads "Fixture", never "Measured" (A11, Q-32).
    for (const li of container.querySelectorAll(
      '[data-testid="legend"] [data-testid="provenance-badge"]',
    )) {
      expect(li.textContent).toBe('Fixture');
    }
    expect(canvasLabel()).not.toBe(before);
    expect(text('viewer-announcer')).toMatch(/^Measured only\./);
  });

  it('changing the view mode updates the label and announces it', async () => {
    const { card, params } = fixture('asteroid_shape');
    useAppStore.getState().setObject(card, params);
    await mount();
    await click('SPHEREx infrared');
    expect(button('SPHEREx infrared')?.getAttribute('aria-pressed')).toBe('true');
    expect(canvasLabel()).toContain('SPHEREx infrared false colour');
    expect(text('viewer-announcer')).toMatch(/^SPHEREx infrared view\./);
  });

  it('disables a mode that is not available and says why in the list', async () => {
    const { card, params } = fixture('comet');
    useAppStore.getState().setObject(card, params);
    await mount();
    expect(button('Visible colour')?.disabled).toBe(true);
    expect(text('missing-list')).toContain('Visible-colour view: not drawn.');
  });

  it('the comet has an epoch toggle that changes the shells and is announced', async () => {
    const { card, params } = fixture('comet');
    useAppStore.getState().setObject(card, params);
    await mount();
    // Opens on the latest epoch that has gas data (August), not on a bare dot (N1).
    expect(shown.at(-1)?.epoch).toBe('2025-08');
    expect(button('Aug 2025')?.getAttribute('aria-pressed')).toBe('true');
    await click('Aug 2025');
    expect(shown.at(-1)?.epoch).toBe('2025-08');
    expect(shown.at(-1)?.shells).toHaveLength(3);
    expect(text('viewer-announcer')).toMatch(/^August 2025\. Gas shells: CO₂, H₂O, CO\./);
    // The toggle says which epoch has no gas data.
    expect(button('Dec 2025(no gas data)')).toBeDefined();
    await click('Dec 2025(no gas data)');
    expect(shown.at(-1)?.shells).toHaveLength(0); // the fixture card holds August Q only
    expect(text('missing-list')).toContain(
      'Gas shells: not drawn for December 2025. The card has no gas measurements for this epoch.',
    );
  });

  it('shows the scale bar with a comparison', async () => {
    const { card, params } = fixture('asteroid_shape');
    useAppStore.getState().setObject(card, params);
    await mount();
    expect(text('scale-bar')).toContain('16.8 km long');
    expect(text('scale-bar')).toContain('Le Morne Brabant');
  });

  it('a candidate shows the R7.6 message, no view-mode or epoch controls, and no scale bar', async () => {
    const { card, params } = fixture('candidate');
    useAppStore.getState().setObject(card, params);
    await mount();
    expect(text('viewer-message')).toBe(CANDIDATE_MESSAGE);
    expect(container.querySelector('[role="group"][aria-label="View mode"]')).toBeNull();
    expect(container.querySelector('[data-testid="scale-bar"]')).toBeNull();
  });

  it('shows what happens when nothing can be drawn at the chosen level', async () => {
    const { card, params } = fixture('brown_dwarf');
    useAppStore.getState().setObject(card, params);
    useAppStore.getState().setHonesty('measured');
    await mount();
    expect(container.querySelector('[data-testid="viewer-nothing"]')).not.toBeNull();
    expect(text('missing-list')).toContain('hidden at this level');
  });

  it('names the cause when nothing is drawn, and the level that would show it', async () => {
    const { card, params } = fixture('brown_dwarf');
    useAppStore.getState().setObject(card, params);
    useAppStore.getState().setHonesty('measured');
    await mount();
    expect(text('viewer-nothing')).toContain('Its size is only an estimate');
    expect(text('viewer-nothing')).toContain('“+ Estimated”');
    expect(canvasLabel()).toContain('Nothing is drawn');
    expect(canvasLabel()).not.toContain('R to reset');
  });

  it('a comet nucleus is read out as an upper limit in the scale bar and the label', async () => {
    const { card, params } = fixture('comet');
    useAppStore.getState().setObject(card, params);
    await mount();
    expect(text('scale-bar')).toContain('At most 2 km long (upper limit)');
    expect(text('scale-bar')).toContain('at most about');
    expect(canvasLabel()).toContain('at most 2 km long (upper limit');
    expect(canvasLabel()).not.toMatch(/, 2 km long/);
  });

  it('an estimated size gives its formula, assumption or source: tooltip, text and a Why button (B4)', async () => {
    const { card, params } = fixture('brown_dwarf');
    card.radius_rjup = {
      value: 1,
      tag: 'model_dependent',
      source: 'test',
      assumption: 'Brown dwarf radii are about 1 Jupiter radius.',
    };
    useAppStore.getState().setObject(card, params);
    await mount();
    const badge = container.querySelector(
      '[data-testid="scale-bar"] [data-testid="provenance-badge"]',
    )!;
    expect(badge.getAttribute('title')).toBe('Brown dwarf radii are about 1 Jupiter radius.');
    expect(badge.querySelector('.sr-only')?.textContent).toContain('about 1 Jupiter radius');
    expect(container.querySelector('[data-testid="size-why"]')).toBeNull();
    await click('Why this size?');
    expect(text('size-why')).toBe('Brown dwarf radii are about 1 Jupiter radius.');
    expect(button('Why this size?')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('the legend shows plain layer names, with the formula behind a disclosure', async () => {
    const { card, params } = fixture('asteroid_procedural');
    useAppStore.getState().setObject(card, params);
    await mount();
    const legend = container.querySelector('[data-testid="legend"]')!;
    expect(legend.textContent).toContain('Surface brightness map');
    const visible = [...legend.querySelectorAll('li > span')].map((e) => e.textContent).join(' ');
    expect(visible).not.toMatch(/clamp\(|\(R\d/);
    expect(legend.querySelector('details')).not.toBeNull();
    expect(container.textContent).toContain('Default: the artist’s choice');
  });

  it('a display default is listed with a Default chip, not as "not drawn"', async () => {
    const { card, params } = fixture('asteroid_shape');
    delete params.lighting.phase_angle_deg;
    delete params.lighting.sun_dir;
    useAppStore.getState().setObject(card, params);
    await mount();
    expect(text('default-list')).toContain('Sun direction: shown as a default');
    expect(
      container.querySelector('[data-testid="default-list"] [data-tag="artistic"]'),
    ).not.toBeNull();
    expect(text('missing-list')).not.toContain('Sun direction');
  });

  it('one pause control for all motion, shown whenever something is a time-lapse (WCAG 2.2.2)', async () => {
    // A Mira (pulsation only) has no spin and still gets the control.
    const { card, params } = fixture('star_mira');
    useAppStore.getState().setObject(card, params);
    useAppStore.getState().setHonesty('artistic');
    await mount();
    expect(button('Pause motion')?.hasAttribute('aria-pressed')).toBe(false);
    expect(button('Pause spin')).toBeUndefined();
    await click('Pause motion');
    expect(fake.setSpinPaused).toHaveBeenLastCalledWith(true);
    expect(text('motion-status')).toContain('Motion is paused');
    await click('Play motion');
    expect(fake.setSpinPaused).toHaveBeenLastCalledWith(false);
  });

  it('no time-lapse, no pause control', async () => {
    const { card, params } = fixture('star_mira'); // the pulsation is hidden at the default level
    useAppStore.getState().setObject(card, params);
    await mount();
    expect(button('Pause motion')).toBeUndefined();
    expect(button('Play motion')).toBeUndefined();
  });

  it('under reduced motion the control stays and starts as Play motion (R9, WCAG 2.2.2)', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q === '(prefers-reduced-motion: reduce)',
      addEventListener() {},
      removeEventListener() {},
    }));
    try {
      const { card, params } = fixture('asteroid_shape');
      card.shape_source = { value: '/meshes/bennu.glb', tag: 'measured', source: 'test' };
      useAppStore.getState().setObject(card, params);
      await mount();
      expect(button('Play motion')?.hasAttribute('aria-pressed')).toBe(false);
      expect(text('motion-status')).toContain('reduced motion');
      await click('Play motion');
      expect(fake.setMotionOverride).toHaveBeenLastCalledWith(true);
      expect(button('Pause motion')).toBeDefined();
      await click('Pause motion');
      expect(fake.setMotionOverride).toHaveBeenLastCalledWith(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reduced motion, Play motion, then an idle pause: the button and status show the pause', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q === '(prefers-reduced-motion: reduce)',
      addEventListener() {},
      removeEventListener() {},
    }));
    try {
      const { card, params } = fixture('asteroid_shape');
      card.shape_source = { value: '/meshes/bennu.glb', tag: 'measured', source: 'test' };
      useAppStore.getState().setObject(card, params);
      await mount();
      await click('Play motion');
      expect(button('Pause motion')).toBeDefined();
      expect(text('motion-status')).toContain('Motion is playing');
      const idle = fake.setIdleChangeHandler.mock.calls.at(-1)?.[0] as (i: boolean) => void;
      await act(async () => idle(true));
      expect(button('Play motion')).toBeDefined();
      expect(button('Pause motion')).toBeUndefined();
      expect(text('motion-status')).toContain('paused after a minute');
      await click('Play motion');
      expect(fake.resumeFromIdle).toHaveBeenCalled();
      // The reduced-motion override stays on (the user asked for motion).
      expect(fake.setMotionOverride).toHaveBeenLastCalledWith(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the light-curve slider is not announced a second time by the live region', async () => {
    const { card, params } = fixture('star_mira');
    card.lightcurve = [
      { t_mjd: 60000, flux: 10, sigma: 1, lambda_um: 1, flags: 0 },
      { t_mjd: 60010, flux: 2, sigma: 1, lambda_um: 1, flags: 0 },
    ];
    useAppStore.getState().setObject(card, params);
    await mount();
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider.getAttribute('aria-valuetext')).toContain('2023-02-25');
    expect(container.textContent).not.toMatch(/MJD/);
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(slider, '1');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(shown.at(-1)?.scrub?.index).toBe(1);
    expect(text('viewer-announcer')).toBe('');
  });

  it('a new object starts from its own epoch, not the last one chosen', async () => {
    const a = fixture('comet');
    useAppStore.getState().setObject(a.card, a.params);
    await mount();
    await click('Dec 2025(no gas data)');
    expect(shown.at(-1)?.epoch).toBe('2025-12');
    const b = fixture('comet');
    b.params.id = 'fixture:comet-2';
    await act(async () => {
      useAppStore.getState().setObject(b.card, b.params);
    });
    expect(shown.at(-1)?.epoch).toBe('2025-08');
  });

  it('every control is at least 24 px (44 px by class)', async () => {
    const { card, params } = fixture('comet');
    useAppStore.getState().setObject(card, params);
    await mount();
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.length).toBeGreaterThan(8);
    for (const b of buttons) expect(b.className).toMatch(/min-h-11/);
  });
});

describe('ViewerPanel: remnant age slider (issue #43)', () => {
  const setNova = () => {
    const { card, params } = fixture('nova');
    useAppStore.getState().setObject(card, params);
  };
  const slider = () => container.querySelector('input[type="range"]') as HTMLInputElement | null;

  it('is hidden while the remnant is hidden, shown at + Artistic, with a stable name, value text and badge', async () => {
    setNova();
    await mount();
    expect(slider()).toBeNull(); // + Estimated: the remnant is an artist's impression, not drawn
    await click('+ Artistic');
    const input = slider()!;
    expect(input).not.toBeNull();
    expect(input.className).toMatch(/min-h-11/);
    // Log-mapped: log10 years, 1 to 5, fine steps.
    expect([input.min, input.max, input.step]).toEqual(['1', '5', '0.01']);
    expect(input.getAttribute('aria-valuetext')).toMatch(/years old$/);
    // The name is the plain phrase only; the value and the hint are not part of it.
    const name = document.getElementById(input.getAttribute('aria-labelledby')!)!;
    expect(name.textContent).toBe('Age of the remnant');
    // A real label: a click on the name focuses the slider.
    expect(name.tagName).toBe('LABEL');
    expect(name.getAttribute('for')).toBe(input.id);
    // The chosen age is on screen, outside the accessible name and hidden from screen readers.
    const out = input.closest('div')!.querySelector('output')!;
    expect(out.getAttribute('aria-hidden')).toBe('true');
    expect(out.textContent).toBe('100,000 years');
    expect(document.getElementById(input.getAttribute('aria-describedby')!)!.textContent).toMatch(
      /when 100,000 years old/,
    );
    const hint = document.getElementById(input.getAttribute('aria-describedby')!)!;
    expect(hint.textContent).toMatch(/not a measurement/);
    expect(input.closest('div')!.textContent).toMatch(/Default/); // the Artistic tag shows as Default
  });

  it('passes the age to the viewer through the store overrides, and a new object starts from the default', async () => {
    setNova();
    await mount();
    await click('+ Artistic');
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(slider()!, String(Math.log10(5000)));
      slider()!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(useAppStore.getState().overrides.age_yr).toBe(5000);
    expect(fake.setOverrides).toHaveBeenLastCalledWith({ age_yr: 5000 });
    expect(slider()!.getAttribute('aria-valuetext')).toBe('5,000 years old');
    expect(slider()!.closest('div')!.querySelector('output')!.textContent).toBe('5,000 years');
    // The store's reset clears it too.
    await act(async () => useAppStore.getState().resetOverrides());
    expect(fake.setOverrides).toHaveBeenLastCalledWith({});
    expect(slider()!.getAttribute('aria-valuetext')).toBe('100,000 years old');
    await act(async () => {
      useAppStore.getState().setOverride('age_yr', 300);
    });
    const other = fixture('nova');
    other.params.id = 'fixture:nova-2';
    await act(async () => {
      useAppStore.getState().setObject(other.card, other.params);
    });
    expect(fake.setOverrides).toHaveBeenLastCalledWith({});
  });

  it('says the size is the shell when 100,000 years old, in the bar', async () => {
    setNova();
    await mount();
    await click('+ Artistic');
    expect(text('scale-bar')).toMatch(/long when 100,000 years old/);
  });

  it('the honesty announcement keeps the remnant qualifier on the size', async () => {
    setNova();
    await mount();
    await click('+ Artistic');
    await click('+ Estimated');
    await click('+ Artistic');
    const live = document.body.textContent ?? '';
    expect(live).toMatch(/when 100,000 years old/);
  });

  it('ageFromLog maps the log position to rounded years inside the range', () => {
    expect(ageFromLog(1)).toBe(10);
    expect(ageFromLog(1.01)).toBe(10); // whole years below 1,000, not "10.2"
    expect(ageFromLog(2.5)).toBe(316);
    expect(ageFromLog(5)).toBe(100000);
    expect(ageFromLog(3.69897)).toBe(5000);
    expect(ageFromLog(0)).toBe(10);
  });

  it('is not offered for other types', async () => {
    const { card, params } = fixture('nebula');
    useAppStore.getState().setObject(card, params);
    await mount();
    await click('+ Artistic');
    expect(slider()).toBeNull();
  });
});

describe('ViewerPanel: one size for the bar, the label and the announcement (issue #43)', () => {
  function eros() {
    const { card, params } = fixture('asteroid_shape');
    card.shape_source = { value: '/data/shapes/eros-gaskell.glb', tag: 'measured', source: 'test' };
    useAppStore.getState().setObject(card, params);
  }
  const measured = async (radiusM: number) => {
    const handler = fake.setMeshMeasuredHandler.mock.calls.at(-1)?.[0] as
      ((m: { radiusM: number }) => void) | null | undefined;
    await act(async () => handler!({ radiusM }));
  };

  it('the screen-reader label gives the size the scale bar shows, and the swap is announced', async () => {
    eros();
    await mount();
    const cardSize = canvasLabel();
    await measured(16_500);
    expect(text('scale-bar')).toMatch(/33 km/);
    expect(canvasLabel()).toMatch(/33 km long \(estimated\)/);
    expect(canvasLabel()).not.toBe(cardSize);
    // Measured only hides the model-dependent size: the card's size and its own tag are read out.
    await click('Measured only');
    expect(canvasLabel()).not.toMatch(/33 km/);
    expect(text('viewer-announcer')).toMatch(/Measured only/);
    // Back to + Estimated: the swap to the model's size is said.
    await click('+ Estimated');
    expect(text('viewer-announcer')).toMatch(/Size shown: 33 km long \(estimated\)/);
  });
});

describe('ViewerPanel: a size report does not redraw the plan (issue #43)', () => {
  it('showPlan runs once for one plan, even when the model reports its size', async () => {
    const { card, params } = fixture('asteroid_shape');
    card.shape_source = { value: '/data/shapes/eros-gaskell.glb', tag: 'measured', source: 'test' };
    useAppStore.getState().setObject(card, params);
    await mount();
    const calls = fake.showPlan.mock.calls.length;
    const handler = fake.setMeshMeasuredHandler.mock.calls.at(-1)?.[0] as
      ((m: { radiusM: number }) => void) | null | undefined;
    await act(async () => handler!({ radiusM: 16_500 }));
    await act(async () => handler!({ radiusM: 16_400 }));
    expect(fake.showPlan.mock.calls.length).toBe(calls);
    expect(canvasLabel()).toMatch(/km long/); // the label still follows the size
  });
});

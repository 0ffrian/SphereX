// Issue #42 review item 2 and 5: a process is registered on the clock (note, frame loop) only when
// it drives a layer that is DRAWN, and the clock can be played under reduced motion.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebGPURenderer } from 'three/webgpu';
import { defaultContext, planRender } from '../renderPlan';
import { fixture } from '../renderers/fixtures.testutil';
import { ViewerApp } from '../ViewerApp';
import { generateField } from '../fields/fieldGenerator';
import { DEFAULT_HONESTY, type HonestyState } from '../honesty';
import type { PauseReason } from '../render/clock';

const plan = (
  kind: string,
  honesty: HonestyState = DEFAULT_HONESTY,
  mode: 'visible' | 'spherex_ir' | null = null,
) => {
  const { card, params } = fixture(kind);
  return planRender(card, params, defaultContext({ honesty, mode }));
};
const active = (p: ReturnType<typeof plan>) => p.motion.activeProcesses;

describe('activeProcesses: only processes that drive a drawn layer', () => {
  it('gas giant at the default honesty draws its estimated layers and spins, but its jets are artistic', () => {
    const p = plan('gas_giant');
    expect(p.motion.processes.length).toBeGreaterThan(0); // the card does animate them
    expect(p.shader).toMatchObject({ surface: true });
    // Issue #62: bands, flattening, colour and storms show from + Estimated, so the body turns; the
    // jets and the storm drift are artistic looks and wait for + Artistic.
    expect(active(p)).toEqual(['spin']);
  });

  it('gas giant at + Artistic runs spin, winds and cloud changes', () => {
    expect(active(plan('gas_giant', 'artistic'))).toEqual(['spin', 'winds', 'clouds']);
  });

  it('brown dwarf in the infrared view draws no jets, so nothing moves', () => {
    const p = plan('brown_dwarf', 'artistic', 'spherex_ir');
    expect(p.motion.processes.some((x) => x.id === 'winds')).toBe(true);
    expect(active(p)).toEqual([]);
    expect(active(plan('brown_dwarf', 'artistic', 'visible'))).toEqual(['spin', 'winds']);
  });

  it('a star at Measured only draws no surface, so nothing moves', () => {
    expect(active(plan('star', 'measured'))).toEqual([]);
    expect(active(plan('star', 'artistic'))).toEqual(['spin', 'spots', 'flares']);
  });

  it('a Mira pulses only where the pulsation is drawn (+ Artistic)', () => {
    expect(active(plan('star_mira', 'derived'))).toEqual([]);
    expect(active(plan('star_mira', 'artistic'))).toEqual(['pulsation']);
  });

  it('T Tauri spins and flares without spot ageing', () => {
    expect(active(plan('star_ttauri', 'artistic'))).toEqual(['spin', 'flares']);
  });
});

function make() {
  const stub = {
    backend: {},
    setPixelRatio() {},
    setClearColor() {},
    setSize() {},
    render() {},
    dispose: () => Promise.resolve(),
  } as unknown as WebGPURenderer;
  const Ctor = ViewerApp as unknown as new (c: HTMLCanvasElement, r: WebGPURenderer) => ViewerApp;
  return new Ctor(document.createElement('canvas'), stub);
}
const internals = (v: ViewerApp) =>
  v as unknown as {
    clock: { running: boolean; pauseReasons(): PauseReason[] };
    built: { setTime(t: unknown): void };
  };
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ViewerApp registers only active processes', () => {
  it('a star at Measured only has no time-lapse and does not run the frame loop', () => {
    const v = make();
    v.showPlan(plan('star', 'measured'));
    expect(v.timeLapses()).toEqual([]);
    expect(internals(v).clock.running).toBe(false);
    v.showPlan(plan('star', 'artistic'));
    expect(v.timeLapses().map((t) => t.id)).toEqual(['spin', 'spots', 'flares']);
    expect(internals(v).clock.running).toBe(true);
    // Back to Measured: the same scene, in place, and the processes go.
    v.showPlan(plan('star', 'measured'));
    expect(v.timeLapses()).toEqual([]);
    v.dispose();
  });

  it('a Mira shows its pulsation time-lapse only when it is drawn, with the tier of its rate', () => {
    const v = make();
    v.showPlan(plan('star_mira', 'derived'));
    expect(v.timeLapses()).toEqual([]);
    v.showPlan(plan('star_mira', 'artistic'));
    expect(v.timeLapses()).toEqual([
      { id: 'pulsation', label: 'Pulsation', speedup: 86400, tag: 'measured', tier: 1 },
    ]);
    v.dispose();
  });

  it('the flare time-lapse shows the lowered speed-up (flare onsets are capped)', () => {
    const v = make();
    v.showPlan(plan('star_ttauri', 'artistic'));
    const flares = v.timeLapses().find((t) => t.id === 'flares');
    expect(flares?.speedup).toBe(43000);
    v.dispose();
  });
});

describe('reduced motion: Play motion starts the scene (WCAG 2.2.2, R9)', () => {
  it('starts paused, plays on request, and pauses again', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q === '(prefers-reduced-motion: reduce)',
      addEventListener() {},
      removeEventListener() {},
    }));
    const v = make();
    v.showPlan(plan('star', 'artistic'));
    expect(internals(v).clock.pauseReasons()).toContain('reduced-motion');
    expect(internals(v).clock.running).toBe(false);
    v.setMotionOverride(true);
    expect(internals(v).clock.pauseReasons()).not.toContain('reduced-motion');
    expect(internals(v).clock.running).toBe(true);
    v.setMotionOverride(false);
    expect(internals(v).clock.pauseReasons()).toContain('reduced-motion');
    v.dispose();
  });
});

describe('brown dwarf cloud cover follows the scrub while paused (review item 10)', () => {
  it('poses the body again when only the scrub changed, with the clock paused', async () => {
    const { card, params } = fixture('brown_dwarf');
    card.lightcurve = [
      { t_mjd: 1, flux: 10, sigma: 1, lambda_um: 4, flags: 0 },
      { t_mjd: 2, flux: 5, sigma: 1, lambda_um: 4, flags: 0 },
    ];
    const at = (scrubIndex: number) =>
      planRender(
        card,
        params,
        defaultContext({ honesty: 'artistic', mode: 'visible', scrubIndex }),
      );
    const v = make();
    v.setShaderOptions({ fieldSource: async (p) => generateField(p, 64, 32) });
    v.showPlan(at(0));
    await flush();
    v.setSpinPaused(true);
    expect(internals(v).clock.running).toBe(false);
    const spy = vi.spyOn(internals(v).built, 'setTime');
    v.showPlan(at(1));
    expect(spy).toHaveBeenCalled();
    v.dispose();
  });
});

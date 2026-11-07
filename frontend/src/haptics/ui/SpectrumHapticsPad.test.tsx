// R8.6 pad: pointer drags and arrow keys drive the spectrum source through the real engine; the
// slider's value text carries the same information as text (R9); an empty spectrum is refused.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpectrumPoint } from '@/app/api/types';
import { FakeClock, FakeDriver } from '@/test/fakeHaptics';
import { AudioDriver } from '../drivers/audio';
import { WebVibrateDriver } from '../drivers/webVibrate';
import { HapticEngine, type HapticOutputs } from '../haptics';
import { SpectrumHapticsPad } from './SpectrumHapticsPad';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const WIDTH = 800;

/** 1–5 µm, flat, with a deep dip at 3 µm. */
function spectrum(): SpectrumPoint[] {
  const pts: SpectrumPoint[] = [];
  for (let i = 0; i <= 100; i++) {
    const wavelength_um = 1 + (4 * i) / 100;
    const flux = 10 * (1 - 0.95 * Math.exp(-((wavelength_um - 3) ** 2) / (2 * 0.15 ** 2)));
    pts.push({ wavelength_um, flux, error: 0.1, flagged: false, frame_id: `f${i}` });
  }
  return pts;
}

describe('SpectrumHapticsPad (R8.6)', () => {
  let host: HTMLDivElement;
  let root: Root;
  let clock: FakeClock;
  let driver: FakeDriver;
  let haptics: HapticOutputs;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    clock = new FakeClock();
    driver = new FakeDriver(clock.clock);
    const engine = new HapticEngine([driver], {
      clock: clock.clock,
      timers: clock,
      debugTarget: null,
    });
    haptics = {
      engine,
      vibrate: new WebVibrateDriver({ vibrate: null }),
      audio: new AudioDriver({ context: () => null, supported: false }),
    };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: WIDTH,
      width: WIDTH,
      top: 0,
      bottom: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  const render = (points = spectrum()) =>
    act(() =>
      root.render(
        <SpectrumHapticsPad
          haptics={haptics}
          spectrum={{ spectrum: points, tag: 'measured' }}
          objectName="Test star"
        />,
      ),
    );
  const pad = () => host.querySelector<HTMLElement>('[role="slider"]')!;
  const pointer = (type: string, clientX: number) =>
    act(() => pad().dispatchEvent(new MouseEvent(type, { bubbles: true, clientX })));
  /** A pointer event with the fields jsdom's MouseEvent lacks. */
  const ptr = (
    type: string,
    clientX: number,
    extra: { pointerId: number; isPrimary?: boolean; pointerType?: string; button?: number },
  ) => {
    const ev = new MouseEvent(type, { bubbles: true, clientX, button: extra.button ?? 0 });
    Object.defineProperties(ev, {
      pointerId: { value: extra.pointerId },
      isPrimary: { value: extra.isPrimary ?? true },
      pointerType: { value: extra.pointerType ?? 'touch' },
    });
    act(() => pad().dispatchEvent(ev));
  };
  const key = (k: string) =>
    act(() => pad().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));

  it('is a labelled, focusable slider over λ with its provenance badge and no unlock button', () => {
    render();
    const p = pad();
    expect(p.tabIndex).toBe(0);
    expect(p.getAttribute('aria-label')).toBe('Feel the spectrum of Test star');
    expect(p.getAttribute('aria-valuemin')).toBe('1');
    expect(p.getAttribute('aria-valuemax')).toBe('5');
    expect(host.querySelector('button')).toBeNull(); // the host page owns unlocking
    expect(host.querySelector('[data-testid="pad-badge"]')!.textContent).toBe('Data · Measured');
    expect(host.textContent).toContain('With TalkBack, double-tap and hold, then drag');
  });

  it('a drag ticks every 8 px and the dip is silent', () => {
    render();
    pointer('pointerdown', 0);
    for (let x = 1; x <= WIDTH; x++) {
      if (x % 8 === 0) clock.advance(30);
      pointer('pointermove', x);
    }
    pointer('pointerup', WIDTH);
    const n = driver.events.length;
    expect(n).toBeGreaterThan(80);
    expect(n).toBeLessThan(WIDTH / 8);
    expect(driver.events.every((e) => e.kind === 'tick' && e.strength >= 0.2)).toBe(true);
    expect(pad().getAttribute('aria-valuetext')).toMatch(/^5\.00 µm, 100% of peak flux/);
  });

  it('arrow keys step and say where they are, including quiet steps', () => {
    render();
    pad().focus();
    key('ArrowRight');
    expect(pad().getAttribute('aria-valuetext')).toBe('1.00 µm, 100% of peak flux');
    expect(driver.events).toHaveLength(1);
    // Walk to the dip at 3 µm (400 px = 50 steps of 8 px).
    for (let i = 0; i < 50; i++) {
      clock.advance(30);
      key('ArrowRight');
    }
    expect(pad().getAttribute('aria-valuenow')).toBe('3');
    expect(pad().getAttribute('aria-valuetext')).toMatch(/^3\.00 µm, quiet, \d+% of peak flux/);
    const atDip = driver.events.length;
    clock.advance(30);
    key('ArrowLeft');
    expect(driver.events.length).toBe(atDip); // still in the dip: quiet
    key('Tab');
    expect(driver.events.length).toBe(atDip);
  });

  it('a second finger neither drives nor ends the drag', () => {
    render();
    ptr('pointerdown', 0, { pointerId: 1 });
    ptr('pointerdown', 400, { pointerId: 2, isPrimary: false });
    ptr('pointermove', 600, { pointerId: 2, isPrimary: false });
    expect(driver.events).toHaveLength(0);
    ptr('pointerup', 600, { pointerId: 2, isPrimary: false });
    ptr('pointermove', 8, { pointerId: 1 });
    expect(driver.events).toHaveLength(1); // finger 1 still drags
    clock.advance(30);
    ptr('pointerup', 8, { pointerId: 1 });
    ptr('pointermove', 16, { pointerId: 1 });
    expect(driver.events).toHaveLength(1); // ended
  });

  it('a lost pointer capture ends the drag, so the next finger can drag', () => {
    render();
    ptr('pointerdown', 0, { pointerId: 1 });
    // The browser took the capture away (e.g. a system gesture) without a pointerup.
    ptr('lostpointercapture', 0, { pointerId: 1 });
    ptr('pointerdown', 0, { pointerId: 2 });
    ptr('pointermove', 8, { pointerId: 2 });
    expect(driver.events).toHaveLength(1);
  });

  it('ignores the right mouse button', () => {
    render();
    ptr('pointerdown', 0, { pointerId: 1, pointerType: 'mouse', button: 2 });
    ptr('pointermove', 40, { pointerId: 1, pointerType: 'mouse', button: 2 });
    expect(driver.events).toHaveLength(0);
  });

  it('Home, End, Page Up and Page Down move along the slider, and the end is reachable', () => {
    render();
    pad().focus();
    key('End');
    expect(pad().getAttribute('aria-valuenow')).toBe('5');
    clock.advance(30);
    key('Home');
    expect(pad().getAttribute('aria-valuenow')).toBe('1');
    clock.advance(30);
    key('PageUp'); // 10 steps of 8 px = 80 px of 800 = 0.4 µm
    expect(pad().getAttribute('aria-valuenow')).toBe('1.4');
    clock.advance(30);
    key('PageDown');
    expect(pad().getAttribute('aria-valuenow')).toBe('1');
    for (let i = 0; i < 120; i++) key('ArrowRight');
    expect(pad().getAttribute('aria-valuenow')).toBe('5');
  });

  it('says how pitch follows wavelength from the tuning constant', () => {
    render();
    expect(host.textContent).toMatch(/Pitch (rises|falls) with wavelength/);
  });

  it('refuses a single-wavelength spectrum instead of spreading it over the pad', () => {
    const one = spectrum().slice(0, 1);
    render(one);
    expect(host.querySelector('[role="slider"]')).toBeNull();
    expect(host.textContent).toContain('usable flux at only one wavelength');
    // Two points at the same λ are one wavelength too (#9 averages them).
    render([one[0]!, { ...one[0]!, flux: 5, frame_id: 'f-dup' }]);
    expect(host.querySelector('[role="slider"]')).toBeNull();
  });

  it('the readout follows the finger during a drag, once per frame', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    render();
    pointer('pointerdown', 0);
    for (let x = 1; x <= 40; x++) pointer('pointermove', x);
    expect(frames).toHaveLength(1); // several steps, one frame
    act(() => frames.shift()!(0));
    // The visible readout follows the finger …
    expect(host.textContent).toContain('1.20 µm, 100% of peak flux');
    // … but the slider's ARIA value waits for the end of the drag (no screen-reader chatter).
    expect(pad().getAttribute('aria-valuetext')).toBe(
      'Start of the spectrum, 1.00 µm; no step yet',
    );
    expect(pad().getAttribute('aria-valuenow')).toBe('1');
    pointer('pointerup', 40);
    expect(pad().getAttribute('aria-valuetext')).toMatch(/^1\.20 µm, 100% of peak flux/);
    expect(pad().getAttribute('aria-valuenow')).toBe('1.2');
    vi.unstubAllGlobals();
  });

  it('says when the honesty state hides the ticks, and calls large σ "uncertain"', () => {
    haptics.engine.setHonesty('measured');
    const noisy = spectrum().map((p) => ({ ...p, error: p.flux }));
    act(() =>
      root.render(
        <SpectrumHapticsPad
          haptics={haptics}
          spectrum={{ spectrum: noisy, tag: 'derived' }}
          objectName="Test star"
        />,
      ),
    );
    expect(host.querySelector('[data-testid="pad-badge"]')!.textContent).toBe('Data · Estimated');
    pad().focus();
    key('ArrowRight');
    expect(driver.events).toHaveLength(0);
    expect(pad().getAttribute('aria-valuetext')).toBe(
      '1.00 µm, 100% of peak flux, uncertain (hidden by Measured only)',
    );
  });

  it('a quiet dip is not reported as hidden, even when the tag is hidden', () => {
    haptics.engine.setHonesty('measured');
    act(() =>
      root.render(
        <SpectrumHapticsPad
          haptics={haptics}
          spectrum={{ spectrum: spectrum(), tag: 'derived' }}
          objectName="Test star"
        />,
      ),
    );
    pad().focus();
    key('Home');
    for (let i = 0; i < 50; i++) key('ArrowRight');
    expect(pad().getAttribute('aria-valuetext')).toMatch(/quiet/);
    expect(pad().getAttribute('aria-valuetext')).not.toMatch(/hidden/);
  });

  it('a tick dropped by the rate cap is not labelled hidden', () => {
    render(); // default honesty: + Estimated
    pad().focus();
    key('ArrowRight');
    key('ArrowRight'); // same clock time: under 25 ms, the engine drops it
    expect(driver.events).toHaveLength(1);
    expect(pad().getAttribute('aria-valuetext')).toBe('1.04 µm, 100% of peak flux');
  });

  it('fixture data is badged Fixture, never Measured', () => {
    act(() =>
      root.render(
        <SpectrumHapticsPad
          haptics={haptics}
          spectrum={{ spectrum: spectrum(), tag: 'measured' }}
          objectName="Test star"
          fixture
        />,
      ),
    );
    expect(host.querySelector('[data-testid="pad-badge"]')!.textContent).toBe(
      'Data · Fixture (synthetic)',
    );
  });

  it('refuses an empty spectrum with a sentence instead of a pad', () => {
    render(spectrum().map((p) => ({ ...p, flagged: true })));
    expect(host.querySelector('[role="slider"]')).toBeNull();
    expect(host.textContent).toContain('No usable spectrum points for Test star');
  });
});

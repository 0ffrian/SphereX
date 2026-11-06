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
  const key = (k: string) =>
    act(() => pad().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));

  it('is a labelled, focusable slider over λ with an unlock button', () => {
    render();
    const p = pad();
    expect(p.tabIndex).toBe(0);
    expect(p.getAttribute('aria-label')).toBe('Feel the spectrum of Test star');
    expect(p.getAttribute('aria-valuemin')).toBe('1');
    expect(p.getAttribute('aria-valuemax')).toBe('5');
    expect(host.querySelector('button')!.textContent).toBe('Turn on haptics and sound');
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

  it('refuses an empty spectrum with a sentence instead of a pad', () => {
    render(spectrum().map((p) => ({ ...p, flagged: true })));
    expect(host.querySelector('[role="slider"]')).toBeNull();
    expect(host.textContent).toContain('No usable spectrum points for Test star');
  });
});

// The feel pad is a keyboard control (R9, WCAG 2.1.1 / 4.1.2): arrow keys move the same point the
// finger would and emit the same events through the real engine.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HapticEngine, type HapticOutputs } from '@/haptics/haptics';
import { FakeClock, FakeDriver } from '@/test/fakeHaptics';
import { TexturePanel } from './TexturePanel';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

describe('Texture panel feel pad: keyboard', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    // jsdom has no canvas 2D context: the pad simply is not painted.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('is focusable, describes the point, and arrow keys emit the texture events', () => {
    const clock = new FakeClock();
    const driver = new FakeDriver(clock.clock);
    const engine = new HapticEngine([driver], {
      clock: clock.clock,
      timers: clock,
      honesty: 'artistic',
      debugTarget: null,
    });
    const haptics = {
      engine,
      vibrate: { supported: false },
      audio: {},
    } as unknown as HapticOutputs;
    act(() => root.render(<TexturePanel haptics={haptics} />));
    const pad = host.querySelector('canvas')!;
    expect(pad.tabIndex).toBe(0);
    expect(pad.getAttribute('role')).toBe('slider');
    expect(pad.getAttribute('aria-roledescription')).toBe('feel pad');
    expect(host.textContent).toContain('Artist’s impression');
    expect(host.textContent).toContain('Synthetic test bodies');

    act(() => pad.focus());
    for (let i = 0; i < 12; i++) {
      act(() => {
        pad.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      });
      clock.advance(40);
    }
    // The gas giant's flow: band ticks and the jet train, all artistic texture.
    expect(driver.events.length + driver.windows.length).toBeGreaterThan(0);
    expect(driver.events.every((e) => e.tag === 'artistic')).toBe(true);
    expect(pad.getAttribute('aria-valuetext')).toMatch(
      /^Gas giant .*: upper centre\. Moving: texture/,
    );
  });
});

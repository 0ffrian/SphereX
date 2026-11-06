// D-20 pulse indicator (decorative, fed by the debug event, reduced motion) and the R8.9 unlock button.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HapticEvent } from '@/contract';
import { HAPTIC_DEBUG_EVENT, HapticEngine } from '../haptics';
import { PulseIndicator, flashPlan } from './PulseIndicator';
import { UnlockButton } from './UnlockButton';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

describe('haptics UI', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('the indicator is hidden from assistive tech and flashes on each debug event', () => {
    const target = new EventTarget();
    const animate = vi.fn(() => ({ cancel: vi.fn() }));
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
    act(() => root.render(<PulseIndicator target={target} />));
    expect(host.firstElementChild!.getAttribute('aria-hidden')).toBe('true');
    const detail: HapticEvent = { kind: 'pulseTrain', rateHz: 8, strength: 1, tag: 'measured' };
    target.dispatchEvent(new CustomEvent(HAPTIC_DEBUG_EVENT, { detail }));
    expect(animate).toHaveBeenCalledTimes(1);
    const [keyframes, timing] = animate.mock.calls[0] as unknown as [
      Keyframe[],
      KeyframeAnimationOptions,
    ];
    expect(timing.iterations).toBe(2);
    expect(keyframes[0]).toHaveProperty('transform');
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  });

  it('with reduced motion it only fades', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduced-motion') }));
    const target = new EventTarget();
    const animate = vi.fn(() => ({ cancel: vi.fn() }));
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
    act(() => root.render(<PulseIndicator target={target} />));
    target.dispatchEvent(
      new CustomEvent(HAPTIC_DEBUG_EVENT, {
        detail: { kind: 'tick', strength: 0.5, tag: 'measured' },
      }),
    );
    const [keyframes] = animate.mock.calls[0] as unknown as [Keyframe[]];
    expect(keyframes[0]).not.toHaveProperty('transform');
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  });

  it('flash plans follow the patterns', () => {
    expect(flashPlan({ kind: 'double', strength: 1, tag: 'measured' }).count).toBe(2);
    expect(flashPlan({ kind: 'stop', strength: 0, tag: 'measured' }).count).toBe(0);
  });

  it('the unlock button calls engine.unlock from its click', async () => {
    const engine = new HapticEngine([], { debugTarget: null });
    const unlock = vi.spyOn(engine, 'unlock').mockResolvedValue(true);
    act(() => root.render(<UnlockButton engine={engine} canVibrate />));
    const button = host.querySelector('button')!;
    expect(button.textContent).toBe('Turn on haptics and sound');
    await act(async () => button.click());
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(button.textContent).toBe('Haptics and sound on');
  });
});

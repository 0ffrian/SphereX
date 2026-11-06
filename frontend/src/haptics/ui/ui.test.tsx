// D-20 pulse indicator (decorative, fed by the debug event, reduced motion) and the R8.9 unlock button.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HapticEvent } from '@/contract';
import { FakeAudioContext } from '@/test/fakeAudio';
import { setAudioContextFactory } from '../audioContext';
import { HAPTIC_DEBUG_EVENT, HapticEngine } from '../haptics';
import { PulseIndicator, flashPlan, pulseCaption } from './PulseIndicator';
import { useHapticSettings } from '../settings';
import { UnlockButton, unlockActionLabel, unlockedLabel } from './UnlockButton';

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
    vi.useRealTimers();
    setAudioContextFactory(null);
  });

  it('the indicator is hidden from assistive tech and flashes on each debug event', () => {
    const target = new EventTarget();
    const animate = vi.fn(() => ({ cancel: vi.fn() }));
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
    act(() => root.render(<PulseIndicator target={target} />));
    expect(
      host.querySelector('[data-testid="pulse-dot"]')!.closest('[aria-hidden="true"]'),
    ).not.toBeNull();
    // The caption is visible text, not hidden from assistive tech.
    expect(
      host.querySelector('[data-testid="pulse-caption"]')!.closest('[aria-hidden]'),
    ).toBeNull();
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

  it('the caption names the last event, its provenance badge and its channel', () => {
    const target = new EventTarget();
    act(() => root.render(<PulseIndicator target={target} />));
    const caption = () => host.querySelector('[data-testid="pulse-caption"]')!.textContent;
    expect(caption()).toBe('No pulse yet');
    act(() => {
      target.dispatchEvent(
        new CustomEvent(HAPTIC_DEBUG_EVENT, {
          detail: { kind: 'tick', strength: 1, tag: 'artistic', channel: 'texture' },
        }),
      );
    });
    expect(caption()).toBe('Tick Default (artist’s choice) · Texture');
    expect(
      pulseCaption({ kind: 'pulseTrain', strength: 1, tag: 'derived', channel: 'data' }),
    ).toEqual({ kind: 'Pulse train', badge: 'Estimated', channel: 'Data' });
    expect(pulseCaption({ kind: 'heartbeat', strength: 1, tag: 'measured' })).toEqual({
      kind: 'Heartbeat',
      badge: 'Measured',
      channel: null,
    });
  });

  it('with reduced motion: at most 3 flashes a second, and a steady glow for trains', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduced-motion') }));
    const now = vi.spyOn(performance, 'now');
    const target = new EventTarget();
    const animate = vi.fn(() => ({ cancel: vi.fn() }));
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
    act(() => root.render(<PulseIndicator target={target} />));
    const fire = (detail: HapticEvent, t: number) => {
      now.mockReturnValue(t);
      act(() => {
        target.dispatchEvent(new CustomEvent(HAPTIC_DEBUG_EVENT, { detail }));
      });
    };
    const tick: HapticEvent = { kind: 'tick', strength: 1, tag: 'measured' };
    for (let t = 1000; t < 2000; t += 25) fire(tick, t); // a 40/s drag for 1 s
    expect(animate.mock.calls.length).toBeLessThanOrEqual(3);
    animate.mockClear();
    fire({ kind: 'pulseTrain', rateHz: 20, strength: 1, tag: 'measured' }, 3000);
    expect(animate).not.toHaveBeenCalled();
    const dot = host.querySelector<HTMLElement>('[data-testid="pulse-dot"]')!;
    expect(dot.style.opacity).toBe('1');
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  });

  it('the unlock button is shared, named by its action, then replaced by a live status', async () => {
    const ctx = new FakeAudioContext({ state: 'suspended' });
    setAudioContextFactory(() => ctx.asAudioContext());
    useHapticSettings.setState({ hapticsOn: true, soundOn: true, loaded: true });
    const engine = new HapticEngine([], { debugTarget: null });
    const onUnlocked = vi.fn();
    act(() =>
      root.render(
        <>
          <UnlockButton engine={engine} canVibrate onUnlocked={onUnlocked} />
          <UnlockButton engine={engine} canVibrate={false} />
        </>,
      ),
    );
    const buttons = host.querySelectorAll('button');
    expect([...buttons].map((b) => b.textContent)).toEqual([
      'Turn on vibration and sound',
      'Turn on sound',
    ]);
    await act(async () => buttons[0]!.click());
    expect(onUnlocked).toHaveBeenCalledWith(true);
    expect(host.querySelectorAll('button')).toHaveLength(0); // both instances follow
    const live = [...host.querySelectorAll('[aria-live="polite"]')].map((s) => s.textContent);
    expect(live).toEqual(['Vibration and sound on', 'Sound on (this device cannot vibrate)']);
    expect(document.activeElement).toBe(host.querySelector('[aria-live="polite"]'));
    act(() => useHapticSettings.setState({ hapticsOn: false }));
    expect(host.querySelector('[aria-live="polite"]')!.textContent).toBe('Sound on, vibration off');
  });

  it('labels never claim an output that is off or missing', () => {
    const on = { hapticsOn: true, soundOn: true };
    expect(unlockActionLabel(true, on)).toBe('Turn on vibration and sound');
    expect(unlockActionLabel(false, on)).toBe('Turn on sound');
    expect(unlockActionLabel(true, { hapticsOn: false, soundOn: true })).toBe('Turn on sound');
    expect(unlockActionLabel(true, { hapticsOn: true, soundOn: false })).toBe('Turn on vibration');
    expect(unlockedLabel(true, true, on)).toBe('Vibration and sound on');
    expect(unlockedLabel(false, true, on)).toBe('Sound on (this device cannot vibrate)');
    expect(unlockedLabel(true, true, { hapticsOn: false, soundOn: true })).toBe(
      'Sound on, vibration off',
    );
    expect(unlockedLabel(true, false, on)).toBe('Vibration on, sound unavailable here');
    expect(unlockedLabel(true, true, { hapticsOn: true, soundOn: false })).toBe(
      'Vibration on, sound off',
    );
    expect(unlockedLabel(false, false, on)).toBe('Sound unavailable here');
    expect(unlockedLabel(true, true, { hapticsOn: false, soundOn: false })).toBe(
      'Vibration and sound are off in settings',
    );
  });
});

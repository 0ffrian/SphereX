// D-20 pulse indicator (decorative dot, visible caption, flash cap, spoofed events) and the R8.9
// unlock button (shared state, action names, one announcement, focus).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAudioContext } from '@/test/fakeAudio';
import { setAudioContextFactory } from '../audioContext';
import { HAPTIC_DEBUG_EVENT, HapticEngine } from '../haptics';
import { useHapticSettings } from '../settings';
import {
  MAX_FLASHES_PER_S,
  PulseIndicator,
  flashPlan,
  isHapticEventDetail,
  pulseCaption,
} from './PulseIndicator';
import { BOTH_OFF_TEXT, UnlockButton, unlockActionLabel, unlockedLabel } from './UnlockButton';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

type AnimateMock = ReturnType<typeof vi.fn>;

function mockAnimate(): AnimateMock {
  const animate = vi.fn(() => ({ cancel: vi.fn() }));
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
  return animate;
}

describe('pulse indicator (D-20)', () => {
  let host: HTMLDivElement;
  let root: Root;
  let target: EventTarget;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    target = new EventTarget();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  });

  const fire = (detail: unknown) =>
    act(() => {
      target.dispatchEvent(new CustomEvent(HAPTIC_DEBUG_EVENT, { detail }));
    });
  const caption = () => host.querySelector('[data-testid="pulse-caption"]')!.textContent;
  const dot = () => host.querySelector<HTMLElement>('[data-testid="pulse-dot"]')!;

  it('hides the dot from assistive tech but not the caption', () => {
    act(() => root.render(<PulseIndicator target={target} />));
    expect(dot().closest('[aria-hidden="true"]')).not.toBeNull();
    expect(
      host.querySelector('[data-testid="pulse-caption"]')!.closest('[aria-hidden]'),
    ).toBeNull();
  });

  it('flashes at most 3 times a second for everyone, scaling only without reduced motion', () => {
    const now = vi.spyOn(performance, 'now');
    const animate = mockAnimate();
    act(() => root.render(<PulseIndicator target={target} />));
    for (let t = 1000; t < 2000; t += 25) {
      now.mockReturnValue(t);
      fire({ kind: 'double', strength: 1, tag: 'measured' }); // a 40/s drag for 1 s
    }
    expect(animate.mock.calls.length).toBeLessThanOrEqual(MAX_FLASHES_PER_S);
    for (const call of animate.mock.calls) {
      const [keyframes, timing] = call as unknown as [Keyframe[], KeyframeAnimationOptions];
      expect(timing.iterations).toBe(1);
      expect(keyframes[0]).toHaveProperty('transform');
    }
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduced-motion') }));
    animate.mockClear();
    now.mockReturnValue(5000);
    fire({ kind: 'tick', strength: 0.5, tag: 'measured' });
    const [keyframes] = animate.mock.calls[0] as unknown as [Keyframe[]];
    expect(keyframes[0]).not.toHaveProperty('transform');
  });

  it('glows steadily through a train, also a slow one, instead of flashing', () => {
    vi.useFakeTimers();
    const animate = mockAnimate();
    act(() => root.render(<PulseIndicator target={target} />));
    const train = { kind: 'pulseTrain', rateHz: 20, strength: 1, tag: 'measured' } as const;
    fire(train);
    expect(animate).not.toHaveBeenCalled();
    expect(dot().style.opacity).toBe('1');
    // A 2 Hz train: windows 500 ms apart, the glow must bridge the gap.
    expect(flashPlan({ ...train, rateHz: 2 }).glowMs).toBeGreaterThan(500);
    fire({ ...train, rateHz: 2 });
    act(() => vi.advanceTimersByTime(500));
    expect(dot().style.opacity).toBe('1');
    fire({ ...train, rateHz: 2 });
    act(() => vi.advanceTimersByTime(700));
    expect(dot().style.opacity).toBe(''); // back to rest after the train
    expect(flashPlan({ kind: 'stop', strength: 0, tag: 'measured' }).mode).toBe('none');
  });

  it('the caption names the kind, the provenance badge and the channel', () => {
    act(() => root.render(<PulseIndicator target={target} />));
    expect(caption()).toBe('No pulse yet');
    fire({ kind: 'tick', strength: 1, tag: 'artistic', channel: 'texture' });
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

  it('does not re-render for a repeat of the same caption', () => {
    let renders = 0;
    function Counted() {
      renders++;
      return <PulseIndicator target={target} />;
    }
    act(() => root.render(<Counted />));
    fire({ kind: 'tick', strength: 1, tag: 'measured' });
    const caption1 = caption();
    for (let i = 0; i < 10; i++) fire({ kind: 'tick', strength: 0.2, tag: 'measured' });
    expect(caption()).toBe(caption1);
    expect(renders).toBe(1); // only the indicator itself re-renders, and only once
  });

  it('ignores spoofed or malformed events', () => {
    act(() => root.render(<PulseIndicator target={target} />));
    const bad: unknown[] = [
      null,
      'tick',
      { kind: '__proto__', strength: 1, tag: 'measured' },
      { kind: 'toString', strength: 1, tag: 'measured' },
      { kind: 'boom', strength: 1, tag: 'measured' },
      { kind: 'tick', strength: NaN, tag: 'measured' },
      { kind: 'tick', strength: 1, tag: 'verified' },
      { kind: 'tick', strength: 1, tag: 'measured', channel: 'secret' },
      { kind: 'pulseTrain', strength: 1, tag: 'measured', rateHz: 'fast' },
    ];
    for (const d of bad) {
      expect(isHapticEventDetail(d)).toBe(false);
      expect(() => fire(d)).not.toThrow();
    }
    expect(caption()).toBe('No pulse yet');
    expect(isHapticEventDetail({ kind: 'tick', strength: 1, tag: 'measured' })).toBe(true);
  });
});

describe('unlock button (R8.9, Q-73)', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    useHapticSettings.setState({ hapticsOn: true, soundOn: true, loaded: true });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    setAudioContextFactory(null);
  });

  const lives = () => [...host.querySelectorAll('[aria-live="polite"]')].map((s) => s.textContent);

  it('is shared, named by its action, and only the clicked one announces the result', async () => {
    const ctx = new FakeAudioContext({ state: 'suspended' });
    setAudioContextFactory(() => ctx.asAudioContext());
    const engine = new HapticEngine([], { debugTarget: null });
    const onUnlocked = vi.fn();
    act(() =>
      root.render(
        <>
          <UnlockButton engine={engine} canVibrate onUnlocked={onUnlocked} />
          <UnlockButton engine={engine} canVibrate={false} />
          <UnlockButton engine={engine} canVibrate={false} />
        </>,
      ),
    );
    const buttons = host.querySelectorAll('button');
    expect([...buttons].map((b) => b.textContent)).toEqual([
      'Turn on vibration and sound',
      'Turn on sound',
      'Turn on sound',
    ]);
    buttons[0]!.focus();
    await act(async () => buttons[0]!.click());
    expect(onUnlocked).toHaveBeenCalledWith(true);
    expect(host.querySelectorAll('button')).toHaveLength(0); // every instance follows
    expect(lives()).toEqual(['Vibration and sound on', '', '']); // spoken once
    expect(host.textContent).toContain('Sound on (this device cannot vibrate)'); // shown by the others
    // Focus moved to a non-live wrapper with a visible focus style.
    const focused = document.activeElement as HTMLElement;
    expect(focused.getAttribute('aria-live')).toBeNull();
    expect(focused.textContent).toBe('Vibration and sound on');
    expect(focused.className).toContain('focus-visible:outline-2');
    expect(focused.className).not.toContain('outline-none');
    act(() => useHapticSettings.setState({ hapticsOn: false }));
    expect(lives()[0]).toBe('Sound on, vibration off');
  });

  it('comes back when the OS suspends the audio, and says so', async () => {
    const ctx = new FakeAudioContext({ state: 'suspended' });
    setAudioContextFactory(() => ctx.asAudioContext());
    const engine = new HapticEngine([], { debugTarget: null });
    act(() => root.render(<UnlockButton engine={engine} canVibrate={false} />));
    await act(async () => host.querySelector('button')!.click());
    expect(host.querySelector('button')).toBeNull();
    act(() => ctx.simulateState('suspended'));
    expect(host.querySelector('button')!.textContent).toBe('Turn on sound');
    expect(lives()[0]).toBe('Sound paused; press the button to resume');
    await act(async () => host.querySelector('button')!.click());
    expect(host.querySelector('button')).toBeNull();
    expect(lives()[0]).toBe('Sound on (this device cannot vibrate)');
  });

  it('does not steal focus later when its click did not remove the button', async () => {
    const ctx = new FakeAudioContext({ state: 'suspended' });
    ctx.resume = async () => {
      ctx.resumes++; // the browser refuses: still suspended
    };
    setAudioContextFactory(() => ctx.asAudioContext());
    const engine = new HapticEngine([], { debugTarget: null });
    const elsewhere = document.createElement('input');
    document.body.appendChild(elsewhere);
    act(() => root.render(<UnlockButton engine={engine} canVibrate={false} />));
    await act(async () => host.querySelector('button')!.click());
    expect(host.querySelector('button')).not.toBeNull();
    elsewhere.focus();
    act(() => ctx.simulateState('running')); // later, the context starts by itself
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('shows no button when both outputs are off', () => {
    useHapticSettings.setState({ hapticsOn: false, soundOn: false });
    const engine = new HapticEngine([], { debugTarget: null });
    act(() => root.render(<UnlockButton engine={engine} canVibrate />));
    expect(host.querySelector('button')).toBeNull();
    expect(host.textContent).toBe(BOTH_OFF_TEXT);
  });

  it('labels never name an output that is off or missing', () => {
    const on = { hapticsOn: true, soundOn: true };
    expect(unlockActionLabel(true, on)).toBe('Turn on vibration and sound');
    expect(unlockActionLabel(false, on)).toBe('Turn on sound');
    expect(unlockActionLabel(true, { hapticsOn: false, soundOn: true })).toBe('Turn on sound');
    expect(unlockActionLabel(true, { hapticsOn: true, soundOn: false })).toBe('Turn on vibration');
    expect(unlockActionLabel(false, { hapticsOn: true, soundOn: false })).toBeNull();
    expect(unlockActionLabel(true, { hapticsOn: false, soundOn: false })).toBeNull();
    expect(unlockedLabel(true, true, on)).toBe('Vibration and sound on');
    expect(unlockedLabel(false, true, on)).toBe('Sound on (this device cannot vibrate)');
    expect(unlockedLabel(true, true, { hapticsOn: false, soundOn: true })).toBe(
      'Sound on, vibration off',
    );
    expect(unlockedLabel(true, false, on)).toBe('Vibration on, sound unavailable here');
    expect(unlockedLabel(true, false, on, 'suspended')).toBe(
      'Vibration on, sound paused; press the button to resume',
    );
    expect(unlockedLabel(false, false, on, 'suspended')).toBe(
      'Sound paused; press the button to resume',
    );
    expect(unlockedLabel(false, false, on, 'none')).toBe('Sound unavailable here');
    expect(unlockedLabel(true, true, { hapticsOn: true, soundOn: false })).toBe(
      'Vibration on, sound off',
    );
    expect(unlockedLabel(true, true, { hapticsOn: false, soundOn: false })).toBe(BOTH_OFF_TEXT);
  });
});

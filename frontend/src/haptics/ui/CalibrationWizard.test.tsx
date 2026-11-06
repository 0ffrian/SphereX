// R8.7 calibration wizard: runs only where vibrate is supported, plays the probe, level and beat
// patterns, measures the tap-along offset (touch and Space), saves under the one key, applies it.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAudioContext } from '@/test/fakeAudio';
import { FakeClock, fakeVibrate } from '@/test/fakeHaptics';
import { CALIBRATION_STORAGE_KEY, beatPlan, loadCalibration } from '../calibration';
import { AudioDriver } from '../drivers/audio';
import { WebVibrateDriver } from '../drivers/webVibrate';
import { HapticEngine, type HapticOutputs } from '../haptics';
import { CALIBRATION_GAP_MS, TAP_BEAT_COUNT, TAP_BEAT_PERIOD_MS } from '../tuning';
import { CalibrationWizard, describeOffset } from './CalibrationWizard';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

function outputs(canVibrate = true) {
  const clock = new FakeClock();
  const ctx = new FakeAudioContext();
  const vib = fakeVibrate();
  const vibrate = new WebVibrateDriver({ vibrate: canVibrate ? vib.fn : null });
  const audio = new AudioDriver({ context: () => ctx.asAudioContext(), supported: true });
  const engine = new HapticEngine([vibrate, audio], {
    clock: clock.clock,
    timers: clock,
    debugTarget: null,
  });
  vi.spyOn(engine, 'unlock').mockResolvedValue(true);
  const haptics: HapticOutputs = { engine, vibrate, audio };
  return { haptics, ctx, vib };
}

describe('CalibrationWizard (R8.7)', () => {
  let host: HTMLDivElement;
  let root: Root;
  let t = 0;
  const now = () => t;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    t = 1000;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const button = (name: string | RegExp) => {
    const b = [...host.querySelectorAll('button')].find((el) =>
      typeof name === 'string' ? el.textContent === name : name.test(el.textContent ?? ''),
    );
    if (!b) throw new Error(`no button "${String(name)}" in: ${host.textContent}`);
    return b;
  };
  const click = async (name: string | RegExp) => {
    await act(async () => button(name).click());
  };
  const live = () => host.querySelector('[aria-live="polite"]')!.textContent;

  /** Play a beat and tap `lagMs` after beats 0..count-1; the warm-up taps are ignored. */
  const tapAlong = async (start: string, lagMs: number, via: 'pointer' | 'space' = 'pointer') => {
    await click(start);
    const t0 = t;
    const tap = button('Tap');
    for (let k = 0; k < TAP_BEAT_COUNT; k++) {
      t = t0 + k * TAP_BEAT_PERIOD_MS + lagMs;
      act(() => {
        if (via === 'pointer') tap.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        else tap.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      });
    }
    await act(async () => {
      vi.advanceTimersByTime((TAP_BEAT_COUNT + 1) * TAP_BEAT_PERIOD_MS);
    });
  };

  it('does not run where the device cannot vibrate', () => {
    const { haptics } = outputs(false);
    act(() => root.render(<CalibrationWizard haptics={haptics} vibrate={null} />));
    expect(host.textContent).toContain('cannot vibrate');
    expect(host.querySelector('button')).toBeNull();
  });

  it('runs the three steps, measures the offset and saves it', async () => {
    vi.useFakeTimers();
    const { haptics, ctx, vib } = outputs();
    const onDone = vi.fn();
    act(() =>
      root.render(
        <CalibrationWizard haptics={haptics} vibrate={vib.fn} now={now} onDone={onDone} />,
      ),
    );

    await click('Start');
    expect(haptics.engine.unlock).toHaveBeenCalledTimes(1);
    expect(live()).toBe('Step 1 of 3: the faintest pulse');
    expect(document.activeElement?.textContent).toBe('Step 1 of 3: the faintest pulse');

    await click('Play the three pulses');
    expect(vib.calls.at(-1)).toEqual([5, CALIBRATION_GAP_MS, 10, CALIBRATION_GAP_MS, 20]);
    await click('Second (10 ms)');
    expect(live()).toMatch(/^Step 2 of 3/);

    await click('Play the four buzzes');
    const g = CALIBRATION_GAP_MS;
    expect(vib.calls.at(-1)).toEqual([4, 4, 4, 4, 4, g, 10, g, 15, g, 25]);
    await click('Yes, it was different');
    expect(live()).toMatch(/^Step 3 of 3/);

    // Vibration felt 100 ms after the beat, sound heard 40 ms after: +60 ms, audio waits.
    await tapAlong('Start the vibration beat', 100);
    expect(vib.calls.at(-1)).toHaveLength(2 * TAP_BEAT_COUNT - 1);
    expect(live()).toMatch(/sound only/);
    const before = ctx.sources().length;
    await tapAlong('Start the sound beat', 40, 'space');
    expect(ctx.sources().length - before).toBe(beatPlan().count);
    expect(live()).toBe(`Offset measured: ${describeOffset(60)}`);

    await click('Save calibration');
    const expected = {
      version: 1,
      minMs: 10,
      levels: ['whisper', 'soft', 'medium', 'firm'],
      avOffsetMs: 60,
    };
    expect(loadCalibration()).toEqual(expected);
    expect(onDone).toHaveBeenCalledWith(expected, true);
    expect(haptics.audio.offsetMs).toBe(60);
    expect(haptics.vibrate.delayMs).toBe(0);
    expect(haptics.vibrate.levels).toEqual([[4, 4, 4, 4, 4], 10, 15, 25]);
    expect(host.textContent).toContain('Saved on this device');
  });

  it('too few taps asks to try again; skipping keeps no offset', async () => {
    vi.useFakeTimers();
    const { haptics, vib } = outputs();
    act(() => root.render(<CalibrationWizard haptics={haptics} vibrate={vib.fn} now={now} />));
    await click('Start');
    await click('Skip this step');
    await click('Skip this step');
    await click('Start the vibration beat');
    await act(async () => {
      vi.advanceTimersByTime((TAP_BEAT_COUNT + 1) * TAP_BEAT_PERIOD_MS);
    });
    expect(live()).toMatch(/Not enough taps/);
    button('Try again');
    await click('Skip this step');
    expect(loadCalibration()).toEqual({
      version: 1,
      minMs: 8,
      levels: ['soft', 'medium', 'firm'],
      avOffsetMs: 0,
    });
    expect(localStorage.length).toBe(1);
    expect(localStorage.key(0)).toBe(CALIBRATION_STORAGE_KEY);
  });

  it('the sound beat plays with no offset, and leaving mid-beat gives the old offset back', async () => {
    vi.useFakeTimers();
    const { haptics, vib } = outputs();
    haptics.audio.setOffsetMs(80);
    act(() => root.render(<CalibrationWizard haptics={haptics} vibrate={vib.fn} now={now} />));
    await click('Start');
    await click('Skip this step');
    await click('Skip this step');
    await tapAlong('Start the vibration beat', 50);
    await click('Start the sound beat');
    expect(haptics.audio.offsetMs).toBe(0);
    act(() => root.render(<p />));
    expect(haptics.audio.offsetMs).toBe(80);
    expect(loadCalibration()).toBeNull();
  });

  it('"I felt none" keeps the default soft tick and says why it may be', async () => {
    const { haptics, vib } = outputs();
    act(() => root.render(<CalibrationWizard haptics={haptics} vibrate={vib.fn} now={now} />));
    await click('Start');
    await click('I felt none');
    await click('I did not feel the first one');
    await click('Skip this step');
    expect(loadCalibration()?.minMs).toBe(8);
    expect(loadCalibration()?.levels).toHaveLength(3);
    expect(host.textContent).toContain('battery saver');
  });

  it('every button is a real button with a text label', async () => {
    const { haptics, vib } = outputs();
    act(() => root.render(<CalibrationWizard haptics={haptics} vibrate={vib.fn} now={now} />));
    await click('Start');
    for (const b of host.querySelectorAll('button')) {
      expect(b.getAttribute('type')).toBe('button');
      expect(b.textContent!.trim().length).toBeGreaterThan(0);
      expect(b.className).toContain('min-h-11'); // ≥ 24 px (R9)
    }
  });
});

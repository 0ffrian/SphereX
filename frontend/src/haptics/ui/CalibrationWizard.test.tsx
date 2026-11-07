// R8.7 calibration wizard: runs only on phones that vibrate, plays the probe, level and beat
// patterns, measures the tap-along offset (touch and Space), saves under the one key and applies
// it; Cancel at every step saves nothing; skipping keeps stored values; leaving stops playback.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAudioContext } from '@/test/fakeAudio';
import { FakeClock, fakeVibrate } from '@/test/fakeHaptics';
import {
  CALIBRATION_STORAGE_KEY,
  beatPlan,
  loadCalibration,
  saveCalibration,
  type Calibration,
} from '../calibration';
import { AudioDriver } from '../drivers/audio';
import { WebVibrateDriver } from '../drivers/webVibrate';
import { HapticEngine, type HapticOutputs } from '../haptics';
import type { PlatformEnv } from '../platform';
import { defaultSettings, useHapticSettings } from '../settings';
import { CALIBRATION_GAP_MS, TAP_BEAT_COUNT, TAP_BEAT_PERIOD_MS } from '../tuning';
import {
  CalibrationWizard,
  describeOffset,
  type CalibrationWizardProps,
} from './CalibrationWizard';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const PHONE: PlatformEnv = { android: true, coarsePointer: true };

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

const STORED: Calibration = {
  version: 1,
  minMs: 20,
  levels: ['whisper', 'soft', 'medium', 'firm'],
  avOffsetMs: -120,
};

describe('CalibrationWizard (R8.7)', () => {
  let host: HTMLDivElement;
  let root: Root;
  let t = 0;
  const now = () => t;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    useHapticSettings.setState({
      ...defaultSettings({ hapticsOn: true, soundOn: true }),
      loaded: true,
    });
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

  const render = (props: Partial<CalibrationWizardProps> & { haptics: HapticOutputs }) =>
    act(() => root.render(<CalibrationWizard now={now} platform={PHONE} {...props} />));
  const buttons = () => [...host.querySelectorAll('button')];
  const find = (name: string | RegExp) =>
    buttons().find((el) =>
      typeof name === 'string' ? el.textContent === name : name.test(el.textContent ?? ''),
    );
  const button = (name: string | RegExp) => {
    const b = find(name);
    if (!b) throw new Error(`no button "${String(name)}" in: ${host.textContent}`);
    return b;
  };
  const click = async (name: string | RegExp) => {
    await act(async () => button(name).click());
  };
  const statusLine = () => host.querySelector<HTMLElement>('[role="status"]')!;
  const live = () => statusLine().textContent!.trim();
  const focused = () => document.activeElement?.textContent;
  const endBeat = async () => {
    await act(async () => {
      vi.advanceTimersByTime((TAP_BEAT_COUNT + 1) * TAP_BEAT_PERIOD_MS);
    });
  };

  /** Play a beat and tap `lagMs` after every beat; the warm-up taps are ignored. */
  const tapAlong = async (start: string, lagMs: number, via: 'pointer' | 'space' = 'pointer') => {
    await click(start);
    const t0 = t;
    const tap = button(/beat: tap with each/);
    for (let k = 0; k < TAP_BEAT_COUNT; k++) {
      t = t0 + k * TAP_BEAT_PERIOD_MS + lagMs;
      act(() => {
        if (via === 'pointer') tap.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        else tap.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      });
    }
    await endBeat();
  };

  it.each([
    ['no vibrate API', false, PHONE],
    ['desktop Chrome (vibrate, no Android)', true, { android: false, coarsePointer: false }],
    ['Chromebook / Android desktop mode (no touch)', true, { android: true, coarsePointer: false }],
  ])('does not run on %s', (_name, canVibrate, platform) => {
    const { haptics, vib } = outputs(canVibrate);
    render({ haptics, vibrate: canVibrate ? vib.fn : null, platform });
    expect(host.textContent).toContain('Calibration is for phones that vibrate');
    expect(host.textContent).not.toContain('plays as sound');
    expect(host.querySelector('button')).toBeNull();
  });

  it('runs the three steps, measures the offset and saves it', async () => {
    vi.useFakeTimers();
    const { haptics, ctx, vib } = outputs();
    const onDone = vi.fn();
    render({ haptics, vibrate: vib.fn, onDone });

    await click('Start');
    expect(haptics.engine.unlock).toHaveBeenCalledTimes(1);
    // The focused heading says the step; the status line does not repeat it.
    expect(focused()).toBe('Step 1 of 3: the faintest pulse');
    expect(live()).toBe('');

    await click('Play the three pulses');
    expect(vib.calls.at(-1)).toEqual([5, CALIBRATION_GAP_MS, 10, CALIBRATION_GAP_MS, 20]);
    await click('Second (10 ms)');
    expect(focused()).toMatch(/^Step 2 of 3/);

    await click('Play the four buzzes');
    const g = CALIBRATION_GAP_MS;
    expect(vib.calls.at(-1)).toEqual([4, 4, 4, 4, 4, g, 10, g, 15, g, 25]);
    await click('Yes, it was weaker');
    expect(focused()).toMatch(/^Step 3 of 3/);
    expect(host.textContent).toContain('media volume up and silent mode off');

    // Vibration felt 100 ms after the beat, sound heard 40 ms after: +60 ms, audio waits.
    await tapAlong('Start the vibration beat', 100);
    expect(vib.calls.at(-1)).toHaveLength(2 * TAP_BEAT_COUNT - 1);
    expect(live()).toMatch(/sound only/);
    // Focus moves to the next action when the Tap button goes away.
    expect(document.activeElement?.textContent).toBe('Start the sound beat');
    const before = ctx.sources().length;
    await tapAlong('Start the sound beat', 40, 'space');
    expect(ctx.sources().length - before).toBe(beatPlan().count);
    expect(live()).toBe(`Offset measured: ${describeOffset(60)}`);
    expect(document.activeElement?.textContent).toBe('Save calibration');

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

  it('Measure again restarts the tap-along', async () => {
    vi.useFakeTimers();
    const { haptics, vib } = outputs();
    render({ haptics, vibrate: vib.fn });
    await click('Start');
    await click('Skip this step');
    await click('Skip this step');
    await tapAlong('Start the vibration beat', 100);
    await tapAlong('Start the sound beat', 40);
    await click('Measure again');
    expect(find('Start the vibration beat')).toBeDefined();
    expect(find('Save calibration')).toBeUndefined();
    expect(document.activeElement?.textContent).toBe('Start the vibration beat');
  });

  it('Cancel is offered on every step and saves nothing', async () => {
    saveCalibration(STORED);
    for (const steps of [[], ['Skip this step'], ['Skip this step', 'Skip this step']]) {
      const { haptics, vib } = outputs();
      const onCancel = vi.fn();
      render({ haptics, vibrate: vib.fn, onCancel });
      await click('Start');
      for (const s of steps) await click(s);
      await click('Cancel');
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(loadCalibration()).toEqual(STORED);
      act(() => root.render(<p />));
    }
  });

  it('skipping every step keeps the stored calibration (nothing re-measured)', async () => {
    saveCalibration(STORED);
    const { haptics, vib } = outputs();
    const onDone = vi.fn();
    render({ haptics, vibrate: vib.fn, onDone });
    await click('Start');
    await click('Skip this step');
    await click('Skip this step');
    await click('Skip this step');
    expect(loadCalibration()).toEqual(STORED);
    expect(onDone).toHaveBeenCalledWith(STORED, false);
    expect(haptics.vibrate.delayMs).toBe(120);
    expect(host.textContent).toContain('nothing changed');
  });

  it('a re-measured step changes only that value', async () => {
    saveCalibration(STORED);
    const { haptics, vib } = outputs();
    render({ haptics, vibrate: vib.fn });
    await click('Start');
    await click('Skip this step');
    await click('Play the four buzzes');
    await click('No, the same or stronger');
    await click('Skip this step');
    expect(loadCalibration()).toEqual({ ...STORED, levels: ['soft', 'medium', 'firm'] });
  });

  it('too few taps asks to try again', async () => {
    vi.useFakeTimers();
    const { haptics, vib } = outputs();
    render({ haptics, vibrate: vib.fn });
    await click('Start');
    await click('Skip this step');
    await click('Skip this step');
    await click('Start the vibration beat');
    await endBeat();
    expect(live()).toMatch(/Not enough taps/);
    expect(document.activeElement?.textContent).toBe('Try again');
  });

  it('skip and unmount stop a raw vibrate pattern still playing', async () => {
    vi.useFakeTimers();
    const { haptics, vib } = outputs();
    render({ haptics, vibrate: vib.fn });
    await click('Start');
    await click('Skip this step');
    await click('Skip this step');
    await click('Start the vibration beat');
    expect(vib.calls.at(-1)).toHaveLength(2 * TAP_BEAT_COUNT - 1);
    await click('Skip this step');
    expect(vib.calls.at(-1)).toBe(0);
    act(() => root.render(<p />));

    const second = outputs();
    render({ haptics: second.haptics, vibrate: second.vib.fn });
    await click('Start');
    await click('Play the three pulses');
    act(() => root.render(<p />));
    expect(second.vib.calls.at(-1)).toBe(0);
  });

  it('leaving mid sound beat cancels the scheduled sound and restores the old offset', async () => {
    vi.useFakeTimers();
    const { haptics, ctx, vib } = outputs();
    haptics.audio.setOffsetMs(80);
    render({ haptics, vibrate: vib.fn });
    await click('Start');
    await click('Skip this step');
    await click('Skip this step');
    await tapAlong('Start the vibration beat', 50);
    await click('Start the sound beat');
    expect(haptics.audio.offsetMs).toBe(0);
    const beat = ctx.sources().slice(-beatPlan().count);
    expect(beat).toHaveLength(beatPlan().count);
    act(() => root.render(<p />));
    expect(haptics.audio.offsetMs).toBe(80);
    expect(beat.every((s) => s.disconnected)).toBe(true);
    expect(loadCalibration()).toBeNull();
  });

  it('the sound beat starts once, even when clicked twice before audio resumes', async () => {
    vi.useFakeTimers();
    const { haptics, ctx, vib } = outputs();
    let resolve!: (v: boolean) => void;
    vi.mocked(haptics.engine.unlock).mockImplementation(
      () => new Promise<boolean>((r) => (resolve = r)),
    );
    render({ haptics, vibrate: vib.fn });
    await click('Start');
    await click('Skip this step');
    await click('Skip this step');
    await tapAlong('Start the vibration beat', 50);
    const start = button('Start the sound beat');
    const before = ctx.sources().length;
    await act(async () => start.click());
    await act(async () => start.click());
    await act(async () => resolve(true));
    expect(ctx.sources().length - before).toBe(beatPlan().count);
  });

  it('a sound beat after unmount never plays', async () => {
    vi.useFakeTimers();
    const { haptics, ctx, vib } = outputs();
    let resolve!: (v: boolean) => void;
    vi.mocked(haptics.engine.unlock).mockImplementation(
      () => new Promise<boolean>((r) => (resolve = r)),
    );
    render({ haptics, vibrate: vib.fn });
    await click('Start');
    await click('Skip this step');
    await click('Skip this step');
    await tapAlong('Start the vibration beat', 50);
    await click('Start the sound beat');
    const before = ctx.sources().length;
    act(() => root.render(<p />));
    await act(async () => resolve(true));
    expect(ctx.sources().length).toBe(before);
  });

  it('with sound off it says so instead of playing a silent beat', async () => {
    vi.useFakeTimers();
    useHapticSettings.setState({ soundOn: false });
    const { haptics, ctx, vib } = outputs();
    render({ haptics, vibrate: vib.fn });
    await click('Start');
    await click('Skip this step');
    await click('Skip this step');
    await tapAlong('Start the vibration beat', 50);
    const before = ctx.sources().length;
    await click('Start the sound beat');
    expect(ctx.sources().length).toBe(before);
    expect(live()).toMatch(/Sound is off/);
    expect(find('Save without the offset')).toBeDefined();
    // The same sentence twice in a row still changes the live region, so it is announced again.
    const region = statusLine();
    const first = region.textContent;
    await click('Try the sound beat again');
    expect(region.textContent).not.toBe(first);
    expect(live()).toBe(first!.trim());
  });

  it('"I felt none" keeps the default soft tick and says why it may be', async () => {
    const { haptics, vib } = outputs();
    render({ haptics, vibrate: vib.fn });
    await click('Start');
    await click('Play the three pulses');
    await click('I felt none');
    await click('Play the four buzzes');
    await click('I did not feel the first one');
    await click('Skip this step');
    expect(loadCalibration()?.minMs).toBe(8);
    expect(loadCalibration()?.levels).toHaveLength(3);
    expect(host.textContent).toContain('Faintest pulse: 8 ms (default: no pulse felt)');
    expect(host.textContent).toContain('battery saver');
    expect(localStorage.key(0)).toBe(CALIBRATION_STORAGE_KEY);
  });

  it('status and failures are visible, and the beat says its channel and count', async () => {
    vi.useFakeTimers();
    const { haptics, vib } = outputs();
    render({ haptics, vibrate: vib.fn });
    await click('Start');
    await click('Skip this step');
    await click('Skip this step');
    await click('Start the vibration beat');
    expect(find('Vibration beat: tap with each buzz')).toBeDefined();
    expect(host.textContent).toContain(`Beat 1 of ${TAP_BEAT_COUNT} · 0 taps`);
    await act(async () => {
      vi.advanceTimersByTime(TAP_BEAT_PERIOD_MS);
    });
    expect(host.textContent).toContain(`Beat 2 of ${TAP_BEAT_COUNT}`);
    await endBeat();
    const line = statusLine();
    expect(line.className).not.toContain('sr-only');
    expect(line.textContent).toMatch(/Not enough taps/);
    // The status line sits right under the step text, before the controls.
    expect(line.previousElementSibling?.tagName).toBe('P');
    expect(line.nextElementSibling?.querySelector('button')?.textContent).toBe('Try again');
  });

  it('answers wait until the pulses or buzzes have played', async () => {
    const { haptics, vib } = outputs();
    render({ haptics, vibrate: vib.fn });
    await click('Start');
    expect(button('Second (10 ms)').disabled).toBe(true);
    expect(host.querySelector('[role="group"]')!.getAttribute('aria-label')).toMatch(
      /play them first/,
    );
    await click('Play the three pulses');
    expect(button('Second (10 ms)').disabled).toBe(false);
    await click('Second (10 ms)');
    expect(button('Yes, it was weaker').disabled).toBe(true);
    await click('Play the four buzzes');
    expect(button('Yes, it was weaker').disabled).toBe(false);
  });

  it('opening focuses the intro heading and scrolls it into view', () => {
    const scroll = vi.fn();
    HTMLElement.prototype.scrollIntoView = scroll;
    const { haptics, vib } = outputs();
    render({ haptics, vibrate: vib.fn });
    expect(focused()).toBe('Calibrate vibration for this phone');
    expect(scroll).toHaveBeenCalled();
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  });

  it('closing returns focus to the opener; cancelling without a host goes back to the intro', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    const ref = { current: opener };
    const { haptics, vib } = outputs();
    const onCancel = vi.fn();
    render({ haptics, vibrate: vib.fn, onCancel, returnFocusRef: ref });
    await click('Start');
    await click('Cancel');
    expect(onCancel).toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);

    // The host closes the wizard itself (e.g. in onDone) while focus is inside it.
    act(() => root.render(<p />));
    render({ haptics, vibrate: vib.fn, returnFocusRef: ref });
    expect(focused()).toBe('Calibrate vibration for this phone');
    act(() => root.render(<p />));
    expect(document.activeElement).toBe(opener);

    render({ haptics, vibrate: vib.fn });
    await click('Start');
    await click('Cancel');
    expect(focused()).toBe('Calibrate vibration for this phone');
    expect(live()).toBe('Calibration cancelled. Nothing was saved.');
    opener.remove();
  });

  it('"I felt none" keeps the stored faintest pulse and does not count as a measurement', async () => {
    saveCalibration(STORED);
    const { haptics, vib } = outputs();
    render({ haptics, vibrate: vib.fn });
    await click('Start');
    await click('Play the three pulses');
    await click('I felt none');
    await click('Skip this step');
    await click('Skip this step');
    expect(loadCalibration()).toEqual(STORED);
    expect(host.textContent).toContain('Faintest pulse: 20 ms (kept: no pulse felt)');
    expect(host.textContent).toContain('nothing changed');
  });

  it('Cancel then Start begins a fresh run: nothing from the cancelled run is saved', async () => {
    const { haptics, vib } = outputs();
    render({ haptics, vibrate: vib.fn });
    await click('Start');
    await click('Play the three pulses');
    await click('Second (10 ms)');
    await click('Play the four buzzes');
    await click('Yes, it was weaker');
    await click('Cancel');
    expect(live()).toBe('Calibration cancelled. Nothing was saved.');
    await click('Start');
    // The answers are locked again until the pulses play in this run.
    expect(button('Second (10 ms)').disabled).toBe(true);
    await click('Skip this step');
    expect(button('Yes, it was weaker').disabled).toBe(true);
    await click('Skip this step');
    await click('Skip this step');
    expect(loadCalibration()).toBeNull();
    expect(host.textContent).toContain('Nothing was measured, so nothing changed.');
    expect(host.textContent).toContain('Faintest pulse: 8 ms (kept)');
  });

  it('playing announces what to do next; a hint says the answers unlock after playing', async () => {
    const { haptics, vib } = outputs();
    render({ haptics, vibrate: vib.fn });
    await click('Start');
    expect(host.textContent).toContain('Play the pulses first; these buttons unlock then.');
    await click('Play the three pulses');
    expect(live()).toBe('Played. Now pick the faintest one you felt.');
    expect(host.textContent).not.toContain('these buttons unlock then');
    await click('First (5 ms)');
    expect(host.textContent).toContain('Play the buzzes first; these buttons unlock then.');
    await click('Play the four buzzes');
    expect(live()).toBe('Played. Was the first buzz weaker than the second?');
  });

  it('a failed save is said in the status line', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { haptics, vib } = outputs();
    render({ haptics, vibrate: vib.fn });
    await click('Start');
    await click('Play the three pulses');
    await click('First (5 ms)');
    await click('Skip this step');
    await click('Skip this step');
    expect(live()).toBe('Could not save on this device; it applies until you close the page.');
    expect(haptics.vibrate.levels[0]).toBe(5); // applied for this session
  });

  it('with vibration off in the settings it plays no raw pattern and says so', async () => {
    const { haptics, vib } = outputs();
    act(() => useHapticSettings.setState({ hapticsOn: false }));
    render({ haptics, vibrate: vib.fn });
    await click('Start');
    const n = vib.calls.length;
    await click('Play the three pulses');
    expect(vib.calls.length).toBe(n);
    expect(live()).toBe('Vibration is off in the settings. Turn it on to calibrate, or cancel.');
    expect(button('First (5 ms)').disabled).toBe(true);
    await click('Skip this step');
    await click('Play the four buzzes');
    expect(vib.calls.length).toBe(n);
    await click('Skip this step');
    await click('Start the vibration beat');
    expect(vib.calls.length).toBe(n);
    expect(find(/beat: tap with each/)).toBeUndefined();
  });

  it('skipping step 2 after a shorter faintest pulse drops the stored whisper (Q-74)', async () => {
    saveCalibration(STORED); // minMs 20, whisper kept
    const { haptics, vib } = outputs();
    render({ haptics, vibrate: vib.fn });
    await click('Start');
    await click('Play the three pulses');
    await click('First (5 ms)');
    await click('Skip this step');
    await click('Skip this step');
    expect(loadCalibration()).toEqual({ ...STORED, minMs: 5, levels: ['soft', 'medium', 'firm'] });
    expect(host.textContent).toContain('whisper dropped: the faintest pulse is now shorter');
  });

  it('skipping step 2 keeps the stored whisper when the faintest pulse is not shorter', async () => {
    saveCalibration(STORED);
    const { haptics, vib } = outputs();
    render({ haptics, vibrate: vib.fn });
    await click('Start');
    await click('Play the three pulses');
    await click('Third (20 ms)');
    await click('Skip this step');
    await click('Skip this step');
    expect(loadCalibration()?.levels).toEqual(STORED.levels);
    expect(host.textContent).not.toContain('whisper dropped');
  });

  it('a screen-reader double-tap (a click with no pointer down) counts as one tap', async () => {
    vi.useFakeTimers();
    const { haptics, vib } = outputs();
    render({ haptics, vibrate: vib.fn });
    await click('Start');
    await click('Skip this step');
    await click('Skip this step');
    await click('Start the vibration beat');
    const tap = button(/beat: tap with each/);
    act(() => tap.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })));
    expect(host.textContent).toContain('· 1 tap');
    // A finger counts on pointer down; the click that follows (detail 1) does not count again.
    act(() => {
      tap.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      tap.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    expect(host.textContent).toContain('· 2 taps');
  });

  it('a new haptics object mid-beat does not stall the beat', async () => {
    vi.useFakeTimers();
    const first = outputs();
    render({ haptics: first.haptics, vibrate: first.vib.fn });
    await click('Start');
    await click('Skip this step');
    await click('Skip this step');
    await click('Start the vibration beat');
    render({ haptics: outputs().haptics, vibrate: first.vib.fn });
    await endBeat();
    expect(live()).toMatch(/Not enough taps/);
  });

  it('every button is a real button with a text label and a 44 px target', async () => {
    const { haptics, vib } = outputs();
    render({ haptics, vibrate: vib.fn });
    await click('Start');
    for (const b of buttons()) {
      expect(b.getAttribute('type')).toBe('button');
      expect(b.textContent!.trim().length).toBeGreaterThan(0);
      expect(b.className).toContain('min-h-11'); // ≥ 24 px (R9)
    }
  });
});

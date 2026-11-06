// R8.7 settings UI on top of the settings store: each control saves, labels are present, and the
// calibrate button is offered only where the device can vibrate.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_STORAGE_KEY, defaultSettings, useHapticSettings } from '../settings';
import { HapticsSettings } from './HapticsSettings';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

function setRange(el: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('HapticsSettings (R8.7)', () => {
  let host: HTMLDivElement;
  let root: Root;

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
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  const input = (label: RegExp) => {
    const l = [...host.querySelectorAll('label')].find((el) => label.test(el.textContent ?? ''));
    if (!l) throw new Error(`no label ${label}`);
    return l.querySelector('input')!;
  };
  const saved = () =>
    JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!) as Record<string, unknown>;

  it('each control updates and saves the settings', () => {
    act(() => root.render(<HapticsSettings canVibrate />));
    act(() => input(/^Vibration/).click());
    expect(useHapticSettings.getState().hapticsOn).toBe(false);
    expect(saved().hapticsOn).toBe(false);

    act(() => input(/^Sound/).click());
    expect(useHapticSettings.getState().soundOn).toBe(false);
    expect(input(/^Volume/).disabled).toBe(true);
    act(() => input(/^Sound/).click());

    act(() => setRange(input(/^Volume/), '0.3'));
    expect(useHapticSettings.getState().volume).toBeCloseTo(0.3);
    expect(host.textContent).toContain('Volume: 30%');

    act(() => setRange(input(/^Strength/), '1.5'));
    expect(useHapticSettings.getState().strengthMultiplier).toBe(1.5);
    expect(input(/^Strength/).min).toBe('0.5');
    expect(input(/^Strength/).max).toBe('1.5');

    act(() => input(/texture and data labels/).click());
    expect(saved().showChannelLabels).toBe(false);
  });

  it('says when the device cannot vibrate, and offers calibration only where it can', () => {
    const onCalibrate = vi.fn();
    act(() => root.render(<HapticsSettings canVibrate={false} onCalibrate={onCalibrate} />));
    expect(host.textContent).toContain('cannot vibrate');
    expect(input(/^Vibration/).getAttribute('aria-describedby')).toBeTruthy();
    expect(host.textContent).not.toContain('Calibrate vibration');

    act(() => root.render(<HapticsSettings canVibrate onCalibrate={onCalibrate} />));
    const b = [...host.querySelectorAll('button')].find(
      (el) => el.textContent === 'Calibrate vibration',
    )!;
    act(() => b.click());
    expect(onCalibrate).toHaveBeenCalledTimes(1);
  });

  it('reset clears the saved settings', () => {
    act(() => root.render(<HapticsSettings canVibrate />));
    act(() => setRange(input(/^Volume/), '0.2'));
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).not.toBeNull();
    const reset = [...host.querySelectorAll('button')].find(
      (el) => el.textContent === 'Reset to defaults',
    )!;
    act(() => reset.click());
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
  });
});

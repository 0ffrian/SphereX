// R13.9 / R13.10 (Q-442; moved into the build view's Ambience dropdown by Q-456): each control
// updates the saved settings, every slider has a visible label, and the status line names each state.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAudioContext } from '@/test/fakeAudio';
import { setAudioContextFactory } from '../audioContext';
import { createAppSound, type AppSound } from '../appSound';
import { defaultSettings, flushSoundSettings, useSoundSettings } from '../settings';
import { SoundProvider } from '../SoundProvider';
import {
  LATENCY_HINT,
  SOUND_STATUS_AMBIENCE_OFF,
  SOUND_STATUS_NONE,
  SOUND_STATUS_OFF,
  SOUND_STATUS_READY,
  SOUND_STATUS_SUSPENDED,
  SoundControls,
} from './SoundSettings';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let host: HTMLDivElement;
let root: Root;
let ctx: FakeAudioContext;
let sound: AppSound;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  useSoundSettings.setState({ ...defaultSettings(), loaded: false });
  ctx = new FakeAudioContext({ state: 'suspended' });
  setAudioContextFactory(() => ctx.asAudioContext());
  sound = createAppSound({ engine: { debugTarget: null } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  setAudioContextFactory(null);
  flushSoundSettings();
  localStorage.clear();
  vi.restoreAllMocks();
});

const q = <T extends HTMLElement>(id: string) => host.querySelector<T>(`[data-testid="${id}"]`)!;

async function render() {
  await act(async () =>
    root.render(
      <SoundProvider sound={sound}>
        <SoundControls />
      </SoundProvider>,
    ),
  );
}

describe('SoundControls', () => {
  it('each switch updates the saved settings; a volume is off with its switch', async () => {
    await render();
    await act(async () => q('sound-ambience').click());
    expect(useSoundSettings.getState().ambienceOn).toBe(false);
    expect(q<HTMLInputElement>('sound-ambience-volume').disabled).toBe(true);
    await act(async () => q('sound-flashes').click());
    expect(useSoundSettings.getState().flashesOn).toBe(false);
    await act(async () => q('sound-on').click());
    expect(useSoundSettings.getState().soundOn).toBe(false);
    expect(q<HTMLInputElement>('sound-volume').disabled).toBe(true);
    expect(q('sound-on').getAttribute('aria-checked')).toBe('false');
    flushSoundSettings();
    expect(JSON.parse(localStorage.getItem('sx.haptics.settings')!)).toMatchObject({
      soundOn: false,
      ambienceOn: false,
      flashesOn: false,
    });
  });

  it('every slider has a visible label and switches are named', async () => {
    await render();
    for (const input of host.querySelectorAll('input')) {
      expect(host.querySelector(`label[for="${input.id}"]`)?.textContent).toBeTruthy();
    }
    for (const sw of host.querySelectorAll('[role="switch"]')) {
      const id = sw.getAttribute('aria-labelledby')!;
      expect(document.getElementById(id)?.textContent).toBeTruthy();
    }
  });

  it('the status line names each state', async () => {
    await render();
    expect(q('sound-status').textContent).toBe(SOUND_STATUS_READY);
    await act(async () => sound.unlock());
    expect(q('sound-status').textContent).toBe(SOUND_STATUS_READY);
    await act(async () => ctx.simulateState('suspended'));
    expect(q('sound-status').textContent).toBe(SOUND_STATUS_SUSPENDED);
    await act(async () => useSoundSettings.getState().update({ ambienceOn: false }));
    expect(q('sound-status').textContent).toBe(SOUND_STATUS_AMBIENCE_OFF);
    await act(async () => useSoundSettings.getState().update({ soundOn: false }));
    expect(q('sound-status').textContent).toBe(SOUND_STATUS_OFF);
  });

  it('says so when the browser has no Web Audio', async () => {
    setAudioContextFactory(() => null);
    sound = createAppSound({ engine: { debugTarget: null } });
    await render();
    await act(async () => sound.unlock());
    expect(q('sound-status').textContent).toBe(SOUND_STATUS_NONE);
  });

  it('hints at Bluetooth only after unlock when the output latency is high (R8.9)', async () => {
    ctx = new FakeAudioContext({ state: 'suspended', outputLatency: 0.2 });
    setAudioContextFactory(() => ctx.asAudioContext());
    sound = createAppSound({ engine: { debugTarget: null } });
    await render();
    expect(q('sound-latency-hint')).toBeNull();
    await act(async () => sound.unlock());
    expect(q('sound-latency-hint')?.textContent).toBe(LATENCY_HINT);
  });

  it('shows no latency hint at a low or unknown output latency', async () => {
    for (const outputLatency of [0.02, undefined]) {
      ctx = new FakeAudioContext({ state: 'suspended', outputLatency });
      setAudioContextFactory(() => ctx.asAudioContext());
      sound = createAppSound({ engine: { debugTarget: null } });
      await render();
      await act(async () => sound.unlock());
      expect(q('sound-latency-hint')).toBeNull();
      await act(async () => root.unmount());
      root = createRoot(host);
    }
  });
});

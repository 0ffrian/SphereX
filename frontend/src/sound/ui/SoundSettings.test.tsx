// R13.9 / R13.10 (Q-442): the shell's Sound control. Its click unlocks audio and plays nothing; each
// control updates the saved settings; Escape is consumed (A21.10 order) and focus goes back; the
// status line names each state.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAudioContext } from '@/test/fakeAudio';
import { setAudioContextFactory } from '../audioContext';
import { createAppSound, type AppSound } from '../appSound';
import { defaultSettings, flushSoundSettings, useSoundSettings } from '../settings';
import { SoundProvider } from '../SoundProvider';
import {
  SOUND_STATUS_NONE,
  SOUND_STATUS_OFF,
  SOUND_STATUS_READY,
  SOUND_STATUS_SUSPENDED,
  SoundSettings,
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

const q = <T extends HTMLElement>(id: string) =>
  host.querySelector<T>(`[data-testid="${id}"]`)!;
const byLabel = (text: string) => {
  const label = [...host.querySelectorAll('label')].find((l) => l.textContent === text)!;
  return document.getElementById(label.htmlFor) as HTMLInputElement;
};

async function render() {
  await act(async () =>
    root.render(
      <SoundProvider sound={sound}>
        <SoundSettings />
      </SoundProvider>,
    ),
  );
}

describe('SoundSettings (R13.9)', () => {
  it('starts closed; the first click unlocks audio once, plays nothing and opens the popover', async () => {
    await render();
    const button = q<HTMLButtonElement>('sound-button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(q('sound-popover').hidden).toBe(true);
    const unlock = vi.spyOn(sound, 'unlock');
    await act(async () => button.click());
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(ctx.resumes).toBe(1);
    expect(ctx.sources()).toHaveLength(0);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(q('sound-popover').id);
    expect(q('sound-popover').hidden).toBe(false);
  });

  it('each control updates the saved settings; ambience volume is off with the ambience', async () => {
    await render();
    await act(async () => q<HTMLButtonElement>('sound-button').click());
    await act(async () => byLabel('Ambience (fly view)').click());
    expect(useSoundSettings.getState().ambienceOn).toBe(false);
    expect(byLabel('Ambience volume').disabled).toBe(true);
    await act(async () => byLabel('Flashes').click());
    expect(useSoundSettings.getState().flashesOn).toBe(false);
    await act(async () => byLabel('Sound').click());
    expect(useSoundSettings.getState().soundOn).toBe(false);
    expect(byLabel('Volume').disabled).toBe(true);
    expect(q('sound-button').textContent).toContain('off');
    flushSoundSettings();
    expect(JSON.parse(localStorage.getItem('sx.haptics.settings')!)).toMatchObject({
      soundOn: false,
      ambienceOn: false,
      flashesOn: false,
    });
  });

  it('every input has a visible label', async () => {
    await render();
    for (const input of host.querySelectorAll('input')) {
      expect(host.querySelector(`label[for="${input.id}"]`)?.textContent).toBeTruthy();
    }
  });

  it('Escape closes it, is consumed, and focus returns to the button', async () => {
    await render();
    const button = q<HTMLButtonElement>('sound-button');
    await act(async () => button.click());
    byLabel('Flashes').focus();
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => document.dispatchEvent(esc));
    expect(esc.defaultPrevented).toBe(true);
    expect(q('sound-popover').hidden).toBe(true);
    expect(document.activeElement).toBe(button);
  });

  it('an outside click closes it', async () => {
    await render();
    await act(async () => q<HTMLButtonElement>('sound-button').click());
    await act(async () =>
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })),
    );
    expect(q('sound-popover').hidden).toBe(true);
  });

  it('the status line names each state', async () => {
    await render();
    expect(q('sound-status').textContent).toBe(SOUND_STATUS_READY); // before any click
    await act(async () => q<HTMLButtonElement>('sound-button').click());
    expect(q('sound-status').textContent).toBe(SOUND_STATUS_READY); // running
    await act(async () => ctx.simulateState('suspended'));
    expect(q('sound-status').textContent).toBe(SOUND_STATUS_SUSPENDED);
    await act(async () => useSoundSettings.getState().update({ soundOn: false }));
    expect(q('sound-status').textContent).toBe(SOUND_STATUS_OFF);
  });

  it('says so when the browser has no Web Audio', async () => {
    setAudioContextFactory(() => null);
    sound = createAppSound({ engine: { debugTarget: null } });
    await render();
    await act(async () => q<HTMLButtonElement>('sound-button').click());
    expect(q('sound-status').textContent).toBe(SOUND_STATUS_NONE);
  });
});

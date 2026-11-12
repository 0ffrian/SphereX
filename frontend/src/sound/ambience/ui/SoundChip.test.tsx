// R13.11 test 10 (UI): the chip, the caption and its live region, the panel and their a11y attributes.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeAudioContext } from '@/test/fakeAudio';
import { setAudioContextFactory, unlockAudio } from '../../audioContext';
import { useSoundSettings } from '../../settings';
import { IDLE_UI, type AmbienceUi } from '../ambienceLoop';
import { useAmbienceStore } from '../ambienceStore';
import { resetWeatherBus } from '../weatherBus';
import { CHIP_TEXT, SoundChip } from './SoundChip';
import { HOW_TEXT, LEGEND_TEXT } from './WhatYouHear';

let container: HTMLDivElement;
let root: Root;

const UI: AmbienceUi = {
  ...IDLE_UI,
  status: 'playing',
  live: true,
  caption: 'Strong wind on a ridge · surf to the south',
  levelNote: null,
  heard: [
    { id: 'S1_land', phrase: 'Strong wind on a ridge', relDb: 0 },
    { id: 'S4', phrase: 'surf to the south', relDb: -7 },
  ],
  notHeard: [{ source: 'S7', reason: 'No rivers flow here.' }],
  airFacts: [{ label: 'Speed of sound', text: '340 m/s' }],
  inputs: [{ label: 'Surface pressure', value: 1.2, unit: 'bar', tag: 'measured', source: 'card' }],
  selected: 3,
  ready: 2,
};

const render = async () => {
  await act(async () => root.render(<SoundChip />));
};
const button = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement | undefined;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  setAudioContextFactory(() => new FakeAudioContext().asAudioContext());
  useSoundSettings.getState().reset();
  useAmbienceStore.setState({ ui: UI });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setAudioContextFactory(null);
  useAmbienceStore.setState({ ui: IDLE_UI });
  resetWeatherBus();
});

describe('SoundChip', () => {
  it('is hidden unless the fly view is live at + Artistic', async () => {
    useAmbienceStore.setState({ ui: { ...UI, live: false } });
    await render();
    expect(container.querySelector('[data-testid="world-fly-sound"]')).toBeNull();
  });

  it('locked audio: "Click to hear" unlocks; then Mute toggles the ambience setting with aria-pressed', async () => {
    await render();
    expect(container.textContent).toContain(CHIP_TEXT.title);
    expect(container.textContent).toContain(CHIP_TEXT.locked);
    await act(async () => {
      button(CHIP_TEXT.start)!.click();
      await unlockAudio();
    });
    const mute = button(CHIP_TEXT.mute)!;
    expect(mute.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[data-testid="world-fly-caption"]')!.textContent).toBe(UI.caption);
    await act(async () => mute.click());
    expect(useSoundSettings.getState().ambienceOn).toBe(false);
    expect(button(CHIP_TEXT.mute)!.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain(CHIP_TEXT.muted);
  });

  it('sound off offers "Turn sound on"', async () => {
    useSoundSettings.getState().update({ soundOn: false });
    await render();
    expect(container.textContent).toContain(CHIP_TEXT.soundOff);
    await act(async () => button(CHIP_TEXT.turnOn)!.click());
    expect(useSoundSettings.getState().soundOn).toBe(true);
  });

  it('the visible caption is not live; the sr-only region speaks only with "Read changes aloud" on', async () => {
    await act(async () => void (await unlockAudio()));
    await render();
    const live = container.querySelector('[data-testid="world-fly-caption-live"]')!;
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toBe('');
    expect(container.querySelector('[data-testid="world-fly-caption"]')!.hasAttribute('aria-live')).toBe(false);
    await act(async () => useSoundSettings.getState().update({ readCaptions: true }));
    expect(live.textContent).toBe(UI.caption);
  });

  it('"What you hear" opens the panel (aria-expanded, aria-controls); Escape closes it and returns focus', async () => {
    await render();
    const what = button(CHIP_TEXT.what)!;
    expect(what.getAttribute('aria-expanded')).toBe('false');
    await act(async () => what.click());
    expect(what.getAttribute('aria-expanded')).toBe('true');
    const panel = container.querySelector('[data-testid="what-you-hear"]')!;
    expect(panel.id).toBe(what.getAttribute('aria-controls'));
    expect(panel.getAttribute('role')).toBe('region');
    expect(panel.textContent).toContain('Strong wind on a ridge');
    expect(panel.textContent).toContain('−7 dB');
    expect(panel.textContent).toContain('No rivers flow here.');
    expect(panel.textContent).toContain('Preparing sounds (2 of 3)');
    expect(panel.textContent).toContain('Speed of sound');
    expect(panel.textContent).toContain('Surface pressure');
    expect(panel.textContent).toContain(LEGEND_TEXT);
    expect(panel.textContent).toContain(HOW_TEXT);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(container.querySelector('[data-testid="what-you-hear"]')).toBeNull();
    expect(document.activeElement).toBe(button(CHIP_TEXT.what));
  });

  it('"Read changes aloud" in the panel sets readCaptions', async () => {
    await render();
    await act(async () => button(CHIP_TEXT.what)!.click());
    const box = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(box.checked).toBe(false);
    await act(async () => box.click());
    expect(useSoundSettings.getState().readCaptions).toBe(true);
  });

  it('while waiting nothing is listed as not heard (R12)', async () => {
    useAmbienceStore.setState({ ui: { ...UI, status: 'waiting', notHeard: [], heard: [], caption: 'Waiting for the world to form…' } });
    await render();
    await act(async () => button(CHIP_TEXT.what)!.click());
    expect(container.textContent).not.toContain('Not heard here');
  });
});

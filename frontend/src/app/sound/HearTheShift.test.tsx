// #78: the "Hear the Shift" toggle (R8.9.2, A20.9) with the real AppSound on a fake AudioContext:
// off by default, start on click (unlock in the click), a tick per new exposure, the path voice while
// the player runs, a restart after the engine dropped the tone, and the tone released on unmount.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErosDemo, ErosHop } from '@/app/area/areaService';
import { ErosCard } from '@/app/area/ErosCard';
import { useAreaStore } from '@/app/shell/areaStore';
import { setAudioContextFactory } from '@/sound/audioContext';
import { duckHolds } from '@/sound/audioGraph';
import { createAppSound, type AppSound } from '@/sound/appSound';
import { defaultSettings, flushSoundSettings, useSoundSettings } from '@/sound/settings';
import { SoundProvider } from '@/sound/SoundProvider';
import { initialAppData, useAppStore } from '@/state/store';
import { FakeAudioContext } from '@/test/fakeAudio';
import {
  HEAR_SHIFT_HINT,
  HEAR_SHIFT_LABEL,
  HEAR_SHIFT_NO_AUDIO,
  HearTheShift,
} from './HearTheShift';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

function hop(exposure: number, detector: string, mjd: number, wl: number): ErosHop {
  return {
    frame_id: `f_${exposure}_${detector}`,
    exposure,
    detector,
    mjd_avg: mjd,
    hw_flags: [],
    nx: 58,
    ny: 59,
    x: 28.5,
    y: 29,
    wl_um: wl,
    flux: 100,
    stars: [],
    seg: [],
    north: [0, 1],
    east: [1, 0],
    png: '',
    flags_png: '',
    wide_px: [0, 0],
  };
}
const EROS: ErosDemo = {
  object: { name: '433 Eros' },
  wide: { png: '', w: 10, h: 10 },
  track: [],
  hops: [
    hop(1, 'D1', 61119.356749534, 0.9861),
    hop(1, 'D4', 61119.356749534, 3.3319),
    hop(2, 'D1', 61119.358241791, 1.0094),
    hop(2, 'D4', 61119.358241791, 3.4224),
  ],
};

let host: HTMLDivElement;
let root: Root;
let ctx: FakeAudioContext;
let sound: AppSound;

const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = async (id: string) => {
  await act(async () => {
    q(id)!.click();
  });
};
const setArea = async (patch: Partial<ReturnType<typeof useAreaStore.getState>>) => {
  await act(async () => {
    useAreaStore.setState(patch);
  });
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  useSoundSettings.setState({ ...defaultSettings(), loaded: false });
  useAppStore.setState(initialAppData);
  useAppStore.setState({ honesty: 'derived' });
  useAreaStore.setState({ eros: EROS, det: null, index: 0, playing: false, screen: 'eros' });
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
  sound.outputs.engine.dispose();
  setAudioContextFactory(null);
  flushSoundSettings();
  localStorage.clear();
  useAreaStore.getState().reset();
  useAreaStore.setState({ eros: null });
  useAppStore.setState({ honesty: 'derived' });
  vi.restoreAllMocks();
});

async function render(node = <HearTheShift />) {
  await act(async () => root.render(<SoundProvider sound={sound}>{node}</SoundProvider>));
}

describe('Hear the Shift (R8.9.2, A20.9)', () => {
  it('is off by default and makes no sound until pressed', async () => {
    const emit = vi.spyOn(sound, 'emitTogether');
    await render();
    const b = q('hear-shift-toggle')!;
    expect(b.textContent).toBe(HEAR_SHIFT_LABEL);
    expect(b.tagName).toBe('BUTTON'); // keyboard: a native button
    expect(b.getAttribute('aria-pressed')).toBe('false');
    expect(q('hear-shift-line')!.getAttribute('role')).toBe('status');
    expect(q('hear-shift-line')!.textContent).toBe('');
    await setArea({ index: 2 });
    expect(emit).not.toHaveBeenCalled();
    expect(ctx.resumes).toBe(0);
  });

  it('the click unlocks audio and sounds the current exposure as one two-note tick', async () => {
    const emit = vi.spyOn(sound, 'emitTogether');
    await render();
    await click('hear-shift-toggle');
    expect(ctx.resumes).toBe(1);
    expect(q('hear-shift-toggle')!.getAttribute('aria-pressed')).toBe('true');
    expect(q('hear-shift-line')!.textContent).toBe(HEAR_SHIFT_HINT);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![0]).toHaveLength(2);
    expect(emit.mock.results[0]!.value).toBe(2); // both notes played
  });

  it('a new exposure ticks again; the voice follows the player; pausing releases it', async () => {
    const emit = vi.spyOn(sound, 'emitTogether');
    await render();
    await click('hear-shift-toggle');
    await setArea({ index: 1 }); // same exposure, other detector
    expect(emit).toHaveBeenCalledTimes(1);
    await setArea({ index: 2, playing: true });
    expect(emit).toHaveBeenCalledTimes(2);
    expect(sound.hasTone('path')).toBe(true);
    expect(duckHolds(ctx.asAudioContext())).toBeGreaterThan(0);
    await setArea({ playing: false });
    expect(sound.hasTone('path')).toBe(false);
  });

  it('starts the tone again after the engine dropped it (honesty change back to + Estimated)', async () => {
    await setArea({ playing: true });
    await render();
    await click('hear-shift-toggle');
    expect(sound.hasTone('path')).toBe(true);
    await act(async () => useAppStore.setState({ honesty: 'measured' }));
    expect(sound.hasTone('path')).toBe(false); // model_dependent is hidden at Measured only
    await act(async () => useAppStore.setState({ honesty: 'derived' }));
    expect(sound.hasTone('path')).toBe(true);
  });

  it('pressing again stops it; unmounting (card closed) releases the tone and the duck', async () => {
    await setArea({ playing: true });
    await render();
    await click('hear-shift-toggle');
    await click('hear-shift-toggle');
    expect(q('hear-shift-toggle')!.getAttribute('aria-pressed')).toBe('false');
    expect(sound.hasTone('path')).toBe(false);
    await click('hear-shift-toggle');
    expect(sound.hasTone('path')).toBe(true);
    const held = duckHolds(ctx.asAudioContext()); // the tone's hold, plus any tick's short hold
    await act(async () => root.render(<SoundProvider sound={sound}>{null}</SoundProvider>));
    expect(sound.hasTone('path')).toBe(false);
    expect(duckHolds(ctx.asAudioContext())).toBe(held - 1); // the tone let go of the duck
  });

  it('press, press, press while the unlock is pending: the cancelled start is not "no audio"', async () => {
    const pending: ((v: boolean) => void)[] = [];
    vi.spyOn(sound, 'unlock').mockImplementation(
      () => new Promise<boolean>((r) => pending.push(r)),
    );
    await render();
    await click('hear-shift-toggle'); // start A (pending)
    await click('hear-shift-toggle'); // stop: cancels A
    expect(q('hear-shift-toggle')!.getAttribute('aria-pressed')).toBe('false');
    await click('hear-shift-toggle'); // start B (pending)
    expect(pending).toHaveLength(2);
    await act(async () => pending[0]!(false)); // A resolves late, as if no audio
    expect(q('hear-shift-line')!.textContent).toBe(HEAR_SHIFT_HINT);
    await act(async () => pending[1]!(true));
    expect(q('hear-shift-toggle')!.getAttribute('aria-pressed')).toBe('true');
    expect(q('hear-shift-line')!.textContent).toBe(HEAR_SHIFT_HINT);
  });

  it('a refused unlock says the sound could not start', async () => {
    vi.spyOn(sound, 'unlock').mockResolvedValue(false);
    await render();
    await click('hear-shift-toggle');
    expect(q('hear-shift-line')!.textContent).toBe(HEAR_SHIFT_NO_AUDIO);
  });

  it('the empty status line adds no space; a line gets its margin', async () => {
    await render();
    expect(q('hear-shift')!.className).not.toMatch(/gap/);
    expect(q('hear-shift-line')!.className).not.toMatch(/mt-/);
    await click('hear-shift-toggle');
    expect(q('hear-shift-line')!.className).toMatch(/mt-2/);
  });

  it('the hop list going away turns it off and hides the toggle', async () => {
    await setArea({ playing: true });
    await render();
    await click('hear-shift-toggle');
    await setArea({ eros: null });
    expect(sound.hasTone('path')).toBe(false);
    expect(q('hear-shift-toggle')).toBeNull();
    await setArea({ eros: EROS });
    expect(q('hear-shift-toggle')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('renders nothing outside a SoundProvider, and the Eros card still renders', async () => {
    await act(async () => root.render(<HearTheShift />));
    expect(q('hear-shift')).toBeNull();
    await act(async () => root.render(<ErosCard />));
    expect(q('eros-card')).not.toBeNull();
    expect(q('hear-shift')).toBeNull();
  });

  it('the Eros card mounts the toggle inside a SoundProvider', async () => {
    await render(<ErosCard />);
    expect(q('eros-card')).not.toBeNull();
    expect(q('hear-shift-toggle')).not.toBeNull();
  });
});

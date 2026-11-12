// R13.12 (Q-443, Q-446): the chord controls in Hear it and in the sky tool's Spectrum panel, with the
// real AppSound on a fake AudioContext.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HearPanel } from '@/app/build/HearPanel';
import { resetHearAudioForTests } from '@/app/build/hearAudio';
import { setAudioContextFactory } from '@/sound/audioContext';
import { duckHolds } from '@/sound/audioGraph';
import { createAppSound, type AppSound } from '@/sound/appSound';
import { defaultSettings, flushSoundSettings, useSoundSettings } from '@/sound/settings';
import { stopSpectrumSound } from '@/sound/spectrumExclusive';
import { SoundProvider } from '@/sound/SoundProvider';
import { initialAppData, initialSkyState, useAppStore } from '@/state/store';
import { FakeAudioContext } from '@/test/fakeAudio';
import { CHORD_CAPTION, CHORD_LOUDNESS_LABEL } from './ChordPlayer';
import { SpectrumSound } from './SpectrumSound';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const points = Array.from({ length: 40 }, (_, i) => ({
  frame_id: `f${i}`,
  wavelength_um: 0.8 + i * 0.1,
  flux: 1 + 0.5 * Math.sin(i / 3),
  error: 0.01,
  flagged: false,
}));
const data = {
  id: 'x',
  spectrum: points as never,
  light_curve: [],
  flux_unit: 'MJy/sr',
  tag: 'measured' as const,
  cached_at: null,
  missing: [],
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

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  useSoundSettings.setState({ ...defaultSettings(), loaded: false });
  useAppStore.setState(initialAppData);
  useAppStore.setState({
    sky: {
      ...initialSkyState,
      resolved: { id: 'x', name: 'X', moving: false } as never,
      spectrum: { status: 'ready', error: null, data: data as never },
    },
  });
  ctx = new FakeAudioContext();
  setAudioContextFactory(() => ctx.asAudioContext());
  resetHearAudioForTests();
  sound = createAppSound({ engine: { debugTarget: null } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  sound.outputs.engine.dispose();
  stopSpectrumSound();
  resetHearAudioForTests();
  setAudioContextFactory(null);
  flushSoundSettings();
  localStorage.clear();
  useAppStore.setState({ honesty: 'derived' });
});

async function renderHear(active = true) {
  await act(async () =>
    root.render(
      <SoundProvider sound={sound}>
        <HearPanel active={active} name="X" />
      </SoundProvider>,
    ),
  );
}

describe('Hear it: Sweep | Chord (R13.12, Q-446)', () => {
  it('Chord shows the caption, the loudness label, a 12-note strip and a summary; no audibility claim', async () => {
    await renderHear();
    expect(q('hear-kind')).not.toBeNull();
    await click('hear-kind-chord');
    expect(q('hear-chord-caption')!.textContent).toContain(CHORD_CAPTION);
    expect(q('hear-chord-loudness')!.textContent).toContain(CHORD_LOUDNESS_LABEL);
    expect(q('hear-chord-strip')!.children).toHaveLength(12);
    expect(q('hear-chord-summary')!.getAttribute('aria-live')).toBe('polite');
    expect(q('hear-chord-summary')!.textContent).toMatch(/of 12 notes sound/);
    expect(host.textContent!.toLowerCase()).not.toMatch(/audible|you can hear|hear the band/);
  });

  it('the chord plays as the panel own sound; switching to Sweep stops it; closing the panel stops it', async () => {
    await renderHear();
    await click('hear-kind-chord');
    await click('hear-chord-play');
    expect(sound.getStatus().chord).toEqual({ owner: 'hear', mode: 'data' });
    expect(q('hear-chord-play')!.getAttribute('aria-pressed')).toBe('true');
    expect(duckHolds(ctx.asAudioContext())).toBe(1);
    await click('hear-kind-sweep'); // switching kind stops it
    expect(sound.getStatus().chord).toBeNull();
    await click('hear-spec-play');
    await click('hear-kind-chord');
    await click('hear-chord-play');
    expect(sound.getStatus().chord?.owner).toBe('hear');
    await renderHear(false); // closing the panel stops it
    expect(sound.getStatus().chord).toBeNull();
    expect(duckHolds(ctx.asAudioContext())).toBe(0);
  });

  it('Smooth is unavailable at Measured only, with the reason in visible text', async () => {
    useAppStore.setState({ honesty: 'measured' });
    await renderHear();
    await click('hear-kind-chord');
    const why = q('hear-chord-smooth-why')!;
    expect(why.textContent).toMatch(/smoothed data/);
    const smooth = q('hear-chord-mode-smooth') as HTMLButtonElement;
    expect(smooth.disabled).toBe(true);
    expect(smooth.getAttribute('aria-describedby')).toBe(why.id);
  });

  it('Escape in the player stops the chord', async () => {
    await renderHear();
    await click('hear-kind-chord');
    await click('hear-chord-play');
    await act(async () => {
      q('hear-chord-play')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(sound.getStatus().chord).toBeNull();
  });
});

describe('sky Spectrum panel: Sweep | Chord (A8, R13.12)', () => {
  it('the Listen sweep and the chord exclude each other; each button shows its own state', async () => {
    await act(async () =>
      root.render(
        <SoundProvider sound={sound}>
          <SpectrumSound reply={data as never} />
        </SoundProvider>,
      ),
    );
    await click('sky-sweep-play');
    expect(sound.getStatus().listening).toBe(true);
    await click('sky-kind-chord');
    expect(sound.getStatus().listening).toBe(false);
    await click('sky-chord-play');
    expect(sound.getStatus().chord).toEqual({ owner: 'sky', mode: 'data' });
    await click('sky-chord-mode-smooth');
    expect(sound.getStatus().chord).toEqual({ owner: 'sky', mode: 'smooth' });
    // A Hear it chord elsewhere is not shown as this panel's.
    await act(async () => {
      await sound.chord(data as never, { owner: 'hear' });
    });
    expect(q('sky-chord-play')!.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('chord strip and copy (code review, Q-446)', () => {
  it('silent notes are short empty boxes; A/B changes are marked; the summary is visible', async () => {
    // A deep narrow dip at 2.3 um (one note changes in Smooth) and a gap with no data (silent notes).
    const pts = Array.from({ length: 60 }, (_, i) => {
      const l = 0.8 + i * 0.05;
      return {
        frame_id: `g${i}`,
        wavelength_um: l,
        flux: Math.abs(l - 2.3) < 0.06 ? 0.02 : 1,
        error: 0.01,
        flagged: false,
      };
    });
    const reply = { ...data, spectrum: pts as never };
    await act(async () =>
      root.render(
        <SoundProvider sound={sound}>
          <SpectrumSound reply={reply as never} />
        </SoundProvider>,
      ),
    );
    expect(q('sky-kind-hint')!.textContent).toMatch(/one wavelength at a time/);
    await click('sky-kind-chord');
    expect(q('sky-kind-hint')!.textContent).toMatch(/all at once/);
    const bars = [...q('sky-chord-strip')!.querySelectorAll('i')];
    const silent = bars.filter((b) => b.dataset.silent === 'true');
    expect(silent.length).toBeGreaterThan(0);
    for (const b of silent) expect(b.style.height).toBe('12%');
    expect(host.querySelectorAll('[data-testid="sky-chord-ab-mark"]').length).toBeGreaterThan(0);
    const summary = q('sky-chord-summary')!;
    expect(summary.className).not.toContain('sr-only');
    expect(summary.textContent).toMatch(/change between Data and Smooth by 1 dB or more/);
  });

  it('the disabled Smooth reason reads as an instruction', async () => {
    useAppStore.setState({ honesty: 'measured' });
    await renderHear();
    await click('hear-kind-chord');
    expect(q('hear-chord-smooth-why')!.textContent).toBe(
      'Smooth is an estimate (smoothed data). Set honesty to + Estimated to use it.',
    );
  });

  it('a new spectrum stops the chord that played the old one', async () => {
    const view = (r: typeof data) => (
      <SoundProvider sound={sound}>
        <SpectrumSound reply={r as never} />
      </SoundProvider>
    );
    await act(async () => root.render(view(data)));
    await click('sky-kind-chord');
    await click('sky-chord-play');
    expect(sound.getStatus().chord?.owner).toBe('sky');
    await act(async () => root.render(view({ ...data, spectrum: [...points] as never })));
    expect(sound.getStatus().chord).toBeNull();
  });
});

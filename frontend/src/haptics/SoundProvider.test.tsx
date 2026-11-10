// #76 done-when: inside the real provider (the default createAppSound(), StrictMode, a suspended
// AudioContext), a stand-in for #83's controls turns sound on with a click, listens to a
// `/spectrum` reply fetched through the app's own client, and the sweep stops on a hidden page, on
// mute and on a honesty change. No `sound` is injected, so this is the engine the app mounts.
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '@/app/api/client';
import type { SpectrumResponse } from '@/app/api/types';
import { useAppStore } from '@/state/store';
import { FakeAudioContext, type FakeNode, type FakeSource } from '@/test/fakeAudio';
import { fixtureFetch } from '@/test/fixtureFetch';
import { setAudioContextFactory } from './audioContext';
import type { AppSound, ListenOutcome } from './appSound';
import { AudioDriver } from './drivers/audio';
import { defaultSettings, flushHapticSettings, useHapticSettings } from './settings';
import { buildSpectrumMapping } from './spectrumMapping';
import { SoundProvider, useSound, useSoundStatus } from './SoundProvider';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let host: HTMLDivElement;
let root: Root;
let ctx: FakeAudioContext;
let wise: SpectrumResponse;
let seen: AppSound[];
let outcomes: ListenOutcome[];
let chimeLines: Parameters<AppSound['listen']>[1];

/** Stands in for #83: two buttons and the live status. */
function Probe({ id = 'a' }: { id?: string }) {
  const sound = useSound();
  const status = useSoundStatus();
  seen.push(sound);
  return (
    <div>
      <button data-testid={`on-${id}`} onClick={() => void sound.unlock()}>
        on
      </button>
      <button
        data-testid={`listen-${id}`}
        onClick={() => void sound.listen(wise, chimeLines).then((o) => outcomes.push(o))}
      >
        listen
      </button>
      <output data-testid={`status-${id}`}>{JSON.stringify(status)}</output>
    </div>
  );
}

const status = (id = 'a') =>
  JSON.parse(host.querySelector(`[data-testid="status-${id}"]`)!.textContent!) as Record<
    string,
    unknown
  >;

/** A real click: React runs the handler synchronously inside this call. */
function click(testId: string) {
  host
    .querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

const settle = () => act(async () => void (await Promise.resolve()));

/** Whether `from` reaches `to` through `connect()` edges. */
function reaches(from: FakeNode, to: FakeNode, seenNodes = new Set<FakeNode>()): boolean {
  if (from === to) return true;
  if (seenNodes.has(from)) return false;
  seenNodes.add(from);
  return from.outputs.some((n) => reaches(n, to, seenNodes));
}

async function mount(children: React.ReactNode = <Probe />) {
  await act(async () => {
    root.render(
      <StrictMode>
        <SoundProvider>{children}</SoundProvider>
      </StrictMode>,
    );
  });
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ctx = new FakeAudioContext({ state: 'suspended' });
  // Before the provider renders: `AudioDriver.supported` is fixed at construction.
  setAudioContextFactory(() => ctx.asAudioContext());
  wise ??= (await createApiClient({ fetchImpl: fixtureFetch }).spectrum('wise-0855')).data;
  seen = [];
  outcomes = [];
  chimeLines = undefined;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setAudioContextFactory(null);
  vi.restoreAllMocks();
  flushHapticSettings();
  localStorage.clear();
  useHapticSettings.setState({
    ...defaultSettings({ hapticsOn: false, soundOn: true }),
    loaded: false,
  });
  useAppStore.setState({ honesty: 'derived' });
});

describe('SoundProvider with the default engine (#76 done-when)', () => {
  it('turns sound on in the click, then listens to the real reply through the destination', async () => {
    await mount();
    expect(status()).toMatchObject({ unlocked: false, audio: 'suspended', listening: false });

    click('on-a');
    expect(ctx.resumes).toBe(1); // inside the click, before any await (Q-73)
    await settle();
    expect(status()).toMatchObject({ unlocked: true, audio: 'running' });

    click('listen-a');
    await settle();
    expect(outcomes).toEqual(['playing']);
    expect(status().listening).toBe(true);
    const started = ctx.sources().filter((s) => s.startAt !== null);
    expect(started.length).toBeGreaterThan(0);
    expect(started.some((s) => reaches(s, ctx.destination))).toBe(true);
  });

  it('the honesty chime case: Measured silences a model_dependent chime, the tone plays on', async () => {
    const m = buildSpectrumMapping(wise.spectrum);
    chimeLines = {
      lines: [
        { gas: 'co2', lambdaUm: (m.lambdaMinUm + m.lambdaMaxUm) / 2, tag: 'model_dependent' },
      ],
    };
    await mount();
    click('listen-a');
    await settle();
    expect(outcomes).toEqual(['playing']);
    const [tone, ...bells] = ctx.sources() as FakeSource[];
    expect(bells.length).toBeGreaterThan(0);
    act(() => useAppStore.getState().setHonesty('measured'));
    for (const b of bells) expect(b.disconnected).toBe(true);
    expect(tone!.disconnected).toBe(false);
    expect(status().listening).toBe(true);
  });

  it('a hidden page stops the sweep and disconnects its voices', async () => {
    await mount();
    click('listen-a');
    await settle();
    expect(status().listening).toBe(true);
    const tone = ctx.sources()[0]!;
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(status().listening).toBe(false);
    expect(tone.disconnected).toBe(true);
  });

  it('mute stops the sweep', async () => {
    await mount();
    click('listen-a');
    await settle();
    const sound = seen.at(-1)!;
    act(() => sound.setMuted(true));
    expect(status().listening).toBe(false);
    expect(status().muted).toBe(true);
  });

  describe('bound once, even under StrictMode', () => {
    it('siblings share one engine, one hidden event stops once, one honesty change sets once, unmount unbinds', async () => {
      await mount(
        <>
          <Probe id="a" />
          <Probe id="b" />
        </>,
      );
      expect(new Set(seen).size).toBe(1); // (a) the same useSound() object
      const sound = seen[0]!;
      const { engine } = sound.outputs;

      // (e) audio only
      expect(engine.activeDrivers).toHaveLength(1);
      expect(engine.activeDrivers[0]).toBeInstanceOf(AudioDriver);

      // (b) one hidden event, one engine.stop
      const stop = vi.spyOn(engine, 'stop');
      const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      act(() => void document.dispatchEvent(new Event('visibilitychange')));
      expect(stop).toHaveBeenCalledTimes(1);
      hidden.mockReturnValue(false);

      // (c) one honesty change, one engine.setHonesty
      const setHonesty = vi.spyOn(engine, 'setHonesty');
      act(() => useAppStore.getState().setHonesty('measured'));
      expect(setHonesty).toHaveBeenCalledTimes(1);
      expect(setHonesty).toHaveBeenCalledWith('measured');

      // (d) after unmount nothing is bound any more
      act(() => root.unmount());
      stop.mockClear();
      setHonesty.mockClear();
      hidden.mockReturnValue(true);
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pagehide'));
      expect(stop).toHaveBeenCalledTimes(0);
      useAppStore.getState().setHonesty('derived');
      expect(setHonesty).toHaveBeenCalledTimes(0);
      root = createRoot(host); // so afterEach can unmount
    });
  });

  it('useSound outside the provider throws the dev error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Bad() {
      useSound();
      return null;
    }
    expect(() => act(() => root.render(<Bad />))).toThrow(/SoundProvider/);
  });
});

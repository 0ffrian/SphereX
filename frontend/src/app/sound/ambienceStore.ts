// Wind sound that outlives the Hear it panel ("Ambience"). The synth runs here, not in the panel: the panel only
// draws controls and the waveform. Started only by a click (the play button or the Ambience switch), never on
// its own. Stops when: the switch goes off, the object changes, the build pane closes, or Spectrum is played
// (the panel calls stop() for each of those).
// While it plays it follows the place being looked at in the close-up (see sampleLocal): what the world engine
// exposes there changes pressure (loudness, cutoff) and temperature (sound speed), eased over about a second.
import { create } from 'zustand';
import { startAtmosphere, type AtmosphereHandle } from '@/app/build/hearAudio';
import type { AtmosphereModel } from '@/app/build/hearModel';
import { sampleLocal, type LocalSignals } from './ambienceLocal';

export type WindMode = 'calm' | 'breezy' | 'storm';
export const WIND_LEVEL: Record<WindMode, number> = { calm: 0.25, breezy: 0.6, storm: 1 };
const EASE_S = 0.4; // time constant: about 1 s to settle
const LOCAL_EVERY_MS = 250;

interface AmbienceState {
  playing: boolean;
  /** The user asked for the sound to stay after the panel closes. */
  ambience: boolean;
  wind: WindMode;
  /** The object (card id) the sound belongs to. */
  key: string | null;
  /** What the sound is following right now, for the panel's note; null = the global values. */
  local: LocalSignals | null;
  play(model: AtmosphereModel, key: string): void;
  stop(): void;
  setAmbience(on: boolean, model: AtmosphereModel, key: string): void;
  setWind(w: WindMode): void;
}

let handle: AtmosphereHandle | null = null;
let raf = 0;
let model: AtmosphereModel | null = null;
let cur = { P: 0, c: 0, s: 0.6 };
let target = { P: 0, c: 0 };
let lastT = 0;
let lastLocal = -1e9;

function frame(t: number) {
  if (!handle || !model) return;
  const st = useAmbienceStore.getState();
  if (t - lastLocal >= LOCAL_EVERY_MS) {
    lastLocal = t;
    const loc = sampleLocal(model);
    target = { P: loc?.P ?? model.P, c: loc?.c ?? model.c };
    if (loc?.note !== st.local?.note) useAmbienceStore.setState({ local: loc });
  }
  const k = 1 - Math.exp(-Math.min(0.1, Math.max(0, (t - lastT) / 1000)) / EASE_S);
  lastT = t;
  cur = {
    P: cur.P + (target.P - cur.P) * k,
    c: cur.c + (target.c - cur.c) * k,
    s: cur.s + (WIND_LEVEL[st.wind] - cur.s) * k,
  };
  handle.tick(t, cur);
  raf = requestAnimationFrame(frame);
}

function begin(m: AtmosphereModel, key: string, ambience: boolean): boolean {
  halt();
  const h = startAtmosphere(m);
  if (!h) return false;
  handle = h;
  model = m;
  const w = WIND_LEVEL[useAmbienceStore.getState().wind];
  cur = { P: m.P, c: m.c, s: w };
  target = { P: m.P, c: m.c };
  lastT = performance.now();
  lastLocal = -1e9;
  useAmbienceStore.setState({ playing: true, ambience, key });
  raf = requestAnimationFrame(frame);
  return true;
}
function halt() {
  cancelAnimationFrame(raf);
  handle?.stop();
  handle = null;
  model = null;
}

export const useAmbienceStore = create<AmbienceState>((set) => ({
  playing: false,
  ambience: false,
  wind: 'breezy',
  key: null,
  local: null,
  play: (m, key) => {
    begin(m, key, false);
  },
  stop: () => {
    halt();
    set({ playing: false, ambience: false, local: null });
  },
  setAmbience: (on, m, key) => {
    if (!on) {
      halt();
      set({ playing: false, ambience: false, local: null });
      return;
    }
    // Already playing this sound by the play button: keep it going, just mark it as ambience.
    if (handle && useAmbienceStore.getState().key === key) set({ ambience: true });
    else begin(m, key, true);
  },
  setWind: (wind) => set({ wind }),
}));

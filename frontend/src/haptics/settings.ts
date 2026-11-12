// R8.7 / R13.9 sound settings (haptics cut, D-39): their own Zustand store (not state/store.ts), saved to
// localStorage under one key. Loading is lazy: the first read of the store (`getState()`, the hook,
// `bindEngine`) loads it, so no consumer ever sees the unloaded defaults, and importing this module
// touches no browser storage. Corrupt or missing storage gives the defaults.
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { SoundOutputs } from './haptics';
import { clamp01 } from './pitch';
import { DEFAULT_VOLUME } from './tuning';

export const SETTINGS_STORAGE_KEY = 'sx.haptics.settings';

/**
 * The key is the pre-D-39 one, kept so saved volumes survive; the old `hapticsOn`,
 * `strengthMultiplier` and `showChannelLabels` fields are ignored when read and dropped on save.
 */
export interface HapticSettings {
  soundOn: boolean;
  /** 0–1. */
  volume: number;
}

export interface HapticSettingsState extends HapticSettings {
  /** True once storage has been read. */
  loaded: boolean;
  /** Change settings; values are clamped and saved (debounced, flushed when the page hides). Loads first if needed. */
  update(changes: Partial<HapticSettings>): void;
  /** Back to the defaults; clears the saved settings. */
  reset(): void;
}

export function defaultSettings(): HapticSettings {
  return { soundOn: true, volume: DEFAULT_VOLUME };
}

/** Keep only valid fields of `raw` over `base`. Anything malformed is ignored. */
export function sanitizeSettings(raw: unknown, base: HapticSettings): HapticSettings {
  const out = { ...base };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.soundOn === 'boolean') out.soundOn = r.soundOn;
  if (typeof r.volume === 'number' && Number.isFinite(r.volume)) out.volume = clamp01(r.volume);
  return out;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // Access can throw (blocked site data).
  }
}

/** Saved settings over the defaults. Never throws. */
export function loadHapticSettings(): HapticSettings {
  const base = defaultSettings();
  try {
    const text = storage()?.getItem(SETTINGS_STORAGE_KEY);
    return text ? sanitizeSettings(JSON.parse(text), base) : base;
  } catch {
    return base;
  }
}

function save(s: HapticSettings): void {
  try {
    storage()?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Quota or blocked storage: the settings still apply for this session.
  }
}

/** Saves wait this long after the last change (a slider drag changes the settings 60 times a second). */
export const SAVE_DEBOUNCE_MS = 200;
let pendingSave: HapticSettings | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let flushOnHideBound = false;

/** Write a pending save now (also run when the page is hidden or unloaded). */
export function flushHapticSettings(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
  const s = pendingSave;
  pendingSave = null;
  if (s) save(s);
}

function cancelPendingSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
  pendingSave = null;
}

function scheduleSave(s: HapticSettings): void {
  pendingSave = s;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushHapticSettings, SAVE_DEBOUNCE_MS);
  if (!flushOnHideBound && typeof window !== 'undefined' && typeof document !== 'undefined') {
    // Registered on the first change, never at import.
    flushOnHideBound = true;
    window.addEventListener('pagehide', flushHapticSettings);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) flushHapticSettings();
    });
  }
}

function pick(s: HapticSettings): HapticSettings {
  const { soundOn, volume } = s;
  return { soundOn, volume };
}

// Static initial values: storage is read on first use, not at import.
const INITIAL: HapticSettings = defaultSettings();

const store = createStore<HapticSettingsState>()((set) => ({
  ...INITIAL,
  loaded: false,
  update(changes) {
    // store.getState() (not `get`) loads storage first, so an early change cannot save over it.
    const next = sanitizeSettings(changes, pick(store.getState()));
    set(next);
    scheduleSave(next);
  },
  reset() {
    cancelPendingSave();
    try {
      storage()?.removeItem(SETTINGS_STORAGE_KEY);
    } catch {
      // Nothing to clear.
    }
    set({ ...defaultSettings(), loaded: true });
  },
}));

// Every read goes through the lazy loader: the first read (after import, or after a test sets
// `loaded: false`) reads storage before it returns.
const rawGetState = store.getState;
store.getState = () => {
  const s = rawGetState();
  if (s.loaded) return s;
  store.setState({ ...loadHapticSettings(), loaded: true });
  return rawGetState();
};

type SettingsHook = {
  (): HapticSettingsState;
  <T>(selector: (s: HapticSettingsState) => T): T;
} & StoreApi<HapticSettingsState>;

/** The settings store: a React hook with `getState`, `setState` and `subscribe` (Zustand). */
export const useHapticSettings: SettingsHook = Object.assign(
  <T>(selector?: (s: HapticSettingsState) => T) =>
    useStore(store, selector ?? ((s: HapticSettingsState) => s as unknown as T)),
  store,
) as SettingsHook;

/** The current settings, loaded from storage on first use. */
export function getHapticSettings(): HapticSettingsState {
  return store.getState();
}

/** Read storage once (first call only). Reads do this by themselves; kept for callers. */
export function ensureLoaded(): void {
  store.getState();
}

/** Push settings into the engine and the audio driver. */
export function applySettings(outputs: SoundOutputs, s: HapticSettings): void {
  outputs.engine.setDriverEnabled(outputs.audio, s.soundOn);
  outputs.audio.setVolume(s.volume);
}

/**
 * Keep an engine in step with the settings: loads them, applies them now and on every change.
 * Returns the unsubscribe function.
 */
export function bindEngine(outputs: SoundOutputs): () => void {
  ensureLoaded();
  applySettings(outputs, useHapticSettings.getState());
  const unsubscribe = useHapticSettings.subscribe((s) => applySettings(outputs, s));
  const unbindPage = bindPageLifecycle(outputs);
  return () => {
    unsubscribe();
    unbindPage();
  };
}

/**
 * Stop every train and sound when the page is hidden (another tab, the screen locked) or
 * unloaded: a held train would otherwise keep sounding on throttled timers. `bindEngine` calls
 * this. Returns the function that removes the listeners.
 */
export function bindPageLifecycle(outputs: Pick<SoundOutputs, 'engine'>): () => void {
  return stopWhenHidden(outputs.engine);
}

/**
 * Call `target.stop()` when the page is hidden (`visibilitychange` with `document.hidden`) or
 * unloaded (`pagehide`). Returns the function that removes the listeners. A no-op without a DOM.
 */
export function stopWhenHidden(target: { stop(): void }): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
  const onVisibility = () => {
    if (document.hidden) target.stop();
  };
  const onPageHide = () => target.stop();
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
  };
}

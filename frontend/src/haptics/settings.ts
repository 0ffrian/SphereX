// R8.7 haptics and sound settings: their own Zustand store (not state/store.ts), saved to
// localStorage under one key. Loading is lazy (first `ensureLoaded`, `bindEngine` or UI use), so
// importing this module touches no browser storage. Corrupt or missing storage gives the defaults.
import { create } from 'zustand';
import type { HapticOutputs } from './haptics';
import { clamp01 } from './pitch';
import { defaultOutputs, type OutputDefaults } from './platform';
import { DEFAULT_VOLUME, STRENGTH_MULTIPLIER_MAX, STRENGTH_MULTIPLIER_MIN } from './tuning';

export const SETTINGS_STORAGE_KEY = 'sx.haptics.settings';

export interface HapticSettings {
  hapticsOn: boolean;
  soundOn: boolean;
  /** 0–1. */
  volume: number;
  /** R8.7: 0.5–1.5. */
  strengthMultiplier: number;
  /** R8.7 "texture-vs-data labels shown in the legend". */
  showChannelLabels: boolean;
}

export interface HapticSettingsState extends HapticSettings {
  /** True once storage has been read. */
  loaded: boolean;
  /** Change settings; values are clamped and saved. Loads first if needed. */
  update(changes: Partial<HapticSettings>): void;
  /** Back to the platform defaults; clears the saved settings. */
  reset(): void;
}

export function defaultSettings(outputs: OutputDefaults = defaultOutputs()): HapticSettings {
  return {
    hapticsOn: outputs.hapticsOn,
    soundOn: outputs.soundOn,
    volume: DEFAULT_VOLUME,
    strengthMultiplier: 1,
    showChannelLabels: true,
  };
}

function clampMultiplier(m: number): number {
  return Math.min(STRENGTH_MULTIPLIER_MAX, Math.max(STRENGTH_MULTIPLIER_MIN, m));
}

/** Keep only valid fields of `raw` over `base`. Anything malformed is ignored. */
export function sanitizeSettings(raw: unknown, base: HapticSettings): HapticSettings {
  const out = { ...base };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.hapticsOn === 'boolean') out.hapticsOn = r.hapticsOn;
  if (typeof r.soundOn === 'boolean') out.soundOn = r.soundOn;
  if (typeof r.showChannelLabels === 'boolean') out.showChannelLabels = r.showChannelLabels;
  if (typeof r.volume === 'number' && Number.isFinite(r.volume)) out.volume = clamp01(r.volume);
  if (typeof r.strengthMultiplier === 'number' && Number.isFinite(r.strengthMultiplier)) {
    out.strengthMultiplier = clampMultiplier(r.strengthMultiplier);
  }
  return out;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // Access can throw (blocked site data).
  }
}

/** Saved settings over the platform defaults. Never throws. */
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

function pick(s: HapticSettings): HapticSettings {
  const { hapticsOn, soundOn, volume, strengthMultiplier, showChannelLabels } = s;
  return { hapticsOn, soundOn, volume, strengthMultiplier, showChannelLabels };
}

// Static initial values: the platform and storage are read on first use, not at import.
const INITIAL: HapticSettings = {
  hapticsOn: false,
  soundOn: true,
  volume: DEFAULT_VOLUME,
  strengthMultiplier: 1,
  showChannelLabels: true,
};

export const useHapticSettings = create<HapticSettingsState>()((set, get) => ({
  ...INITIAL,
  loaded: false,
  update(changes) {
    if (!get().loaded) ensureLoaded();
    const next = sanitizeSettings(changes, pick(get()));
    set(next);
    save(next);
  },
  reset() {
    try {
      storage()?.removeItem(SETTINGS_STORAGE_KEY);
    } catch {
      // Nothing to clear.
    }
    set({ ...defaultSettings(), loaded: true });
  },
}));

/** Read storage once (first call only). */
export function ensureLoaded(): void {
  if (useHapticSettings.getState().loaded) return;
  useHapticSettings.setState({ ...loadHapticSettings(), loaded: true });
}

/** Push settings into the engine and drivers. */
export function applySettings(outputs: HapticOutputs, s: HapticSettings): void {
  outputs.engine.setDriverEnabled(outputs.vibrate, s.hapticsOn);
  outputs.engine.setDriverEnabled(outputs.audio, s.soundOn);
  outputs.audio.setVolume(s.volume);
  outputs.engine.setStrengthMultiplier(s.strengthMultiplier);
}

/**
 * Keep an engine in step with the settings: loads them, applies them now and on every change.
 * Returns the unsubscribe function.
 */
export function bindEngine(outputs: HapticOutputs): () => void {
  ensureLoaded();
  applySettings(outputs, useHapticSettings.getState());
  return useHapticSettings.subscribe((s) => applySettings(outputs, s));
}

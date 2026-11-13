// R8.8 Engine API types (rendering doc), with D-10 (pitch, pan), D-20 (sharpness) and the D-12 audio
// `voice` hint (Q-72). These are runtime interfaces, not card data, so they stay hand-written (Q-19).
// HapticProfile comes from shared/schemas (D-18).
import type { Tag } from './generated';

export type { HapticProfile, TextureHaptic, DataHaptic } from './generated';

export type HapticKind = 'tick' | 'double' | 'heartbeat' | 'pulseTrain' | 'stop';

/**
 * Audio-only hint for the per-kind sounds of D-12 (Q-72): `tone` a pitched tone (gas giant bands,
 * pitch from latitude), `click` a land click, `surf` filtered noise (open ocean), `chime` a bell
 * (Listen sweep gas lines). The timbre still follows `tag` first (R8.9): an `artistic` sound keeps
 * its grainy character whatever the voice says, and a non-`artistic` sound never becomes noise.
 */
export type HapticVoice = 'tone' | 'click' | 'surf' | 'chime';

/**
 * Display-only hint (Q-85): whether an event is a texture or a data haptic (R8.2), for the
 * on-screen pulse indicator and the legend labels. Every driver ignores it.
 */
export type HapticChannel = 'texture' | 'data';

export interface HapticEvent {
  kind: HapticKind;
  strength: number;
  rateHz?: number;
  tag: Tag;
  pitch?: number; // 0–1. Audio only. Spectrum: λ→pitch as in the Listen sweep; surfaces: height or latitude
  pan?: number; // −1 (left) to 1 (right). Audio only. From the finger's x on screen
  sharpness?: number; // Optional (D-20). The web driver ignores it; a future Tauri driver (B-01) uses it
  voice?: HapticVoice; // Optional audio hint (D-12, Q-72). The vibrate driver ignores it
  channel?: HapticChannel; // Optional display hint, texture or data (R8.2, Q-85). Drivers ignore it
}

export interface HapticDriver {
  readonly supported: boolean;
  emit(e: HapticEvent): void;
  stop(): void;
}

/**
 * R8.8 tone stream (Q-189, built in #77): the ids of the sustained tones. At most one tone per id.
 * `path` is the Track path voice (R8.9.2); `body` is the body tone (R8.9.1, deferred by D-39).
 */
export type ToneId = 'body' | 'path';

/**
 * R8.8 tone stream (Q-189): what a source asks for when it starts or updates a sustained tone.
 * Pitch, gain and pan glide while it plays. The tag sets the sustained timbre (R8.9, Q-190).
 */
export interface ToneParams {
  /** 0–1, mapped to Hz as R8.9 (`pitch.ts`; `wavelengthToPitch` for a λ, Q-430). */
  pitch: number;
  /** 0–1 → continuous gain (× the strength multiplier and the volume), with the audible floor. */
  strength: number;
  tag: Tag;
  /** −1 (left) to 1 (right). */
  pan?: number;
  /** Kept for R8.8 parity; a sustained tone's timbre follows `tag` only. */
  voice?: HapticVoice;
  /** Display hint (Q-85); drivers ignore it. */
  channel?: HapticChannel;
}

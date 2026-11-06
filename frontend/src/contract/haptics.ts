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

export interface HapticEvent {
  kind: HapticKind;
  strength: number;
  rateHz?: number;
  tag: Tag;
  pitch?: number; // 0–1. Audio only. Spectrum: λ→pitch as in the Listen sweep; surfaces: height or latitude
  pan?: number; // −1 (left) to 1 (right). Audio only. From the finger's x on screen
  sharpness?: number; // Optional (D-20). The web driver ignores it; a future Tauri driver (B-01) uses it
  voice?: HapticVoice; // Optional audio hint (D-12, Q-72). The vibrate driver ignores it
}

export interface HapticDriver {
  readonly supported: boolean;
  emit(e: HapticEvent): void;
  stop(): void;
}

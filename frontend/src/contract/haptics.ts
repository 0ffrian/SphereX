// R8.8 Engine API types (rendering doc), with D-10 (pitch, pan) and D-12 (terrain, flow, teq_pulse).
import type { Tag } from './tags';

export type HapticKind = 'tick' | 'double' | 'heartbeat' | 'pulseTrain' | 'stop';

export interface HapticEvent {
  kind: HapticKind;
  strength: number;
  rateHz?: number;
  tag: Tag;
  pitch?: number; // 0–1. Audio only. Spectrum: λ→pitch as in the Listen sweep; surfaces: height or latitude
  pan?: number; // −1 (left) to 1 (right). Audio only. From the finger's x on screen
}

export interface HapticDriver {
  readonly supported: boolean;
  emit(e: HapticEvent): void;
  stop(): void;
}

/** 'terrain' = height + ocean and ice masks; 'flow' = bands, jets, storms (D-12). */
export type TextureHaptic = 'height' | 'mesh' | 'bands' | 'terrain' | 'flow' | 'none';

export type DataHaptic =
  'field' | 'flux_pulse' | 'teq_pulse' | 'heartbeat' | 'dimming' | 'motion' | 'detections' | 'none';

export interface HapticProfile {
  texture: TextureHaptic;
  texture_tag: Tag;
  data: DataHaptic;
  data_tag: Tag;
  params: Record<string, number>; // e.g. tau, k, softness, maxRateHz
}

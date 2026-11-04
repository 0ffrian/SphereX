// R8.8 haptic engine — not implemented yet.
// The R8.8 types live in src/contract/haptics.ts and are re-exported here, where R8.8 places them.
// HapticEngine (fan-out to all drivers, drop ticks under minIntervalMs) is still to be built.

export type {
  HapticKind,
  HapticEvent,
  HapticDriver,
  HapticProfile,
  TextureHaptic,
  DataHaptic,
} from '@/contract/haptics';

export const HAPTIC_ENGINE_PLACEHOLDER = { spec: 'R8.8', implemented: false } as const;

// What the island's smoothui GridLoader shows (issue #66): the props for each state.
import type { GridLoaderProps } from './GridLoader';

// Moon (11 Nov 2026): at rest it pulses softly, as smoothui's pulse mode (opacity .4 to 1, a 3 s cycle).
// Reduced motion keeps it lit and still (GridLoader's own useReducedMotion). Amends Q-121 item 2.
export const IDLE_LOOK: GridLoaderProps = { pattern: 'heartbeat', mode: 'pulse', speed: 'idle' };

/**
 * The three state pills (smoothui's demo pills, exact props): one word per state.
 * Searching: the object is resolved or the archive searched. Fetching: frames download (smoothui's
 * "Thinking" look). Generating: a 3D body is built.
 */
export const SEARCHING_LOOK: GridLoaderProps = {
  pattern: 'sparkle',
  mode: 'stagger',
  color: 'amber',
  blur: 1,
  gap: 1,
  size: 'sm',
};
export const FETCHING_LOOK: GridLoaderProps = {
  pattern: 'frame',
  mode: 'stagger',
  color: 'white',
  blur: 1,
  gap: 1,
  size: 'sm',
};
export const GENERATING_LOOK: GridLoaderProps = {
  pattern: 'plus-full',
  mode: 'pulse',
  color: 'blue',
  blur: 1.2,
  gap: 1,
  rounded: true,
  size: 'sm',
};

/** The shared look: green, round, softly blurred (the mock-up's settings). */
export const LOADER_BASE: GridLoaderProps = {
  color: 'green',
  rounded: true,
  blur: 1.4,
  size: 28,
  gap: 1,
  className: 'flex-none',
};

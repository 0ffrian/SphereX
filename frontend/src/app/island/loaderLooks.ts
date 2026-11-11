// What the island's smoothui GridLoader shows (issue #66): the props for each state.
import type { GridLoaderProps } from './GridLoader';

/** At rest: the heartbeat plus-shape, lit and still (WCAG 2.2.2: nothing moves on its own). */
export const IDLE_LOOK: GridLoaderProps = { pattern: 'heartbeat', static: true };

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

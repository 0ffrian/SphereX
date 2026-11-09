// What the island's smoothui GridLoader shows (issue #66): the props for each state.
import type { GridLoaderProps } from './GridLoader';

/** At rest: the heartbeat plus-shape, lit and still (WCAG 2.2.2: nothing moves on its own). */
export const IDLE_LOOK: GridLoaderProps = { pattern: 'heartbeat', static: true };

/** While the object is found and its frames searched. */
export const THINKING_LOOK: GridLoaderProps = {
  mode: 'sequence',
  sequence: ['ripple-out', 'breathing', 'ripple-in', 'twinkle'],
  speed: 'slow',
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

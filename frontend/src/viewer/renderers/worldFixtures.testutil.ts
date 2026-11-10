// Issue #71 stream D: a fast stand-in for the world worker, for tests that need a rocky planet to
// build but do not test the climate (a full world takes seconds on the main thread).
import { generateWorld, type WorldSize } from '../fields/worldGenerator';
import type { BodyContext } from './bodyRenderer';

const TINY: WorldSize = { tw: 90, th: 45, nx: 36, ny: 18, rw: 128, rh: 64, steps: 12 };

export const tinyWorldSource: NonNullable<BodyContext['worldSource']> = (p) =>
  Promise.resolve(generateWorld(p, TINY));

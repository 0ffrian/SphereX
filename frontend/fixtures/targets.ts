// DEV/TEST FIXTURES ONLY. Never imported by app code (src/fixtures.test.ts enforces this).
// The five A1.1 test targets plus two synthetic objects. Only the names and J2000 coordinates of
// the real targets are meant to be real; everything the generators make from them is synthetic.
//
// RA/Dec: ICRS, epoch J2000, from SIMBAD (checked 5 Nov 2026 against the backend's recorded SIMBAD
// replies). Barnard's Star, eps Ind B and WISE 0855 move 2-4.6 arcmin from these positions by the
// SPHEREx epochs (2025-26).

export interface FixtureTarget {
  id: string;
  /** Name the resolver returns. */
  name: string;
  /** Search texts that resolve to this target (matched without case or punctuation). */
  aliases: readonly string[];
  ra: number;
  dec: number;
  /** Solar System body (Q-22: high-proper-motion stars are not "moving"). */
  moving: boolean;
  /** Fixture frames on one north-up grid (true) or in native orientation (false). */
  northUp: boolean;
  frameCount: number;
  seed: number;
  /** Frame indices whose cutout returns 404 (refusal path). */
  brokenCutouts?: readonly number[];
  /** When set, the frames reply is empty and lists this in `missing` (backend M1 behaviour). */
  refuseFrames?: string;
  refuseSpectrum?: string;
}

export const FIXTURE_TARGETS: readonly FixtureTarget[] = [
  {
    id: 'barnards-star',
    name: "Barnard's Star",
    aliases: ["Barnard's Star", 'Barnards Star', 'GJ 699'],
    ra: 269.45208,
    dec: 4.69336,
    moving: false,
    northUp: false,
    frameCount: 24,
    seed: 101,
  },
  {
    id: 'eps-indi-b',
    name: 'Epsilon Indi B',
    aliases: ['Epsilon Indi B', 'eps Ind B', 'Eps Indi B', 'Epsilon Indi Ba'],
    ra: 331.04415,
    dec: -56.78284,
    moving: false,
    northUp: false,
    frameCount: 24,
    seed: 202,
  },
  {
    id: 'wise-0855',
    name: 'WISE 0855-0714',
    aliases: ['WISE 0855', 'WISE 0855-0714', 'WISE J085510.83-071442.5'],
    ra: 133.81891,
    dec: -7.24705,
    moving: false,
    northUp: false,
    frameCount: 24,
    seed: 303,
  },
  {
    id: 'rw-aur',
    name: 'RW Aurigae',
    aliases: ['RW Aurigae', 'RW Aur'],
    ra: 76.95653,
    dec: 30.40144,
    moving: false,
    northUp: false,
    frameCount: 24,
    seed: 404,
  },
  {
    id: 'r-dra',
    name: 'R Draconis',
    aliases: ['R Draconis', 'R Dra'],
    ra: 248.16761,
    dec: 66.75498,
    moving: false,
    northUp: false,
    frameCount: 24,
    seed: 505,
    brokenCutouts: [5],
  },
  {
    id: 'synthetic-mover',
    name: 'Synthetic mover (fixture)',
    aliases: ['Synthetic mover', 'synthetic-mover'],
    ra: 10, // synthetic position, not a real object
    dec: 10,
    moving: true,
    northUp: true,
    frameCount: 16,
    seed: 606,
  },
  {
    id: 'synthetic-refused-mover',
    name: 'Synthetic refused mover (fixture)',
    aliases: ['Synthetic refused mover', 'synthetic-refused-mover'],
    ra: 20, // synthetic position, not a real object
    dec: -20,
    moving: true,
    northUp: false,
    frameCount: 0,
    seed: 707,
    refuseFrames: 'frames:moving_object_search',
    refuseSpectrum: 'spectrum:moving_object_search',
  },
];

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function findTargetByName(q: string): FixtureTarget | undefined {
  const key = squash(q);
  if (key === '') return undefined;
  return FIXTURE_TARGETS.find((t) => t.aliases.some((a) => squash(a) === key));
}

export function findTargetById(id: string): FixtureTarget | undefined {
  return FIXTURE_TARGETS.find((t) => t.id === id);
}

/** Angular separation in degrees (haversine). */
export function separationDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const r = Math.PI / 180;
  const dDec = (dec2 - dec1) * r;
  const dRa = (ra2 - ra1) * r;
  const a =
    Math.sin(dDec / 2) ** 2 + Math.cos(dec1 * r) * Math.cos(dec2 * r) * Math.sin(dRa / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(a)))) / r;
}

/** Coordinate searches match a fixture target within this radius. */
export const COORD_MATCH_DEG = 1 / 60;

export function findTargetByCoords(ra: number, dec: number): FixtureTarget | undefined {
  return FIXTURE_TARGETS.find((t) => separationDeg(ra, dec, t.ra, t.dec) <= COORD_MATCH_DEG);
}

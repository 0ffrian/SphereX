// DEV/TEST FIXTURES ONLY. Never imported by app code (src/fixtures.test.ts enforces this).
// The five A1.1 test targets plus synthetic objects (two movers, a progressive object that loads
// in parts and a cached spot for the sky's "loads instantly" markers). Only the names and J2000
// coordinates of the real targets are meant to be real; everything the generators make from them
// is synthetic.
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
  /**
   * Frames clipped by a detector edge: the cutout lost rows above the object, so it is shorter
   * and the object sits near its top (like the real 59×36 and 58×46 cutouts).
   */
  clippedFrames?: Readonly<Record<number, { width: number; height: number }>>;
  /** Frame indices whose cutout returns 404 (refusal path); refused as `cutout` in the spectrum. */
  brokenCutouts?: readonly number[];
  /**
   * Which listed frames give a spectrum point; the rest are refused like the backend's Stage 2
   * (A4.2). Precedence per frame: `refusals` > `brokenCutouts` (→ `cutout`) > `measured` > the
   * default refusal `saturated`. Unset: every frame is measured.
   */
  spectrumShape?: {
    measured: 'all' | readonly number[];
    /** Frame index → Stage 2 refusal reason. */
    refusals?: Readonly<Record<number, string>>;
  };
  /**
   * Stage 1 refusals of frames that never reach the frame list (index ≥ frameCount), e.g.
   * `outside_cutout`: listed in the frames' `missing` and passed through to the spectrum's.
   */
  unlistedRefusals?: Readonly<Record<number, string>>;
  /** When set, the frames reply is empty and lists this in `missing` (backend M1 behaviour). */
  refuseFrames?: string;
  refuseSpectrum?: string;
  /** When set, the colour composite is refused (`image_url: null`) with these in `missing`. */
  refuseComposite?: readonly string[];
  /**
   * Progressive loading (like a live backend with a small SX_LIVE_CUTOUTS_PER_REQUEST): frames
   * listed by the 1st, 2nd, … `/frames` reply since the last resolve; the rest are
   * `cutouts:deferred:<n>`. The last stage must be `frameCount` (complete).
   */
  progressive?: readonly number[];
  /**
   * Issue #60: name of a shared 3D fixture (`shared/fixtures/cards/<body>.json` and
   * `params/<body>.json`) that `/card` and `/render-params` serve for this target. Unset: no 3D model.
   */
  body?: string;
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
    clippedFrames: { 2: { width: 64, height: 40 } },
    // Shape of the 6 Nov full-cache run (synthetic): saturated in all but one frame.
    spectrumShape: { measured: [], refusals: { 11: 'aperture_flags' } },
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
    spectrumShape: { measured: 'all', refusals: { 7: 'aperture_flags', 15: 'aperture_flags' } },
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
    spectrumShape: { measured: 'all', refusals: { 7: 'aperture_flags', 15: 'aperture_flags' } },
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
    // A few short-wavelength points only; the rest saturated (synthetic shape).
    spectrumShape: {
      measured: [0, 1, 2, 3],
      refusals: { 10: 'aperture_flags', 20: 'aperture_edge' },
    },
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
    // Saturated in every listed frame the aperture fits in; one more frame is refused by Stage 1
    // (synthetic shape).
    spectrumShape: { measured: [], refusals: { 21: 'aperture_edge', 22: 'aperture_edge' } },
    unlistedRefusals: { 24: 'outside_cutout' },
    // Fixture-only path: a refused composite (synthetic reasons, not R Dra's real data).
    refuseComposite: ['composite:red:saturated', 'composite:saturated', 'composite:too_few_bands'],
  },
  {
    // Issue #68, 7d: a planet host named in the demo list. Name and J2000 position are real (SIMBAD
    // "HD 189733 b", checked 9 Nov 2026); frames are synthetic. "HD 189733b" (no space) finds it.
    id: 'hd-189733-b',
    name: 'HD 189733 b',
    aliases: ['HD 189733 b', 'HD 189733b', 'HD 189733'],
    ra: 300.18214,
    dec: 22.71085,
    moving: false,
    northUp: false,
    frameCount: 12,
    seed: 1111,
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
    refuseComposite: ['composite:moving_object'],
  },
  {
    id: 'synthetic-progressive',
    name: 'Synthetic progressive (fixture)',
    aliases: ['Synthetic progressive', 'synthetic-progressive'],
    ra: 30, // synthetic position, not a real object
    dec: 30,
    moving: false,
    northUp: false,
    frameCount: 30,
    seed: 808,
    unlistedRefusals: { 30: 'outside_cutout' },
    progressive: [4, 10, 18, 30],
  },
  {
    id: 'synthetic-cached-spot',
    name: 'Synthetic cached spot (fixture)',
    aliases: ['Synthetic cached spot', 'synthetic-cached-spot'],
    ra: 45, // synthetic position, not a real object
    dec: -15,
    moving: false,
    northUp: false,
    frameCount: 12,
    seed: 909,
  },
  {
    // Issue #60: a searchable water planet for the build view. Name, position and frames are all
    // synthetic; its card and render params are the shared planet_water fixture as it draws today.
    id: 'aqua-prime',
    name: 'Aqua Prime',
    aliases: ['Aqua Prime', 'aqua-prime'],
    ra: 38, // synthetic position, not a real object (near the cached spot at 45, -15)
    dec: -12,
    moving: false,
    northUp: false,
    frameCount: 12,
    seed: 1010,
    body: 'planet_water',
  },
  {
    // Issue #68 Part 6 (Q-165): the two demo exoplanets, as searchable fixtures for the build view.
    // The position is the real SIMBAD one (backend recorded reply, 9 Nov 2026); the frames are
    // synthetic. The card and render params are the shared `planet_trappist1f` fixture: real
    // archive values, each source marked "synthetic fixture: real TRAPPIST-1 f value, ...".
    id: 'trappist-1f',
    name: 'TRAPPIST-1 f',
    aliases: ['TRAPPIST-1 f', 'TRAPPIST-1f', 'TRAPPIST 1 f'],
    ra: 346.62237,
    dec: -5.0414,
    moving: false,
    northUp: false,
    frameCount: 12,
    seed: 1111,
    body: 'planet_trappist1f',
  },
  {
    id: 'kepler-186f',
    name: 'Kepler-186 f',
    aliases: ['Kepler-186 f', 'Kepler-186f', 'Kepler 186 f'],
    ra: 298.65272, // SIMBAD, backend recorded reply
    dec: 43.95501,
    moving: false,
    northUp: false,
    frameCount: 12,
    seed: 1212,
    body: 'planet_kepler186f',
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
    // What the backend sends for a mover with no path ephemeris (find/moving.py); the
    // spectrum passes Stage 1's `missing` through.
    refuseFrames: 'frames:ephemeris',
    refuseSpectrum: 'frames:ephemeris',
    refuseComposite: ['composite:moving_object'],
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

// The shell hooks Area search adds (issue #96): validators, area codes, hash key, pointer mode,
// formats, copy, and the reusable sky points (layers, safe rectangle, skyFlyTo). Each also checks
// that what existed before is unchanged.
import { describe, expect, it } from 'vitest';
import {
  parseAreaDots,
  parseAreaIndex,
  parseAreaKnown,
  parseAreaSummary,
  parseAreaTracks,
} from '@/app/api/validate';
import { areaFixture, areaIndexFixture } from '@/test/areaFixtures';
import { formatUtcDayRange, formatVisitTime } from './format';
import * as messages from './messages';
import { groupAreaMissing, groupMissing, parseMissing } from './refusals';
import { useShellStore } from './shell/shellStore';
import { addSkyDescribedBy, registerSkyLayer, runLayerHits, skyDescribedByIds } from './sky/layers';
import { computeSafeRect } from './sky/safeRect';
import { cameraForTarget, skyFlyTo, useSkyFlyStore } from './sky/skyFlyTo';
import { formatHash, parseHash } from './urlHash';
import { raDecToScreen } from '@/viewer/sky/skyMath';

describe('parseArea* (A17.8)', () => {
  it('accepts every reply of both fixture folders', () => {
    expect(parseAreaIndex(areaIndexFixture()).areas).toHaveLength(2);
    for (const which of ['main', 'multivisit'] as const) {
      const f = areaFixture(which);
      expect(parseAreaSummary(f.summary).area_id).toBe(f.summary.area_id);
      expect(parseAreaDots(f.dots).visits.length).toBeGreaterThan(1);
      expect(parseAreaTracks(f.tracks).tracks.length).toBeGreaterThan(0);
      expect(parseAreaKnown(f.known).known).toBeDefined();
    }
  });

  it('refuses one bad case each', () => {
    const idx = areaIndexFixture();
    delete (idx.areas[0] as Partial<(typeof idx.areas)[0]>).width_deg;
    expect(() => parseAreaIndex(idx)).toThrow(/width_deg/);
    const f = areaFixture('main');
    f.summary.frames[0]!.time = '2026-01-15T03:00:00';
    expect(() => parseAreaSummary(f.summary)).toThrow(/time/);
    (f.dots.visits[0]!.dots[0] as { label: string }).label = 'comet';
    expect(() => parseAreaDots(f.dots)).toThrow(/label/);
    (f.tracks.tracks[0] as { verdict: string }).verdict = 'discovered';
    expect(() => parseAreaTracks(f.tracks)).toThrow(/verdict/);
    delete (f.known.provenance.positions as { assumption?: string }).assumption;
    expect(() => parseAreaKnown(f.known)).toThrow(/assumption/);
    const g = areaFixture('main');
    delete (g.dots.provenance.position as { formula?: string }).formula;
    expect(() => parseAreaDots(g.dots)).toThrow(/formula/);
  });
});

describe('area codes (refusals.ts, additions only)', () => {
  it('groups Area notes apart, with wording for the frontend codes', () => {
    const groups = groupAreaMissing(['area:not_prepared', 'horizons:A2', 'saturated:f1']);
    expect(groups.map((g) => [g.kind, g.reason, g.known])).toEqual([
      ['note', 'area:not_prepared', true],
      ['note', 'horizons:A2', false],
      ['frames', 'saturated', true],
    ]);
    expect(messages.describeRefusalGroup(groups[0]!)).toMatch(/not prepared/);
    expect(messages.describeRefusalGroup(groups[1]!)).toBe('Not available: horizons:A2');
  });

  it('leaves the flipbook grouping as it was', () => {
    expect(parseMissing('stamp:x')).toEqual({
      kind: 'frame',
      reason: 'stamp',
      frameId: 'x',
      known: false,
    });
    expect(groupMissing(['saturated:f1'])[0]!.kind).toBe('frames');
  });
});

describe('hash key area= (A18.9)', () => {
  it('reads and writes area after the object keys', () => {
    expect(parseHash('#area=fixture%3Aarea-main').area).toBe('fixture:area-main');
    expect(parseHash('#area=%20').area).toBeUndefined();
    expect(
      formatHash({ ra: 1, dec: 2, name: 'Eros', area: 'fixture:area-main', build: true }),
    ).toBe('#ra=1.00000&dec=2.00000&name=Eros&area=fixture%3Aarea-main&build');
    expect(formatHash({ area: 'a' })).toBe('#area=a');
    expect(formatHash({ ra: 1, dec: 2 })).toBe('#ra=1.00000&dec=2.00000');
  });
});

describe('shell store: area and pointer mode', () => {
  it('choosing any tool sets pan; area drops a card request', () => {
    const s = useShellStore.getState();
    s.requestCard();
    s.setTool('area');
    expect(useShellStore.getState().cardRequested).toBe(false);
    s.setPointerMode('draw');
    expect(useShellStore.getState().pointerMode).toBe('draw');
    s.setTool('sky');
    expect(useShellStore.getState().pointerMode).toBe('pan');
  });
});

describe('formats', () => {
  it('visit time and day range in UTC', () => {
    expect(formatVisitTime('2026-01-16T03:24:00.000Z')).toBe('16 Jan 03:24 UTC');
    expect(formatVisitTime('2026-01-16T03:24:00')).toBe('time not stated in UTC');
    expect(formatUtcDayRange('2026-01-15T03:00:00Z', '2026-01-16T03:24:00Z')).toBe(
      '15 to 16 Jan 2026',
    );
    expect(formatUtcDayRange('2026-01-30T03:00:00Z', '2026-02-02T00:00:00Z')).toBe(
      '30 Jan 2026 to 2 Feb 2026',
    );
    expect(formatUtcDayRange('2026-01-15T03:00:00Z', '2026-01-15T05:00:00Z')).toBe('15 Jan 2026');
  });
});

describe('Area copy (A16.5)', () => {
  it('never calls a track an asteroid, new or a discovery', () => {
    const f = areaFixture('main');
    const strings = [
      ...f.tracks.tracks.map((t) => messages.areaTrackLabel(t)),
      messages.areaTextAlternative({
        widthDeg: 1,
        heightDeg: 0.6,
        visit: 2,
        nVisits: 2,
        measured: false,
        nDots: 289,
        tracks: f.tracks.tracks,
      }),
      messages.AREA_TOOL_HINT,
      messages.AREA_NOT_PREPARED,
      messages.AREA_MEASURED_NOTE,
    ];
    for (const s of strings) expect(s).not.toMatch(/asteroid|\bnew\b|discover/i);
    expect(strings[4]).toBe(
      'Area 1.00° by 0.60°, visit 2 of 2: 4 movers, 1 found blind as Synthetic fixture A1, 1 unexplained, 1 not checked, 1 possible.',
    );
  });

  it('states that results are precomputed, with the run date (Q-205)', () => {
    expect(messages.areaPrecomputedNote('2026-11-10T12:00:00.000Z')).toBe(
      'Precomputed · run 2026-11-10 12:00:00 UTC',
    );
  });
});

describe('sky points (layers, safe rectangle, skyFlyTo)', () => {
  it('runs layer hits topmost first; the first hit consumes the click', () => {
    const order: string[] = [];
    const offA = registerSkyLayer({ id: 'a', order: 1, hitTest: () => (order.push('a'), true) });
    const offB = registerSkyLayer({ id: 'b', order: 5, hitTest: () => (order.push('b'), false) });
    expect(runLayerHits(0, 0)).toBe(true);
    expect(order).toEqual(['b', 'a']);
    offA();
    offB();
    expect(runLayerHits(0, 0)).toBe(false);
  });

  it('an old remover never removes a newer registration (StrictMode)', () => {
    const off1 = registerSkyLayer({ id: 'x', order: 1, hitTest: () => false });
    const off2 = registerSkyLayer({ id: 'x', order: 1, hitTest: () => true });
    off1();
    expect(runLayerHits(0, 0)).toBe(true);
    off2();
  });

  it('appends described-by ids', () => {
    const off = addSkyDescribedBy('alt-1');
    expect(skyDescribedByIds()).toEqual(['alt-1']);
    off();
    expect(skyDescribedByIds()).toEqual([]);
  });

  it('computes the safe rectangle from insets, credit and the card', () => {
    const base = {
      width: 1000,
      height: 600,
      insets: { top: 60, right: 16, bottom: 64, left: 64 },
      creditH: 40,
      card: null,
    };
    expect(computeSafeRect(base)).toEqual({ x: 64, y: 60, w: 920, h: 436 });
    expect(computeSafeRect({ ...base, card: { x: 330, y: 68, w: 340, h: 200 } })).toEqual({
      x: 64,
      y: 268,
      w: 920,
      h: 228,
    });
    expect(computeSafeRect({ ...base, creditH: Number.NaN }).h).toBe(476);
  });

  it('fits a box and centres it in the safe rectangle', () => {
    const safe = { x: 0, y: 300, w: 1280, h: 420 };
    const cam = cameraForTarget(
      { box: { ra: 150, dec: 10, width_deg: 1, height_deg: 0.6 } },
      { ra: 0, dec: 0, fovDeg: 60 },
      1280,
      720,
      safe,
    );
    const p = raDecToScreen(cam, 150, 10, 1280, 720);
    expect(p.x).toBeCloseTo(640, 0);
    expect(p.y).toBeCloseTo(510, 0);
    expect(cam.fovDeg).toBeGreaterThanOrEqual(2);
  });

  it('keeps the last command for a sky that is not ready yet', () => {
    const before = useSkyFlyStore.getState().seq;
    skyFlyTo({ ra: 1, dec: 2 });
    expect(useSkyFlyStore.getState()).toMatchObject({ seq: before + 1, cmd: { ra: 1, dec: 2 } });
  });
});

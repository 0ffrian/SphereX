import { describe, expect, it } from 'vitest';
import { areaFixture } from '@/test/areaFixtures';
import type { AreaTracks } from '@/contract';
import { areaTrackLabel } from '@/app/messages';
import { clampLabel, drawArea, hitTestTracks, type AreaCtx, type AreaDrawInput } from './drawLayer';
import { dotStyle, joinStyle, orderDots, prepareScene } from './scene';

/** A 2D context that records what is drawn (jsdom has none). */
function fakeCtx() {
  const calls: { op: string; style?: string; dash?: number[]; text?: string }[] = [];
  let dash: number[] = [];
  const ctx = {
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    font: '',
    globalAlpha: 1,
    lineJoin: 'miter',
    textBaseline: 'alphabetic',
    clearRect: () => calls.push({ op: 'clear' }),
    beginPath: () => calls.push({ op: 'begin' }),
    moveTo: () => undefined,
    lineTo: () => undefined,
    arc: () => undefined,
    closePath: () => undefined,
    stroke: () => calls.push({ op: 'stroke', style: String(ctx.strokeStyle), dash }),
    fill: () => calls.push({ op: 'fill', style: String(ctx.fillStyle) }),
    setLineDash: (d: number[]) => {
      dash = [...d];
    },
    strokeText: () => undefined,
    fillText: (text: string) => calls.push({ op: 'text', text }),
    measureText: (t: string) => ({ width: t.length * 6 }) as TextMetrics,
  };
  return { ctx: ctx as unknown as AreaCtx, calls };
}

const main = areaFixture('main');
const multi = areaFixture('multivisit');

function input(over: Partial<AreaDrawInput> = {}): AreaDrawInput {
  return {
    scene: prepareScene(main.summary, main.dots, main.tracks),
    visit: 1,
    step: 5,
    layers: { dots: true, tracks: true },
    measured: false,
    selected: null,
    outline: { kind: 'box', box: main.summary, label: '1.00° × 0.60°' },
    draft: null,
    cam: { ra: 150, dec: 10, fovDeg: 2 },
    width: 1280,
    height: 720,
    safe: { x: 0, y: 0, w: 1280, h: 720 },
    ...over,
  };
}

describe('scene', () => {
  it('orders dots by frame order, then numeric n (":5" before ":12")', () => {
    const order = new Map([['f', 0]]);
    const out = orderDots(
      [
        { dot_id: 'f:12', frame_id: 'f' },
        { dot_id: 'f:5', frame_id: 'f' },
      ],
      order,
    );
    expect(out.map((d) => d.dot_id)).toEqual(['f:5', 'f:12']);
  });

  it('joins every tracklet dot id of both fixtures to /dots', () => {
    for (const f of [main, multi]) {
      const s = prepareScene(f.summary, f.dots, f.tracks);
      expect(s.unmatchedDotIds).toEqual([]);
      expect(s.tracks.length).toBe(f.tracks.tracks.length);
    }
  });

  it('labels each verdict without claiming a discovery (A16.5)', () => {
    const labels = main.tracks.tracks.map((t) => areaTrackLabel(t));
    expect(labels).toEqual([
      'T1 · found blind = Synthetic fixture A1',
      'T2 · unexplained track',
      'T3 · not checked',
      'T4 · possible · 1 visit',
    ]);
    const numbered = {
      ...main.tracks.tracks[0]!,
      match: { ...main.tracks.tracks[0]!.match!, number: 433, designation: 'Eros' },
    };
    expect(areaTrackLabel(numbered)).toBe('T1 · found blind = 433 Eros');
    const ambiguous = { ...main.tracks.tracks[3]!, reason: 'ambiguous' as const };
    expect(areaTrackLabel(ambiguous)).toBe('T4 · possible · ambiguous pair');
    for (const l of labels) expect(l).not.toMatch(/asteroid|\bnew\b|discover/i);
  });

  it('dot style per label and step (Q-406 (3)) and in Measured only', () => {
    expect(dotStyle('star', 0, false)).toBe('none');
    expect(dotStyle('star', 2, false)).toBe('ring-white');
    expect(dotStyle('star', 3, false)).toBe('cross');
    expect(dotStyle('fixed', 5, false)).toBe('cross');
    expect(dotStyle('glitch', 1, false)).toBe('ring-colour');
    expect(dotStyle('glitch', 2, false)).toBe('none');
    expect(dotStyle('mover', 5, false)).toBe('ring-colour');
    expect(dotStyle('glitch', 5, true)).toBe('ring-mono');
  });

  it('join style by verdict: dash, not only colour (R9)', () => {
    expect(joinStyle('found_blind', 5)?.dash).toEqual([4, 4]);
    expect(joinStyle('unexplained', 5)?.dash).toEqual([10, 6]);
    expect(joinStyle('unchecked', 5)?.dash).toEqual([1.5, 4]);
    expect(joinStyle('possible', 5)).toBeNull();
    expect(joinStyle('unexplained', 4)?.dash).toEqual([]);
  });
});

describe('drawArea', () => {
  it('draws the box, dots, tracks, joins and labels at step 5', () => {
    const { ctx, calls } = fakeCtx();
    const stats = drawArea(ctx, input());
    expect(stats.outline).toBe('box');
    expect(stats.dots).toBeGreaterThan(200);
    expect(stats.tracks).toBe(4);
    // T1 to T3 are 2-visit tracks: one join each; T4 (possible) none.
    expect(stats.joins).toBe(3);
    expect(stats.labels).toBe(4);
    const dashes = calls.filter((c) => c.op === 'stroke').map((c) => c.dash?.join(','));
    expect(dashes).toContain('4,4');
    expect(dashes).toContain('10,6');
    expect(dashes).toContain('1.5,4');
  });

  it('draws n − 1 joins for the 4-visit track', () => {
    const { ctx } = fakeCtx();
    const s = drawArea(
      ctx,
      input({
        scene: prepareScene(multi.summary, multi.dots, multi.tracks),
        outline: null,
        cam: { ra: 210, dec: -20, fovDeg: 2 },
      }),
    );
    expect(s.joins).toBe(3);
  });

  it('Measured only: dots in one colour, no tracks, labels or bracket', () => {
    const { ctx, calls } = fakeCtx();
    const s = drawArea(ctx, input({ measured: true, selected: 'T1', outline: null }));
    expect(s.tracks).toBe(0);
    expect(s.labels).toBe(0);
    expect(s.bracket).toBe(false);
    expect(s.dots).toBe(main.dots.visits[0]!.dots.length);
    const colours = new Set(
      calls.filter((c) => c.op === 'stroke' && c.style !== 'rgba(0,0,0,0.65)').map((c) => c.style),
    );
    expect([...colours]).toEqual(['#e5e7eb']);
    expect(calls.some((c) => c.op === 'text' && c.text?.startsWith('T'))).toBe(false);
  });

  it('step 4 draws tracks neutral and without labels', () => {
    const s = drawArea(fakeCtx().ctx, input({ step: 4 }));
    expect(s.tracks).toBe(4);
    expect(s.labels).toBe(0);
  });

  it('hides labels when the view is wider than 30°', () => {
    expect(drawArea(fakeCtx().ctx, input({ cam: { ra: 150, dec: 10, fovDeg: 31 } })).labels).toBe(
      0,
    );
    expect(drawArea(fakeCtx().ctx, input({ cam: { ra: 150, dec: 10, fovDeg: 30 } })).labels).toBe(
      4,
    );
  });

  it('clamps a label inside the safe rectangle', () => {
    const safe = { x: 100, y: 50, w: 400, h: 300 };
    expect(clampLabel(480, 20, 60, 14, safe)).toEqual({ x: 438, y: 64 });
    expect(clampLabel(10, 500, 60, 14, safe)).toEqual({ x: 102, y: 348 });
  });

  it('hit-tests within 20 px of a drawn track dot, and draws the bracket', () => {
    const i = input();
    drawArea(fakeCtx().ctx, i);
    const t1 = i.scene!.tracks[0]!;
    const x = t1.sx[0]!;
    const y = t1.sy[0]!;
    expect(hitTestTracks(i.scene, x + 19, y)).toBe('T1');
    expect(hitTestTracks(i.scene, x + 200, y + 200)).not.toBe('T1');
    expect(drawArea(fakeCtx().ctx, { ...i, selected: 'T1' }).bracket).toBe(true);
    // Tracks hidden (Measured only): nothing to hit.
    drawArea(fakeCtx().ctx, { ...i, measured: true });
    expect(hitTestTracks(i.scene, x, y)).toBeNull();
  });

  it('draws a track across RA 0/360 as a short segment', () => {
    const tracks: AreaTracks = structuredClone(main.tracks);
    const dots = structuredClone(main.dots);
    const t = tracks.tracks[1]!;
    // Move the track's dots to straddle RA 0.
    const ids = new Set(t.tracklets.flatMap((tl) => tl.dot_ids));
    let k = 0;
    for (const v of dots.visits)
      for (const d of v.dots)
        if (ids.has(d.dot_id)) {
          d.ra = k++ % 2 === 0 ? 359.99 : 0.01;
          d.dec = 0;
        }
    const scene = prepareScene(main.summary, dots, tracks);
    drawArea(fakeCtx().ctx, input({ scene, outline: null, cam: { ra: 0, dec: 0, fovDeg: 2 } }));
    const st = scene.tracks[1]!;
    const xs = [...st.sx].filter((v) => !Number.isNaN(v));
    expect(xs.length).toBeGreaterThan(1);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(50);
  });
});

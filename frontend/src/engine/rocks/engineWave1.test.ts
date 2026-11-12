// Issue #93 wave 1: the rock engine's @deviation blocks (source.ts, from extract-rock-engine.py PATCHES_93W1 and
// DEV93W1_TAIL), run on a stub WebGL 2 context that records every call: background compile and loops kept as loops
// (B7), comet jets in the vertex shader (1.7), the cube-map bake (2.1).
import { afterEach, describe, expect, it } from 'vitest';
import { stubCanvas, stubGL } from '../worlds/glStub.testutil';
import * as E from './source';

const S = E as unknown as {
  R: Record<string, any>;
  RP: any[];
  RockGL: new (c: HTMLCanvasElement) => {
    poll(): boolean;
    upload(b: unknown): void;
    draw(m: unknown): void;
    baked: boolean;
  };
  rockModel(): any;
  rng(seed: number): () => number;
  radialFn(ax: number[], comet: boolean): (x: number, y: number, z: number) => number;
  ROCK_FS: string;
  BAKE_FS: string;
  ROCK_FS_BAKED: string;
  JET_VS: string;
  setRockBake(on: boolean, n?: number): void;
  setReducedMotion(v: boolean): void;
};

type Call = [string, ...unknown[]];

/** Wraps the stub so every method call is logged with its arguments. */
function recorded(o: Parameters<typeof stubGL>[0] = {}, noFloat = false) {
  const { gl, progs } = stubGL(o);
  const log: Call[] = [];
  const g = gl as unknown as Record<string, unknown>;
  const wrapped = new Proxy(g, {
    get(t, k) {
      const v = t[k as string];
      if (k === 'getExtension')
        return (n: string) =>
          noFloat && n === 'EXT_color_buffer_float' ? null : (v as (n: string) => unknown)(n);
      if (typeof v !== 'function') return v;
      return (...a: unknown[]) => {
        log.push([k as string, ...a]);
        return (v as (...x: unknown[]) => unknown)(...a);
      };
    },
  });
  return { gl: wrapped, log, progs };
}

const fakeBuilt = { w: 4, h: 2, data: new Float32Array(16), ext: 1, craters: 0 };

function engine(preset: any, opts: Parameters<typeof stubGL>[0] = {}, noFloat = false) {
  const r = recorded(opts, noFloat);
  S.R.p = preset;
  S.R.mode = 'rocky';
  S.R.built = fakeBuilt;
  const m = S.rockModel();
  const e = new S.RockGL(stubCanvas(r.gl, 800, 500));
  return { ...r, e, m };
}

afterEach(() => {
  S.setRockBake(true, 1024);
  S.setReducedMotion(false);
});

describe('B7: the rock shader keeps its loops and compiles in the background', () => {
  it('every constant loop bound in ROCK_FS becomes N+uZ0 (fbm, ridge, the 3 boulder loops, the shadow march)', () => {
    expect(S.ROCK_FS).toContain('uniform int uZ0;');
    expect(S.ROCK_FS).not.toMatch(/for\(int [ijk]=-?\d+;[ijk]<=?(\d+|n);/);
    expect(S.ROCK_FS.match(/\+uZ0;/g)).toHaveLength(6);
    expect(S.ROCK_FS).toContain('for(int i=0;i<26+uZ0;i++)');
  });

  it('submits the programs without reading their status, and poll() links once the driver is done', () => {
    const { e, log } = engine(S.RP[0], { lateBy: 3 });
    const status = () =>
      log.filter((c) => c[0] === 'getProgramParameter' && c[2] === 'LINK_STATUS');
    expect(status()).toHaveLength(0);
    expect(e.poll()).toBe(false);
    expect(e.poll()).toBe(false);
    expect(status()).toHaveLength(0);
    let n = 0;
    while (!e.poll()) n++;
    expect(n).toBeLessThan(10);
    expect(status().length).toBeGreaterThanOrEqual(3);
  });

  it('a link error is thrown by poll() (the stage then hands the body back to three.js)', () => {
    const { e } = engine(S.RP[0], { failOn: 'samplerCube uBN' });
    expect(() => e.poll()).toThrow(/link error/);
  });

  it('a host that draws before poll() said ready still draws (it links first, as the prototype did)', () => {
    const { e, m, log } = engine(S.RP[0], { lateBy: 1e9 });
    e.upload(fakeBuilt);
    e.draw(m);
    expect(log.some((c) => c[0] === 'drawElements')).toBe(true);
  });
});

describe('2.1: the fine relief, normal and albedo are baked into cube maps', () => {
  const bakes = (log: Call[]) =>
    log.filter((c) => c[0] === 'framebufferTexture2D' && c[2] === 'COLOR_ATTACHMENT0').length / 6;

  it('BAKE_FS and ROCK_FS_BAKED are cut from ROCK_FS: the light, shadows, phase and tone curve are its own', () => {
    expect(S.BAKE_FS).toContain('hf(dA)');
    expect(S.BAKE_FS).toContain('O2=vec4(h');
    expect(S.BAKE_FS).not.toContain('in vec3 vD;');
    expect(S.ROCK_FS_BAKED).not.toContain('hf(dA)');
    expect(S.ROCK_FS_BAKED).toContain('vec4 bk=texture(uBN,d);float h=texture(uBH,d).r;');
    const tail = (s: string) => s.slice(s.indexOf(' float mu0='));
    expect(tail(S.ROCK_FS_BAKED).replace('vec3 alb=uTint*bk.w;', '')).toBe(
      tail(S.ROCK_FS)
        .replace(',pat=fbm(p0*3.+uSeed3,4),grain=fbm(p0*44.+uSeed3,3);', ';')
        .replace('vec3 alb=uTint*(.58+.8*pat)*(.8+.42*grain);', ''),
    );
  });

  it('with float render targets the baked program draws; the bake runs once per height map and inputs', () => {
    const { e, m, log, progs } = engine(S.RP[2]);
    expect(e.baked).toBe(true);
    expect(progs.map((p) => p.fs)).toEqual(expect.arrayContaining([S.ROCK_FS_BAKED, S.BAKE_FS]));
    expect(progs.map((p) => p.fs)).not.toContain(S.ROCK_FS);
    e.poll();
    e.upload(fakeBuilt);
    e.draw(m);
    expect(bakes(log)).toBe(1);
    expect(log.filter((c) => c[0] === 'texStorage2D').map((c) => c.slice(1))).toEqual([
      ['TEXTURE_CUBE_MAP', 1, 'RGBA16F', 1024, 1024],
      ['TEXTURE_CUBE_MAP', 1, 'R16F', 1024, 1024],
    ]);
    e.draw(m);
    expect(bakes(log)).toBe(1);
    e.upload(fakeBuilt); // a new height map (the age slider)
    e.draw(m);
    expect(bakes(log)).toBe(2);
    S.R.mode = 'smooth'; // a shading input
    e.draw(m);
    expect(bakes(log)).toBe(3);
    // Back-face culling (RockView turns it on) is restored after a bake.
    expect(log.filter((c) => c[0] === 'isEnabled')).toHaveLength(3);
  });

  it('without float render targets, or with the bake off, the prototype ROCK_FS draws and nothing is baked', () => {
    const a = engine(S.RP[0], {}, true);
    expect(a.e.baked).toBe(false);
    expect(a.progs.map((p) => p.fs)).toContain(S.ROCK_FS);
    S.setRockBake(false);
    const b = engine(S.RP[0]);
    expect(b.e.baked).toBe(false);
    b.e.poll();
    b.e.upload(fakeBuilt);
    b.e.draw(b.m);
    expect(b.log.some((c) => c[0] === 'framebufferTexture2D')).toBe(false);
  });
});

describe('1.7: the comet jets move in the vertex shader', () => {
  const comet = () => S.RP.find((p) => p.comet);

  it('a frame uploads nothing and draws every particle (2,400 under reduced motion)', () => {
    const { e, m, log } = engine(comet());
    e.poll();
    e.upload(fakeBuilt);
    const before = log.length;
    e.draw(m);
    const frame = log.slice(before);
    expect(frame.some((c) => c[0] === 'bufferSubData' || c[0] === 'bufferData')).toBe(false);
    expect(frame.filter((c) => c[0] === 'drawArrays' && c[1] === 'POINTS')).toEqual([
      ['drawArrays', 'POINTS', 0, 4000],
    ]);
    S.setReducedMotion(true);
    e.draw(m);
    expect(log.filter((c) => c[0] === 'drawArrays' && c[1] === 'POINTS').at(-1)).toEqual([
      'drawArrays',
      'POINTS',
      0,
      2400,
    ]);
  });

  it("JET_VS on the static data gives the prototype's particles (float32 rounding only)", () => {
    const { e, m, log } = engine(comet());
    const data = log.find(
      (c) => c[0] === 'bufferData' && (c[2] as Float32Array).length === 28000,
    )![2] as Float32Array;
    expect(S.JET_VS).toContain('in vec4 aQ;');
    // The frame the prototype's draw() would see.
    const yaw = 0.9,
      pitch = -0.3,
      clock = 7.25,
      sc = 0.8;
    const cy = Math.cos(yaw),
      sy = Math.sin(yaw),
      cp = Math.cos(pitch),
      sp = Math.sin(pitch);
    const M = [cy, sp * sy, -cp * sy, 0, cp, sp, sy, -sp * cy, cp * cy];
    const q0 = [-0.72, 0.3, 0.62],
      l0 = Math.hypot(...q0);
    const L = q0.map((v) => v / l0);
    // The prototype's loop (source.ts before #93 wave 1), verbatim but for the output array.
    const proto: number[][] = [];
    {
      const jr = S.rng(404),
        jetD: number[][] = [];
      for (let i = 0; i < 4000; i++) jetD.push([jr(), jr(), jr(), jr()]);
      const rf = S.radialFn(m.ax, true),
        t = clock;
      for (let n2 = 0; n2 < 4000; n2++) {
        const q = jetD[n2]!,
          src = Math.floor(q[0]! * 6),
          r2 = S.rng(1000 + src),
          z = r2() * 2 - 1,
          an = r2() * 6.2832,
          c2 = Math.sqrt(1 - z * z);
        let bx = c2 * Math.cos(an) + (q[1]! - 0.5) * 0.28,
          by = z + (q[2]! - 0.5) * 0.28,
          bz = c2 * Math.sin(an) + (q[3]! - 0.5) * 0.28;
        const l2 = Math.hypot(bx, by, bz);
        bx /= l2;
        by /= l2;
        bz /= l2;
        const rs = rf(bx, by, bz),
          wv = [
            (M[0]! * bx + M[1]! * by + M[2]! * bz) * rs,
            (M[3]! * bx + M[4]! * by + M[5]! * bz) * rs,
            (M[6]! * bx + M[7]! * by + M[8]! * bz) * rs,
          ];
        const nl = Math.max(0, (wv[0]! * L[0]! + wv[1]! * L[1]! + wv[2]! * L[2]!) / rs);
        if (nl < 0.06) {
          proto.push([]);
          continue;
        }
        const age = (t * 0.14 + q[1]! * 7 + q[2]!) % 1,
          spd = 0.5 + 0.8 * q[3]!,
          far = age * spd * 2.4,
          push = age * age * 2.1;
        proto.push([
          (wv[0]! + (wv[0]! / rs) * far - L[0]! * push) * sc,
          (wv[1]! + (wv[1]! / rs) * far - L[1]! * push) * sc,
          -(wv[2]! + (wv[2]! / rs) * far - L[2]! * push) * sc,
          (1 - age) * Math.pow(nl, 0.6),
        ]);
      }
    }
    // JET_VS's arithmetic on the uploaded float32 data (uM is the transpose the draw uploads, so uM*aB = M rows . aB).
    const f = Math.fround;
    const ax = m.ax.map(f);
    const uT = f((clock * 0.14) % 1);
    let culled = 0;
    for (let n = 0; n < 4000; n++) {
      const o = n * 7;
      const b = [data[o + 4]!, data[o + 5]!, data[o + 6]!];
      const dq = b.map((v, i) => v / ax[i]!);
      const rs =
        (1 / Math.sqrt(dq[0]! ** 2 + dq[1]! ** 2 + dq[2]! ** 2)) *
        (0.72 + 0.62 * b[0]! * b[0]! + 0.1 * b[0]!);
      const wv = [0, 1, 2].map(
        (r) => (M[r * 3]! * b[0]! + M[r * 3 + 1]! * b[1]! + M[r * 3 + 2]! * b[2]!) * rs,
      );
      const nl = Math.max(0, (wv[0]! * L[0]! + wv[1]! * L[1]! + wv[2]! * L[2]!) / rs);
      const want = proto[n]!;
      if (nl < 0.06) {
        culled++;
        // Only a particle right at the cut may land on the other side of it in float32.
        if (want.length) expect(Math.abs(nl - 0.06)).toBeLessThan(1e-5);
        continue;
      }
      const s = uT + data[o + 1]! * 7 + data[o + 2]!;
      const age = s - Math.floor(s),
        far = age * (0.5 + 0.8 * data[o + 3]!) * 2.4,
        push = age * age * 2.1;
      const got = [
        (wv[0]! + (wv[0]! / rs) * far - L[0]! * push) * sc,
        (wv[1]! + (wv[1]! / rs) * far - L[1]! * push) * sc,
        -(wv[2]! + (wv[2]! / rs) * far - L[2]! * push) * sc,
        (1 - age) * Math.pow(nl, 0.6),
      ];
      expect(want.length).toBe(4);
      for (let k = 0; k < 4; k++) expect(Math.abs(got[k]! - want[k]!)).toBeLessThan(2e-4);
    }
    expect(culled).toBe(proto.filter((p) => !p.length).length);
    expect(e.baked).toBe(true);
  });
});

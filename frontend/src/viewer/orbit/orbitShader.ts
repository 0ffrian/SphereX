// Issue #71 stream H (D-36, Q-270): the Surface view pass as three r187 TSL (`three/webgpu`), a port
// of the prototype's `FLY_FS` GLSL shader. It runs the same on WebGPU and on the WebGL2 fallback.
//
// What it draws, per pixel, from a camera near the ground or in orbit:
//   rocky: ray-march the height field on a sphere (Quilez slope-damped eroded fBm plus gully noise
//     for detail, soft shadows), the ocean with a sunglint whose sharpness fades with the pixel
//     footprint, the land palette of the globe, snow and frost from temperature (cooled with height
//     by 0.66 of the dry lapse rate), rivers, lakes and salt from the hydrology raster, the 2.5D
//     cloud deck and its shadow;
//   gas: the cloud-deck sphere; its sub-grid detail is the solved tracer carried back 10 steps along
//     the solver velocity, plus curl-noise eddies weighted by the belt turbulence;
//   both: single-scattering exponential atmosphere (Rayleigh + haze, limb glow, planet shadow, air
//     mass capped at sqrt(pi R / 2H)).
// Detail finer than a pixel fades out (`lod`, `fbmL`) so nothing shimmers. Float targets are read
// with `textureLoad` and filtered by hand (`bilinear`, no float32 filtering needed).
//
// The output is LINEAR light (the prototype's final 1/2.2 gamma is the renderer's sRGB output).
// No `Math.random`, no time except the cloud drift `uTime` (the sim clock): same sources, camera and
// time give the same image.
/* eslint-disable @typescript-eslint/no-explicit-any -- TSL node graphs are built from untyped proxies */
import { Vector2, Vector3, type DataTexture, type Texture } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { bilinear } from '../renderers/fieldTexture';
import type { OrbitKind } from './orbitMath';

// The TSL helpers are used as untyped proxies (the typings reject mixed scalar and vector maths).
const {
  Break, Fn, If, Loop, abs, asin, atan, clamp, cos, cross, dot, exp, float, floor, fract, length, max, min, mix, normalize, pow, select, sin, smoothstep, sqrt, step, texture, uniform, uv, vec2, vec3, vec4,
} = TSL as any;

const PI = Math.PI;
const TAU = Math.PI * 2;

/** Compile-time shape of the pass: which layers exist. Changing it rebuilds the material. */
export interface OrbitShaderConfig {
  kind: OrbitKind;
  height: DataTexture | null;
  climate: DataTexture | null;
  hydrology: DataTexture | null;
  /** Rocky cloud base: the tracer, or the climate humidity when there is none. */
  cloudBase: DataTexture | null;
  clouds: boolean;
  ocean: boolean;
  snow: boolean;
  velocity: Texture | null;
  bands: Texture | null;
  /** Gas: a live tracer texture is read through `tracerBase`. */
  tracer: Texture | null;
}

const v3 = () => uniform(new Vector3());
const f1 = () => uniform(0);

/** Every uniform of the pass. Set by `OrbitView` from `orbitUniformValues`. */
export function createOrbitUniforms() {
  return {
    uR: uniform(new Vector2(1, 1)),
    uCam: v3(),
    uFwd: v3(),
    uRt: v3(),
    uUp: v3(),
    uLb: v3(),
    uStar: v3(),
    uC0: v3(),
    uCA: v3(),
    uCB: v3(),
    uLiq: v3(),
    uIce: v3(),
    uLand: v3(),
    uCld: v3(),
    uAw: v3(),
    uZ: v3(),
    uB: v3(),
    uS: v3(),
    uP: v3(),
    uHazeC: v3(),
    uSCR: v3(),
    uSCM: v3(),
    uEXT: v3(),
    uFov: f1(),
    uEx: f1(),
    uRkm: f1(),
    uOcean: f1(),
    uTt: f1(),
    uTb: f1(),
    uCov: f1(),
    uTau: f1(),
    uHz: f1(),
    uTime: f1(),
    uSeed: f1(),
    uGam: f1(),
    uClouds: f1(),
    uHV: f1(),
    uMX: f1(),
    /** 0..1: the pane fades in from black like the mock-up's close-up (display only). */
    uFade: uniform(1),
  };
}
export type OrbitUniforms = ReturnType<typeof createOrbitUniforms>;

type T = 'float' | 'vec2' | 'vec3' | 'vec4';
/**
 * A TSL function WITH a layout: three emits it once as a real shader function. Without a layout every
 * call is inlined, which made this pass over a megabyte of WGSL.
 */
const shaderFn = (name: string, type: T, inputs: readonly (readonly [string, T])[], body: (args: any[]) => any) =>
  (Fn(body as any) as any).setLayout({
    name: `sxo_${name}`,
    type,
    inputs: inputs.map(([n, t]) => ({ name: n, type: t })),
  });

/** GLSL `smoothstep(a, b, x)` with a > b, which WGSL leaves undefined: 1 - smoothstep(b, a, x). */
const sstepRev = (a: any, b: any, x: any) => float(1).sub(smoothstep(b, a, x));

/** Direction -> world UV (row 0 = south), as the globe's shaders. */
const uvOf = (b: any) =>
  vec2(atan(b.z, b.x).div(TAU).add(0.5), asin(clamp(b.y, -1, 1)).div(PI).add(0.5));

// ---- value noise (Hoskins hash, no sine) --------------------------------------------------------

const h33 = shaderFn('h33', 'vec3', [['p', 'vec3']], ([p_]) => {
  const p = fract(p_.mul(vec3(0.1031, 0.103, 0.0973))).toVar();
  p.addAssign(dot(p, p.yxz.add(33.33)));
  return fract(p.xxy.add(p.yxx).mul(p.zyx));
});

const vn = shaderFn('vn', 'float', [['x', 'vec3']], ([x]) => {
  const i = floor(x).toVar();
  const f0 = fract(x);
  const f = f0.mul(f0).mul(float(3).sub(f0.mul(2))).toVar();
  const c = (a: number, b: number, d: number) => h33(i.add(vec3(a, b, d))).x;
  return mix(
    mix(mix(c(0, 0, 0), c(1, 0, 0), f.x), mix(c(0, 1, 0), c(1, 1, 0), f.x), f.y),
    mix(mix(c(0, 0, 1), c(1, 0, 1), f.x), mix(c(0, 1, 1), c(1, 1, 1), f.x), f.y),
    f.z,
  );
});

const fbm = (p0: any, n: number) => {
  let p = p0;
  let a = 0.5;
  let s: any = float(0);
  let t = 0;
  for (let i = 0; i < n; i++) {
    s = s.add(vn(p).mul(a));
    t += a;
    p = p.mul(2.03).add(vec3(7.1, 3.3, 1.7));
    a *= 0.5;
  }
  return s.div(t);
};

const ridge = (p0: any, n: number) => {
  let p = p0;
  let a = 0.5;
  let s: any = float(0);
  let t = 0;
  for (let i = 0; i < n; i++) {
    s = s.add(float(1).sub(abs(vn(p).mul(2).sub(1))).mul(a));
    t += a;
    p = p.mul(2.1).add(vec3(3.1, 9.3, 4.7));
    a *= 0.5;
  }
  return s.div(t);
};

/** Detail finer than a pixel fades out instead of shimmering: `fp` is the pixel footprint in planet radii. */
const lod = (f: number, fp: any) => float(1).sub(smoothstep(0.25, 0.6, fp.mul(f)));

const fbmL = (p0: any, f0: number, n: number, fp: any) => {
  let p = p0;
  let f = f0;
  let a = 0.5;
  let s: any = float(0);
  let t = 0;
  for (let i = 0; i < n; i++) {
    s = s.add(vn(p).sub(0.5).mul(lod(f, fp)).mul(a));
    t += a;
    p = p.mul(2.03).add(vec3(7.1, 3.3, 1.7));
    f *= 2.03;
    a *= 0.5;
  }
  return s.div(t).add(0.5);
};

/** Value noise with its analytic gradient (Quilez): xyz = gradient, w = value packed as (value, dx, dy, dz). */
const vnd = shaderFn('vnd', 'vec4', [['x', 'vec3']], ([x]) => {
  const i = floor(x).toVar();
  const f = fract(x).toVar();
  const u = f.mul(f).mul(float(3).sub(f.mul(2))).toVar();
  const du = f.mul(6).mul(float(1).sub(f)).toVar();
  const c = (a: number, b: number, d: number) => h33(i.add(vec3(a, b, d))).x.toVar();
  const a = c(0, 0, 0);
  const b = c(1, 0, 0);
  const cc = c(0, 1, 0);
  const d = c(1, 1, 0);
  const e = c(0, 0, 1);
  const f1_ = c(1, 0, 1);
  const g = c(0, 1, 1);
  const h = c(1, 1, 1);
  const k1 = b.sub(a);
  const k2 = cc.sub(a);
  const k3 = e.sub(a);
  const k4 = a.sub(b).sub(cc).add(d);
  const k5 = a.sub(cc).sub(e).add(g);
  const k6 = a.sub(b).sub(e).add(f1_);
  const k7 = a.negate().add(b).add(cc).sub(d).add(e).sub(f1_).sub(g).add(h);
  const val = a
    .add(k1.mul(u.x))
    .add(k2.mul(u.y))
    .add(k3.mul(u.z))
    .add(k4.mul(u.x).mul(u.y))
    .add(k5.mul(u.y).mul(u.z))
    .add(k6.mul(u.z).mul(u.x))
    .add(k7.mul(u.x).mul(u.y).mul(u.z));
  const gx = k1.add(k4.mul(u.y)).add(k6.mul(u.z)).add(k7.mul(u.y).mul(u.z));
  const gy = k2.add(k5.mul(u.z)).add(k4.mul(u.x)).add(k7.mul(u.z).mul(u.x));
  const gz = k3.add(k6.mul(u.x)).add(k5.mul(u.y)).add(k7.mul(u.x).mul(u.y));
  return vec4(val, du.x.mul(gx), du.y.mul(gy), du.z.mul(gz));
});

/**
 * Slope-damped fBm: each octave is weakened where the octaves above it are steep, which gives
 * smooth valleys and sharp eroded crests (I. Quilez, "elevated" terrain technique).
 */
const efbm = shaderFn('efbm', 'float', [['p0', 'vec3']], ([p0]) => {
  const p = p0.toVar();
  const g = vec3(0).toVar();
  const s = float(0).toVar();
  let a = 0.5;
  for (let i = 0; i < 6; i++) {
    const n = vnd(p);
    g.addAssign(n.yzw.mul(2));
    s.addAssign(n.x.mul(2).sub(1).mul(a).div(float(1).add(dot(g, g))));
    a *= 0.5;
    // rotation (prototype RM, column-major .00,.80,.60 / -.80,.36,-.48 / -.60,-.48,.64), then x2
    p.assign(
      vec3(0, 0.8, 0.6).mul(p.x).add(vec3(-0.8, 0.36, -0.48).mul(p.y)).add(vec3(-0.6, -0.48, 0.64).mul(p.z)).mul(2),
    );
  }
  return s;
});

export interface OrbitShader {
  fragment: any;
  /** The base texture node of the gas tracer (its `.value` is swapped each frame), or null. */
  tracerBase: any | null;
}

/** Builds the full-screen fragment node. Returns the node and the node whose texture is swapped per frame. */
export function buildOrbitShader(cfg: OrbitShaderConfig, U: OrbitUniforms): OrbitShader {
  const gas = cfg.kind === 'gas';
  const { uR, uCam, uFwd, uRt, uUp, uLb, uStar, uC0, uCA, uCB, uLiq, uIce, uLand, uCld, uAw, uZ, uB, uS, uP } = U;
  const { uHazeC, uSCR, uSCM, uEXT, uFov, uEx, uRkm, uOcean, uTt, uTb, uCov, uTau, uHz, uTime, uSeed, uGam, uHV, uMX } = U;

  // ---- sources ----
  const heightAt = (u_: any, v_: any) => bilinear(cfg.height!, u_, v_);
  const climateAt = (uvn: any) => bilinear(cfg.climate!, uvn.x, uvn.y);
  const hydroAt = (uvn: any) => bilinear(cfg.hydrology!, uvn.x, uvn.y);
  const velBase = cfg.velocity ? texture(cfg.velocity) : null;
  const bandBase = cfg.bands ? texture(cfg.bands) : null;
  const tracerBase = cfg.tracer ? texture(cfg.tracer) : null;
  // `.level(0)`: explicit-LOD samples are legal in non-uniform control flow.
  const vel = (uvn: any) => velBase!.sample(uvn).level(0);
  const band = (v_: any) => bandBase!.sample(vec2(0.5, v_)).level(0);
  const tracer = (uvn: any) => tracerBase!.sample(uvn).level(0);

  const rsph = shaderFn('rsph', 'vec2', [['ro', 'vec3'], ['rd', 'vec3'], ['r', 'float']], ([ro, rd, r]) => {
    const b = dot(ro, rd);
    const c = dot(ro, ro).sub(r.mul(r));
    const h = b.mul(b).sub(c);
    const hs = sqrt(max(h, 0));
    return select(h.lessThan(0), vec2(-1, -1), vec2(b.negate().sub(hs), b.negate().add(hs)));
  });

  const airm = (mus: any) =>
    select(mus.lessThan(0), uMX, min(float(1).div(mus.add(0.035)), uMX));

  /** Single scattering through an exponential atmosphere (scale height HV): Rayleigh plus haze. rgb = in-scatter, a = optical depth. */
  const atmo = shaderFn('atmo', 'vec4', [['ro', 'vec3'], ['rd', 'vec3'], ['tmax', 'float']], ([ro, rd, tmax]) => {
    const res = vec4(0, 0, 0, 0).toVar();
    const rs = rsph(ro, rd, float(1).add(uHV.mul(8).div(uRkm)));
    const t0 = max(rs.x, 0).toVar();
    const t1 = min(rs.y, tmax).toVar();
    If(uTau.add(uHz).greaterThan(0.001).and(rs.y.greaterThan(0)).and(t1.greaterThan(t0)), () => {
      const dt = t1.sub(t0).div(16).toVar();
      const od = float(0).toVar();
      const L = vec3(0).toVar();
      Loop(16, ({ i }: any) => {
        const p = ro.add(rd.mul(t0.add(i.toFloat().add(0.5).mul(dt))));
        const r = length(p);
        const dn = exp(max(r.sub(1), 0).mul(uRkm).div(uHV).negate());
        const ds = dn.mul(dt).mul(uRkm);
        const mus = dot(p.div(r), uLb);
        const cz = sqrt(max(float(1).sub(float(1).div(r.mul(r))), 0)).negate();
        const path = od.add(ds.mul(0.5)).add(uHV.mul(dn).mul(airm(mus)));
        L.addAssign(exp(uEXT.mul(path).negate()).mul(smoothstep(cz.sub(0.03), cz.add(0.01), mus)).mul(ds));
        od.addAssign(ds);
      });
      const c = dot(rd, uLb);
      const g = 0.72;
      const pR = float(0.0597).mul(float(1).add(c.mul(c)));
      const pM = float(1 - g * g).div(float(12.566).mul(pow(float(1 + g * g).sub(c.mul(2 * g)), 1.5)));
      const ins = uStar.mul(L).mul(uSCR.mul(pR).add(uSCM.mul(uHazeC).mul(pM))).mul(PI);
      res.assign(vec4(ins, od));
    });
    return res;
  });

  const sunT = (d: any) => exp(uEXT.mul(uHV).mul(airm(dot(d, uLb))).negate());

  // ---- rocky pieces ----
  const gully = shaderFn('gully', 'vec3', [['p', 'vec2'], ['dir', 'vec2']], ([p, dir]) => {
    const ip = floor(p).toVar();
    const fp = fract(p).toVar();
    const va = vec3(0).toVar();
    const wt = float(0).toVar();
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const o = vec2(i, j);
        const jit = h33(vec3(ip.x.add(i), ip.y.add(j), uSeed)).xy;
        const pp = fp.sub(o).sub(jit.mul(0.8)).add(0.4);
        const w = exp(dot(pp, pp).mul(-2));
        const mg = dot(pp, dir).mul(TAU);
        const gv = sin(mg).negate().mul(dir).mul(TAU);
        va.addAssign(vec3(cos(mg), gv.x, gv.y).mul(w));
        wt.addAssign(w);
      }
    }
    return va.div(wt);
  });

  /** Height above sea level, km: the 55 km grid read through a small fractal warp, plus eroded detail. */
  const hKm = shaderFn('hKm', 'float', [['d', 'vec3']], ([d]) => {
    const wq = d.mul(300).add(uSeed).toVar();
    const warp = vec3(vn(wq), vn(wq.add(7.3)), vn(wq.add(3.1)))
      .sub(0.5)
      .mul(0.008)
      .add(vec3(vn(wq.mul(4)), vn(wq.mul(4).add(7.3)), vn(wq.mul(4).add(3.1))).sub(0.5).mul(0.0025));
    const uvh = uvOf(normalize(d.add(warp)));
    const e = heightAt(uvh.x, uvh.y).r.toVar();
    const m = smoothstep(0.1, 2.5, e);
    const p = d.mul(420).add(uSeed).toVar();
    const h = e
      .add(ridge(p, 4).sub(0.55).mul(0.6).add(efbm(p.mul(0.8)).mul(1.1)).mul(float(0.3).add(m.mul(2.6))))
      .add(fbm(p.mul(3.7), 3).sub(0.5).mul(0.14));
    return select(uOcean.greaterThan(0.5), max(h, 0), h);
  });
  const surfR = (d: any) => float(1).add(hKm(d).mul(uEx).div(uRkm));

  /** Cloud cover 0..1 at a direction, `tq` = distance to the deck (for the pixel footprint). */
  const cov2 = shaderFn('cov2', 'float', [['d', 'vec3'], ['tq', 'float']], ([d, tq]) => {
    const fp = tq.mul(2).mul(uFov).div(uR.y);
    const q = d.mul(260).add(vec3(uTime.mul(0.01), 0, 0)).add(uSeed).toVar();
    const w = vec3(fbmL(q, 260, 4, fp), fbmL(q.add(5.2), 260, 4, fp), fbmL(q.add(9.7), 260, 4, fp)).sub(0.5).toVar();
    const cuv = uvOf(normalize(d.add(w.mul(0.035))));
    // The tracer when the renderer has one, else the humidity of the climate budget (R = cover, G = offset).
    const cl = cfg.cloudBase
      ? bilinear(cfg.cloudBase, cuv.x, cuv.y).rg
      : cfg.climate
        ? vec2(climateAt(cuv).a, 0.5)
        : vec2(0, 0.5);
    const th = float(1).sub(uCov);
    const b = cl.x.add(cl.y.sub(0.5).mul(0.32)).add(fbmL(d.mul(1100).add(w.mul(30)).add(uSeed), 1100, 5, fp).sub(0.5).mul(0.42));
    return smoothstep(th.sub(0.08), th.add(0.3), b);
  });

  /** Colour of the ground the ray hit on a rocky world (before the cloud deck and the air). */
  const rockShade = shaderFn('rockShade', 'vec3', [['ro', 'vec3'], ['rd', 'vec3'], ['hit', 'float']], ([ro, rd, hit]) => {
    const p = ro.add(rd.mul(hit)).toVar();
    const d = normalize(p).toVar();
    const uvd = uvOf(d).toVar();
    const mud = dot(d, uLb).toVar();
    const fp = hit.mul(2).mul(uFov).div(uR.y).div(max(abs(dot(rd, d)), 0.2)).toVar();
    const amb = uStar
      .mul(uSCR.mul(uHV).mul(1.3).add(uSCM.mul(uHazeC).mul(uHV).mul(0.8)).add(0.012))
      .mul(smoothstep(-0.25, 0.3, mud))
      .toVar();
    const sT = sunT(d).toVar();
    const tA = normalize(cross(d, select(abs(d.y).lessThan(0.99), vec3(0, 1, 0), vec3(1, 0, 0)))).toVar();
    const tB = cross(d, tA).toVar();
    const ee = max(float(0.35).div(uRkm), fp.mul(0.7));
    const da = normalize(d.add(tA.mul(ee))).toVar();
    const db = normalize(d.add(tB.mul(ee))).toVar();
    const hk = hKm(d).toVar();
    const p0 = d.mul(float(1).add(hk.mul(uEx).div(uRkm))).toVar();
    const nn = normalize(cross(da.mul(surfR(da)).sub(p0), db.mul(surfR(db)).sub(p0))).toVar();
    const n = select(dot(nn, d).lessThan(0), nn.negate(), nn).toVar();
    const top = float(1).add(uEx.mul(14).div(uRkm));

    // soft shadow toward the star
    const sh = float(1).toVar();
    If(dot(n, uLb).greaterThan(0), () => {
      const s2 = p0.add(d.mul(2e-6)).toVar();
      const st = float(6e-6).toVar();
      Loop(36, () => {
        s2.addAssign(uLb.mul(st));
        const rq = length(s2);
        const gq = rq.sub(surfR(s2.div(rq)));
        If(gq.lessThan(0), () => {
          sh.assign(0);
          Break();
        });
        sh.assign(min(sh, gq.mul(10).div(st)));
        st.mulAssign(1.3);
        If(rq.greaterThan(top), () => {
          Break();
        });
      });
      sh.assign(clamp(sh, 0, 1));
    });

    const E = cfg.climate ? climateAt(uvd).toVar() : vec4(300, 0, 0, 0).toVar();
    const hy = cfg.hydrology ? hydroAt(uvd).toVar() : vec4(0, 0, 0, 0).toVar();
    const e = heightAt(uvd.x, uvd.y).r.toVar();
    const slope = float(1).sub(dot(n, d)).mul(uEx).toVar();

    // drainage gullies on slopes, a few km apart: shading and snow only
    const P = vec2(dot(d, uCA), dot(d, uCB)).div(max(dot(d, uC0), 0.05)).mul(uRkm).toVar();
    const sl = n.sub(d.mul(dot(n, d)));
    const s2d = vec2(dot(sl, uCA), dot(sl, uCB)).toVar();
    const sm = length(s2d);
    const dir = select(sm.greaterThan(1e-5), vec2(s2d.y.negate(), s2d.x).div(sm), vec2(1, 0)).toVar();
    let G: any = float(0);
    let gd: any = vec2(0, 0);
    let ga = 1;
    let fq = 0.16;
    for (let i = 0; i < 3; i++) {
      const w = lod(fq * 1, fp.mul(uRkm));
      const g3 = gully(P.mul(fq), dir);
      G = G.add(g3.x.mul(w).mul(ga));
      gd = gd.add(g3.yz.mul(fq).mul(w).mul(ga));
      ga *= 0.5;
      fq *= 2.3;
    }
    const gw = smoothstep(0.03, 0.18, slope).mul(float(1).sub(step(hk, 0.001).mul(uOcean)));
    G = G.mul(gw);
    gd = gd.mul(gw);
    const n2 = normalize(n.sub(uCA.mul(gd.x).add(uCB.mul(gd.y)).mul(0.3).mul(uEx))).toVar();
    const slope2 = float(1).sub(dot(n2, d)).mul(uEx).toVar();
    const Tl = E.r.sub(uGam.mul(max(hk.add(G.mul(0.3)), 0))).toVar();

    // shadow of the cloud deck on the ground
    const cs = float(1).toVar();
    if (cfg.clouds) {
      If(U.uClouds.greaterThan(0.5).and(uCov.greaterThan(0.01)), () => {
        const rm = float(1).add(uEx.mul(3).div(uRkm));
        const sp = p0.add(uLb.mul(rm.sub(length(p0)).div(max(mud, 0.1))));
        cs.assign(float(1).sub(smoothstep(0.15, 0.7, cov2(normalize(sp), hit)).mul(0.78)));
      });
    }

    const col = vec3(0).toVar();
    const litSun = uStar.mul(sT).mul(max(dot(n2, uLb), 0)).mul(sh).mul(cs);
    const landCol = () => {
      // same palette as the globe: brighter lowlands, darker heights, dry ground warmer, wet ground darker
      const fn = fbm(d.mul(38).add(uSeed), 4).toVar();
      let ld: any = mix(uLand, uLand.mul(vec3(0.72, 0.7, 0.7)).add(0.06), smoothstep(0.5, 2.6, e)).mul(
        float(0.7).add(fbm(d.mul(15).add(uSeed), 3).mul(0.62)),
      );
      ld = mix(ld, ld.mul(1.18).add(vec3(0.03, 0.025, 0.015)), float(1).sub(smoothstep(0, 0.35, e)));
      const wet = cfg.climate ? clamp(E.a, 0, 1) : float(0.4);
      ld = mix(
        ld.mul(vec3(1.22, 1.08, 0.82)).add(vec3(0.05, 0.035, 0.012)),
        ld.mul(vec3(0.62, 0.6, 0.56)),
        smoothstep(0.05, 0.6, wet),
      );
      ld = ld
        .mul(float(0.78).add(fbmL(d.mul(110).add(uSeed), 110, 3, fp).mul(0.44)))
        .mul(float(0.85).add(fbmL(d.mul(1500).add(uSeed), 1500, 4, fp).mul(0.3)));
      ld = mix(ld, ld.gbr.mul(0.35).add(ld.mul(0.75)), smoothstep(0.55, 0.8, fbm(d.mul(60).add(uSeed).add(3), 3)).mul(0.5));
      ld = mix(
        ld,
        uLand.mul(vec3(0.58, 0.56, 0.55)).mul(float(0.8).add(fbmL(d.mul(5000), 5000, 3, fp).mul(0.4))),
        smoothstep(0.1, 0.35, slope2),
      );
      if (cfg.snow && cfg.climate) {
        const fs = float(1).sub(exp(E.b.div(0.08).negate()));
        const cold = sstepRev(uTt.add(9), uTt.sub(5), Tl);
        let fa: any = clamp(fs.mul(float(0.35).add(cold.mul(0.65))).add(cold.mul(smoothstep(1.6, 3.4, hk)).mul(0.75)), 0, 1);
        fa = smoothstep(0, 1, fa.mul(float(0.7).add(fn.mul(0.7)))).mul(float(1).sub(smoothstep(0.35, 0.7, slope2).mul(0.8)));
        ld = mix(ld, uIce.mul(float(0.92).add(fn.mul(0.1))), fa);
      }
      if (cfg.hydrology) {
        ld = mix(ld, vec3(0.93, 0.91, 0.86), hy.g.mul(0.85));
        const riv = hy.r
          .mul(sstepRev(uTb, uTb.sub(4), Tl))
          .mul(uOcean)
          .mul(float(1).sub(smoothstep(0.1, 0.3, slope2)));
        ld = mix(ld, uLiq.mul(0.7), min(riv.mul(1.3), 1));
        ld = mix(ld, uIce, hy.a.mul(0.8));
      }
      return ld.mul(litSun.add(amb));
    };
    if (cfg.ocean && cfg.climate) {
      If(uOcean.greaterThan(0.5).and(hk.lessThanEqual(0.001)), () => {
        // water: colour by depth, Fresnel sky, sunglint whose sharpness fades with the pixel footprint
        const trn = exp(uAw.mul(2).negate().mul(min(max(e.negate(), 0).mul(1000), 400)));
        const w = uLiq.mul(float(1).sub(trn)).add(uLand.mul(0.8).mul(trn));
        const wl = lod(2600, fp);
        const wq = d.mul(2600);
        const wn = normalize(
          d.add(
            vec3(fbm(wq.add(uTime.mul(0.2)), 3), fbm(wq.add(7).sub(uTime.mul(0.17)), 3), fbm(wq.add(13), 3))
              .sub(0.5)
              .mul(0.06)
              .mul(wl),
          ),
        );
        const v = rd.negate();
        const hv = normalize(uLb.add(v));
        const pw = mix(float(14), float(140), wl);
        const spec = pow(max(dot(wn, hv), 0), pw).mul(pw.add(8)).div(150);
        const fr = float(0.02).add(float(0.98).mul(pow(float(1).sub(max(dot(wn, v), 0)), 5)));
        const ice = smoothstep(0.02, 0.45, E.g).mul(smoothstep(0.3, 0.6, fbmL(d.mul(700), 700, 3, fp).add(E.g.mul(0.4))));
        const skyR = uStar
          .mul(uSCR.mul(uHV).mul(3).add(uSCM.mul(uHazeC).mul(uHV).mul(2)).add(0.02))
          .mul(smoothstep(-0.2, 0.3, mud));
        const water = w
          .mul(uStar.mul(sT).mul(max(mud, 0)).mul(cs).add(amb))
          .add(skyR.mul(fr))
          .add(uStar.mul(sT).mul(spec).mul(sh).mul(cs).mul(smoothstep(-0.05, 0.15, mud)))
          .toVar();
        col.assign(mix(water, uIce.mul(litSun.add(amb)), ice));
      }).Else(() => {
        col.assign(landCol());
      });
    } else {
      col.assign(landCol());
    }
    return col;
  });

  /** Colour of the cloud tops of a gas giant (before the air). */
  const gasShade = shaderFn('gasShade', 'vec3', [['ro', 'vec3'], ['rd', 'vec3'], ['hit', 'float']], ([ro, rd, hit]) => {
    const p = ro.add(rd.mul(hit));
    const d = normalize(p).toVar();
    const uvd = uvOf(d).toVar();
    const mud = dot(d, uLb).toVar();
    const fp = hit.mul(2).mul(uFov).div(uR.y).div(max(abs(dot(rd, d)), 0.2)).toVar();
    const amb = uStar
      .mul(uSCR.mul(uHV).mul(1.3).add(uSCM.mul(uHazeC).mul(uHV).mul(0.8)).add(0.012))
      .mul(smoothstep(-0.25, 0.3, mud));
    const sT = sunT(d);
    // Large scale = the solved tracer; small scale = the tracer carried back along the solved winds
    // plus sub-grid curl-noise eddies, so filaments stretch along the jets and wrap the storms
    // (artistic below the solver grid, about 280 km).
    const X = vec2(dot(d, uCA), dot(d, uCB)).div(max(dot(d, uC0), 0.05)).toVar();
    const tb = band(uvd.y).b.toVar();
    if (velBase) {
      Loop(10, () => {
        const dd = normalize(uC0.add(uCA.mul(X.x)).add(uCB.mul(X.y)));
        const v = vel(uvOf(dd));
        const E_ = normalize(cross(vec3(0, 1, 0), dd));
        const N_ = cross(dd, E_);
        const V = E_.mul(v.x).mul(sqrt(max(float(1).sub(dd.y.mul(dd.y)), 0))).add(N_.mul(v.y));
        const Y1 = X.mul(55);
        const Y2 = X.mul(170).add(3);
        const e = 0.2;
        const curl = (Y: any) =>
          vec2(
            vn(vec3(Y.x, Y.y.add(e), uSeed)).sub(vn(vec3(Y.x, Y.y.sub(e), uSeed))),
            vn(vec3(Y.x.sub(e), Y.y, uSeed)).sub(vn(vec3(Y.x.add(e), Y.y, uSeed))),
          ).div(2 * e);
        const c1 = curl(Y1);
        const c2 = curl(Y2);
        X.subAssign(
          vec2(dot(V, uCA), dot(V, uCB))
            .mul(0.004)
            .add(c1.mul(0.3 / 55).mul(lod(55, fp)).add(c2.mul(0.25 / 170).mul(lod(170, fp))).mul(float(0.2).add(tb.mul(1.6)))),
        );
      });
    }
    const df = normalize(uC0.add(uCA.mul(X.x)).add(uCB.mul(X.y)));
    const uf = uvOf(df);
    const tt = tracer(uf).toVar();
    const bd = band(uf.y).toVar();
    const dye = fbmL(vec3(X.mul(300), uSeed), 300, 4, fp).toVar();
    const dye2 = fbmL(vec3(X.mul(70), uSeed.add(4)), 70, 3, fp);
    const ex2 = 0.6 / 300;
    const streak = tt.b
      .sub(0.5)
      .mul(float(0.08).add(bd.b.mul(0.55)))
      .add(dye.sub(0.5).mul(float(0.3).add(bd.b.mul(0.6))))
      .toVar();
    const br = tt.r.add(streak.mul(0.5)).toVar();
    let cc: any = mix(uZ, uB, clamp(tt.g.add(streak.mul(0.9)), 0, 1));
    cc = mix(cc, uS, clamp(tt.a.mul(1.15), 0, 0.92));
    cc = cc.mul(float(0.38).add(br.mul(0.78)));
    cc = mix(cc, uP.mul(float(0.74).add(br.mul(0.5))), bd.a.mul(0.85));
    cc = mix(cc, uP.mul(float(0.55).add(dye.mul(0.8))), smoothstep(0.55, 0.78, dye2).mul(float(0.25).add(tb.mul(0.6))).mul(0.7));
    cc = mix(cc, mix(uB, uS, dye).mul(float(0.55).add(br.mul(0.7))), smoothstep(0.45, 0.75, dye2).mul(tb).mul(0.55));
    const gx = fbmL(vec3(X.add(vec2(ex2, 0)).mul(300), uSeed), 300, 4, fp).sub(dye);
    const gy = fbmL(vec3(X.add(vec2(0, ex2)).mul(300), uSeed), 300, 4, fp).sub(dye);
    const n = normalize(d.sub(uCA.mul(gx).add(uCB.mul(gy)).div(ex2).mul(0.0008).mul(float(0.5).add(br))));
    return cc.mul(
      uStar
        .mul(sT)
        .mul(float(0.04).add(float(0.96).mul(max(dot(n, uLb), 0))))
        .mul(smoothstep(-0.08, 0.05, mud))
        .add(amb.mul(0.5)),
    );
  });

  // ---- the pass ----
  const fragment = Fn(() => {
    const vp = uv();
    const q = vec2(vp.x.mul(2).sub(1).mul(uR.x.div(uR.y)), float(1).sub(vp.y.mul(2)));
    const rd = normalize(uFwd.add(uRt.mul(q.x.mul(uFov))).add(uUp.mul(q.y.mul(uFov)))).toVar();
    const ro = uCam;
    const hit = float(-1).toVar();
    if (gas) {
      const rs = rsph(ro, rd, float(1)).toVar();
      If(rs.x.greaterThan(0), () => {
        hit.assign(rs.x);
      });
    } else {
      const top = float(1).add(uEx.mul(14).div(uRkm));
      const rs = rsph(ro, rd, top).toVar();
      If(rs.y.greaterThan(0), () => {
        const t = max(rs.x, 0).toVar();
        Loop(360, () => {
          const p = ro.add(rd.mul(t));
          const r = length(p);
          const g = r.sub(surfR(p.div(r)));
          If(g.lessThan(float(1e-6).add(t.mul(6e-5))), () => {
            hit.assign(t);
            Break();
          });
          If(t.greaterThan(rs.y), () => {
            Break();
          });
          t.addAssign(max(g.mul(0.55), float(2e-7).add(t.mul(0.0012))));
        });
      });
    }
    const col = vec3(0).toVar();
    If(hit.greaterThan(0), () => {
      col.assign(gas ? gasShade(ro, rd, hit) : rockShade(ro, rd, hit));
    }).Else(() => {
      // the star's disc
      col.assign(uStar.mul(pow(max(dot(rd, uLb), 0), 2400)).mul(40));
    });

    // rock worlds: one cloud deck about 3 km up (drawn x uEx). Opacity is the cover times the slant
    // path through a layer whose depth grows with cover; tops are lit from their own slope and
    // shadowed by cloud toward the Sun.
    if (!gas && cfg.clouds) {
      If(U.uClouds.greaterThan(0.5).and(uCov.greaterThan(0.01)), () => {
        const rc = float(1).add(uEx.mul(3).div(uRkm));
        const tmax = select(hit.greaterThan(0), hit, float(1e9));
        const rs = rsph(ro, rd, rc).toVar();
        const above = step(rc, length(ro));
        const tc = select(above.greaterThan(0.5), rs.x, rs.y).toVar();
        If(tc.greaterThan(0).and(tc.lessThan(tmax)).and(rs.y.greaterThan(0)), () => {
          const pc = ro.add(rd.mul(tc));
          const dc = normalize(pc).toVar();
          const c = cov2(dc, tc).toVar();
          If(c.greaterThan(0.003), () => {
            const fpc = tc.mul(2).mul(uFov).div(uR.y);
            const mu = abs(dot(rd, dc));
            const al = float(1).sub(exp(c.mul(-7).div(max(mu, 0.12))));
            const ec = max(float(1.5).div(uRkm), fpc.mul(1.5));
            const cx = cov2(normalize(dc.add(uCA.mul(ec))), tc);
            const cy = cov2(normalize(dc.add(uCB.mul(ec))), tc);
            const nc = normalize(
              dc.sub(uCA.mul(cx.sub(c)).add(uCB.mul(cy.sub(c))).div(ec).mul(uEx.mul(2.5).div(uRkm))),
            );
            const mus = dot(dc, uLb);
            const o = cov2(normalize(dc.add(uLb.mul(uEx.mul(4).div(uRkm)))), tc);
            const slf = exp(max(o.sub(c.mul(0.6)), 0).mul(-1.8));
            const lit = select(
              above.greaterThan(0.5),
              float(0.25).add(float(0.75).mul(max(dot(nc, uLb), 0))).mul(slf),
              float(0.35).mul(float(1).sub(c.mul(0.7))),
            );
            const lc = uCld.mul(
              uStar
                .mul(sunT(dc))
                .mul(lit)
                .mul(smoothstep(-0.06, 0.08, mus))
                .mul(float(0.85).add(pow(max(dot(rd, uLb), 0), 6).mul(0.6)))
                .add(
                  uStar
                    .mul(uSCR.mul(uHV).mul(1.3).add(0.05))
                    .mul(smoothstep(-0.25, 0.3, mus))
                    .mul(select(above.greaterThan(0.5), float(1), float(0.6))),
                ),
            );
            col.assign(mix(col, lc, al));
          });
        });
      });
    }

    const at = atmo(ro, rd, select(hit.greaterThan(0), hit, float(1e9)));
    col.assign(col.mul(exp(uEXT.mul(at.w).negate())).add(at.xyz));
    return vec4(float(1).sub(exp(col.mul(-1.5))).mul(U.uFade), 1);
  })();

  return { fragment, tracerBase };
}

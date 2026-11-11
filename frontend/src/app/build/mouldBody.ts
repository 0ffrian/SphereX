/* eslint-disable */
// @ts-nocheck
// Verbatim port of the mock-up's build-view bodies (mockup/spherex-ui.html: NOISE, ROCK/STAR/GAS/TERRA/
// CLOUD/ATM/RING shaders, makeBody and its per-kind `apply(P, t)` staging, disposeBody). The shader
// code is unchanged. Changes for three r187 (plain `three`, WebGLRenderer): `import * as THREE`, the
// shared state `B` is a module object, and ShaderMaterial's `extensions:{derivatives:true}` is dropped
// (derivatives are always on in WebGL2). Math.random stays as in the mock-up: this is a loader's
// picture, not a generated texture. Not for lint or strict types: keep it as the mock-up has it.
import * as THREE from 'three';

export const B = { dotTex: null, SUN: null, Q: null };
export function initShared() {
  if (B.dotTex) return;
  B.SUN = new THREE.Vector3(-1, .55, .8).normalize(); B.Q = new THREE.Quaternion();
  const dot = document.createElement('canvas'); dot.width = dot.height = 64; const g = dot.getContext('2d');
  const gr = g.createRadialGradient(32,32,0,32,32,32); gr.addColorStop(0,'#fff'); gr.addColorStop(.3,'#ffffffaa'); gr.addColorStop(1,'#ffffff00');
  g.fillStyle = gr; g.fillRect(0,0,64,64); B.dotTex = new THREE.CanvasTexture(dot);
}
function rng(seed){ return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const NOISE = `float hash13(vec3 p){ p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1.0,0.0,0.0)), f.x), mix(hash13(i + vec3(0.0,1.0,0.0)), hash13(i + vec3(1.0,1.0,0.0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0.0,0.0,1.0)), hash13(i + vec3(1.0,0.0,1.0)), f.x), mix(hash13(i + vec3(0.0,1.0,1.0)), hash13(i + vec3(1.0,1.0,1.0)), f.x), f.y), f.z); }
float fbm(vec3 p, int oct){ float a = 0.5, sum = 0.0; for (int i = 0; i < 7; i++) { if (i >= oct) break; sum += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return sum / 0.97; }
`;
/* rock: the mould is a sphere, the vertex shader stretches and lumps it, the fragment shader adds craters + colour */
const ROCK_VS = NOISE + `uniform float uShape, uSeed; uniform vec3 uElong; varying vec3 vObj; varying vec3 vPos;
void main(){
  vec3 d = normalize(position);
  float l = fbm(d * 1.25 + uSeed, 3) - 0.5, l2 = fbm(d * 3.1 + uSeed * 1.7 + 4.0, 3) - 0.5;
  float r = 1.0 + uShape * (0.42 * l + 0.12 * l2);
  vec3 p = d * r * mix(vec3(1.0), uElong, uShape);
  vObj = d; vPos = p; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const ROCK_FS = NOISE + `uniform float uSeed, uRelief, uColor, uBump, uCrat, uHO; uniform vec3 uTint, uSunO; varying vec3 vObj; varying vec3 vPos;
float cr(vec3 p, float s, float dens){
  vec3 q = p * s; vec3 c0 = floor(q); float h = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) for (int k = -1; k <= 1; k++) {
    vec3 c = c0 + vec3(float(i), float(j), float(k));
    if (hash13(c + uSeed) > dens) continue;
    vec3 ctr = c + vec3(hash13(c + 1.7), hash13(c + 5.3), hash13(c + 9.1));
    float rad = 0.28 + 0.3 * hash13(c + 3.3);
    float d = length(q - ctr) / rad;
    float bowl = d < 1.0 ? -(1.0 - d * d) : 0.0;
    float rim = exp(-pow((d - 1.0) / 0.2, 2.0)) * 0.35;
    h += (bowl + rim) * rad;
  }
  return h / s;
}
float H(vec3 d){ return (cr(d, 3.2, 0.45) + cr(d, 8.0, 0.35) * 0.6) * uCrat * 6.0 + 0.05 * fbm(d * 14.0, 4); }
void main(){
  vec3 d = normalize(vObj);
  vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos))); if (dot(n, vObj) < 0.0) n = -n;
  vec3 t1 = normalize(cross(abs(d.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0), d)); vec3 t2 = cross(d, t1);
  float e = 0.01, h0 = H(d), h1 = H(normalize(d + t1 * e)), h2 = H(normalize(d + t2 * e));
  vec3 pv = (((h1 - h0) / e) * t1 + ((h2 - h0) / e) * t2) * uBump * uRelief;
  pv *= min(1.0, 0.8 / max(length(pv), 0.0001)); n = normalize(n - pv);
  if (uHO > 0.5) { gl_FragColor = vec4(clamp(h0 * 2.0 + 0.5, 0.0, 1.0), clamp(length(pv) * 1.5, 0.0, 1.0), 0.0, 1.0); return; }
  float mu0 = max(dot(n, uSunO), 0.0);
  float alb = 0.55 + 0.6 * (fbm(d * 5.0 + uSeed, 4) - 0.5) + 0.25 * h0 * uRelief;
  vec3 base = mix(vec3(0.62, 0.66, 0.72), uTint * (0.45 + 1.1 * alb), uColor);
  float ao = mix(1.0, 0.7 + 0.3 * smoothstep(-0.15, 0.1, h0), uRelief);
  vec3 col = pow(base * ao * (mu0 * 1.5 + 0.04), vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}`;
const WIRE_FS = `uniform float uWire; void main(){ gl_FragColor = vec4(0.45, 0.82, 1.0, uWire); }`;
/* star */
const STAR_VS = `varying vec3 vObj; varying vec3 vN; void main(){ vObj = position; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const STAR_FS = NOISE + `uniform float uTime, uGran, uSpots, uColor, uSeed, uFreq, uHO; uniform vec3 uCol; varying vec3 vObj; varying vec3 vN;
void main(){
  vec3 d = normalize(vObj); float mu = clamp(normalize(vN).z, 0.0, 1.0);
  float g = fbm(d * uFreq + vec3(uTime * 0.05, 0.0, uSeed), 4), cells = vnoise(d * uFreq * 2.2 + vec3(0.0, uTime * 0.08, uSeed));
  float gran = mix(0.5, g * 0.6 + cells * 0.4, uGran);
  float sp = smoothstep(0.6, 0.7, fbm(d * 2.4 + uSeed * 3.0, 4)) * uSpots;
  float b = (0.62 + 1.2 * (gran - 0.5)) * (1.0 - sp * 0.75);
  if (uHO > 0.5) { gl_FragColor = vec4(clamp(gran, 0.0, 1.0), clamp((abs(dFdx(gran)) + abs(dFdy(gran))) * 30.0, 0.0, 1.0), 0.0, 1.0); return; }
  float limb = 1.0 - 0.65 * (1.0 - mu);
  vec3 clay = vec3(0.7, 0.72, 0.78) * (0.3 + 0.7 * mu) * (0.8 + 0.5 * (gran - 0.5));
  vec3 hot = uCol * b * limb * 1.7;
  vec3 col = mix(clay, hot, uColor); col = 1.0 - exp(-col * 1.5);
  gl_FragColor = vec4(col, 1.0);
}`;
/* brown dwarf: banded cloud deck, patched with stage uniforms */
const GAS_VS = `uniform vec3 uScale; varying vec3 vD; varying vec3 vN; void main(){ vD = normalize(position); vN = normalize(normal / uScale); gl_Position = projectionMatrix * modelViewMatrix * vec4(position * uScale, 1.0); }`;
const GAS_FS = NOISE + `uniform vec3 uSun, uView, uC0, uC1, uC2, uC3; uniform float uBands, uTurb, uStorms, uTime, uSeed, uSelf, uGlow, uDet, uStormAmt, uColor, uHO; varying vec3 vD; varying vec3 vN;
vec3 rotY(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
void main(){
  vec3 d = normalize(vD); vec3 n = normalize(vN); float lat = d.y;
  float ang = uTime * 0.012 * sin(lat * uBands * 3.14159); vec3 p = rotY(d, ang);
  float warp = fbm(vec3(p.x * 2.0, p.y * 5.0, p.z * 2.0) + uSeed, 4);
  float b = sin(lat * uBands * 3.14159 + (warp - 0.5) * uTurb * 8.0); float v = 0.5 + 0.5 * b;
  float fine = fbm(vec3(p.x * 7.0, p.y * 28.0, p.z * 7.0) + uSeed * 2.0, 4);
  v = clamp(v * 0.7 + (fine - 0.5) * 0.55 * (0.3 + uTurb) + 0.15, 0.0, 1.0); v = mix(0.5, v, uDet);
  if (uHO > 0.5) { gl_FragColor = vec4(v, clamp((abs(dFdx(v)) + abs(dFdy(v))) * 18.0, 0.0, 1.0), 0.0, 1.0); return; }
  vec3 col = v < 0.5 ? mix(uC0, uC1, v * 2.0) : mix(uC1, uC2, (v - 0.5) * 2.0);
  for (int i = 0; i < 8; i++) { if (float(i) >= uStorms) break;
    float h1 = hash13(vec3(float(i), uSeed, 1.0)), h2 = hash13(vec3(float(i), uSeed, 2.0)), h3 = hash13(vec3(float(i), uSeed, 3.0));
    float la = (h2 - 0.5) * 1.5, lo = h1 * 6.2832; vec3 c = vec3(cos(la) * cos(lo), sin(la), cos(la) * sin(lo));
    float angc = uTime * 0.012 * sin(sin(la) * uBands * 3.14159); vec3 cc = rotY(c, -angc);
    float dist = acos(clamp(dot(d, cc), -1.0, 1.0)); float sz = 0.07 + 0.11 * h3;
    float spot = exp(-pow(dist / sz, 2.0)); float ring = exp(-pow((dist - sz * 1.3) / (sz * 0.4), 2.0));
    col = mix(col, uC3, spot * 0.85 * uStormAmt); col = mix(col, uC2, ring * 0.35 * uStormAmt); }
  float mu = max(dot(n, uView), 0.0);
  float L = 0.25 + 0.75 * pow(mu, 0.6);
  vec3 lit = col * L + col * uGlow * 0.6;
  lit = mix(vec3(0.65, 0.68, 0.74) * (0.3 + 0.7 * mu), lit, uColor);
  gl_FragColor = vec4(lit, 1.0);
}`;
const BDK = [
  [250, [0.02,0.01,0.03], [0.07,0.03,0.08], [0.15,0.07,0.15], [0.01,0.005,0.02]],
  [600, [0.05,0.02,0.06], [0.18,0.06,0.16], [0.32,0.14,0.28], [0.03,0.01,0.04]],
  [1000, [0.09,0.02,0.07], [0.30,0.08,0.20], [0.55,0.22,0.35], [0.05,0.01,0.04]],
  [1500, [0.12,0.04,0.04], [0.38,0.14,0.10], [0.72,0.38,0.25], [0.06,0.02,0.02]],
  [2300, [0.20,0.07,0.03], [0.55,0.22,0.08], [0.95,0.55,0.25], [0.10,0.03,0.01]]];
function keyed(keys, T){
  let i = 0; while(i < keys.length - 2 && T > keys[i+1][0]) i++;
  const a = keys[i], b = keys[i+1], t = Math.max(0, Math.min(1, (T - a[0])/(b[0] - a[0]))), out = [];
  for(let j = 1; j <= 4; j++) out.push([0,1,2].map(q => a[j][q] + (b[j][q] - a[j][q])*t)); return out;
}
function bb(T){ const t = T/100; let r, g, b;
  r = t <= 66 ? 255 : 329.698727446*Math.pow(t - 60, -0.1332047592);
  g = t <= 66 ? 99.4708025861*Math.log(t) - 161.1195681661 : 288.1221695283*Math.pow(t - 60, -0.0755148492);
  b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231*Math.log(t - 10) - 305.0447927307;
  return [r, g, b].map(v => Math.max(0, Math.min(255, v))/255); }


/* ----- worlds: rocky / water (terrain + sea + clouds + sky), gas giant (+ rings) ----- */
const TERRA_VS = `uniform vec3 uScale; varying vec3 vP; varying vec3 vN; varying vec3 vD;
void main(){ vD = normalize(position); vP = position * uScale; vN = normalize(normal / uScale); gl_Position = projectionMatrix * modelViewMatrix * vec4(vP, 1.0); }`;
const TERRA_FS = NOISE + `uniform vec3 uSun, uView; uniform float uSeed, uFreq, uSea, uIce, uHeat, uHue, uBump, uColor, uHO; varying vec3 vP; varying vec3 vN; varying vec3 vD;
void main(){
  vec3 d = normalize(vD); vec3 n = normalize(vN);
  vec3 sp = d * uFreq + vec3(uSeed * 7.1, uSeed * 3.3, uSeed * 1.7);
  float e = fbm(sp, 6);
  float seaL = max(uSea, 0.0);
  float water = uSea > 0.0 ? 1.0 - smoothstep(uSea - 0.006, uSea + 0.006, e) : 0.0;
  float depth = uSea > 0.0 ? clamp((uSea - e) / uSea * 3.0, 0.0, 1.0) : 0.0;
  float hh = clamp((e - seaL) / (1.0 - seaL), 0.0, 1.0);
  vec3 lowC = mix(vec3(0.50, 0.27, 0.16), vec3(0.22, 0.30, 0.17), uHue);
  vec3 highC = mix(vec3(0.78, 0.60, 0.44), vec3(0.58, 0.57, 0.54), uHue);
  float vr = fbm(sp * 3.0 + 5.0, 4);
  vec3 landC = mix(lowC, highC, clamp(hh * 1.5 + (vr - 0.5) * 0.6, 0.0, 1.0));
  landC = mix(vec3(0.66, 0.68, 0.72), landC, uColor);
  vec3 oceanC = mix(vec3(0.07, 0.32, 0.45), vec3(0.01, 0.05, 0.17), depth);
  vec3 col = mix(landC, oceanC, water);
  float lat = abs(d.y);
  float edge = mix(1.08, 0.45, uIce);
  float iceM = smoothstep(edge - 0.06, edge + 0.06, lat + (fbm(sp * 2.0, 4) - 0.5) * 0.35) * step(0.001, uIce);
  iceM = max(iceM, uIce * uIce * smoothstep(0.5, 0.75, hh) * (1.0 - water) * 0.9) * uColor;
  col = mix(col, vec3(0.92, 0.95, 0.98), iceM);
  float HHv = mix(e, seaL, water) * (1.0 - 0.7 * iceM * water);
  vec3 sx = dFdx(vP), sy = dFdy(vP); float dx = dFdx(HHv), dy = dFdy(HHv);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx); float det = dot(sx, r1);
  vec3 gr = sign(det) * (dx * r1 + dy * r2);
  vec3 pv = uBump * gr / max(abs(det), 0.000001); float pl = length(pv); pv *= min(1.0, 0.85 / max(pl, 0.00001));
  n = normalize(n - pv);
  if (uHO > 0.5) { gl_FragColor = vec4(clamp(HHv, 0.0, 1.0), clamp((abs(dx) + abs(dy)) * 60.0, 0.0, 1.0), water, 1.0); return; }
  float dif = max(dot(n, uSun), 0.0);
  float spec = water * (1.0 - iceM) * pow(max(dot(n, normalize(uSun + uView)), 0.0), 80.0) * 0.7;
  vec3 lit = col * (dif * 1.15 + 0.03) + vec3(spec);
  float crack = pow(1.0 - abs(fbm(sp * 2.5 + 11.0, 5) * 2.0 - 1.0), 8.0);
  float lowH = 1.0 - smoothstep(0.0, 0.5, hh);
  lit *= 1.0 - 0.5 * uHeat;
  lit += vec3(1.0, 0.33, 0.06) * (crack * (0.5 + 0.5 * lowH) * 1.7 + 0.12 * lowH) * uHeat;
  gl_FragColor = vec4(lit, 1.0);
}`;
const CLOUD_FS = NOISE + `uniform vec3 uSun; uniform float uCloud, uTime, uSeed; varying vec3 vN; varying vec3 vD;
void main(){
  vec3 d = normalize(vD); vec3 p = d * 3.0 + vec3(uTime * 0.03, 0.0, uSeed * 2.3);
  vec3 q = vec3(fbm(p + 3.3, 4), fbm(p + 7.7, 4), fbm(p + 1.1, 4));
  float c = fbm(p * 1.2 + q * 1.6, 5);
  float thr = mix(0.88, 0.36, uCloud);
  float dens = smoothstep(thr, thr + 0.16, c) * step(0.001, uCloud);
  float lit = max(dot(normalize(vN), uSun), 0.0) * 1.1 + 0.035;
  gl_FragColor = vec4(vec3(0.97) * lit, dens * 0.92);
}`;
const ATM_VS = `uniform vec3 uScale; uniform float uGrow; varying vec3 vWN; varying vec3 vWP;
void main(){ vWN = normalize(mat3(modelMatrix) * (normal / uScale)); vec3 p = position * uScale * uGrow; vWP = (modelMatrix * vec4(p, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`;
const ATM_FS = `uniform vec3 uCol; uniform vec3 uSunW; uniform float uAtmo; varying vec3 vWN; varying vec3 vWP;
void main(){ vec3 n = normalize(vWN); float f = pow(1.0 - max(dot(n, normalize(cameraPosition - vWP)), 0.0), 2.6);
  float sunlit = smoothstep(-0.25, 0.45, dot(n, uSunW));
  gl_FragColor = vec4(uCol * f * sunlit * uAtmo * 1.6, f * sunlit * uAtmo); }`;
const RING_VS = `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RING_FS = NOISE + `varying vec3 vPos; uniform float uRings, uSeed; uniform vec3 uTintR;
void main(){ float r = length(vPos.xy); float t = (r - 1.45) / 1.1;
  float n = vnoise(vec3(r * 35.0, 0.5, uSeed));
  float bands = 0.55 + 0.45 * sin(r * 70.0) * sin(r * 23.0 + 1.0);
  float dens = clamp(0.35 + 0.65 * n, 0.0, 1.0) * bands;
  float gap = smoothstep(0.58, 0.6, t) * (1.0 - smoothstep(0.64, 0.66, t));
  dens *= 1.0 - gap * 0.9;
  float edge = smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.96, 1.0, t));
  gl_FragColor = vec4(uTintR * (0.7 + 0.5 * n), dens * edge * uRings * 0.92); }`;
const GASK = [
  [60, [0.50,0.72,0.78], [0.68,0.86,0.90], [0.88,0.96,0.98], [0.45,0.66,0.74]],
  [100, [0.10,0.20,0.55], [0.22,0.40,0.80], [0.55,0.72,0.95], [0.05,0.10,0.35]],
  [130, [0.42,0.27,0.17], [0.74,0.58,0.40], [0.94,0.88,0.76], [0.72,0.28,0.16]],
  [200, [0.60,0.50,0.32], [0.82,0.72,0.50], [0.95,0.90,0.74], [0.65,0.45,0.25]],
  [600, [0.04,0.08,0.28], [0.10,0.20,0.55], [0.30,0.45,0.80], [0.02,0.05,0.18]],
  [1100, [0.03,0.03,0.05], [0.10,0.07,0.08], [0.25,0.14,0.10], [0.02,0.02,0.03]],
  [1800, [0.12,0.03,0.02], [0.45,0.14,0.05], [0.95,0.50,0.18], [0.08,0.02,0.01]]];

/* ----- point clouds (gas cloud, supernova remnant): seeded noise, small port of the artifact's ----- */
function mkNoise(sd){
  const r = rng(sd), sm = t => t*t*(3 - 2*t);
  const h3 = (i, j, k) => { let h = (i*374761393 + j*668265263 + k*2147483647 + sd*1274126177) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0)/4294967295; };
  const n3 = (x, y, z) => { const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z), fx = sm(x - x0), fy = sm(y - y0), fz = sm(z - z0); let s = 0;
    for(let a = 0; a < 2; a++) for(let b = 0; b < 2; b++) for(let c = 0; c < 2; c++) s += h3(x0 + a, y0 + b, z0 + c)*(a ? fx : 1 - fx)*(b ? fy : 1 - fy)*(c ? fz : 1 - fz); return s; };
  const f3 = (x, y, z, o) => { let a = .5, s = 0; for(let k = 0; k < o; k++){ s += a*n3(x, y, z); x = x*2.03 + 1.7; y = y*2.03 + 9.2; z = z*2.03 + 3.1; a *= .5; } return s/.97; };
  return {f3, r};
}
function pointsOf(n, size, opacity, blend){
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n*3), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n*3), 3));
  return new THREE.Points(g, new THREE.PointsMaterial({size, map:B.dotTex, vertexColors:true, transparent:true, opacity, depthWrite:false, blending:blend}));
}
const clamp01 = x => Math.max(0, Math.min(1, x));

function objSun(mesh, out, v){ mesh.updateWorldMatrix(true, false); mesh.getWorldQuaternion(B.Q).invert(); return out.copy(v).applyQuaternion(B.Q); }
function wireMesh(uni, detail){
  const wm = new THREE.ShaderMaterial({vertexShader:ROCK_VS, fragmentShader:WIRE_FS, wireframe:true, transparent:true, depthWrite:false,
    uniforms:{uSeed:uni.uSeed, uShape:uni.uShape, uElong:uni.uElong, uWire:{value:0}}});
  return new THREE.Mesh(new THREE.IcosahedronGeometry(1.004, detail), wm);
}
function makeBody(o, seed){
  const k = o.kind || "star", V = THREE.Vector3, root = new THREE.Group(), fixed = new THREE.Group(), res = {root, fixed, k, ionOn:1, dustOn:1};
  if(k === "asteroid" || k === "comet"){
    const comet = k === "comet", el = o.elong || [1.5,.9,.8];
    const U = {uSeed:{value:seed}, uShape:{value:0}, uElong:{value:new V(...el)}, uRelief:{value:0}, uColor:{value:0}, uBump:{value:.28}, uCrat:{value:comet ? .3 : .55},
      uTint:{value:new V(...(o.tint || [.6,.55,.5]))}, uSunO:{value:new V()}, uHO:{value:0}};
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 40), new THREE.ShaderMaterial({vertexShader:ROCK_VS, fragmentShader:ROCK_FS, uniforms:U}));
    const wire = wireMesh(U, 5); root.add(mesh, wire); res.mesh = mesh; res.HO = U.uHO;
    let pts, pos, col, N = 2600, dat;
    if(comet){
      root.position.set(-1.25, .75, 0); fixed.position.copy(root.position);
      pos = new Float32Array(N*3); col = new Float32Array(N*3);
      dat = Array.from({length:N}, (_, i) => ({s:Math.random(), spd:.05 + Math.random()*.06, ion:i % 3 === 0, a:Math.random()*2 - 1, b:Math.random()*2 - 1, c:Math.random()*2 - 1}));
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      pts = new THREE.Points(g, new THREE.PointsMaterial({size:7, map:B.dotTex, vertexColors:true, blending:THREE.AdditiveBlending, transparent:true, depthWrite:false, sizeAttenuation:false}));
      const coma = new THREE.Sprite(new THREE.SpriteMaterial({map:B.dotTex, color:0xbfe8ff, blending:THREE.AdditiveBlending, transparent:true, depthWrite:false, opacity:0}));
      coma.scale.set(2.6, 2.6, 1); fixed.add(pts, coma); res.coma = coma;
    }
    const dirW = B.SUN.clone().negate(), pr = new V().crossVectors(dirW, new V(0,0,1)).normalize(), head = root.position.clone(), L = 6.2;
    res.apply = (P, t) => {
      U.uShape.value = P[1]; U.uRelief.value = P[2]; U.uColor.value = P[3];
      wire.material.uniforms.uWire.value = .9*P[0]*(1 - P[2]); objSun(mesh, U.uSunO.value, B.SUN);
      root.scale.setScalar((.55 + .45*P[0])*(comet ? .62 : 1));
      if(comet){
        const act = P[4]; res.coma.material.opacity = act*.55; pts.visible = act > .01;
        if(pts.visible) for(let i = 0; i < N; i++){
          const d = dat[i], s = (d.s + t*d.spd) % 1, len = s*L*(d.ion ? 1 : .82), sp = (.05 + s*(d.ion ? .2 : .55));
          const cv = d.ion ? 0 : s*s*1.2, x = dirW.x*len + pr.x*cv + (d.a*sp), y = dirW.y*len + pr.y*cv + (d.b*sp), z = dirW.z*len*.4 + (d.c*sp);
          pos[i*3] = x; pos[i*3+1] = y; pos[i*3+2] = z;   // the tail group already sits at the head
          const f = Math.pow(1 - s, 1.4)*Math.min(1, s*9)*(d.ion ? 1.5 : 1.3)*act*(d.ion ? res.ionOn : res.dustOn), c = d.ion ? [.4,.8,1] : [1,.86,.6];
          col[i*3] = c[0]*f; col[i*3+1] = c[1]*f; col[i*3+2] = c[2]*f;
        }
        if(pts.visible){ pts.geometry.attributes.position.needsUpdate = true; pts.geometry.attributes.color.needsUpdate = true; }
      }
    };
  } else if(k === "star"){
    const c = bb(o.T || 4500).map(v => Math.pow(v, 1.8));   // push the colour so cool stars read orange-red
    const U = {uTime:{value:0}, uGran:{value:0}, uSpots:{value:0}, uColor:{value:0}, uSeed:{value:seed}, uFreq:{value:o.giant ? 4 : 10}, uCol:{value:new V(...c)}, uHO:{value:0}};
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.ShaderMaterial({vertexShader:STAR_VS, fragmentShader:STAR_FS, uniforms:U}));
    const wire = wireMesh({uSeed:U.uSeed, uShape:{value:0}, uElong:{value:new V(1,1,1)}}, 5);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({map:B.dotTex, color:new THREE.Color(...c), blending:THREE.AdditiveBlending, transparent:true, depthWrite:false, opacity:0}));
    glow.scale.set(4.2, 4.2, 1); fixed.add(glow); root.add(mesh, wire); res.mesh = mesh; res.HO = U.uHO;
    res.apply = (P, t) => { U.uTime.value = t; U.uGran.value = P[1]; U.uSpots.value = P[2]; U.uColor.value = P[3];
      wire.material.uniforms.uWire.value = .9*P[0]*(1 - P[1]); glow.material.opacity = P[3]*.85; root.scale.setScalar(.55 + .45*P[0]); };
  } else if(k === "rocky" || k === "water"){
    const water = k === "water", sunU = {value:new V()}, viewU = {value:new V()}, scaleU = {value:new V(1,1,1)}, sd = {value:seed % 97 * .37};
    const geo = new THREE.SphereGeometry(1, 128, 96);
    const BU = {uScale:scaleU, uSun:sunU, uView:viewU, uSeed:sd, uFreq:{value:water ? 2 : 1.6}, uSea:{value:-1}, uIce:{value:0}, uHeat:{value:0}, uHue:{value:water ? .5 : .2}, uBump:{value:0}, uColor:{value:0}, uHO:{value:0}};
    const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({vertexShader:TERRA_VS, fragmentShader:TERRA_FS, uniforms:BU, }));
    const CU = {uScale:{value:new V(1.012,1.012,1.012)}, uSun:sunU, uCloud:{value:0}, uTime:{value:0}, uSeed:sd};
    mesh.add(new THREE.Mesh(geo, new THREE.ShaderMaterial({vertexShader:TERRA_VS, fragmentShader:CLOUD_FS, uniforms:CU, transparent:true, depthWrite:false})));
    const AU = {uScale:scaleU, uGrow:{value:1.07}, uCol:{value:new V(...(water ? [.35,.6,1] : [1,.55,.25]))}, uSunW:{value:B.SUN.clone()}, uAtmo:{value:0}};
    const atm = new THREE.Mesh(geo, new THREE.ShaderMaterial({vertexShader:ATM_VS, fragmentShader:ATM_FS, uniforms:AU, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending}));
    const wire = wireMesh({uSeed:sd, uShape:{value:0}, uElong:{value:new V(1,1,1)}}, 5); root.add(mesh, atm, wire); res.mesh = mesh; res.HO = BU.uHO;
    res.apply = (P, t) => {
      const oc = water ? P[2] : 0, co = water ? P[3] : P[2], air = water ? P[4] : P[3];
      wire.material.uniforms.uWire.value = .9*P[0]*(1 - P[1]);
      BU.uBump.value = (water ? .03 : .045)*P[1]*1.8; BU.uColor.value = co;
      BU.uSea.value = water && oc > .01 ? .03 + (.65 - .03)*oc : -1;
      BU.uIce.value = water ? .22*co : 0; BU.uHeat.value = water ? 0 : .55*co;
      CU.uCloud.value = (water ? .7 : .2)*air; CU.uTime.value = t; AU.uAtmo.value = .85*air;
      objSun(mesh, sunU.value, B.SUN); objSun(mesh, viewU.value, new V(0,0,1)); root.scale.setScalar(.55 + .45*P[0]);
    };
  } else if(k === "gas"){
    const pal = keyed(GASK, o.T || 140), tilt = new THREE.Group(); tilt.rotation.z = .35; root.add(tilt);
    const U = {uSun:{value:new V()}, uView:{value:new V()}, uScale:{value:new V(1,1,1)}, uC0:{value:new V(...pal[0])}, uC1:{value:new V(...pal[1])}, uC2:{value:new V(...pal[2])}, uC3:{value:new V(...pal[3])},
      uBands:{value:12}, uTurb:{value:.5}, uStorms:{value:5}, uTime:{value:0}, uSeed:{value:seed}, uSelf:{value:1}, uGlow:{value:(o.T || 140) > 900 ? .3 : 0}, uDet:{value:0}, uStormAmt:{value:0}, uColor:{value:0}, uHO:{value:0}};
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.ShaderMaterial({vertexShader:GAS_VS, fragmentShader:GAS_FS, uniforms:U}));
    const wire = wireMesh({uSeed:U.uSeed, uShape:{value:0}, uElong:{value:new V(1,1,1)}}, 5);
    const c1 = pal[1], RU = {uRings:{value:0}, uSeed:{value:seed % 53*.7}, uTintR:{value:new V(Math.min(1, c1[0]*1.05 + .1), Math.min(1, c1[1] + .08), Math.min(1, c1[2]*.9))}};
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.45, 2.55, 160, 1), new THREE.ShaderMaterial({vertexShader:RING_VS, fragmentShader:RING_FS, uniforms:RU, transparent:true, depthWrite:false, side:THREE.DoubleSide}));
    ring.rotation.x = Math.PI/2; ring.visible = false; tilt.add(mesh, wire, ring); res.mesh = mesh; res.HO = U.uHO;
    res.apply = (P, t) => { U.uTime.value = t*3; U.uDet.value = P[1]; U.uStormAmt.value = P[2]; U.uColor.value = P[3]; RU.uRings.value = P[4]; ring.visible = P[4] > .01;
      wire.material.uniforms.uWire.value = .9*P[0]*(1 - P[1]); objSun(mesh, U.uView.value, new V(0,0,1)); objSun(mesh, U.uSun.value, B.SUN); root.scale.setScalar(.55 + .45*P[0]); };
  } else if(k === "nebula"){
    const N0 = 14000, ND = 3500, NS = 500, nz = mkNoise(seed + 5), rr = nz.r;
    const glow = pointsOf(N0, .1, .7, THREE.AdditiveBlending), dust = pointsOf(ND, .2, 0, THREE.NormalBlending), stars = pointsOf(NS, .1, 0, THREE.AdditiveBlending);
    dust.renderOrder = 2; root.add(glow, dust, stars);
    const FIL = .6, CL = .5;
    const gen = (geo, n, noise, pw) => {   // returns start (ball) and end (filament) positions
      const E = new Float32Array(n*3), S = new Float32Array(n*3), sp = new Float32Array(n), dn = new Float32Array(n); let i = 0, tries = 0;
      while(i < n && tries < n*60){ tries++;
        const x = rr()*2 - 1, y = rr()*2 - 1, z = rr()*2 - 1, r = Math.hypot(x, y, z); if(r > 1) continue;
        const q = noise.f3(x*1.3 + 4, y*1.3 + 4, z*1.3 + 4, 4), rid = 1 - Math.abs(2*q - 1); let w = q + (rid*rid*1.4 - q)*FIL;
        const cl = noise.f3(x*3.1, y*3.1, z*3.1, 3); w *= (1 + (clamp01((cl - .3)*3) - 1)*CL)*Math.pow(1 - r, .7);
        if(rr() > Math.pow(w, pw)) continue;
        E[i*3] = x; E[i*3+1] = y*.8; E[i*3+2] = z; sp[i] = noise.f3(x*1.7 + 20, y*1.7, z*1.7, 3); dn[i] = w;
        let a, b, c; do{ a = rr()*2 - 1; b = rr()*2 - 1; c = rr()*2 - 1; }while(a*a + b*b + c*c > 1);
        S[i*3] = a*.8; S[i*3+1] = b*.8; S[i*3+2] = c*.8; i++; }
      geo.setDrawRange(0, i); return {E, S, sp, dn, n:i};
    };
    const G = gen(glow.geometry, N0, nz, 1.4), D = gen(dust.geometry, ND, mkNoise(seed + 77), 1.1);
    const SP = stars.geometry.attributes.position.array, SC = stars.geometry.attributes.color.array;
    for(let i = 0; i < NS; i++){ let x, y, z; do{ x = rr()*2 - 1; y = rr()*2 - 1; z = rr()*2 - 1; }while(x*x + y*y + z*z > 1);
      SP[i*3] = x; SP[i*3+1] = y*.8; SP[i*3+2] = z; const t = rr(); SC[i*3] = 1; SC[i*3+1] = .85 + .15*t; SC[i*3+2] = .7 + .3*t; }
    stars.geometry.attributes.position.needsUpdate = true; stars.geometry.attributes.color.needsUpdate = true;
    const DC = dust.geometry.attributes.color.array; for(let i = 0; i < D.n; i++){ DC[i*3] = .06; DC[i*3+1] = .035; DC[i*3+2] = .03; } dust.geometry.attributes.color.needsUpdate = true;
    let lp1 = -1, lp2 = -1;
    res.apply = (P, t) => {
      if(Math.abs(P[1] - lp1) > .001){ lp1 = P[1]; const e = P[1], A = glow.geometry.attributes.position.array, B2 = dust.geometry.attributes.position.array;
        for(let i = 0; i < G.n*3; i++) A[i] = G.S[i] + (G.E[i] - G.S[i])*e;
        for(let i = 0; i < D.n*3; i++) B2[i] = D.S[i] + (D.E[i] - D.S[i])*e;
        glow.geometry.attributes.position.needsUpdate = true; dust.geometry.attributes.position.needsUpdate = true; }
      if(Math.abs(P[2] - lp2) > .001){ lp2 = P[2]; const C = glow.geometry.attributes.color.array, g = P[2];
        for(let i = 0; i < G.n; i++){ const s1 = clamp01((G.sp[i] - .35)*3), k2 = .35 + .9*G.dn[i], ha = .8, o3 = .45*1.4;
          const R = k2*((1 - s1)*ha + s1*o3*.15 + .03), Gc = k2*((1 - s1)*ha*.22 + s1*o3*.85 + .03), Bc = k2*((1 - s1)*ha*.3 + s1*o3*.75 + .03), gr = k2*.45;
          C[i*3] = gr + (R - gr)*g; C[i*3+1] = gr + (Gc - gr)*g; C[i*3+2] = gr + (Bc - gr)*g; }
        glow.geometry.attributes.color.needsUpdate = true; }
      glow.material.opacity = .7*Math.min(1, P[0]*1.5); dust.material.opacity = .3*P[3]; stars.material.opacity = .9*P[3];
      stars.geometry.setDrawRange(0, Math.round(NS*P[3]));
      root.scale.setScalar(1.35*(.4 + .6*P[0]));
    };
  } else if(k === "nova"){
    const NSH = 16000, NHOT = 4500, nz = mkNoise(seed + 31), rr = nz.r;
    const shell = pointsOf(NSH, .06, 0, THREE.AdditiveBlending), hot = pointsOf(NHOT, .1, 0, THREE.AdditiveBlending), core = pointsOf(1, .9, 0, THREE.AdditiveBlending);
    root.add(shell, hot, core);
    const E = new Float32Array(NSH*3), S = new Float32Array(NSH*3), sp = new Float32Array(NSH), rd = new Float32Array(NSH); let i = 0, tries = 0;
    while(i < NSH && tries < NSH*40){ tries++;
      const gx = rr() + rr() + rr() - 1.5, gy = rr() + rr() + rr() - 1.5, gz = rr() + rr() + rr() - 1.5, l = Math.hypot(gx, gy, gz); if(l < 1e-4) continue;
      const dx = gx/l, dy = gy/l, dz = gz/l, q = nz.f3(dx*3 + 6, dy*3 + 6, dz*3 + 6, 4), rid = 1 - Math.abs(2*q - 1), w = 1 + (rid*rid*2.2 - 1)*.7;
      if(rr() > w) continue;
      const gauss = (rr() + rr() + rr() - 1.5)*2, r = 1 + .18*gauss*.5;
      const dsx = nz.f3(dx*5, dy*5, dz*5, 3) - .5, dsy = nz.f3(dx*5 + 9, dy*5, dz*5, 3) - .5, dsz = nz.f3(dx*5, dy*5 + 9, dz*5, 3) - .5;
      E[i*3] = dx*r + dsx*.16*.7; E[i*3+1] = dy*r + dsy*.16*.7; E[i*3+2] = dz*r + dsz*.16*.7; S[i*3] = dx; S[i*3+1] = dy; S[i*3+2] = dz;
      sp[i] = nz.f3(dx*2 + 30, dy*2, dz*2, 3); rd[i] = clamp01((gauss + 1.5)/3); i++; }
    const NN = i, HP = hot.geometry.attributes.position.array;
    for(let q = 0; q < NHOT; q++){ const ax = rr() + rr() + rr() - 1.5, ay = rr() + rr() + rr() - 1.5, az = rr() + rr() + rr() - 1.5, al = Math.hypot(ax, ay, az) || 1, r2 = Math.pow(rr(), .6)*.85;
      HP[q*3] = ax/al*r2; HP[q*3+1] = ay/al*r2; HP[q*3+2] = az/al*r2; }
    hot.geometry.attributes.position.needsUpdate = true; shell.geometry.setDrawRange(0, NN);
    const KC = core.geometry.attributes.color.array; KC[0] = .8; KC[1] = .9; KC[2] = 1;
    const HC = hot.geometry.attributes.color.array; for(let q = 0; q < NHOT; q++){ HC[q*3] = .25; HC[q*3+1] = .42; HC[q*3+2] = .7; } hot.geometry.attributes.color.needsUpdate = true;
    shell.geometry.attributes.position.array.set(S.subarray(0, NN*3)); let lp2 = -1, lp3 = -1;
    res.apply = (P, t) => {
      const A = shell.geometry.attributes.position.array;
      if(Math.abs(P[2] - lp2) > .001){ lp2 = P[2]; for(let q = 0; q < NN*3; q++) A[q] = S[q] + (E[q] - S[q])*P[2]; shell.geometry.attributes.position.needsUpdate = true; }
      if(Math.abs(P[3] - lp3) > .001){ lp3 = P[3]; const C = shell.geometry.attributes.color.array, g = P[3];
        for(let q = 0; q < NN; q++){ const s1 = clamp01((sp[q] - .3)*2.4 + (rd[q] - .5)*.8), ha = .7, o3 = .6, k2 = .9;
          const R = k2*((1 - s1)*ha + s1*o3*.15 + .03), Gc = k2*((1 - s1)*ha*.2 + s1*o3*.85 + .03), Bc = k2*((1 - s1)*ha*.25 + s1*o3*.75 + .03), gr = .4;
          C[q*3] = gr + (R - gr)*g; C[q*3+1] = gr + (Gc - gr)*g; C[q*3+2] = gr + (Bc - gr)*g; }
        shell.geometry.attributes.color.needsUpdate = true; }
      core.geometry.attributes.color.needsUpdate = true; core.material.opacity = .9*Math.min(1, P[0]*2) * (1 - .3*P[1]);
      shell.material.opacity = .6*Math.min(1, P[1]*3); hot.material.opacity = .35*P[3];
      const nr = .25 + 1.35*Math.pow(3000/20000, .4), e = 1 - Math.pow(1 - P[1], 3); root.scale.setScalar(.03 + (nr*1.05 - .03)*e);
    };
  } else {
    const T = o.T || 1000, kc = keyed(BDK, T);
    const U = {uSun:{value:new V()}, uView:{value:new V()}, uScale:{value:new V(1,1,1)}, uC0:{value:new V(...kc[0])}, uC1:{value:new V(...kc[1])}, uC2:{value:new V(...kc[2])}, uC3:{value:new V(...kc[3])},
      uBands:{value:8}, uTurb:{value:.45}, uStorms:{value:5}, uTime:{value:0}, uSeed:{value:seed}, uSelf:{value:1}, uGlow:{value:T > 1200 ? .45 : .14}, uDet:{value:0}, uStormAmt:{value:0}, uColor:{value:0}, uHO:{value:0}};
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.ShaderMaterial({vertexShader:GAS_VS, fragmentShader:GAS_FS, uniforms:U}));
    const wire = wireMesh({uSeed:U.uSeed, uShape:{value:0}, uElong:{value:new V(1,1,1)}}, 5); root.add(mesh, wire); res.mesh = mesh; res.HO = U.uHO;
    res.apply = (P, t) => { U.uTime.value = t*3; U.uDet.value = P[1]; U.uStormAmt.value = P[2]; U.uColor.value = P[3];
      wire.material.uniforms.uWire.value = .9*P[0]*(1 - P[1]); objSun(mesh, U.uView.value, new V(0,0,1)); root.scale.setScalar(.55 + .45*P[0]); };
  }
  return res;
}
export { makeBody };
export function disposeBodyOf(scene, body) {
  [body.root, body.fixed].forEach((g) => { g.traverse((m) => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); }); scene.remove(g); });
}

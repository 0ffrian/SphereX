/* eslint-disable */
// @ts-nocheck
// Issue #71, D-37 (stream V3): the approved prototype's rock engine, copied MECHANICALLY and unchanged
// from /sculptor-preview-next.html (the `#rocks` section) by `scripts/extract-rock-engine.py`.
// Do not edit by hand: change the script or the prototype and run it again. Only TypeScript wrapping
// (this header, the shim below and the exports at the end) differs from the prototype; the DOM
// and UI code (`pills`, `rockUi`, the event handlers) is not copied.
// PATCHES (issue #71 review; the script applies them after slicing, mirroring backend params.py):
//   crater depth 0.42 -> 0.33 r (rim-to-floor 0.198 D, Pike d/D 0.196); rmax 0.38 -> the reachable
//   0.014 / sqrt(0.015) = 0.114; a rubble pile's lump is slope-limited (35 deg repose, 3 sigma of
//   the shape layer's rms slope 0.7837 per unit lump) instead of strength-limited. The d^-5 ejecta
//   falloff is artistic (McGetchin et al. 1973 measure about r^-3).
//   Issue #93 2.8: a card body (seed3, seedHash from cardToRock) gets a vec3 noise offset, its full 32-bit seed for
//   the crater RNG, per-crater ellipticity, rim height and rim wave, and 0 to 2 boulders a cell; the artifact's own
//   bodies have neither field and draw exactly as before.
//   Issue #93 wave 1 (PATCHES_93W1, DEV93W1_TAIL; each marked @deviation): background compile (B7), loops kept as
//   loops (B7), comet jets in the vertex shader (1.7), the fine relief, normal and albedo baked into cube maps (2.1).
//   1268-1268  clamp          (shared helper)
//   1273-1273  rng            (shared helper)
//   1292-1297  compile, unis  (shared helpers)
//   1299-1306  NOISE          (GLSL noise block)
//   2512-2645  RP, R, radialFn, rockModel, buildRock, ROCK_VS, ROCK_FS, JET_VS, JET_FS, RockGL
var reduced = false;
// @verbatim L1268-L1268
var clamp = function (x, a, b) { return Math.min(b, Math.max(a, x)); };
// @end-verbatim
// @verbatim L1273-L1273
function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// @end-verbatim
// @verbatim L1292-L1297
function compile(gl, vs, fs) {
  function sh(t, s) { var o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; }
  var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
function unis(gl, p) { var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS), i; for (i = 0; i < n; i++) { var a = gl.getActiveUniform(p, i), name = a.name.replace('[0]', ''); u[name] = gl.getUniformLocation(p, a.name); } return u; }
// @end-verbatim
// @verbatim L1299-L1306
var NOISE = `
vec3 h33(vec3 p){p=fract(p*vec3(.1031,.1030,.0973));p+=dot(p,p.yxz+33.33);return fract((p.xxy+p.yxx)*p.zyx);}
float vn(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
 return mix(mix(mix(h33(i).x,h33(i+vec3(1,0,0)).x,f.x),mix(h33(i+vec3(0,1,0)).x,h33(i+vec3(1,1,0)).x,f.x),f.y),
 mix(mix(h33(i+vec3(0,0,1)).x,h33(i+vec3(1,0,1)).x,f.x),mix(h33(i+vec3(0,1,1)).x,h33(i+vec3(1,1,1)).x,f.x),f.y),f.z);}
float fbm(vec3 p,int n){float a=.5,s=0.,t=0.;for(int i=0;i<n;i++){s+=a*vn(p);t+=a;p=p*2.03+vec3(7.1,3.3,1.7);a*=.5;}return s/t;}
float ridge(vec3 p,int n){float a=.5,s=0.,t=0.;for(int i=0;i<n;i++){s+=a*(1.-abs(2.*vn(p)-1.));t+=a;p=p*2.1+vec3(3.1,9.3,4.7);a*=.5;}return s/t;}
`;
// @end-verbatim
// @verbatim L2512-L2645
var RP = [
  { id: 'oum', label: "'Oumuamua", D: 0.204, ab: 10, P: 7.937, A: 0.04, rho: 2000, tint: [0.62, 0.42, 0.3], seed: 5 },
  { id: 'rub', label: 'Rubble pile (Bennu-sized example)', D: 0.49, ab: 1.08, P: 4.3, A: 0.044, rho: 1200, tint: [0.45, 0.43, 0.41], seed: 17 },
  { id: 'eros', label: 'Stony body (Eros-sized example)', D: 17, ab: 3, P: 5.27, A: 0.25, rho: 2670, tint: [0.62, 0.5, 0.38], seed: 29 },
  { id: 'big', label: 'Large main-belt body (example)', D: 250, ab: 1.2, P: 7, A: 0.12, rho: 2600, tint: [0.5, 0.47, 0.43], seed: 41 },
  { id: 'com', label: 'Comet nucleus (example)', D: 4, ab: 1.5, P: 12.4, A: 0.05, rho: 530, tint: [0.42, 0.4, 0.38], seed: 61, comet: true }
];
var R = { p: RP[0], mode: 'rocky', age: 70, playing: !reduced, spin: 0, yaw: 0.6, pitch: 0.25, drag: null, gl: null, built: null, clock: 0 };
function radialFn(ax, comet) { return function (x, y, z) { var r = 1 / Math.sqrt(x * x / (ax[0] * ax[0]) + y * y / (ax[1] * ax[1]) + z * z / (ax[2] * ax[2])); if (comet) r *= 0.72 + 0.62 * x * x + 0.1 * x; return r; }; }
function rockModel() {
  var p = R.p, smooth = R.mode === 'smooth', rad = p.D * 500, G = 6.674e-11, gv = 4 / 3 * Math.PI * G * p.rho * rad, Y = 1e6, ratio = Y / (p.rho * gv * rad), lump = clamp(ratio, 0.03, 0.3) * (smooth ? 0.3 : 1);
  var limit = Math.sqrt(3 * Math.PI / (G * p.rho)) / 3600, fast = p.P < limit, kind = p.comet ? 'Icy, weak and porous' : fast || p.D < 0.15 ? 'Solid rock' : p.D < 40 ? 'Rubble and shattered rock' : 'Fractured rock under regolith';
  if (!p.comet && !fast && p.D >= 0.15 && p.D < 40) lump = clamp(Math.tan(35 * Math.PI / 180) / (3 * 0.7837077), 0.03, 0.3) * (smooth ? 0.3 : 1);
  var cov = smooth ? 0.012 : 0.05 + 0.27 * R.age / 100, bld = smooth ? 0 : p.comet ? 0.5 : fast || p.D < 0.15 ? 0.45 : p.D < 40 ? 1 : 0.25;
  var ax0 = [Math.pow(p.ab, 2 / 3), Math.pow(p.ab, -1 / 3), Math.pow(p.ab, -1 / 3) * (p.comet ? 0.9 : 0.86)], k = Math.pow(ax0[0] * ax0[1] * ax0[2], -1 / 3), ax = ax0.map(function (v) { return v * k; });
  return { rad: rad, gv: gv, ratio: ratio, lump: lump, limit: limit, fast: fast, kind: kind, cov: cov, bld: bld, ax: ax, escape: Math.sqrt(2 * gv * rad) };
}
function buildRock(m) {
  var p = R.p, TW = 1024, TH = 512, data = new Float32Array(TW * TH * 2), base = new Float32Array(TW * TH), px = new Float32Array(TW * TH * 3), r = rng(p.seedHash != null ? p.seedHash : p.seed * 31 + 7), rf = radialFn(m.ax, p.comet), i, j, ext = 0, W2 = [];
  var w0 = 0; for (i = 0; i < 26; i++) { var z = r() * 2 - 1, an = r() * 6.2832, c2 = Math.sqrt(1 - z * z), kk = 1.3 + 7.5 * Math.pow(r(), 1.4), amp = Math.pow(kk, -1.5); w0 += amp * amp; W2.push([c2 * Math.cos(an), z, c2 * Math.sin(an), kk, r() * 6.2832, amp]); }
  var norm = m.lump * 0.45 / Math.sqrt(w0 / 2);
  for (j = 0; j < TH; j++) { var la = ((j + 0.5) / TH - 0.5) * Math.PI, cl = Math.cos(la), sl = Math.sin(la); for (i = 0; i < TW; i++) {
    var lo = ((i + 0.5) / TW - 0.5) * 6.2832, x = cl * Math.cos(lo), y = sl, z2 = cl * Math.sin(lo), rr = rf(x, y, z2), h = 0, n;
    for (n = 0; n < 26; n++) { var wv = W2[n]; h += wv[5] * Math.sin(wv[3] * (x * wv[0] + y * wv[1] + z2 * wv[2]) + wv[4]); }
    var ix = j * TW + i; base[ix] = h * norm; px[ix * 3] = x * rr; px[ix * 3 + 1] = y * rr; px[ix * 3 + 2] = z2 * rr; if (rr > ext) ext = rr;
  } }
  var rmin = 0.014, rmax = 0.014 / Math.sqrt(0.015), area = 0, target = m.cov * 4, count = 0;
  var cr = []; while (area < target && count < 1500) { var rc = Math.min(rmax, rmin * Math.pow(1 - r() * 0.985, -0.5)); cr.push(rc); area += rc * rc; count++; }
  cr.sort(function (a, b) { return b - a; });
  var cvr = p.seedHash != null ? rng(p.seedHash ^ 0x5bd1e995) : null;
  cr.forEach(function (rc) {
    var z = r() * 2 - 1, an = r() * 6.2832, c2 = Math.sqrt(1 - z * z), dx = c2 * Math.cos(an), dy = z, dz = c2 * Math.sin(an), rs = rf(dx, dy, dz), cx = dx * rs, cy = dy * rs, cz = dz * rs, deg = 0.35 + 0.65 * r(), depth = 0.33 * rc * deg, reach = 2.4 * rc;
    var el = 1, rimK = 1, rph = 0, rk = 0, e1 = null, e2 = null;
    if (cvr) { el = 1 + 0.35 * Math.pow(cvr(), 3); rimK = 0.6 + 0.8 * cvr(); rph = cvr() * 6.2832; rk = 2 + Math.floor(cvr() * 4); var ang = cvr() * 3.1416, up = Math.abs(dy) < 0.9 ? [0, 1, 0] : [1, 0, 0], a1 = [up[1] * dz - up[2] * dy, up[2] * dx - up[0] * dz, up[0] * dy - up[1] * dx], al = Math.hypot(a1[0], a1[1], a1[2]); a1 = [a1[0] / al, a1[1] / al, a1[2] / al]; var b1 = [dy * a1[2] - dz * a1[1], dz * a1[0] - dx * a1[2], dx * a1[1] - dy * a1[0]], ca = Math.cos(ang), sa = Math.sin(ang); e1 = [a1[0] * ca + b1[0] * sa, a1[1] * ca + b1[1] * sa, a1[2] * ca + b1[2] * sa]; e2 = [b1[0] * ca - a1[0] * sa, b1[1] * ca - a1[1] * sa, b1[2] * ca - a1[2] * sa]; reach *= el; }
    var la0 = Math.asin(dy), lo0 = Math.atan2(dz, dx), th = Math.min(Math.PI, reach / rs * 1.08), j0 = Math.max(0, Math.floor(((la0 - th) / Math.PI + 0.5) * TH)), j1 = Math.min(TH - 1, Math.ceil(((la0 + th) / Math.PI + 0.5) * TH));
    var dLo = Math.abs(la0) + th >= 1.5 ? Math.PI : Math.min(Math.PI, Math.asin(Math.min(1, Math.sin(th) / Math.cos(la0))) * 1.1);
    for (var jj = j0; jj <= j1; jj++) {
      var i0 = Math.floor(((lo0 - dLo) / 6.2832 + 0.5) * TW), i1 = Math.min(i0 + TW - 1, Math.ceil(((lo0 + dLo) / 6.2832 + 0.5) * TW));
      for (var ii = i0; ii <= i1; ii++) {
        var iw = ((ii % TW) + TW) % TW, ix = jj * TW + iw, dpx = px[ix * 3] - cx, dpy = px[ix * 3 + 1] - cy, dpz = px[ix * 3 + 2] - cz, d = Math.sqrt(dpx * dpx + dpy * dpy + dpz * dpz) / rc, q1 = 0, q2 = 0;
        if (cvr) { q1 = dpx * e1[0] + dpy * e1[1] + dpz * e1[2]; q2 = dpx * e2[0] + dpy * e2[1] + dpz * e2[2]; var q3 = dpx * dx + dpy * dy + dpz * dz; d = Math.sqrt(q1 * q1 / (el * el) + q2 * q2 * el * el + q3 * q3) / rc; }
        if (d > 2.4) continue;
        var prof = d < 1 ? -depth * (1 - d * d) + 0.2 * depth * d * d * d * d : 0.2 * depth * Math.pow(d, -5);
        if (cvr) { var rimA = rimK * (1 + 0.25 * Math.sin(rk * Math.atan2(q2, q1) + rph)); prof = d < 1 ? -depth * (1 - d * d) + 0.2 * rimA * depth * d * d * d * d : 0.2 * rimA * depth * Math.pow(d, -5); }
        var pr2 = Math.sqrt(px[ix * 3] * px[ix * 3] + px[ix * 3 + 1] * px[ix * 3 + 1] + px[ix * 3 + 2] * px[ix * 3 + 2]);
        if (d < 1) data[ix * 2] *= 0.45 + 0.55 * d;
        data[ix * 2] += prof / pr2;
        if (deg > 0.8 && d > 0.7) data[ix * 2 + 1] = Math.max(data[ix * 2 + 1], (deg - 0.8) * 5 * Math.exp(-(d - 1) * (d - 1) / 0.55));
      }
    }
  });
  for (i = 0; i < TW * TH; i++) data[i * 2] += base[i];
  R.built = { data: data, ext: ext * (1 + m.lump * 0.9), craters: count, w: TW, h: TH };
}
var ROCK_VS = `#version 300 es
layout(location=0) in vec2 aUv;uniform mat3 uM;uniform float uScale,uAsp;uniform vec3 uAx;uniform float uComet;uniform sampler2D uH;out vec3 vD;
float rad(vec3 d){float r=1./sqrt(dot(d/uAx,d/uAx));if(uComet>.5)r*=.72+.62*d.x*d.x+.1*d.x;return r;}
void main(){float lo=(aUv.x-.5)*6.2831853,la=(aUv.y-.5)*3.14159265,c=cos(la);vec3 d=vec3(c*cos(lo),sin(la),c*sin(lo));vD=d;
 vec3 p=uM*(d*rad(d)*(1.+texture(uH,aUv).r));gl_Position=vec4(p.x*uScale/uAsp,p.y*uScale,-p.z*uScale*.3+.0,1.);}`;
var ROCK_FS = `#version 300 es
precision highp float;
in vec3 vD;uniform sampler2D uH;uniform vec3 uAx,uLo,uVo,uTint;uniform float uComet,uFine,uBld,uBright,uScale,uSeed,uBldV;uniform vec3 uSeed3;out vec4 O;
${NOISE}
float rad(vec3 d){float r=1./sqrt(dot(d/uAx,d/uAx));if(uComet>.5)r*=.72+.62*d.x*d.x+.1*d.x;return r;}
vec2 uvOf(vec3 d){return vec2(atan(d.z,d.x)/6.2831853+.5,asin(clamp(d.y,-1.,1.))/3.14159265+.5);}
float boulders(vec3 p){vec3 ip=floor(p),fp=fract(p);float m=0.;
 for(int k=-1;k<=1;k++)for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec3 g=vec3(i,j,k),h=h33(ip+g);float s=.16+.42*h.x*h.x,d=length(g+h-fp)/s;if(d<1.&&h.y>.34)m=max(m,(1.-d*d)*s);if(uBldV>.5&&h.z>.62){vec3 h2=h33(ip+g+vec3(41.3,17.9,29.1));float s2=.12+.3*h2.x*h2.x,d2=length(g+h2-fp)/s2;if(d2<1.)m=max(m,(1.-d2*d2)*s2);}}
 return m;}
float hf(vec3 d){vec3 p=d*rad(d)+uSeed3;float h=texture(uH,uvOf(d)).r;
 h+=uFine*((ridge(p*5.,4)-.55)*.05+(fbm(p*26.,3)-.5)*.018);
 if(uBld>.01)h+=uBld*(boulders(p*17.)*.055+boulders(p*43.)*.018);
 return h;}
vec3 P(vec3 d,float h){return d*rad(d)*(1.+h);}
void main(){
 vec3 d=normalize(vD);float h=hf(d),e=.0035;
 vec3 tA=normalize(cross(d,vec3(.13,1.,.31))),tB=cross(d,tA),dA=normalize(d+tA*e),dB=normalize(d+tB*e);
 vec3 p0=P(d,h),n=normalize(cross(P(dA,hf(dA))-p0,P(dB,hf(dB))-p0));if(dot(n,d)<0.)n=-n;
 float mu0=dot(n,uLo),mu=max(dot(n,uVo),.02),sh=1.;
 if(mu0>0.){vec3 q=p0+n*.016;float st=.03;for(int i=0;i<26;i++){q+=uLo*st;vec3 dq=normalize(q);float s=rad(dq)*(1.+texture(uH,uvOf(dq)).r),o=s-length(q);if(o>.012){sh=0.;break;}sh=min(sh,1.-smoothstep(-.012,.002,o)*.6);st*=1.11;}}
 else sh=0.;
 vec2 uv=uvOf(d);float fresh=texture(uH,uv).g,pat=fbm(p0*3.+uSeed3,4),grain=fbm(p0*44.+uSeed3,3);
 vec3 alb=uTint*(.58+.8*pat)*(.8+.42*grain);alb=mix(alb,alb*1.5+.05,clamp(fresh,0.,1.)*(1.-uComet*.75));
 alb*=uBright;
 float alpha=acos(clamp(dot(uLo,uVo),-1.,1.));
 float phase=exp(-.9*alpha)+.32;
 float m0=max(mu0,0.);
 float I=(m0/(m0+mu)*1.15+m0*.62)*phase*sh;
 vec3 c=alb*I*1.55+alb*.03;
 c=1.-exp(-c*1.5);
 O=vec4(pow(c,vec3(1./2.2)),1.);
}`;
// @deviation (#93 1.7) JET_VS works out each jet particle from its fixed data (aQ: its four random numbers; aB: its
// source direction) and the frame (uM, uL, uT = clock * 0.14 mod 1, uSc), as the prototype's draw() did on the CPU,
// then places it as the prototype's JET_VS did. A particle on the night side (nl < 0.06) is put outside the clip
// volume, so it draws nothing, as the prototype skipped it.
var JET_VS = `#version 300 es
layout(location=0) in vec4 aQ;layout(location=1) in vec3 aB;uniform float uAsp,uPx,uT,uSc;uniform mat3 uM;uniform vec3 uAx,uL;out float vA;
float rad(vec3 d){float r=1./sqrt(dot(d/uAx,d/uAx));return r*(.72+.62*d.x*d.x+.1*d.x);}
void main(){float rs=rad(aB);vec3 wv=uM*aB*rs;float nl=max(0.,dot(wv,uL)/rs);
 if(nl<.06){gl_Position=vec4(2.,2.,2.,1.);gl_PointSize=1.;vA=0.;return;}
 float age=fract(uT+aQ.y*7.+aQ.z),spd=.5+.8*aQ.w,far=age*spd*2.4,push=age*age*2.1;
 vec3 q=(wv+wv/rs*far-uL*push)*uSc;vec4 aP=vec4(q.x,q.y,-q.z,(1.-age)*pow(nl,.6));
 gl_Position=vec4(aP.x/uAsp,aP.y,aP.z*.3,1.);gl_PointSize=uPx*(1.2+2.2*(1.-aP.w));vA=aP.w;}`;
// @end-deviation
var JET_FS = `#version 300 es
precision highp float;in float vA;out vec4 O;void main(){vec2 c=gl_PointCoord*2.-1.;float g=exp(-dot(c,c)*2.6);vec3 col=mix(vec3(.55,.68,.92),vec3(.9,.85,.72),vA);O=vec4(col*g*.2*vA,1.);}`;
function RockGL(canvas) {
  var gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('no webgl2');
// @deviation (#93 B7) the prototype compiled both programs here with compile(), which waits for the driver (1.3 to
// 3.7 s for ROCK_FS on a cold ANGLE D3D11 cache, the page frozen meanwhile). They are now only submitted (compileStart,
// as the world engine's #93 1.2): poll() says when the driver has finished (KHR_parallel_shader_compile) and link()
// reads the result, throwing the compile or link log as compile() did. draw() calls link() first, so a host that draws
// before poll() is true still works (it then waits, as before). With the bake (#93 2.1) ROCK_FS_BAKED draws the body
// and BAKE_FS fills its cube maps; without float render targets (EXT_color_buffer_float) the prototype's ROCK_FS draws.
  var pex = gl.getExtension('KHR_parallel_shader_compile'), bakeOK = rockBake.on && !!gl.getExtension('EXT_color_buffer_float'), p, u, pj, uj, bake = null, upGen = 0, jm = new Float32Array(9);
  var jobs = bakeOK ? { R: compileStart(gl, ROCK_VS, ROCK_FS_BAKED), B: compileStart(gl, BAKE_VS, BAKE_FS), J: compileStart(gl, JET_VS, JET_FS) } : { R: compileStart(gl, ROCK_VS, ROCK_FS), J: compileStart(gl, JET_VS, JET_FS) };
  function link() { if (p) return; var a = compileEnd(gl, jobs.R), b = compileEnd(gl, jobs.J), c = jobs.B ? compileEnd(gl, jobs.B) : null; u = unis(gl, a); uj = unis(gl, b); pj = b; if (c) bake = rockBaker(gl, c); p = a; }
  this.poll = function () { for (var k in jobs) if (!compileDone(gl, jobs[k], pex)) return false; link(); return true; };
  this.baked = bakeOK;
// @end-deviation
  var NX = 520, NY = 300, v = new Float32Array((NX + 1) * (NY + 1) * 2), idx = new Uint32Array(NX * NY * 6), i, j, k = 0;
  for (j = 0; j <= NY; j++) for (i = 0; i <= NX; i++) { v[k++] = i / NX; v[k++] = j / NY; }
  k = 0; for (j = 0; j < NY; j++) for (i = 0; i < NX; i++) { var a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1; idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d; }
  var vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  var bv = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bv); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  var bi = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bi); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  var jv = gl.createVertexArray(); gl.bindVertexArray(jv); var bj = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bj); gl.bufferData(gl.ARRAY_BUFFER, 16 * 4000, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  var tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  var jd = new Float32Array(16000), L = (function () { var q = [-0.72, 0.3, 0.62], l = Math.hypot(q[0], q[1], q[2]); return [q[0] / l, q[1] / l, q[2] / l]; })(), jr = rng(404), jetD = [];
  for (i = 0; i < 4000; i++) jetD.push([jr(), jr(), jr(), jr()]);
// @deviation (#93 1.7) the jets' fixed part, once: each particle's four random numbers and its source direction (one of
// six, from rng(1000 + source), jittered and normalised), which the prototype's draw() worked out again every frame.
// JET_VS does the rest, so a frame creates no JavaScript objects (about 12,000 before) and uploads nothing.
  (function () { var a = new Float32Array(4000 * 7), n, o; for (n = 0; n < 4000; n++) { var q = jetD[n], src = Math.floor(q[0] * 6), r2 = rng(1000 + src), z = r2() * 2 - 1, an = r2() * 6.2832, c2 = Math.sqrt(1 - z * z), bx = c2 * Math.cos(an) + (q[1] - 0.5) * 0.28, by = z + (q[2] - 0.5) * 0.28, bz = c2 * Math.sin(an) + (q[3] - 0.5) * 0.28, l2 = Math.hypot(bx, by, bz); o = n * 7; a[o] = q[0]; a[o + 1] = q[1]; a[o + 2] = q[2]; a[o + 3] = q[3]; a[o + 4] = bx / l2; a[o + 5] = by / l2; a[o + 6] = bz / l2; }
    gl.bindVertexArray(jv); gl.bindBuffer(gl.ARRAY_BUFFER, bj); gl.bufferData(gl.ARRAY_BUFFER, a, gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 28, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 16); gl.bindVertexArray(null); })();
// @end-deviation
// @deviation (#93 2.1) upGen counts the height-map uploads, so the bake runs again after each (a new body, the age).
  this.upload = function (b) { upGen++; gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, b.w, b.h, 0, gl.RG, gl.FLOAT, b.data); };
// @end-deviation
  this.draw = function (m) {
    var dp = Math.min(devicePixelRatio || 1, 1.5), w = Math.round(canvas.clientWidth * dp), h = Math.round(canvas.clientHeight * dp); if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
// @deviation (#93 B7, 2.1) the programs are linked before the first draw (waiting for the driver only when poll() was
// not yet true), then the bake runs if the height map or a shading input changed since the last one.
    link(); if (bake) bake.run(m, tex, upGen);
// @end-deviation
    var cy = Math.cos(R.yaw + R.spin), sy = Math.sin(R.yaw + R.spin), cp = Math.cos(R.pitch), sp = Math.sin(R.pitch);
    var M = [cy, sp * sy, -cp * sy, 0, cp, sp, sy, -sp * cy, cp * cy];
    var asp = w / h, sc = (R.p.ab > 4 ? 1.35 : 0.9) / R.built.ext * (R.p.comet ? 0.9 : 1), mt = function (v2) { return [M[0] * v2[0] + M[3] * v2[1] + M[6] * v2[2], M[1] * v2[0] + M[4] * v2[1] + M[7] * v2[2], M[2] * v2[0] + M[5] * v2[1] + M[8] * v2[2]]; };
    var Lo = mt(L), Vo = mt([0, 0, 1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h); gl.clearColor(0.004, 0.004, 0.008, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND); gl.useProgram(p); gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u.uH, 0);
    gl.uniformMatrix3fv(u.uM, false, new Float32Array([M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]]));
    gl.uniform1f(u.uScale, sc); gl.uniform1f(u.uAsp, asp); gl.uniform3fv(u.uAx, m.ax); gl.uniform1f(u.uComet, R.p.comet ? 1 : 0); gl.uniform3fv(u.uLo, Lo); gl.uniform3fv(u.uVo, Vo); gl.uniform3fv(u.uTint, R.p.tint);
    gl.uniform1f(u.uFine, R.mode === 'smooth' ? 0.25 : 1); gl.uniform1f(u.uBld, m.bld); gl.uniform1f(u.uBright, clamp(0.12 + 1.6 * R.p.A, 0.12, 0.8) * 3.6); gl.uniform1f(u.uSeed, R.p.seed); gl.uniform3fv(u.uSeed3, R.p.seed3 || [R.p.seed, R.p.seed, R.p.seed]); gl.uniform1f(u.uBldV, R.p.seed3 ? 1 : 0);
// @deviation (#93 2.1) ROCK_FS_BAKED reads the baked normal, albedo factor and height from the cube maps.
    if (bake) bake.bind(u);
// @end-deviation
    gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_INT, 0);
// @deviation (#93 1.7) the jets move in the vertex shader (JET_VS): the same particles, ages, speeds and sunlit-side cut
// as the loop the prototype ran here every frame (about 12,000 short-lived objects and a 64 KB upload a frame), in
// float32 instead of float64. Reduced motion draws the first 2,400, as before.
    if (R.p.comet) {
      jm[0] = M[0]; jm[1] = M[3]; jm[2] = M[6]; jm[3] = M[1]; jm[4] = M[4]; jm[5] = M[7]; jm[6] = M[2]; jm[7] = M[5]; jm[8] = M[8];
      gl.useProgram(pj); gl.bindVertexArray(jv);
      gl.uniformMatrix3fv(uj.uM, false, jm); gl.uniform3fv(uj.uAx, m.ax); gl.uniform3fv(uj.uL, L); gl.uniform1f(uj.uT, (R.clock * 0.14) % 1); gl.uniform1f(uj.uSc, sc);
      gl.uniform1f(uj.uAsp, asp); gl.uniform1f(uj.uPx, Math.max(2, h / 200)); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
      gl.drawArrays(gl.POINTS, 0, reduced ? 2400 : 4000); gl.depthMask(true); gl.disable(gl.BLEND);
    }
// @end-deviation
    gl.bindVertexArray(null);
  };
}
// @end-verbatim
// @deviation (#93 B7) compileStart / compileDone / compileEnd, as worlds/helpers.js (#93 1.2): submit a program (compile,
// attach, link, no status read), poll KHR_parallel_shader_compile's COMPLETION_STATUS_KHR (without the extension it
// reports done at once, so the next read waits as compile() did), then read the result, throwing the shader or link
// log exactly as compile() did.
function compileStart(gl, vs, fs) {
  var p = gl.createProgram(), sv = gl.createShader(gl.VERTEX_SHADER), sf = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(sv, vs); gl.compileShader(sv); gl.shaderSource(sf, fs); gl.compileShader(sf);
  gl.attachShader(p, sv); gl.attachShader(p, sf); gl.linkProgram(p);
  return { p: p, vs: sv, fs: sf };
}
function compileDone(gl, job, ext) { return !ext || !!gl.getProgramParameter(job.p, ext.COMPLETION_STATUS_KHR); }
function compileEnd(gl, job) {
  if (!gl.getProgramParameter(job.p, gl.LINK_STATUS)) {
    var s = [job.vs, job.fs].filter(function (o) { return !gl.getShaderParameter(o, gl.COMPILE_STATUS); })[0];
    throw new Error(s ? gl.getShaderInfoLog(s) : gl.getProgramInfoLog(job.p));
  }
  return job.p;
}
// @end-deviation
// @deviation (#93 B7) as the world engine's noUnroll (#93 1.1, Q-337): ANGLE D3D11's fxc unrolls every loop with a
// constant bound. Each constant bound in ROCK_FS (NOISE's fbm and ridge, the three nested 3-step boulder loops, the
// 26-step shadow march) becomes N+uZ0, with uZ0 a uniform that is never set (always 0): the loops run exactly as before,
// but fxc keeps them as loops. BAKE_FS and ROCK_FS_BAKED below are cut from this ROCK_FS, so they inherit it.
function noUnroll(src) {
  return src.replace('precision highp float;', 'precision highp float;\nuniform int uZ0;')
    .replace(/(for\(int [ijk]=-?\d+;[ijk])(<=?)(\d+|n);/g, function (m, a, op, b) { return a + op + b + '+uZ0;'; });
}
ROCK_FS = noUnroll(ROCK_FS);
// @end-deviation
// @deviation (#93 2.1) the bake. ROCK_FS works out the fine relief (ridge and fbm noise, two boulder layers: about 386
// hashes a pixel), the normal from three of those and the albedo noise again on every frame, although none of it moves
// with the camera or the light. BAKE_FS runs ROCK_FS's own code once per texel of two cube maps (rockBake.n texels a
// side; texel directions follow the GL cube-map face table) and keeps the normal and the albedo factor (RGBA16F) and the
// height (R16F); ROCK_FS_BAKED is ROCK_FS with those lines replaced by three cube-map reads, so the light, the cast
// shadow march, the fresh-crater brightening, the phase and the tone curve are the prototype's. The bake runs again when
// the height map is uploaded or a shading input changes (rockBaker.run's key). A GPU bake is not byte-identical across
// GPUs, like the engine itself (R5.9). setRockBake(false) before a RockGL is made draws the prototype's ROCK_FS
// (the pixel comparison in scripts/engine-bench/rocks.html).
var rockBake = { on: true, n: 1024 };
function setRockBake(on, n) { rockBake.on = !!on; if (n) rockBake.n = n; }
function rockShaderEdit(src, edits) { edits.forEach(function (e) { if (src.split(e[0]).length !== 2) throw new Error('ROCK_FS changed, update the bake: ' + e[0]); src = src.replace(e[0], e[1]); }); return src; }
var BAKE_VS = '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}';
var BAKE_FS = rockShaderEdit(ROCK_FS.slice(0, ROCK_FS.indexOf('void main(){')), [['in vec3 vD;', ''], ['out vec4 O;', 'layout(location=0) out vec4 O;layout(location=1) out vec4 O2;']]) + `uniform int uFace;uniform float uN;
vec3 faceDir(vec2 s){if(uFace==0)return vec3(1.,-s.y,-s.x);if(uFace==1)return vec3(-1.,-s.y,s.x);if(uFace==2)return vec3(s.x,1.,s.y);
 if(uFace==3)return vec3(s.x,-1.,-s.y);if(uFace==4)return vec3(s.x,-s.y,1.);return vec3(-s.x,-s.y,-1.);}
void main(){
 vec3 d=normalize(faceDir(gl_FragCoord.xy/uN*2.-1.));float h=hf(d),e=.0035;
 vec3 tA=normalize(cross(d,vec3(.13,1.,.31))),tB=cross(d,tA),dA=normalize(d+tA*e),dB=normalize(d+tB*e);
 vec3 p0=P(d,h),n=normalize(cross(P(dA,hf(dA))-p0,P(dB,hf(dB))-p0));if(dot(n,d)<0.)n=-n;
 float pat=fbm(p0*3.+uSeed3,4),grain=fbm(p0*44.+uSeed3,3);
 O=vec4(n,(.58+.8*pat)*(.8+.42*grain));O2=vec4(h,0.,0.,1.);
}`;
var ROCK_FS_BAKED = rockShaderEdit(ROCK_FS, [
  ['out vec4 O;', 'uniform samplerCube uBN,uBH;out vec4 O;'],
  ['vec3 d=normalize(vD);float h=hf(d),e=.0035;', 'vec3 d=normalize(vD);vec4 bk=texture(uBN,d);float h=texture(uBH,d).r;'],
  [' vec3 tA=normalize(cross(d,vec3(.13,1.,.31))),tB=cross(d,tA),dA=normalize(d+tA*e),dB=normalize(d+tB*e);\n', ''],
  ['vec3 p0=P(d,h),n=normalize(cross(P(dA,hf(dA))-p0,P(dB,hf(dB))-p0));if(dot(n,d)<0.)n=-n;', 'vec3 p0=P(d,h),n=normalize(bk.xyz);'],
  ['float fresh=texture(uH,uv).g,pat=fbm(p0*3.+uSeed3,4),grain=fbm(p0*44.+uSeed3,3);', 'float fresh=texture(uH,uv).g;'],
  ['vec3 alb=uTint*(.58+.8*pat)*(.8+.42*grain);', 'vec3 alb=uTint*bk.w;']
]);
function rockBaker(gl, prog) {
  var ub = unis(gl, prog), N = rockBake.n, fb = gl.createFramebuffer(), key = null;
  function cube(f) { var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_CUBE_MAP, t); gl.texStorage2D(gl.TEXTURE_CUBE_MAP, 1, f, N, N); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; }
  var tN = cube(gl.RGBA16F), tH = cube(gl.R16F);
  return {
    run: function (m, tex, gen) {
      var s3 = R.p.seed3 || [R.p.seed, R.p.seed, R.p.seed], fine = R.mode === 'smooth' ? 0.25 : 1, comet = R.p.comet ? 1 : 0, bv = R.p.seed3 ? 1 : 0;
      var k = [gen, m.ax[0], m.ax[1], m.ax[2], comet, fine, m.bld, s3[0], s3[1], s3[2], bv].join();
      if (k === key) return;
      key = k;
      var cull = gl.isEnabled(gl.CULL_FACE), f;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, N, N); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      gl.useProgram(prog); gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(ub.uH, 0);
      gl.uniform3fv(ub.uAx, m.ax); gl.uniform1f(ub.uComet, comet); gl.uniform1f(ub.uFine, fine); gl.uniform1f(ub.uBld, m.bld); gl.uniform3fv(ub.uSeed3, s3); gl.uniform1f(ub.uBldV, bv); gl.uniform1f(ub.uN, N);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      for (f = 0; f < 6; f++) { gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, tN, 0); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, tH, 0); gl.uniform1i(ub.uFace, f); gl.drawArrays(gl.TRIANGLES, 0, 3); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); if (cull) gl.enable(gl.CULL_FACE);
    },
    bind: function (u) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_CUBE_MAP, tN); gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_CUBE_MAP, tH); gl.activeTexture(gl.TEXTURE0); gl.uniform1i(u.uBN, 1); gl.uniform1i(u.uBH, 2); }
  };
}
// @end-deviation

export { R, RP, radialFn, rockModel, buildRock, RockGL, ROCK_VS, ROCK_FS, JET_VS, JET_FS, rng, clamp, BAKE_FS, ROCK_FS_BAKED, setRockBake };
export function setReducedMotion(v) { reduced = v; }

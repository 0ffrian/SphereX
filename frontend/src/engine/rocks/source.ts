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
  var p = R.p, TW = 1024, TH = 512, data = new Float32Array(TW * TH * 2), base = new Float32Array(TW * TH), px = new Float32Array(TW * TH * 3), r = rng(p.seed * 31 + 7), rf = radialFn(m.ax, p.comet), i, j, ext = 0, W2 = [];
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
  cr.forEach(function (rc) {
    var z = r() * 2 - 1, an = r() * 6.2832, c2 = Math.sqrt(1 - z * z), dx = c2 * Math.cos(an), dy = z, dz = c2 * Math.sin(an), rs = rf(dx, dy, dz), cx = dx * rs, cy = dy * rs, cz = dz * rs, deg = 0.35 + 0.65 * r(), depth = 0.33 * rc * deg, reach = 2.4 * rc;
    var la0 = Math.asin(dy), lo0 = Math.atan2(dz, dx), th = Math.min(Math.PI, reach / rs * 1.08), j0 = Math.max(0, Math.floor(((la0 - th) / Math.PI + 0.5) * TH)), j1 = Math.min(TH - 1, Math.ceil(((la0 + th) / Math.PI + 0.5) * TH));
    var dLo = Math.abs(la0) + th >= 1.5 ? Math.PI : Math.min(Math.PI, Math.asin(Math.min(1, Math.sin(th) / Math.cos(la0))) * 1.1);
    for (var jj = j0; jj <= j1; jj++) {
      var i0 = Math.floor(((lo0 - dLo) / 6.2832 + 0.5) * TW), i1 = Math.min(i0 + TW - 1, Math.ceil(((lo0 + dLo) / 6.2832 + 0.5) * TW));
      for (var ii = i0; ii <= i1; ii++) {
        var iw = ((ii % TW) + TW) % TW, ix = jj * TW + iw, dpx = px[ix * 3] - cx, dpy = px[ix * 3 + 1] - cy, dpz = px[ix * 3 + 2] - cz, d = Math.sqrt(dpx * dpx + dpy * dpy + dpz * dpz) / rc; if (d > 2.4) continue;
        var prof = d < 1 ? -depth * (1 - d * d) + 0.2 * depth * d * d * d * d : 0.2 * depth * Math.pow(d, -5);
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
in vec3 vD;uniform sampler2D uH;uniform vec3 uAx,uLo,uVo,uTint;uniform float uComet,uFine,uBld,uBright,uScale,uSeed;out vec4 O;
${NOISE}
float rad(vec3 d){float r=1./sqrt(dot(d/uAx,d/uAx));if(uComet>.5)r*=.72+.62*d.x*d.x+.1*d.x;return r;}
vec2 uvOf(vec3 d){return vec2(atan(d.z,d.x)/6.2831853+.5,asin(clamp(d.y,-1.,1.))/3.14159265+.5);}
float boulders(vec3 p){vec3 ip=floor(p),fp=fract(p);float m=0.;
 for(int k=-1;k<=1;k++)for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec3 g=vec3(i,j,k),h=h33(ip+g);float s=.16+.42*h.x*h.x,d=length(g+h-fp)/s;if(d<1.&&h.y>.34)m=max(m,(1.-d*d)*s);}
 return m;}
float hf(vec3 d){vec3 p=d*rad(d)+uSeed;float h=texture(uH,uvOf(d)).r;
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
 vec2 uv=uvOf(d);float fresh=texture(uH,uv).g,pat=fbm(p0*3.+uSeed,4),grain=fbm(p0*44.+uSeed,3);
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
var JET_VS = `#version 300 es
layout(location=0) in vec4 aP;uniform float uAsp,uPx;out float vA;void main(){gl_Position=vec4(aP.x/uAsp,aP.y,aP.z*.3,1.);gl_PointSize=uPx*(1.2+2.2*(1.-aP.w));vA=aP.w;}`;
var JET_FS = `#version 300 es
precision highp float;in float vA;out vec4 O;void main(){vec2 c=gl_PointCoord*2.-1.;float g=exp(-dot(c,c)*2.6);vec3 col=mix(vec3(.55,.68,.92),vec3(.9,.85,.72),vA);O=vec4(col*g*.2*vA,1.);}`;
function RockGL(canvas) {
  var gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('no webgl2');
  var p = compile(gl, ROCK_VS, ROCK_FS), u = unis(gl, p), pj = compile(gl, JET_VS, JET_FS), uj = unis(gl, pj);
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
  this.upload = function (b) { gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, b.w, b.h, 0, gl.RG, gl.FLOAT, b.data); };
  this.draw = function (m) {
    var dp = Math.min(devicePixelRatio || 1, 1.5), w = Math.round(canvas.clientWidth * dp), h = Math.round(canvas.clientHeight * dp); if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    var cy = Math.cos(R.yaw + R.spin), sy = Math.sin(R.yaw + R.spin), cp = Math.cos(R.pitch), sp = Math.sin(R.pitch);
    var M = [cy, sp * sy, -cp * sy, 0, cp, sp, sy, -sp * cy, cp * cy];
    var asp = w / h, sc = (R.p.ab > 4 ? 1.35 : 0.9) / R.built.ext * (R.p.comet ? 0.9 : 1), mt = function (v2) { return [M[0] * v2[0] + M[3] * v2[1] + M[6] * v2[2], M[1] * v2[0] + M[4] * v2[1] + M[7] * v2[2], M[2] * v2[0] + M[5] * v2[1] + M[8] * v2[2]]; };
    var Lo = mt(L), Vo = mt([0, 0, 1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h); gl.clearColor(0.004, 0.004, 0.008, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND); gl.useProgram(p); gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u.uH, 0);
    gl.uniformMatrix3fv(u.uM, false, new Float32Array([M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]]));
    gl.uniform1f(u.uScale, sc); gl.uniform1f(u.uAsp, asp); gl.uniform3fv(u.uAx, m.ax); gl.uniform1f(u.uComet, R.p.comet ? 1 : 0); gl.uniform3fv(u.uLo, Lo); gl.uniform3fv(u.uVo, Vo); gl.uniform3fv(u.uTint, R.p.tint);
    gl.uniform1f(u.uFine, R.mode === 'smooth' ? 0.25 : 1); gl.uniform1f(u.uBld, m.bld); gl.uniform1f(u.uBright, clamp(0.12 + 1.6 * R.p.A, 0.12, 0.8) * 3.6); gl.uniform1f(u.uSeed, R.p.seed);
    gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_INT, 0);
    if (R.p.comet) {
      var rf = radialFn(m.ax, true), t = R.clock, N = reduced ? 2400 : 4000, k2 = 0, n2;
      for (n2 = 0; n2 < N; n2++) {
        var q = jetD[n2], src = Math.floor(q[0] * 6), r2 = rng(1000 + src), z = r2() * 2 - 1, an = r2() * 6.2832, c2 = Math.sqrt(1 - z * z), bx = c2 * Math.cos(an) + (q[1] - 0.5) * 0.28, by = z + (q[2] - 0.5) * 0.28, bz = c2 * Math.sin(an) + (q[3] - 0.5) * 0.28, l2 = Math.hypot(bx, by, bz); bx /= l2; by /= l2; bz /= l2;
        var rs = rf(bx, by, bz), wv = [(M[0] * bx + M[1] * by + M[2] * bz) * rs, (M[3] * bx + M[4] * by + M[5] * bz) * rs, (M[6] * bx + M[7] * by + M[8] * bz) * rs];
        var nl = Math.max(0, (wv[0] * L[0] + wv[1] * L[1] + wv[2] * L[2]) / rs); if (nl < 0.06) continue;
        var age = (t * 0.14 + q[1] * 7 + q[2]) % 1, spd = 0.5 + 0.8 * q[3], far = age * spd * 2.4, push = age * age * 2.1;
        jd[k2++] = (wv[0] + wv[0] / rs * far - L[0] * push) * sc; jd[k2++] = (wv[1] + wv[1] / rs * far - L[1] * push) * sc; jd[k2++] = -(wv[2] + wv[2] / rs * far - L[2] * push) * sc; jd[k2++] = (1 - age) * Math.pow(nl, 0.6);
      }
      gl.useProgram(pj); gl.bindVertexArray(jv); gl.bindBuffer(gl.ARRAY_BUFFER, bj); gl.bufferSubData(gl.ARRAY_BUFFER, 0, jd.subarray(0, k2));
      gl.uniform1f(uj.uAsp, asp); gl.uniform1f(uj.uPx, Math.max(2, h / 200)); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
      gl.drawArrays(gl.POINTS, 0, k2 / 4); gl.depthMask(true); gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  };
}
// @end-verbatim

export { R, RP, radialFn, rockModel, buildRock, RockGL, ROCK_VS, ROCK_FS, JET_VS, JET_FS, rng, clamp };
export function setReducedMotion(v) { reduced = v; }

/* eslint-disable */
// @ts-nocheck
// Issue #71, D-37: the approved prototype's star and flare engine, extracted MECHANICALLY and unchanged.
// Source: .claude/worktrees/sculptor-reference/sculptor-preview-next.html, lines 663-849 (field-guided plasma: PART_VS, PART_FS, BLUR_FS, COMP_FS).
// Not yet imported by the app: it still needs the TypeScript host (DOM removed, `cardToStar`). Do not edit here;
// re-run the slicing instead so the body stays byte-identical to the prototype.
// @verbatim L664-L850
/* ---------- field-guided plasma: streaks accumulated as density and temperature, then coloured ---------- */
var PART_VS = `#version 300 es
layout(location=0) in vec2 aP;layout(location=1) in vec2 aD;layout(location=2) in vec3 aV;
uniform vec2 uC;out vec2 vQ;out vec2 vS;
void main(){vec2 q=vec2(float(gl_VertexID&1)*2.-1.,float((gl_VertexID>>1)&1)*2.-1.);
 float l=length(aD);vec2 t=l>.001?aD/l:vec2(1.,0.),n=vec2(-t.y,t.x);
 vec2 p=aP+t*(l+aV.x)*q.x+n*aV.x*q.y,c=p/uC*2.-1.;
 gl_Position=vec4(c.x,-c.y,0.,1.);vQ=q;vS=aV.yz;}`;
var PART_FS = `#version 300 es
precision highp float;in vec2 vQ;in vec2 vS;out vec4 O;
void main(){float g=1.-vQ.x*vQ.x;g*=g*exp(-vQ.y*vQ.y*3.2);float d=vS.y*g;O=vec4(d,d*vS.x,0.,1.);}`;
var BLUR_FS = `#version 300 es
precision highp float;uniform sampler2D uT;uniform vec2 uD,uR;out vec4 O;
void main(){vec2 uv=gl_FragCoord.xy/uR;
 O=texture(uT,uv)*.227027+(texture(uT,uv+uD*1.3846)+texture(uT,uv-uD*1.3846))*.316216+(texture(uT,uv+uD*3.2308)+texture(uT,uv-uD*3.2308))*.070270;}`;
var COMP_FS = `#version 300 es
precision highp float;uniform sampler2D uA,uB;uniform vec2 uR;out vec4 O;
vec3 ramp(float t){vec3 a=vec3(.62,.035,.01),b=vec3(1.,.30,.035),c=vec3(1.,.72,.22),d=vec3(1.,.95,.82),e=vec3(.72,.86,1.);
 t=clamp(t,0.,1.);if(t<.3)return mix(a,b,t/.3);if(t<.6)return mix(b,c,(t-.3)/.3);if(t<.85)return mix(c,d,(t-.6)/.25);return mix(d,e,(t-.85)/.15);}
void main(){vec2 uv=gl_FragCoord.xy/uR;vec4 a=texture(uA,uv),b=texture(uB,uv);
 float d=a.r,t=d>1e-4?a.g/d:0.,db=b.r,tb=db>1e-4?b.g/db:0.;
 float body=1.-exp(-d*1.25),core=smoothstep(.9,3.4,d);
 vec3 c=ramp(t)*body*1.25+vec3(1.,.93,.8)*core*.5+ramp(tb)*(1.-exp(-db*.9))*.55;
 c=1.-exp(-c*1.35);O=vec4(pow(c,vec3(1./2.2)),1.);}`;
function PlasmaGL(canvas, cap) {
  var gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('no webgl2');
  var hasFloat = !!gl.getExtension('EXT_color_buffer_float');
  function sh(t, s) { var o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; }
  function prog(v, f) { var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, v)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, f)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; }
  var pP = prog(PART_VS, PART_FS), pB = prog(VS, BLUR_FS), pC = prog(VS, COMP_FS);
  var uP = gl.getUniformLocation(pP, 'uC'), uBT = gl.getUniformLocation(pB, 'uT'), uBD = gl.getUniformLocation(pB, 'uD'), uBR = gl.getUniformLocation(pB, 'uR'), uCA = gl.getUniformLocation(pC, 'uA'), uCB = gl.getUniformLocation(pC, 'uB'), uCR = gl.getUniformLocation(pC, 'uR');
  var empty = gl.createVertexArray(), vao = gl.createVertexArray(), buf = gl.createBuffer();
  gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, cap * 28, gl.DYNAMIC_DRAW);
  [[0, 2, 0], [1, 2, 8], [2, 3, 16]].forEach(function (a) { gl.enableVertexAttribArray(a[0]); gl.vertexAttribPointer(a[0], a[1], gl.FLOAT, false, 28, a[2]); gl.vertexAttribDivisor(a[0], 1); });
  gl.bindVertexArray(null);
  function target(w, h) {
    var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    if (hasFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null); else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { t: t, f: f, w: w, h: h };
  }
  function kill(o) { if (o) { gl.deleteTexture(o.t); gl.deleteFramebuffer(o.f); } }
  var A = null, B1 = null, B2 = null;
  function blur(src, dst, dx, dy) { gl.bindFramebuffer(gl.FRAMEBUFFER, dst.f); gl.viewport(0, 0, dst.w, dst.h); gl.bindTexture(gl.TEXTURE_2D, src.t); gl.uniform2f(uBD, dx / dst.w, dy / dst.h); gl.uniform2f(uBR, dst.w, dst.h); gl.drawArrays(gl.TRIANGLES, 0, 3); }
  this.draw = function (W, H, data, n) {
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W; canvas.height = H; kill(A); kill(B1); kill(B2);
      A = target(Math.max(2, W >> 1), Math.max(2, H >> 1)); B1 = target(Math.max(2, W >> 2), Math.max(2, H >> 2)); B2 = target(Math.max(2, W >> 2), Math.max(2, H >> 2));
    }
    gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, A.f); gl.viewport(0, 0, A.w, A.h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (n > 0) {
      gl.useProgram(pP); gl.uniform2f(uP, W, H); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, n * 7));
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n); gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(empty); gl.useProgram(pB); gl.activeTexture(gl.TEXTURE0); gl.uniform1i(uBT, 0);
    blur(A, B1, 1.6, 0); blur(B1, B2, 0, 1.6); blur(B2, B1, 3.2, 0); blur(B1, B2, 0, 3.2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); gl.useProgram(pC);
    gl.uniform2f(uCR, W, H); gl.uniform1i(uCA, 0); gl.uniform1i(uCB, 1);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, B2.t); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, A.t);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}
var SHOW_LINES = true, coarse = false;
try { coarse = matchMedia('(pointer: coarse)').matches; } catch (e) {}
var PL = { cap: coarse ? 24000 : 60000, n: 0, q: coarse ? 0.45 : 1, ema: 16, data: null, R: new Float32Array(4096) };
PL.data = new Float32Array(PL.cap * 7);
(function () { var r = rng(31337); for (var i = 0; i < 4096; i++) PL.R[i] = r(); })();
var starPL = null, flarePL = null;
try { starPL = new PlasmaGL($('#star-p'), PL.cap); } catch (e) { console.error(e); }
try { flarePL = new PlasmaGL($('#flare-p'), PL.cap); } catch (e) { console.error(e); }
var AT = { x: 0, y: 0, hid: false, W: 1, H: 1, g: null, at: null };
function atStar(a, l, h) { pt(AT.g, a, l, h); AT.x = VW.x; AT.y = VW.y; AT.hid = VW.hid; }
function atStage(a, l, h) { var ex = a * cp - l * sp, de = a * sp + l * cp, y = (1 + h) * cb - de * sb; AT.x = AT.W / 2 + (ex - V.off[0]) / V.h * AT.H / 2; AT.y = AT.H / 2 - (y - V.off[1]) / V.h * AT.H / 2; AT.hid = false; }
function pr(k) { return PL.R[k & 4095]; }
function put7(x, y, dx, dy, w, T, D) { if (PL.n >= PL.cap) return; var d = PL.data, i = PL.n * 7; d[i] = x; d[i + 1] = y; d[i + 2] = dx; d[i + 3] = dy; d[i + 4] = w; d[i + 5] = T; d[i + 6] = D; PL.n++; }
function emitArch(cA, A, L, h, sh, s, oL, oh, w, T, D, len) {
  var c = Math.cos(Math.PI * s), sn = Math.sin(Math.PI * s);
  AT.at(cA - A * c, L + sh * c + oL, h * sn + oh); if (AT.hid) return;
  var x = AT.x, y = AT.y, c2 = Math.cos(Math.PI * (s + 0.012)), sn2 = Math.sin(Math.PI * (s + 0.012));
  AT.at(cA - A * c2, L + sh * c2 + oL, h * sn2 + oh);
  var dx = AT.x - x, dy = AT.y - y, l = Math.hypot(dx, dy) || 1, k = 0.5 * len / l;
  put7(x, y, dx * k, dy * k, w, T, D);
}
/* Plasma on one loop: evaporates up from both feet, hangs while hot, then cools and drains as rain. Pure function of age. */
function plasmaTube(seed, cA, A, L, h, sh, age, M, w, len, gain) {
  var fade = smooth(0, 0.05, age) * (1 - smooth(0.95, 1.35, age)); if (fade <= 0.002) return;
  var tr = A * 0.17, m = Math.max(6, Math.round(M * PL.q)), j;
  for (j = 0; j < m; j++) {
    var k = seed * 131 + j * 5, h1 = pr(k), h2 = pr(k + 1), h3 = pr(k + 2), h4 = pr(k + 3), h5 = pr(k + 4);
    var p = clamp((age - h1 * 0.24) / 0.15, 0, 1); if (p <= 0) continue;
    var up = 0.5 * p * (2 - p) * (0.5 + 0.6 * h2), q = clamp((age - (0.42 + 0.5 * h3)) / 0.42, 0, 1);
    var sN = up * (1 - q * q) + 0.03 * Math.sin(age * 24 + h4 * 6.283) * (1 - q), s = clamp(j & 1 ? 1 - sN : sN, 0.003, 0.997);
    var sn = Math.sin(Math.PI * s), ra = Math.sqrt(h5) * tr * (0.35 + 0.65 * sn), an = h4 * 39.1;
    var oL = Math.cos(an) * ra + tr * 0.35 * Math.sin(s * 17 + age * 9 + seed) * (0.4 + h2), oh = Math.sin(an) * ra * 0.75;
    var T = clamp(0.94 - age * 1.05 - 0.22 * h5 - (q > 0 ? 0.22 : 0), 0, 1), D = 0.75 * gain * fade * (1 - 0.5 * q), ww = w, ll = len * (1 + 2.5 * (1 - p) + 3 * q);
    if (q > 0.02 && h5 > 0.62) { D *= 1.7; ww *= 0.75; T *= 0.5; }
    emitArch(cA, A, L, h, sh, s, oL, oh, ww, T, D, ll);
  }
}
function plasmaRope(seed, z, rad, Lr, alpha, imp, u, M, w, len, gain) {
  if (alpha <= 0.01) return;
  var m = Math.round(M * PL.q), j;
  for (j = 0; j < m; j++) {
    var k = seed * 97 + j * 5, h1 = pr(k), h2 = pr(k + 1), h3 = pr(k + 2), h4 = pr(k + 3);
    var v = ((h1 + u * 0.25) % 1) * 2 - 1, ph = v * 11 + Math.floor(h2 * 6) * 1.05 + u * 8, env = Math.pow(Math.max(0, 1 - v * v), 0.55), r2 = rad * (0.35 + 1.15 * h3);
    AT.at(r2 * Math.cos(ph) * env, v * Lr, z * env + r2 * Math.sin(ph) * env); if (AT.hid) continue;
    var x = AT.x, y = AT.y, v2 = v + 0.03, ph2 = v2 * 11 + Math.floor(h2 * 6) * 1.05 + u * 8, env2 = Math.pow(Math.max(0, 1 - v2 * v2), 0.55);
    AT.at(r2 * Math.cos(ph2) * env2, v2 * Lr, z * env2 + r2 * Math.sin(ph2) * env2);
    var dx = AT.x - x, dy = AT.y - y, l = Math.hypot(dx, dy) || 1, s = 0.5 * len / l;
    put7(x, y, dx * s, dy * s, w, clamp(0.16 + 0.55 * imp + 0.18 * h4, 0, 1), gain * alpha);
  }
}
/* Cool dense surges thrown up tall field lines from the ribbons, in clumps. */
function plasmaSurge(seed, u, base, span, rA, ad, open, eT, M, w, len, gain) {
  var i, j, m = Math.round(M * PL.q);
  for (i = 0; i < 16; i++) {
    var side = i & 1 ? 1 : -1, b = seed * 53 + i * 11, A = ad * (0.18 + 0.25 * pr(b)), hT = ad * (1.6 + 3.2 * pr(b + 1)) * (0.6 + 0.8 * eT), L = ad * (2 * pr(b + 2) - 1) * 0.9;
    var q0 = (u - (base + 0.4 * span * pr(b + 3))) / span; if (q0 <= 0 || q0 > 1.1) continue;
    for (j = 0; j < m; j++) {
      var k = b + j * 7, h1 = pr(k), h2 = pr(k + 1), h3 = pr(k + 2), h4 = pr(k + 3), qq = (q0 - Math.floor(h1 * 5) * 0.07 - h2 * 0.05) / 0.65; if (qq <= 0 || qq >= 1) continue;
      var s = open ? Math.min(0.5, 0.75 * Math.pow(qq, 0.7)) : 2 * qq * (1 - qq), H = open ? hT * (1 + 3 * qq) : Math.min(hT, ad * 2.4), ra = h3 * A * 0.8;
      emitArch(side * rA, A, L, H, 0, Math.max(0.004, s), Math.cos(h4 * 40) * ra, Math.sin(h4 * 40) * ra, w * 1.25, 0.1 + 0.2 * h3, gain * (1 - smooth(0.75, 1, qq)), len * 0.7);
    }
  }
}
function plasmaLeg(seed, A, L, H, u, flow, M, w, len, gain, T0) {
  var m = Math.max(4, Math.round(M * PL.q)), j, tr = A * 0.12;
  for (j = 0; j < m; j++) {
    var k = seed * 71 + j * 5, h1 = pr(k), h2 = pr(k + 1), h3 = pr(k + 2), h4 = pr(k + 3), s = ((h1 + u * flow * (0.5 + h2)) % 1) * 0.5;
    emitArch(0, A, L, H, 0, clamp(j & 1 ? s : 1 - s, 0.004, 0.996), Math.cos(h4 * 40) * h3 * tr, Math.sin(h4 * 40) * h3 * tr, w, T0 + 0.2 * h3, gain, len);
  }
}
function addTubes(e) {
  var r = rng(e.s + 1), i; e.tubes = []; e.legs = [];
  for (i = 0; i < 38; i++) e.tubes.push({ l: r() * 2 - 1, h: 1.45 + 0.8 * r() });
  for (i = 0; i < 12; i++) e.legs.push({ a: 1.1 + 0.9 * r(), l: (r() - 0.5) * 1.6 });
}
function plasmaEvent(e, boost, lw) {
  var g = e.gx, u = (OV.clock - e.t0) / e.life; if (u < 0 || u > 1) return;
  AT.at = atStar; AT.g = g;
  var eT = clamp(Math.log10(e.E / 1e30) / 2, 0, 1), ad = clamp(Math.max(0.012 * boost, g.sep * 0.5 * boost) * Math.pow(e.E / 1e30, 0.1), 0.012, 0.2), fade = 1 - smooth(0.86, 1, u), i;
  var w = 1.25 * lw, len = 9 * lw, imp = smooth(0.08, 0.16, u) * (u < 0.2 ? 1 : Math.exp(-(u - 0.2) / 0.22));
  if (e.open) { var ko = smooth(0.12, 0.62, u); e.legs.forEach(function (lg, n) { plasmaLeg(e.s + n, ad * lg.a * (1 - 0.3 * ko), ad * lg.l, ad * (1.8 + 26 * ko * ko * ko), u, 1.3, 260, w * 0.8, len * 2.6, 0.026 * (1 - 0.55 * ko) * fade, 0.46); }); }
  var zr = e.open ? ad * (0.3 + 14 * Math.pow(smooth(0.12, 0.78, u), 2.2)) : ad * (0.25 + 0.5 * e.x * smooth(0.05, 0.22, u));
  var ropeA = (e.open ? 1 - smooth(0.5, 0.86, u) : 1 - smooth(0.34, 0.62, u)) * smooth(0, 0.06, u);
  plasmaRope(e.s % 977, zr, ad * (0.12 + (e.open ? 1.1 * smooth(0.15, 0.7, u) : 0.05)), ad * 1.05, ropeA, imp, u, 2600, w, len, 0.06);
  var N = Math.round(12 + 26 * eT);
  for (i = 0; i < N; i++) {
    var tb = e.tubes[i], bs = lerp(0.13, e.open ? 0.72 : 0.5, Math.pow(i / N, 1.1)), ag = (u - bs) / 0.34;
    if (ag <= 0 || ag > 1.35) continue;
    var A2 = ad * (0.42 + (e.open ? 0.85 : 0.22) * smooth(0.13, 0.85, bs));
    plasmaTube((e.s % 1009) + i, 0, A2, ad * tb.l * 0.95, A2 * tb.h, 0, ag, 120, w * (1 + 0.5 * eT), len, 0.11 * (0.6 + 0.5 * eT));
  }
  plasmaSurge(e.s % 811, u, 0.12, 0.55, ad * (0.42 + (e.open ? 0.8 : 0.2) * smooth(0.13, 0.8, u)), ad, e.open, eT, 34, w, len, 0.15);
}
function plasmaStage(W, H, t, open, e, lw) {
  if (!flarePL) return;
  PL.n = 0; AT.at = atStage; AT.W = W; AT.H = H;
  var w = 2 * lw, len = 15 * lw, ko = open ? smooth(0.2, 0.56, t) : 0, imp = impulse(t), i;
  OVER.forEach(function (o, n) {
    var h = open ? o.h * (1 + 42 * ko * ko * ko) : o.h * (1 + 0.14 * smooth(0.14, 0.3, t) - 0.08 * smooth(0.4, 0.72, t));
    plasmaLeg(n + 301, o.a * (1 - 0.3 * ko), o.L, h, t, open ? 3 : 1.2, 300, w * 0.7, len * 2.4, (0.016 + 0.03 * imp) * (1 - 0.5 * ko), 0.42);
  });
  var ropeA = open ? 1 - 0.75 * smooth(0.55, 0.85, t) : 1 - smooth(0.42, 0.75, t);
  plasmaRope(7, ropeZ(t, open), 0.006 + (open ? 0.05 * smooth(0.25, 0.7, t) : 0.004), 0.12, ropeA, imp, t * 2.5, 5200, w * 0.9, len, 0.055);
  var bEnd = open ? 0.84 : 0.56, life = open ? 0.26 : 0.3, count = Math.round(lerp(38, 90, (e - 0.55) / 0.45));
  for (i = 0; i < count; i++) {
    var P = POST[i], born = lerp(0.285, bEnd, Math.pow(P.u, 1.15)), ag = (t - born) / life;
    if (ag <= 0 || ag > 1.35) continue;
    var a0 = ribbon(born, open);
    plasmaTube(i + 11, 0, a0, P.L, a0 * P.h, 0, ag, 170, w, len, 0.1 * (0.5 + 0.5 * e));
  }
  plasmaSurge(5, t, 0.29, 0.42, ribbon(t, open), 0.04, open, e, 42, w, len, 0.13);
  flarePL.draw(W, H, PL.data, PL.n);
}
[].forEach.call(document.querySelectorAll('.lines-b'), function (b) {
  b.addEventListener('click', function () {
    SHOW_LINES = !SHOW_LINES;
    [].forEach.call(document.querySelectorAll('.lines-b'), function (x) { x.setAttribute('aria-pressed', String(SHOW_LINES)); });
    drawStar(); drawFlare();
  });
});

// @end-verbatim

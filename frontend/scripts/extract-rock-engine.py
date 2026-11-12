#!/usr/bin/env python3
"""Regenerates src/engine/rocks/source.ts from the approved prototype (issue #71, D-37).

Usage: python3 scripts/extract-rock-engine.py [path/to/sculptor-preview-next.html]
Slices by line range, so the engine stays byte-identical to the prototype, then applies PATCHES
(issue #71 review: the physics fixes that mirror backend/app/core/render/params.py). Each patch
must match exactly once, so a moved prototype fails loudly. Issue #93 wave 1 (rocks) adds PATCHES_93W1 (each changed
span marked `// @deviation (#93 ...)` ... `// @end-deviation`) and DEV93W1_TAIL, a deviation block appended after the
last verbatim slice. Importing this file (to reuse its PATCHES) does not run the extraction.
"""
import os
import sys

PATCHES = [
    # Crater cap: the sampler can never exceed 0.014 / sqrt(0.015) = 0.114 (params.CRATER_R_MAX).
    ("rmin = 0.014, rmax = 0.38,", "rmin = 0.014, rmax = 0.014 / Math.sqrt(0.015),"),
    # Crater depth: rim-to-floor 1.2 depth = 0.198 D, Pike's d/D = 0.196 (params.CRATER_DEPTH_PER_R).
    ("depth = 0.42 * rc * deg,", "depth = 0.33 * rc * deg,"),
    # A rubble pile's relief is slope-limited at the angle of repose (params.repose_lump).
    ("p.D < 40 ? 'Rubble and shattered rock' : 'Fractured rock under regolith';",
     "p.D < 40 ? 'Rubble and shattered rock' : 'Fractured rock under regolith';\n"
     "  if (!p.comet && !fast && p.D >= 0.15 && p.D < 40) lump = clamp(Math.tan(35 * Math.PI / 180)"
     " / (3 * 0.7837077), 0.03, 0.3) * (smooth ? 0.3 : 1);"),
    # Issue #93 2.8 (repeating patterns). A card body passes seed3 (three integers in [0, 256)) and seedHash (the
    # card seed's 32-bit hash) from cardToRock; the artifact's own bodies have neither and draw exactly as before.
    # The noise offset was the seed along (1, 1, 1) (about 97 distinct colour patterns in practice): now a vec3.
    ("uniform float uComet,uFine,uBld,uBright,uScale,uSeed;out vec4 O;",
     "uniform float uComet,uFine,uBld,uBright,uScale,uSeed,uBldV;uniform vec3 uSeed3;out vec4 O;"),
    ("vec3 p=d*rad(d)+uSeed;", "vec3 p=d*rad(d)+uSeed3;"),
    ("pat=fbm(p0*3.+uSeed,4),grain=fbm(p0*44.+uSeed,3);", "pat=fbm(p0*3.+uSeed3,4),grain=fbm(p0*44.+uSeed3,3);"),
    ("gl.uniform1f(u.uSeed, R.p.seed);",
     "gl.uniform1f(u.uSeed, R.p.seed); gl.uniform3fv(u.uSeed3, R.p.seed3 || [R.p.seed, R.p.seed, R.p.seed]); gl.uniform1f(u.uBldV, R.p.seed3 ? 1 : 0);"),
    # Boulders: one candidate per lattice cell made a regular density; a card body gets a second, smaller candidate in
    # about 38 % of the cells, so a cell holds 0, 1 or 2 boulders (artistic).
    ("if(d<1.&&h.y>.34)m=max(m,(1.-d*d)*s);}",
     "if(d<1.&&h.y>.34)m=max(m,(1.-d*d)*s);if(uBldV>.5&&h.z>.62){vec3 h2=h33(ip+g+vec3(41.3,17.9,29.1));float s2=.12+.3*h2.x*h2.x,d2=length(g+h2-fp)/s2;if(d2<1.)m=max(m,(1.-d2*d2)*s2);}}"),
    # Craters: the RNG took seed * 31 + 7 as a 32-bit integer (about 3,000 layouts); a card body seeds it with its
    # full 32-bit hash. Each crater of a card body also gets its own ellipticity (1 to 1.35, mostly near 1), rim
    # height (0.6 to 1.4) and an azimuthal rim wave, from a second stream so the craters' places and sizes are not
    # disturbed (artistic: real elliptical craters are rare, Bottke et al. 2000).
    ("r = rng(p.seed * 31 + 7),", "r = rng(p.seedHash != null ? p.seedHash : p.seed * 31 + 7),"),
    ("cr.sort(function (a, b) { return b - a; });",
     "cr.sort(function (a, b) { return b - a; });\n"
     "  var cvr = p.seedHash != null ? rng(p.seedHash ^ 0x5bd1e995) : null;"),
    ("depth = 0.33 * rc * deg, reach = 2.4 * rc;",
     "depth = 0.33 * rc * deg, reach = 2.4 * rc;\n"
     "    var el = 1, rimK = 1, rph = 0, rk = 0, e1 = null, e2 = null;\n"
     "    if (cvr) { el = 1 + 0.35 * Math.pow(cvr(), 3); rimK = 0.6 + 0.8 * cvr(); rph = cvr() * 6.2832; rk = 2 + Math.floor(cvr() * 4); var ang = cvr() * 3.1416, up = Math.abs(dy) < 0.9 ? [0, 1, 0] : [1, 0, 0], a1 = [up[1] * dz - up[2] * dy, up[2] * dx - up[0] * dz, up[0] * dy - up[1] * dx], al = Math.hypot(a1[0], a1[1], a1[2]); a1 = [a1[0] / al, a1[1] / al, a1[2] / al]; var b1 = [dy * a1[2] - dz * a1[1], dz * a1[0] - dx * a1[2], dx * a1[1] - dy * a1[0]], ca = Math.cos(ang), sa = Math.sin(ang); e1 = [a1[0] * ca + b1[0] * sa, a1[1] * ca + b1[1] * sa, a1[2] * ca + b1[2] * sa]; e2 = [b1[0] * ca - a1[0] * sa, b1[1] * ca - a1[1] * sa, b1[2] * ca - a1[2] * sa]; reach *= el; }"),
    ("d = Math.sqrt(dpx * dpx + dpy * dpy + dpz * dpz) / rc; if (d > 2.4) continue;",
     "d = Math.sqrt(dpx * dpx + dpy * dpy + dpz * dpz) / rc, q1 = 0, q2 = 0;\n"
     "        if (cvr) { q1 = dpx * e1[0] + dpy * e1[1] + dpz * e1[2]; q2 = dpx * e2[0] + dpy * e2[1] + dpz * e2[2]; var q3 = dpx * dx + dpy * dy + dpz * dz; d = Math.sqrt(q1 * q1 / (el * el) + q2 * q2 * el * el + q3 * q3) / rc; }\n"
     "        if (d > 2.4) continue;"),
    ("var prof = d < 1 ? -depth * (1 - d * d) + 0.2 * depth * d * d * d * d : 0.2 * depth * Math.pow(d, -5);",
     "var prof = d < 1 ? -depth * (1 - d * d) + 0.2 * depth * d * d * d * d : 0.2 * depth * Math.pow(d, -5);\n"
     "        if (cvr) { var rimA = rimK * (1 + 0.25 * Math.sin(rk * Math.atan2(q2, q1) + rph)); prof = d < 1 ? -depth * (1 - d * d) + 0.2 * rimA * depth * d * d * d * d : 0.2 * rimA * depth * Math.pow(d, -5); }"),
]


# Issue #93 wave 1 (rocks): performance deviations (PR #101 notes, the red team's B7). Each changed span is marked
# `// @deviation (#93 ...)` ... `// @end-deviation`; the helpers they call are in DEV93W1_TAIL below.
PATCHES_93W1 = [
    # B7: submit the programs, compile in the background, link before the first draw.
    ("  var p = compile(gl, ROCK_VS, ROCK_FS), u = unis(gl, p), pj = compile(gl, JET_VS, JET_FS), uj = unis(gl, pj);",
     r"""// @deviation (#93 B7) the prototype compiled both programs here with compile(), which waits for the driver (1.3 to
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
// @end-deviation"""),
    # 1.7: the jets' fixed data in a static buffer, once.
    ("  for (i = 0; i < 4000; i++) jetD.push([jr(), jr(), jr(), jr()]);",
     r"""  for (i = 0; i < 4000; i++) jetD.push([jr(), jr(), jr(), jr()]);
// @deviation (#93 1.7) the jets' fixed part, once: each particle's four random numbers and its source direction (one of
// six, from rng(1000 + source), jittered and normalised), which the prototype's draw() worked out again every frame.
// JET_VS does the rest, so a frame creates no JavaScript objects (about 12,000 before) and uploads nothing.
  (function () { var a = new Float32Array(4000 * 7), n, o; for (n = 0; n < 4000; n++) { var q = jetD[n], src = Math.floor(q[0] * 6), r2 = rng(1000 + src), z = r2() * 2 - 1, an = r2() * 6.2832, c2 = Math.sqrt(1 - z * z), bx = c2 * Math.cos(an) + (q[1] - 0.5) * 0.28, by = z + (q[2] - 0.5) * 0.28, bz = c2 * Math.sin(an) + (q[3] - 0.5) * 0.28, l2 = Math.hypot(bx, by, bz); o = n * 7; a[o] = q[0]; a[o + 1] = q[1]; a[o + 2] = q[2]; a[o + 3] = q[3]; a[o + 4] = bx / l2; a[o + 5] = by / l2; a[o + 6] = bz / l2; }
    gl.bindVertexArray(jv); gl.bindBuffer(gl.ARRAY_BUFFER, bj); gl.bufferData(gl.ARRAY_BUFFER, a, gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 28, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 16); gl.bindVertexArray(null); })();
// @end-deviation"""),
    # 2.1: count the height-map uploads (the bake runs again after each).
    ("  this.upload = function (b) { gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, b.w, b.h, 0, gl.RG, gl.FLOAT, b.data); };",
     r"""// @deviation (#93 2.1) upGen counts the height-map uploads, so the bake runs again after each (a new body, the age).
  this.upload = function (b) { upGen++; gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, b.w, b.h, 0, gl.RG, gl.FLOAT, b.data); };
// @end-deviation"""),
    # B7 + 2.1: link before the first draw, then bake if anything the bake reads changed.
    ("    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }",
     r"""    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
// @deviation (#93 B7, 2.1) the programs are linked before the first draw (waiting for the driver only when poll() was
// not yet true), then the bake runs if the height map or a shading input changed since the last one.
    link(); if (bake) bake.run(m, tex, upGen);
// @end-deviation"""),
    # 2.1: the baked program reads the cube maps.
    ("    gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_INT, 0);",
     r"""// @deviation (#93 2.1) ROCK_FS_BAKED reads the baked normal, albedo factor and height from the cube maps.
    if (bake) bake.bind(u);
// @end-deviation
    gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_INT, 0);"""),
    # 1.7: the jets in the vertex shader.
    ("""    if (R.p.comet) {
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
    }""",
     r"""// @deviation (#93 1.7) the jets move in the vertex shader (JET_VS): the same particles, ages, speeds and sunlit-side cut
// as the loop the prototype ran here every frame (about 12,000 short-lived objects and a 64 KB upload a frame), in
// float32 instead of float64. Reduced motion draws the first 2,400, as before.
    if (R.p.comet) {
      jm[0] = M[0]; jm[1] = M[3]; jm[2] = M[6]; jm[3] = M[1]; jm[4] = M[4]; jm[5] = M[7]; jm[6] = M[2]; jm[7] = M[5]; jm[8] = M[8];
      gl.useProgram(pj); gl.bindVertexArray(jv);
      gl.uniformMatrix3fv(uj.uM, false, jm); gl.uniform3fv(uj.uAx, m.ax); gl.uniform3fv(uj.uL, L); gl.uniform1f(uj.uT, (R.clock * 0.14) % 1); gl.uniform1f(uj.uSc, sc);
      gl.uniform1f(uj.uAsp, asp); gl.uniform1f(uj.uPx, Math.max(2, h / 200)); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
      gl.drawArrays(gl.POINTS, 0, reduced ? 2400 : 4000); gl.depthMask(true); gl.disable(gl.BLEND);
    }
// @end-deviation"""),
    # 1.7: the jet vertex shader.
    ("""var JET_VS = `#version 300 es
layout(location=0) in vec4 aP;uniform float uAsp,uPx;out float vA;void main(){gl_Position=vec4(aP.x/uAsp,aP.y,aP.z*.3,1.);gl_PointSize=uPx*(1.2+2.2*(1.-aP.w));vA=aP.w;}`;""",
     r"""// @deviation (#93 1.7) JET_VS works out each jet particle from its fixed data (aQ: its four random numbers; aB: its
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
// @end-deviation"""),
]

DEV93W1_TAIL = r"""// @deviation (#93 B7) compileStart / compileDone / compileEnd, as worlds/helpers.js (#93 1.2): submit a program (compile,
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
"""


def header(n0, n1):
    return f'''/* eslint-disable */
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
//   {n0}-{n1}  NOISE          (GLSL noise block)
//   2512-2645  RP, R, radialFn, rockModel, buildRock, ROCK_VS, ROCK_FS, JET_VS, JET_FS, RockGL
var reduced = false;
'''


TAIL = '''
export { R, RP, radialFn, rockModel, buildRock, RockGL, ROCK_VS, ROCK_FS, JET_VS, JET_FS, rng, clamp, BAKE_FS, ROCK_FS_BAKED, setRockBake };
export function setReducedMotion(v) { reduced = v; }
'''


def apply(body, patches):
    for old, new in patches:
        assert body.count(old) == 1, f'patch target not found once: {old!r}'
        body = body.replace(old, new)
    return body


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('SX_PREVIEW_HTML')
    if not src:
        raise SystemExit('usage: extract-rock-engine.py path/to/sculptor-preview-next.html (or set SX_PREVIEW_HTML)')
    L = open(src, encoding='utf-8').read().split('\n')

    def block(a, b):
        return f'// @verbatim L{a}-L{b}\n' + '\n'.join(L[a - 1:b]) + '\n// @end-verbatim\n'

    n0 = 1299
    n1 = next(i for i in range(n0, n0 + 20) if L[i - 1].startswith('`;'))
    assert L[2645 - 1] == '}' and L[2646 - 1].startswith('try { R.gl'), 'prototype moved: update the ranges'
    body = ''.join([block(1268, 1268), block(1273, 1273), block(1292, 1297), block(n0, n1), block(2512, 2645)])
    body = apply(body, PATCHES + PATCHES_93W1) + DEV93W1_TAIL
    open('src/engine/rocks/source.ts', 'w', encoding='utf-8').write(header(n0, n1) + body + TAIL)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Regenerates src/engine/rocks/source.ts from the approved prototype (issue #71, D-37).

Usage: python3 scripts/extract-rock-engine.py [path/to/sculptor-preview-next.html]
Slices by line range, so the engine stays byte-identical to the prototype, then applies PATCHES
(issue #71 review: the physics fixes that mirror backend/app/core/render/params.py). Each patch
must match exactly once, so a moved prototype fails loudly.
"""
import os
import sys

SRC = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('SX_PREVIEW_HTML')
if not SRC:
    raise SystemExit('usage: extract-rock-engine.py path/to/sculptor-preview-next.html (or set SX_PREVIEW_HTML)')
L = open(SRC, encoding='utf-8').read().split('\n')


def rng(a, b):
    return '\n'.join(L[a - 1:b])


n0 = 1299
n1 = next(i for i in range(n0, n0 + 20) if L[i - 1].startswith('`;'))
assert L[2645 - 1] == '}' and L[2646 - 1].startswith('try { R.gl'), 'prototype moved: update the ranges'
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

head = f'''/* eslint-disable */
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
//   1268-1268  clamp          (shared helper)
//   1273-1273  rng            (shared helper)
//   1292-1297  compile, unis  (shared helpers)
//   {n0}-{n1}  NOISE          (GLSL noise block)
//   2512-2645  RP, R, radialFn, rockModel, buildRock, ROCK_VS, ROCK_FS, JET_VS, JET_FS, RockGL
var reduced = false;
'''
def block(a, b):
    return f'// @verbatim L{a}-L{b}\n' + rng(a, b) + '\n// @end-verbatim\n'


body = ''.join([block(1268, 1268), block(1273, 1273), block(1292, 1297), block(n0, n1), block(2512, 2645)])
for old, new in PATCHES:
    assert body.count(old) == 1, f'patch target not found once: {old!r}'
    body = body.replace(old, new)
tail = '''
export { R, RP, radialFn, rockModel, buildRock, RockGL, ROCK_VS, ROCK_FS, JET_VS, JET_FS, rng, clamp };
export function setReducedMotion(v) { reduced = v; }
'''
open('src/engine/rocks/source.ts', 'w', encoding='utf-8').write(head + body + tail)

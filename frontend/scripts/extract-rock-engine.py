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

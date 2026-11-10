#!/usr/bin/env python3
"""Regenerates src/engine/rocks/source.ts from the approved prototype (issue #71, D-37).

Usage: python3 scripts/extract-rock-engine.py [path/to/sculptor-preview-next.html]
Slices by line range, so the engine stays byte-identical to the prototype.
"""
import sys

SRC = (sys.argv[1] if len(sys.argv) > 1 else
       '/home/moon/Desktop/Projects/SphereX/.claude/worktrees/sculptor-reference/sculptor-preview-next.html')
L = open(SRC, encoding='utf-8').read().split('\n')


def rng(a, b):
    return '\n'.join(L[a - 1:b])


n0 = 1298
n1 = next(i for i in range(n0, n0 + 20) if L[i - 1].startswith('`;'))
assert L[2505 - 1] == '}' and L[2506 - 1].startswith('try { R.gl'), 'prototype moved: update the ranges'
head = f'''/* eslint-disable */
// @ts-nocheck
// Issue #71, D-37 (stream V3): the approved prototype's rock engine, copied MECHANICALLY and unchanged
// from /sculptor-preview-next.html (the `#rocks` section) by `scripts/extract-rock-engine.py`.
// Do not edit by hand: change the script or the prototype and run it again. Only TypeScript wrapping
// (this header, the shim below and the exports at the end) differs from the prototype; the DOM
// and UI code (`pills`, `rockUi`, the event handlers) is not copied.
//   1267-1267  clamp          (shared helper)
//   1272-1272  rng            (shared helper)
//   1291-1296  compile, unis  (shared helpers)
//   {n0}-{n1}  NOISE          (GLSL noise block)
//   2372-2505  RP, R, radialFn, rockModel, buildRock, ROCK_VS, ROCK_FS, JET_VS, JET_FS, RockGL
var reduced = false;
'''
def block(a, b):
    return f'// @verbatim L{a}-L{b}\n' + rng(a, b) + '\n// @end-verbatim\n'


body = ''.join([block(1267, 1267), block(1272, 1272), block(1291, 1296), block(n0, n1), block(2372, 2505)])
tail = '''
export { R, RP, radialFn, rockModel, buildRock, RockGL, ROCK_VS, ROCK_FS, JET_VS, JET_FS, rng, clamp };
export function setReducedMotion(v) { reduced = v; }
'''
open('src/engine/rocks/source.ts', 'w', encoding='utf-8').write(head + body + tail)

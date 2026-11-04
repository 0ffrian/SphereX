---
name: sx-design-review
description: Design review of Shift & Spectrum UI, 3D viewer, haptics/sound or the mock-up — honesty labels, accessibility (WCAG/R9), mobile Touch mode, copy and visual quality. Pass --fix to apply fixes.
argument-hint: "[paths | mockup | PR number] [--fix]"
---

# /sx-design-review

Design-review `$ARGUMENTS`. Don't ask for permission.

1. Work out the target:
   - `mockup` → `mockup/spherex-ui.html`
   - a PR number → its diff (`gh pr diff`)
   - paths → those files
   - nothing → the changed UI files in the working tree
2. Launch these in parallel:
   - `design-reviewer` with the target (and `--fix` if given)
   - `accessibility-tester` for a WCAG 2.2 AA pass on the same target
   - `ux-microcopy-reviewer` for labels, errors and empty states, written for a non-astronomer public audience
3. If haptics or sound changed, also launch `haptics-audio-engineer` to check against R8 (rate limits, quantised levels, audio pairing, the honesty silence rule, Q-11).
4. Merge the results into one list ranked by user impact. Note anything that needs a real-device check (Android Chrome haptics, phone layout).

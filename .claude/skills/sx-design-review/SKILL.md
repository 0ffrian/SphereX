---
name: sx-design-review
description: Design review of Shift & Spectrum UI, 3D viewer, sound or the mock-up — design language (D-38), honesty labels, accessibility (WCAG/R9), copy and visual quality. Pass --fix to apply fixes.
argument-hint: "[paths | mockup | PR number] [--fix]"
---

# /sx-design-review

Design-review `$ARGUMENTS`. Don't ask for permission.

0. Load the `sx-design-language` skill first and pass `docs/design-language.md` (D-38) to every reviewer: it is the rulebook for look and feel, and it wins over the mock-up.

1. Work out the target:
   - `mockup` → `mockup/spherex-ui.html` (and `mockup/chase-the-rock.html` for Track)
   - a PR number → its diff (`gh pr diff`)
   - paths → those files
   - nothing → the changed UI files in the working tree
2. Launch these in parallel:
   - `design-reviewer` with the target (and `--fix` if given), checking the design-language section of its checklist
   - `accessibility-tester` for a WCAG 2.2 AA pass on the same target
   - `ux-microcopy-reviewer` for labels, errors and empty states, written for a non-astronomer public audience
3. If sound changed, also launch `sound-engineer` to check against R8.3, R8.8, R8.9 and R13 (the rate cap, audio pairing, the Track path sound R8.9.2, the honesty silence rule, pitch polarity Q-430, Q-132, Q-134, D-39).
4. Merge the results into one list ranked by user impact. Note anything that needs a listening or real-device check: the A15 laptop in desktop Chrome (Q-132); the phone layout is secondary.

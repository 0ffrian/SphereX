---
name: sx-verify
description: Resolve [verify] items and open fact questions in Shift & Spectrum docs with cited primary sources (astro-verifier), optionally applying resolved values back into the docs via spec-keeper.
argument-hint: "[item | all] [--apply]"
---

# /sx-verify

Resolve `$ARGUMENTS` (default `all`). Don't ask for permission.

1. Launch `astro-verifier` with the item list, or "all". It returns a table of resolved values with citations, plus the items it could not resolve.
2. With `--apply`, launch `spec-keeper` with that table:
   - replace each resolved **[verify]** marker with the value and its citation
   - leave unresolved items marked
   - add any new contradictions as `Q-` entries
3. Report what was resolved, with its sources, what is still open, and which items need a real-device test (haptics or audio on the realme 14 Pro and the Samsung). Do not use any value that has no citation.

---
name: sx-spec-sync
description: Keep Shift & Spectrum docs consistent after a change — section maps, routing table, cross-links, UML diagrams, decisions log — and validate links and Mermaid. Use after editing docs/ or changing a contract in code.
argument-hint: "[what changed, or blank to check everything]"
---

# /sx-spec-sync

Sync the docs for: `$ARGUMENTS` (blank means a full consistency check). Don't ask for permission.

1. Launch `spec-keeper` with the description of what changed. If no description was given, ask it for a full audit:
   - every `A`/`R` section has a section-map entry
   - every routing-table file exists
   - no stale file names remain
   - the diagrams in `docs/uml/` still match the class and type definitions in `docs/rendering/data-contract.md` and `docs/rendering/haptics/engine-api.md`
   - `docs/decisions.md` has no orphaned `D-`/`Q-` references
2. If the change was in code, give the agent the diff (`git diff HEAD`) so it can find contract drift.
3. Report the files changed, the decisions or questions added, the link-check count and problems, and the Mermaid validation result.

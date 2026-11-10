---
name: sx-spec-sync
description: Keep Shift & Spectrum docs consistent after a change — section maps, routing table, cross-links, UML diagrams, decisions log — and validate links and Mermaid. Use after editing docs/ or changing a contract in code.
argument-hint: "[what changed, or blank to check everything]"
---

# /sx-spec-sync

Sync the docs for: `$ARGUMENTS` (blank means a full consistency check). Don't ask for permission.

1. Launch `spec-keeper` with the description of what changed. If no description was given, ask it for a full audit:
   - **Decisions index:** every `D-`/`Q-` entry in `docs/decisions/<topic>.md` has exactly one row in the index `docs/decisions/README.md`, and every index row points at an entry that exists in that topic file
   - **No orphan IDs:** every `D-`/`Q-`/`B-` ID cited anywhere in `docs/`, `CLAUDE.md`, the READMEs and `.claude/` exists in `docs/decisions/`; no ID is defined twice across the topic files
   - **Section maps vs headings:** every `A`/`R` heading has exactly one row in its spec's section map, with the right file, anchor and title, and no row points at a missing heading
   - **Header lines:** every fragment in `docs/architecture/**` and `docs/rendering/**` starts with `> **Part of:** … · **Sections:** … · **Implements:** … · **Read with:** …`, and its Sections value matches its headings
   - **Size:** every fragment is at most about 150 lines and about 20 KB (indexes excepted); list the ones over
   - **Routing:** every file in the routing table of `docs/README.md` exists, every fragment appears in at least one row, and each row names its decision topic files
   - **Links and anchors:** every relative link and `#anchor` resolves (GitHub slug rules); no stale file names remain
   - **Mermaid:** every block in `docs/uml/` and the specs parses; no `;` inside a sequence message, note or `alt`/`opt` label
   - **UML vs specs:** the diagrams in `docs/uml/` still match the class and type definitions in `docs/rendering/data-contract.md` and `docs/rendering/haptics/engine-api.md`, the endpoint register (A4.11) and the shell (A21)
2. If the change was in code, give the agent the diff (`git diff HEAD`) so it can find contract drift.
3. Report the files changed, the decisions or questions added, the link-check count and problems, and the Mermaid validation result.

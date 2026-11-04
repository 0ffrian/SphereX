---
name: sx-code-review
description: Review local Shift & Spectrum changes (or given paths) for bugs and spec violations using the project code-reviewer, with optional security and performance passes. Pass --fix to apply confirmed fixes.
argument-hint: "[paths...] [--fix] [--deep]"
---

# /sx-code-review

Review `$ARGUMENTS` (default: the uncommitted diff plus untracked files). Don't ask for permission.

1. Determine the target: the named paths, or `git diff HEAD`, `git diff --cached` and the untracked files.
2. Launch `code-reviewer` on the target. Pass `--fix` through if the user gave it.
3. With `--deep`, also run these in parallel:
   - `security-auditor`: secrets, the Gemini key server-side, CORS proxy and input handling
   - `performance-engineer`: D-05 budgets, no per-frame noise, disposal of three.js and Web Audio resources
   - `accessibility-tester`: only if UI files changed
4. Merge the results. Remove duplicates and rank by severity.
5. If fixes were applied, run the tests and type check and report the results.

**Output:** a ranked list of findings, each with `file:line`, the defect, its failure scenario and the spec reference. Then state what was fixed and what is left. End with "No blocking issues" when that's true.

---
name: sx-implement
description: Auto-implement a Shift & Spectrum task end to end. Runs auto-implementer (with a specialist when one fits), then code-reviewer with fixes, design-reviewer for UI/haptics changes, and spec-keeper for doc/UML sync. Use when the user asks to build, add or implement a feature.
argument-hint: "<task description> [--commit] [--no-review]"
---

# /sx-implement

Implement `$ARGUMENTS` for Shift & Spectrum. Run the whole pipeline without asking for permission or confirmation. Make reasonable choices and report them at the end.

## Steps

1. **Scope.** Restate the task in one line. Pick the decision topic files and the spec fragments from the task's row in the routing table of `docs/README.md` (after the decisions index `docs/decisions/README.md`). If the task is large, split it into independent sub-tasks.

2. **Implement.** Launch the `auto-implementer` agent with the task, the fragment list and any user constraints. Add a specialist agent alongside it when one clearly fits:
   - haptics or sound: `haptics-audio-engineer`
   - three.js or WebGL rendering: `game-developer`
   - React UI: `react-specialist`
   - Python pipeline or baker: `python-pro`
   - API endpoints: `fastapi-developer` (FastAPI, D-15) or `backend-developer`

   Independent sub-tasks may run in parallel, one agent each, on separate files.

3. **Review and fix.** Unless `--no-review` was passed, launch `code-reviewer` with "review the current diff and fix confirmed issues (--fix)".

   If the change touches `frontend/` UI, the viewer, haptics or audio, also launch `design-reviewer` with `--fix`. Run the two reviewers in parallel.

4. **Docs.** If any contract, type, endpoint, file layout or decision changed, launch `spec-keeper` to update the fragments, section maps and `docs/uml/` diagrams, and to validate the links.

5. **Verify.** Run the project's tests, type check and lint yourself (whatever is configured in `frontend/package.json` or `backend/pyproject.toml`). Report the real results.

6. **Commit (only with `--commit`).** Create a branch `feat/<short-slug>` if you are on `main`, stage the changed files explicitly, and commit with a clear message. Never push.

## Report to the user

- What was built (files, spec sections).
- Test, type and lint results, as numbers.
- Review findings: fixed, and left open.
- Assumptions and **[verify]** items.
- The doc and diagram updates.

Keep it short.

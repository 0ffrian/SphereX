---
name: sx-pr-review
description: Review a GitHub pull request on 0ffrian/SphereX with the project pr-reviewer (scope, correctness, decisions, docs/UML sync, tests, ownership). Pass --comment to post the review to GitHub.
argument-hint: "<PR number or URL> [--comment] [--deep]"
---

# /sx-pr-review

Review PR `$ARGUMENTS`. Don't ask for permission.

1. Parse the PR number. If none was given, use `gh pr list --state open` and review the most recent PR that is not from the current user, or the one for the current branch (`gh pr view --json number`).
2. Launch `pr-reviewer` with the PR number. Pass on whether `--comment` was given: if it was, the agent posts one review; otherwise it only reports.
3. With `--deep`:
   - also launch `code-reviewer` on the PR diff (check it out into a worktree with `gh pr checkout <n>` inside `git worktree add`, or review the diff text)
   - launch `design-reviewer` if the PR touches UI, the viewer, haptics or audio

   Merge their findings into the verdict.
4. Report the verdict, the blocking issues, the nits, the docs to update and the suggested reviewers. If posted, include the review URL.

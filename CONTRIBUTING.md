# Contributing

**Work on `dev`.** `dev` is the development branch and the default branch: make your branch from `dev` and open your pull request against `dev`. `main` is frozen at the event build (decision D-42): nothing is merged into it.

Every change reaches `dev` through a pull request. Nobody pushes, force-pushes or deletes `dev` or `main`, admins included.

## Your first PR

New here? Start from an issue labelled `good first issue`. Each one lists what to read first and who mentors it.

1. **Ask first.** Comment on the issue that you'd like to take it, then wait for Atish (`JoottunAtish`) to assign it to you. Don't start before it is assigned: someone else may already have it.
2. **Get the code.** If you have write access, clone `https://github.com/0ffrian/SphereX.git`. If you don't, fork it on GitHub and clone your fork. Then follow the install steps in the [README](README.md#install-and-run-step-by-step).
3. **Branch from `dev`**, never from `main`: `git switch -c docs/<n>-<slug> origin/dev`. Use `feat/`, `fix/`, `docs/` or `chore/` as the prefix. In a fork, add this repo as `upstream` and branch from `upstream/dev`.
4. **Make the change** and keep to the issue's Scope. If something is listed under Out of scope, leave it for another issue.
5. **Run the checks** for the part you changed (see "Other commands" in the [README](README.md#other-commands-for-developers)): `npm run check` for `frontend/`, `npm run backend:check` for `backend/`. Docs-only changes need neither.
6. **Open the PR against `dev`.** Title it `Issue-<n>: <title>` and put `Closes #<n>` in the body, where `<n>` is the issue number. For example: `Issue-206: Add a "Your first PR" section`.
7. **Wait for CI and review.** If you opened the PR from a fork, a maintainer must approve your CI run before it starts. Then the merge rules below apply.

Stuck at any step? Ask in the issue. That is what the Mentor is for.

## What a PR needs to merge

1. **`ci-gate` is green.** It is the only required check and runs on every PR. The backend and frontend checks run only when their files change; when they are skipped, `ci-gate` still reports.
2. **One approval** from someone with write access who is **not the PR author** and **did not push its last commit**.
3. **A code owner's approval** for every owned file the PR touches (see the map below). A PR that touches only open paths needs no code owner.
4. **All review threads resolved.**

A new push after an approval dismisses it, so ask for a fresh review.

**One code owner is enough.** GitHub requests a review from every owner listed for the files, but one approval from any of them covers those files. You don't need all three.

**"Changes requested" blocks the merge until that reviewer re-reviews.** If one owner approves and another requests changes, the PR can't merge. New pushes don't clear it: only approvals are dismissed on push. The reviewer who requested changes must review again and approve (PR page → **Re-request review** to ask them). Don't dismiss someone's review to get round it; if they're away and it's urgent, say so in the PR and agree it with another owner first.

## Merging: the merge queue

When the PR is approved and green, press **Merge when ready**. GitHub adds it to the merge queue, combines it with the latest `dev` (and any PRs ahead of it), runs `ci-gate` again on that combined commit, and merges only if it passes. If it fails, the PR leaves the queue and stays open, and the PR page shows why. Two PRs that pass on their own can't break `main` together, and you never need to update your branch just to merge it.

## Who owns what

The file that enforces this is [.github/CODEOWNERS](.github/CODEOWNERS) (decision Q-484 in [docs/decisions/scope-process.md](docs/decisions/scope-process.md)).

| Path | Lead | Backups |
|---|---|---|
| `docs/` (incl. `docs/architecture/`) | Atish, Moon, Kevin (equal) | none needed |
| `backend/` | Kevin | Atish, Moon |
| `mockup/` | Atish, Moon | Kevin |
| `.claude/` (skills, agents), `CLAUDE.md` | Atish | Moon, Kevin |
| `frontend/` | **open**: any reviewer with write access | none |
| Moon's UI design: `frontend/src/components/`, `frontend/src/index.css`, `frontend/components.json`, `docs/design-language.md` | Moon | Atish, Kevin |
| `frontend/package.json`, `frontend/package-lock.json` (dependencies) | all three | none needed |
| `.github/` (CI, CODEOWNERS), `CONTRIBUTING.md` | all three | none needed |
| Everything else (`shared/`, `README.md`, any new folder) | all three | none needed |

GitHub: Atish is `JoottunAtish`, Moon is `MintHerbs`, Kevin is `KevinYerkiah`.

**Leads and backups.** GitHub can't mark a lead: it requests a review from every owner on the line, and any one of them can approve. By convention the lead reviews. A backup reviews when the lead wrote the PR or is away. Without backups a lead's own PR could never merge, because nobody can approve their own PR.

**Open paths.** A PR that touches only open paths can be approved by any collaborator with write access, code owner or not. Ask them in the PR sidebar under **Reviewers**. An approval from someone with read or triage access doesn't count. If the PR also touches an owned file, that file still needs its code owner.

The D-17 owners in [docs/decisions/scope-process.md](docs/decisions/scope-process.md) still lead the work in their areas, inside `frontend/` too. This table only decides who can approve the merge.

## Rules

- Make your branch from `dev` (`git switch -c feat/<slug> origin/dev`; also `fix/…`, `docs/…`, `chore/…`) and open the PR against `dev`. A PR against `main` is closed or retargeted.
- Title every PR `Issue-<n>: <title>`, where `<n>` is the issue it closes, and put `Closes #<n>` in the body. No issue yet? Open one first.
- Issues are drafted and approved by their author before they are created. Claude sessions follow this through `/sx-ticket` (see "Tickets" in [CLAUDE.md](CLAUDE.md)) and never create issues on their own.
- One person, one GitHub account. Never approve your own work from a second account.
- Don't hand-edit generated code (`frontend/src/contract/`, `backend/app/contract/`). CI fails if it differs from `shared/schemas/`.
- Fork PRs from outside contributors wait for a maintainer to approve their CI run.

## Emergencies

Admins and maintainers (Atish, Moon, Kevin) can override the rules on a PR. The merge box shows **Merge without waiting for requirements to be met (bypass rules)**. It merges without the approvals, the code-owner review or a green `ci-gate`. Use it only when a fix can't wait, and **say why in the PR** before you merge. GitHub records every bypass on the PR and in the ruleset's insights.

The override works only through a PR. Nobody can push straight to `dev` or `main`, force-push them or delete them. Don't disable the ruleset to get round that.

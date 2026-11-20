# Contributing

Every change reaches `main` through a pull request. Nobody pushes, force-pushes or deletes `main`, admins included.

## What a PR needs to merge

1. **`ci-gate` is green.** It is the only required check and runs on every PR. The backend and frontend checks run only when their files change; when they are skipped, `ci-gate` still reports.
2. **One approval** from someone with write access who is **not the PR author** and **did not push its last commit**.
3. **A code owner's approval** for every owned file the PR touches (see the map below). A PR that touches only open paths needs no code owner.
4. **All review threads resolved.**

A new push after an approval dismisses it, so ask for a fresh review.

**One code owner is enough.** GitHub requests a review from every owner listed for the files, but one approval from any of them covers those files. You don't need all three.

**"Changes requested" blocks the merge until that reviewer re-reviews.** If one owner approves and another requests changes, the PR can't merge. New pushes don't clear it: only approvals are dismissed on push. The reviewer who requested changes must review again and approve (PR page → **Re-request review** to ask them). Don't dismiss someone's review to get round it; if they're away and it's urgent, say so in the PR and agree it with another owner first.

## Merging: the merge queue

When the PR is approved and green, press **Merge when ready**. GitHub adds it to the merge queue, combines it with the latest `main` (and any PRs ahead of it), runs `ci-gate` again on that combined commit, and merges only if it passes. If it fails, the PR leaves the queue and stays open, and the PR page shows why. Two PRs that pass on their own can't break `main` together, and you never need to update your branch just to merge it.

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

- Work on a branch (`feat/…`, `fix/…`, `docs/…`, `chore/…`) and open a PR.
- One person, one GitHub account. Never approve your own work from a second account.
- Don't hand-edit generated code (`frontend/src/contract/`, `backend/app/contract/`). CI fails if it differs from `shared/schemas/`.
- Fork PRs from outside contributors wait for a maintainer to approve their CI run.

## Emergencies

Admins and maintainers (Atish, Moon, Kevin) can override the rules on a PR. The merge box shows **Merge without waiting for requirements to be met (bypass rules)**. It merges without the approvals, the code-owner review or a green `ci-gate`. Use it only when a fix can't wait, and **say why in the PR** before you merge. GitHub records every bypass on the PR and in the ruleset's insights.

The override works only through a PR. Nobody can push straight to `main`, force-push it or delete it. Don't disable the ruleset to get round that.

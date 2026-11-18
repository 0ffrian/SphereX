# Plan: code owners, required CI and `main` protection

Status (18 Nov 2026): step 1 done (alt accounts removed; fork-PR CI approval set to `all_external_contributors`). Step 2 built on `chore/ci-gate`; steps 3–4 built on `chore/codeowners`. Neither pushed. **Step 5 done early** (ruleset `main`, id 27523962, active, no bypass, `ci-gate` pinned to app 15368, verified from a real check run): the `chore/ci-gate` PR reports `ci-gate` from its own run, so it can merge; other PRs report `ci-gate` only once `ci.yml` is on `main` and they are updated. Step 5b (merge queue) waits for the `chore/ci-gate` PR. Steps 6–7 not started.
Delete this file in the last PR (step 7); the lasting rules go into `CONTRIBUTING.md`.

## 0. Starting state (checked 18 Nov 2026)

| Item | Now |
|---|---|
| Repo | `0ffrian/SphereX`, **public**, org on the **free** plan (rulesets and branch protection are available for public repos) |
| `main` protection | **none** (no branch protection, no rulesets). Anyone with write access can push to `main` today. |
| CODEOWNERS | none |
| CI | `backend.yml` (job `ruff, mypy, pytest (offline)`), `frontend.yml` (jobs `typecheck, lint, test, build` and `playwright (chromium)`). Both are **path-filtered**. |
| Actions | enabled, all actions allowed, SHA pinning not required |
| Collaborators | `JoottunAtish` admin (org member), `MintHerbs` admin (org member), `KevinYerkiah` **maintain, outside collaborator**, `atish-syntarengine` admin (outside), `munazir-syntarengine` admin (outside) |
| Org teams | none |
| Open PRs | #182 (MintHerbs) |

## 1. Target behaviour

1. Nobody pushes, force-pushes or deletes `main`. Every change goes through a PR, admins included.
2. Every owned area has a **lead** and **backups** (section 1a). A PR touching an owned path needs an approval from **one of that area's owners who is not the PR author and not the last pusher**. Backups exist so a lead's own PR can always be approved (GitHub blocks self-approval, and the ruleset has no bypass).
3. **Open paths** have no code owner: `frontend/` (except Moon's UI-design files). A PR that touches *only* open paths can be approved by **any reviewer with write access**, code owner or not. That is how non-code-owners review each other's work there.

### 1a. Ownership map (agreed 18 Nov 2026)

| Path | Lead | Backups | Notes |
|---|---|---|---|
| `/docs/` (incl. `docs/architecture/`) | Atish, Moon, Kevin (equal) | — | all three |
| `/backend/` | Kevin | Atish, Moon | |
| `/mockup/` | Atish, Moon | Kevin | |
| `/.claude/` (skills, agents) | Atish | Moon, Kevin | |
| `/CLAUDE.md` | Atish | Moon, Kevin | |
| `/frontend/` | **open** | — | any write-access reviewer |
| Moon's UI design: `/frontend/src/components/`, `/frontend/src/index.css`, `/frontend/components.json` | Moon | Atish, Kevin | owned inside the open `frontend/` |
| `/docs/design-language.md` | Moon | Atish, Kevin | inside docs, Moon leads |
| `/frontend/package.json`, `/frontend/package-lock.json` | all three | — | **proposed**: dependency changes in a public repo stay owned (supply chain); drop if you want `frontend/` fully open |
| `/.github/` (CI, CODEOWNERS) | all three | — | |
| everything else (`shared/`, `README.md`, root `package.json`, any new folder) | all three | — | the `*` default; new folders start owned, never open |

**What "lead" means on GitHub:** CODEOWNERS can't mark a lead. GitHub requests a review from **every** owner on the line, and any one of them can approve. The lead is listed first, and `CONTRIBUTING.md` says the lead reviews by default and the backups step in when the lead is the author or away. In practice every owned path has the same three owners; the only real difference between areas is open versus owned.

**Departs from D-17:** `frontend/src/sound/` and `viewer/fields/` (Atish) and `frontend/src/app/`, `state/` (Moon) are open under this map. The D-17 owners stay in charge of the work itself; only the merge gate is open. Record this as a `Q-` entry in `docs/decisions/scope-process.md` in step 4.
4. A PR touching both open and owned paths still needs a code owner (GitHub checks code owners per file).
5. One required check, `ci-gate`, always reports on every PR, so a docs-only PR is never stuck on "Expected — waiting for status".
6. A new push after approval dismisses the approval.
7. The ownership file and CI are always owned, so nobody can "open" them to dodge review.

## 2. Pitfalls this plan is built around

| # | Pitfall | Guard |
|---|---|---|
| P1 | CODEOWNERS entries for users **without write access are silently ignored**. | All three have write+ (Kevin is `maintain`). Step 6 runs the `codeowners/errors` API, which flags unknown or unwritable owners. |
| P2 | **Org teams can't hold outside collaborators**; Kevin is one. | List the three users by name, not a team. (A team is possible later if Kevin joins the org.) |
| P3 | **Last matching line wins** in CODEOWNERS. An open-path line placed after the governance lines would un-own them. | Order: catch-all, then open paths, then governance re-owned **at the very end**. Test T7. |
| P4 | **Path-filtered required checks never report** on PRs that skip them, so the PR waits forever. | Single `ci.yml` with an always-running `ci-gate` job; the real jobs are skipped, not absent. Test T3. |
| P5 | A required check name can be **spoofed** by any app or commit status with the same name. | Pin the required check to the GitHub Actions app (`integration_id` 15368 **[verify]** in step 5). |
| P6 | **Alt accounts**: `atish-syntarengine` / `munazir-syntarengine` are admins. They are not code owners, so they can't satisfy owner review on owned paths, but they **can approve their own person's PR on open paths**, and as admins they can edit or disable the ruleset. | Decision D-B below. Recommended: drop both to `read` (or remove). Test T2. |
| P7 | Approvals from users with only read/triage access **don't count** towards required approvals. | Non-code-owners who should review open paths get the `write` role. Test T4. |
| P8 | CODEOWNERS only takes effect **from the base branch** (`main`). | Merge CODEOWNERS before switching on the ruleset; the PR adding it is not governed by itself. |
| P9 | A check must have **run at least once** before the ruleset UI offers it. | Merge `ci.yml` first (step 2), then create the ruleset. |
| P10 | **Open PRs** (#182) won't have `ci-gate` until they get a new run. | After step 5, push or merge `main` into #182 (or re-run its checks). |
| P11 | Public repo: **fork PRs** run Actions. | Keep `permissions: contents: read`, never `pull_request_target`, set fork-PR approval to "all outside collaborators". |
| P12 | Ruleset "Evaluate" (dry-run) mode is **Enterprise-only**. | No dry run on free: enable directly, then run the test matrix (step 6) straight away; rollback is one toggle. |
| P13 | With 3 owners and self-approval blocked, if two are away a PR stalls. | Accepted. Emergency path: an admin disables the ruleset, merges, re-enables (all in the audit log), and says so in the PR. |

## 3. Decisions needed before building

| ID | Question | Recommendation |
|---|---|---|
| D-A | Which paths are **open** (no code owner)? | **Decided (Atish, 18 Nov 2026):** section 1a. Still open: (1) is "Moon's UI design" exactly `components/`, `index.css`, `components.json` and `design-language.md`? (2) keep `frontend/package*.json` owned? |
| D-B | Alt accounts `atish-syntarengine`, `munazir-syntarengine`? | **Done (Atish, 18 Nov 2026):** both removed from the repo. Collaborators now: `JoottunAtish` admin, `MintHerbs` admin, `KevinYerkiah` maintain. P6 and test T2 no longer apply. |
| D-C | Who are the **non-code-owner reviewers**, if any exist yet? | Add them with the `write` role when named (P7). None exist today besides the alt accounts. |
| D-D | Bypass list on the ruleset? | **Empty** (no bypass, admins included). Emergencies follow P13. |
| D-E | Require the branch to be up to date before merging? | **No**. It causes rebase churn; `ci-gate` already runs on the merge commit. |
| D-F | Allowed merge methods? | Keep all three (history uses merge commits today). |

## 4. Rollout, one PR per step (branch → PR → review → merge)

### Step 1: access clean-up (GitHub settings, Atish as admin)
- Apply D-B and D-C.
- Settings → Actions → General → "Fork pull request workflows from outside collaborators": **Require approval for all outside collaborators** (P11).

### Step 2: PR `chore/ci-gate`: one always-on CI entry point
- Turn `backend.yml` and `frontend.yml` into reusable workflows: replace their `on:` block with `on: workflow_call:`. Jobs and steps unchanged.
- Add `.github/workflows/ci.yml`:

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      backend: ${{ steps.f.outputs.backend }}
      frontend: ${{ steps.f.outputs.frontend }}
      codeowners: ${{ steps.f.outputs.codeowners }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - id: f
        env:
          BASE: ${{ github.event.pull_request.base.sha || github.event.before }}
        run: |
          # Fail safe: if the diff can't be computed, run everything.
          if files=$(git diff --name-only "$BASE"...HEAD 2>/dev/null) && [ -n "$BASE" ]; then :; else
            echo "backend=true" >> "$GITHUB_OUTPUT"; echo "frontend=true" >> "$GITHUB_OUTPUT"
            echo "codeowners=true" >> "$GITHUB_OUTPUT"; exit 0; fi
          ci='^\.github/workflows/'
          echo "backend=$(grep -qE "^(backend|shared)/|$ci" <<<"$files" && echo true || echo false)" >> "$GITHUB_OUTPUT"
          echo "frontend=$(grep -qE "^(frontend|shared)/|$ci" <<<"$files" && echo true || echo false)" >> "$GITHUB_OUTPUT"
          echo "codeowners=$(grep -qx '.github/CODEOWNERS' <<<"$files" && echo true || echo false)" >> "$GITHUB_OUTPUT"
  backend:
    needs: changes
    if: needs.changes.outputs.backend == 'true'
    uses: ./.github/workflows/backend.yml
  frontend:
    needs: changes
    if: needs.changes.outputs.frontend == 'true'
    uses: ./.github/workflows/frontend.yml
  codeowners:
    needs: changes
    if: needs.changes.outputs.codeowners == 'true' && github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - env:
          GH_TOKEN: ${{ github.token }}
        run: |
          n=$(gh api "repos/${{ github.repository }}/codeowners/errors?ref=${{ github.event.pull_request.head.sha }}" --jq '.errors | length')
          [ "$n" = 0 ] || { gh api "repos/${{ github.repository }}/codeowners/errors?ref=${{ github.event.pull_request.head.sha }}"; exit 1; }
  gate:
    name: ci-gate
    needs: [changes, backend, frontend, codeowners]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - run: |
          echo '${{ toJSON(needs) }}'
          [ "${{ needs.changes.result }}" = success ] || exit 1
          ${{ contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled') }} && exit 1 || exit 0
```

- Skipped jobs count as pass; failure or cancel in any job fails `ci-gate`; a broken `changes` job fails it too.
- Pin `actions/*` to commit SHAs in the same PR (CLAUDE.md "pinned versions only"); tags shown above for readability.
- Accept when: on the PR, `ci-gate` is green, and a second test commit that only touches `docs/` shows `backend`/`frontend` **skipped** and `ci-gate` **green**.

### Step 3: PR `chore/codeowners`: the ownership file
`.github/CODEOWNERS` (D-A applied):

```
# Order matters: the LAST matching line wins.
# Lead first, then backups. GitHub requests all of them; any one can approve.
# Map and reasons: CONTRIBUTING.md.

# 1. Default: anything not listed below (shared/, README.md, new folders).
*                               @JoottunAtish @MintHerbs @KevinYerkiah

# 2. Areas.
/docs/                          @JoottunAtish @MintHerbs @KevinYerkiah
/backend/                       @KevinYerkiah @JoottunAtish @MintHerbs
/mockup/                        @JoottunAtish @MintHerbs @KevinYerkiah

# 3. Open: no owner. Any reviewer with write access can approve.
/frontend/

# 4. Owned inside open frontend/ (must come after line 3).
/frontend/src/components/       @MintHerbs @JoottunAtish @KevinYerkiah
/frontend/src/index.css         @MintHerbs @JoottunAtish @KevinYerkiah
/frontend/components.json       @MintHerbs @JoottunAtish @KevinYerkiah
/frontend/package.json          @JoottunAtish @MintHerbs @KevinYerkiah
/frontend/package-lock.json     @JoottunAtish @MintHerbs @KevinYerkiah
/docs/design-language.md        @MintHerbs @JoottunAtish @KevinYerkiah

# 5. Governance. Keep this block LAST so no rule above can un-own it.
/.claude/                       @JoottunAtish @MintHerbs @KevinYerkiah
/CLAUDE.md                      @JoottunAtish @MintHerbs @KevinYerkiah
/.github/                       @JoottunAtish @MintHerbs @KevinYerkiah
```

- Generated code: `frontend/src/contract/` is open, but CI's `npm run contract:check` fails if it differs from `shared/schemas/` (owned), so a hand edit can't merge.

- Before merging: `gh api "repos/0ffrian/SphereX/codeowners/errors?ref=chore/codeowners"` returns `{"errors":[]}` (also enforced by the step 2 `codeowners` job).
- On the PR's "Files changed" tab, hover the shield icon: a `backend/` file names Kevin first; `frontend/src/app/` has no owner; `frontend/src/components/` names Moon first.

### Step 4: CONTRIBUTING.md and CLAUDE.md (can ride with step 3)
- `docs/decisions/scope-process.md` (+ index row): a `Q-` entry recording section 1a and where it departs from D-17 (use the next free Q- number on `main`).
- `CONTRIBUTING.md`: the section 1a table, the lead/backup convention (lead reviews by default; a backup reviews when the lead is the author or away), the open paths, how to request a review (PR sidebar → Reviewers), "never approve your own work via a second account", the emergency path (P13).
- `CLAUDE.md` "Git workflow": add that `main` is protected, merges need `ci-gate` + a code-owner approval, and that agents must not try to bypass it.

### Step 5: ruleset on `main` (GitHub settings, Atish as admin, after steps 2 and 3 are merged)
Create via `gh api -X POST repos/0ffrian/SphereX/rulesets --input ruleset.json`:

```json
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": true,
        "require_last_push_approval": true,
        "required_review_thread_resolution": true,
        "allowed_merge_methods": ["merge", "squash", "rebase"] } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [ { "context": "ci-gate", "integration_id": 15368 } ] } }
  ]
}
```

- **[verify]** `integration_id` 15368 is the GitHub Actions app: read it back with `gh api repos/0ffrian/SphereX/commits/<sha>/check-runs --jq '.check_runs[] | select(.name=="ci-gate") | .app.id'` on any merged commit, and use that number.
- Then re-trigger #182 (P10).
- Rollback: `gh api -X PUT repos/0ffrian/SphereX/rulesets/<id> -f enforcement=disabled`.

### Step 5b: merge queue (after the `chore/ci-gate` PR, which adds the `merge_group` trigger, is on `main`)
Enabling it earlier would leave queued PRs waiting for a `ci-gate` that never runs. Add this rule to ruleset 27523962 (GET it, append to `rules`, PUT it back):

```json
{ "type": "merge_queue", "parameters": {
    "merge_method": "MERGE",
    "grouping_strategy": "ALLGREEN",
    "max_entries_to_build": 5,
    "min_entries_to_merge": 1,
    "max_entries_to_merge": 5,
    "min_entries_to_merge_wait_minutes": 0,
    "check_response_timeout_minutes": 60 } }
```

Test T12: two approved PRs queued together both merge after one `ci-gate` run each on the combined commits; a PR whose combination fails leaves the queue and stays open.

### Step 6: test matrix (throwaway PRs, closed unmerged unless noted)

| Test | Setup | Expected |
|---|---|---|
| T1 | Atish opens a PR changing `backend/` | Only `backend` runs; merge blocked until Moon **or** Kevin approves; Atish can't approve |
| T2 | (if alt accounts kept) `atish-syntarengine` approves T1 | Still blocked: "Review required from code owners" |
| T3 | PR touching only `docs/README.md` | `backend`/`frontend` skipped, `ci-gate` green, needs an owner approval |
| T4 | PR touching only `frontend/src/app/`, approved by a non-owner with write | Mergeable |
| T5 | PR touching `frontend/src/app/` + `frontend/src/components/` approved by that non-owner | Blocked until an owner (Moon, or a backup) approves |
| T5b | PR touching only `frontend/package.json`, approved by a non-owner | Blocked on code-owner review |
| T5c | Kevin opens a `backend/` PR | Atish or Moon can approve it (backup rule, no deadlock) |
| T6 | After an approval on T1, push a new commit | Approval dismissed |
| T7 | PR adding `/.github/` to the open block (above the governance block) | Still owned (last match); `codeowners` job green; needs owner |
| T8 | Admin runs `git push origin HEAD:main`, a force push and a branch delete | All rejected |
| T9 | PR with a failing pytest | `ci-gate` red, merge blocked |
| T10 | PR with an unresolved review thread | Merge blocked until resolved |
| T11 | Approver = last pusher (owner pushes a fix to someone's PR, then approves) | Doesn't count (`require_last_push_approval`) |

Record the result of each row (pass/fail + PR link) in the step 7 PR description.

### Step 7: wrap-up PR
- Delete this plan file. Update memory (`project-ci-actions-exhausted` is now outdated: CI is free on a public repo). Remove the `.worktrees/codeowners` worktree after merge.

## 5. Ownership of this plan
Atish runs steps 1 and 5 (needs admin). Each PR needs Moon or Kevin to approve once step 5 is on.

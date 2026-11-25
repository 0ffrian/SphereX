# Decisions: Scope and process

> **Part of:** the decision log ([index](README.md)) · **Holds:** scope cuts, doc layout, owners, build dates, milestones, the post-event backlog, the demo object and data release, ID reservations · **Authority:** highest; an entry here wins over [rendering/](../rendering/README.md) and [architecture/](../architecture/README.md) (see the index for precedence)

## D-06 Scope cuts for the event

- **Decision:** Move these to the post-event backlog: Gemini Live voice control, ElevenLabs and other AI sound clips, image-to-3D (TRELLIS, Hunyuan3D, TripoSR), and the Tauri Android app.
- **Stays in scope:** procedural sound (the data sweep and the "imagined drive"), with the Gemini artistic paint as a P3 stretch.

## D-11 Repo and doc layout

- **Decision:**
  - Docs live in `docs/`, the mock-up in `mockup/`, and the code in `backend/`, `frontend/` and `shared/`, as laid out in rendering doc §10.
  - `CLAUDE.md` at the root points to the docs and states the precedence.
  - The handover doc was renamed `initial.md` → `docs/handover.md`.

## D-14 Build from 5 Nov (answers Q-10)

- **Decision:** The team builds from 5 Nov, following the dates in architecture spec §13. The team has chosen to set aside the event rule against building before 14 Nov; that call and its risk belong to the team.
- **How it applies:** `CLAUDE.md` no longer limits the repo to docs and scaffolding before the event.
- **Approval:** Atish, 5 Nov 2026. Kevin and Moon were asked to confirm in PR #18; their confirmations are pending and will be recorded here. Because this sets aside an event rule and could risk disqualification, any teammate may reopen it.
- **Session note (11 Nov 2026; for the decision session, status unchanged):** Evidence: Kevin's and Moon's confirmations are still missing; Moon's PR #18 review approved the PR but asked for confirmations and did not give one. Options: confirm, or reopen. Rec: record both at the session. Decides: Kevin and Moon.

## D-17 Owners (answers Q-07 and the ownership part of Q-14)

- **Decision:**

  | Person | Owns |
  |---|---|
  | Kevin | Backend scaffold, data adapters, pipeline stages 1, 4 and 5, the API, the Gaia and WISE adapters, local hosting (D-24) |
  | Atish | Pipeline stage 3 (classify), stage 7 (`card_to_params`), the texture baker, all haptics (D-13), `frontend/src/viewer/fields/`, the Gemini layer |
  | Moon (Munazir) | `frontend/src/app/`, `frontend/src/state/`, the flipbook UI, the viewer, the shader kinds, the overlay UI; pipeline stage 2 (brightness and spectrum), `shared/schemas/` and `shared/fixtures/`, the physics layer (architecture spec §7) |

- `frontend/src/contract/` and `backend/app/contract/` are generated code (D-18) and follow the owner of `shared/schemas/`.
- **Amendment (9 Nov 2026, issue #68):** Moon decides any rule that changes the 3D body, including the stage 3 type rules (for example the Q-63 exoplanet thresholds). Atish keeps owning and reviewing the stage 3 and stage 7 code; his review can object, but it is not the sign-off.
- Munazir and Moon are the same person (GitHub `MintHerbs`). The separate Munazir row was merged into Moon's on 5 Nov 2026 (answers Q-16).
- **Amended by:** Q-111 item 7 (proposed: object jobs `core/jobs.py` and `core/warm.py`, Kevin), Q-135 (spin slider, Atish), Q-143 (per-visit star list, Kevin), Q-146 (Discovery backend Kevin, Area UI Moon), Q-183 (proposed: Track backend Kevin; Track screen and sound Atish, in `frontend/src/app/track/` and the `track` slice; the star list for movers Kevin only; the OUTLIER-core rule in Stage 2 Moon), Q-404 (proposed: the star list for movers Atish, issue #95), Q-406 (7) (agreed by Moon, 11 Nov 2026, restated 13 Nov 2026: `frontend/src/app/sky/area/*` is Atish's; `app/area/*`, the shell and `state/` stay Moon's). Q-484 (GitHub code owners: who approves a merge; it doesn't change who leads the work).

## D-29 Milestones are independent tracks

- **Decision:** Work is tracked in the GitHub project "SphereX and PlanetX - NASA COMPETITION 2026" with five milestones:

  | Milestone | Due |
  |---|---|
  | M1 SPHEREx core: flipbook + spectrum (P0) | 8 Nov |
  | M2 Sky Sculptor: 3D body (P1) | 10 Nov |
  | M3 Haptics & sound (P1/P2) | 11 Nov |
  | M4 Extras (P1–P3, cut from the bottom) | 12 Nov |
  | M5 Demo & submission | 15 Nov |

- M1 to M4 do not depend on each other. Each builds against its own fixtures (recorded responses, sample cards and spectra). Only M5 joins them. Each milestone holds as few tickets as possible.
- Open questions and **[verify]** items sit inside the ticket that needs them.
- **Amended by:** Q-132 (M3 is renamed "Sound") and Q-187 (proposed: M4 also holds Track tickets T1, T2 and T4, A19.14). Area tickets D1 and D2 are in M4 and D3 in M5 ([A16.7](../architecture/moving-objects/area-plan.md#a167-tickets-and-plan)). Status board: [A13](../architecture/plan.md#a13-plan-to-14-nov). **Amended by D-43** (20 Nov 2026): M1 to M5 are closed and replaced by release milestones.

## D-30 Milestone owners and dependencies

- **Decision (Atish, 5 Nov 2026):** one owner for the milestones where one person leads; the rest are shared.

  | Milestone | Owner |
  |---|---|
  | M1 SPHEREx core | Shared (issues #1–#3, merged as PRs #19–#21) |
  | M2 Sky Sculptor | Moon (`MintHerbs`) |
  | M3 Haptics & sound | Atish (`JoottunAtish`) |
  | M4 Extras | Shared |
  | M5 Demo & submission | Kevin (`KevinYerkiah`, assigned on GitHub once he accepts the repo invite) |

- The milestone owner leads and signs off the milestone; ticket owners from D-17 still apply inside it.
- Numbering: `#1`–`#17` below and in architecture spec §13 are GitHub **issue** numbers (one per ticket); PR numbers are written as "PR #n".
- **Dependencies:** M1–M4 have no hard dependency on each other (D-29). Three soft links run across milestones: texture haptics (#11, M3) read the shared CPU field from #8 (M2); the Gemini layer (#14, M4) repaints the albedo from the baker's height map (#6, M2, D-07); physics sliders (#13, M4) need the viewer (#7, M2) to be seen. Each can be built against fixtures first. M5 depends on all of them. The map is in architecture spec §13.
- **Amended by:** Q-132 (M3 is renamed "Sound"; its owner is unchanged). Track tickets: Q-187. **Amended by D-43** (20 Nov 2026): the milestones this entry assigns owners to are closed; ticket owners are named by Atish (D-17).

## D-41 Project licence

- **Decision (Decided: Atish, 24 Nov 2026, approving PR #212 for issue #204):**
  - **Code** (`backend/`, `frontend/`, `shared/`) is **BSD-3-Clause**: [LICENSE](../../LICENSE). So is everything not listed below.
  - **Documentation** (`docs/`, the README files) is **CC-BY-4.0**; **mock-ups** (`mockup/`) are **BSD-3-Clause**, as code.
  - **Data, fixtures, images derived from archive data and third-party parts keep the terms of their source.** The project licence does not relicense them. The agent definitions imported from VoltAgent stay MIT.
  - **The third-party licence table** (data, fixtures, fonts and dependencies) comes with issue #200 (`CITATION.cff`, PR #211). #200 must land before the solution is resubmitted anywhere.
  - **GPL code is only ever an optional plugin the user installs**, never part of the code licensed here (the orbit fitter, R-37 in A22).
  - Each contributor keeps the copyright in their own commits.
  - [NOTICE.md](../../NOTICE.md) lists which part falls under which terms.
- **Why:** the repository had no licence. The version submitted to Space Apps (14–15 Nov 2026) is distributed by NASA under Apache 2.0, the terms' default when no OSI licence is named. From this PR on, the repository is under the terms above. Contributors keep their copyright, so both can stand. BSD-3-Clause is permissive and matches heliolinx (BSD-3), the linking route chosen in R-37. R-40's `CITATION.cff` needs the licence first.
- **Space Apps terms (checked 24 Nov 2026, by Atish):** [2026 NASA Space Apps Participant Terms and Conditions](https://www.spaceappschallenge.org/legal/), "Updated August 7, 2026". The text was copied from the page in a browser, because the site's certificate chain fails on the team's machines.
  - **Our own work** must be "freely available without restriction or is licensed as open source as defined by the Open Source Initiative (OSI)". "If you do not specify a specific OSI compliant license, NASA will distribute your original content under an Apache 2.0 license."
  - **NASA's permission:** by submitting a Solution, you grant NASA permission to display, copy, combine, compile, distribute and disseminate it. Solutions for which you do not hold the copyright or other intellectual property rights are not accepted.
  - **Third-party material** (data or code not from NASA or a partner space agency) must be freely and publicly available without restriction or, at a minimum, licensed as open source. "Any licenses applicable to your Solution Materials must be identified in the documentation that you submit with your Solution." Every source used must be cited.
  - **Result:** BSD-3-Clause (and MIT for the imported VoltAgent agents) is OSI-approved, so it complies. The GPL rule above is the project's own compatibility choice (R-37), not a Space Apps requirement.
- **Open (Q-486):** a shipped dependency, Animate UI, is under MIT + Commons Clause, which is neither OSI-approved nor "without restriction". The "Result" above holds for the project's own code; Q-486 settles the dependency.
- **Relates to:** R-37 and R-40 in [A22](../architecture/discovery-hunts.md), V35, issue #200 (`CITATION.cff`), Q-486.

## D-42 `dev` is the development branch; `main` is frozen

- **Decision (Atish, 20 Nov 2026):**
  - **`main` is frozen** at `b7b4a1d6` (the merge of PR #182, 20 Nov 2026): the project as built for the event plus the Discovery hunts spec (A22). Nothing is merged into `main`, pushed to it or rebased onto it. Its ruleset (Q-484) stays on.
  - **`dev`** is made from that commit. All new work branches off `dev` (`feat/…`, `fix/…`, `docs/…`, `chore/…`) and returns to `dev` through a pull request. Open PRs that still target `main` are retargeted to `dev`.
  - **`dev` gets the protection `main` had** (Q-484): no direct push, force push or delete; `ci-gate` required; one approval from someone who is not the author and did not push last; code-owner review; threads resolved; the merge queue.
  - **`dev` is the default branch**, so new PRs target it, new contributors land on it, and `Closes #<n>` closes the issue when the PR merges into `dev`.
  - **Merging `dev` into `main`** (a release) needs a new decision.
- **Why:** `main` keeps a known-good snapshot of the event build while the Discovery hunts work (A22) starts and new contributors join.
- **GitHub settings (an admin, once):** create `dev` from `b7b4a1d6`; copy the `main` ruleset (id 27523962) to a `dev` ruleset; make `dev` the default branch; retarget open PRs.
- **Relates to:** Q-484 (code owners and the merge gate), D-17 (owners).

## D-43 Release milestones replace M1 to M5

- **Decision (Atish, 20 Nov 2026), amends D-29 and D-30:** the milestones M1 to M5 were closed on 20 Nov 2026. Work is tracked in the same GitHub project, "SphereX and PlanetX - NASA COMPETITION 2026", under these milestones, which follow the releases of [A22.12](../architecture/discovery-hunts.md#a2212-plan-tickets-and-owners):

  | Milestone | Holds |
  |---|---|
  | **R0** | Housekeeping and verification before the build: HN-0, the `V` checks, the library checks, the README and test-helper tickets |
  | **R1a** | The release 1 minimum (A22.12, R-27): HN-1, HN-2, HN-3, HN-4b, HN-5, HN-6 |
  | **R1b** | The rest of release 1 (R-8): HN-4, HN-7, HN-8, HN-9, HN-10 |
  | **R2** | Release 2: HN-11 to HN-16, and the release 2 part of HN-4b (R-54) |
  | **DR4** | HN-17 (H10, cross-match on Gaia DR4). Ships when Gaia DR4 is out |
  | **Maintenance** | Standing. App fixes outside the hunts (for example #184, #185) |

  No milestone has a due date for now.
- **Difficulty is a label, not a milestone:** `good first issue` is Level 1, `help wanted` is Level 2, and a ticket with neither is core work. Atish assigns every ticket (D-17).
- **Unchanged:** the contents of the A22 releases. D-43 only names where each ticket is tracked.
- **Why:** M1 to M5 were the event's independent tracks, due 8 to 15 Nov. The event build is done, and the Discovery hunts ship in releases that overlap, so the old names and due dates no longer describe the work.
- **Open for Atish:** the A22.12 text does not define R1a and R1b. The split above follows "Release 1 minimum" (R1a) and issue #202 ("R1b: blocks HN-4"). Placing HN-11 and HN-16 in R2 is also proposed: A22.12 does not label them.
- **Relates to:** D-14 (build dates), D-17 (owners), D-42 (`dev`), A22.12.

## Post-event backlog

| ID | Item | From |
|---|---|---|
| B-01 | Tauri Android app with `VibrationEffect` composition and amplitude | Rendering doc §8.1, D-08 |
| B-02 | Gemini Live voice control | Architecture spec §8, D-06 |
| B-03 | AI sound clips (ElevenLabs or similar) | Architecture spec §8, D-06 |
| B-04 | Image-to-3D (TRELLIS, Hunyuan3D, TripoSR) | Architecture spec §6.3, D-06 |

## Questions

Status, owner and full text as recorded. The [index](README.md) lists every ID with its file.

| ID | Question | Owner | Status |
|---|---|---|---|
| Q-07 | Owners for `shared/schemas`, `frontend/src/viewer/fields` and the backend pipeline stages (rendering doc §10 covers only render, API, viewer and haptics). | Team | Answered: D-17 |
| Q-10 | Architecture spec §13 (Plan) schedules build work from 5 Nov, but the event rules say not to build before 14 Nov. Should the plan be re-dated, or should the pre-event days be relabelled as research and prep? | Team | Answered: D-14 |
| Q-16 | Munazir to confirm the D-17 assignments (stage 2, `shared/schemas/`, physics). Munazir is not yet a repo collaborator, and `CLAUDE.md` did not list Munazir in the team. | Munazir | Answered: Munazir is Moon (`MintHerbs`); D-17 rows merged (5 Nov 2026) |
| Q-130 | **Reserved block for the Track tool: Q-130 to Q-149.** When it was set (9 Nov 2026) main ended at Q-113 and open PRs claimed Q-87, Q-88 and Q-113 to Q-120, so Track entries use this block to stop further ID collisions. Main has since taken Q-120 to Q-124; PR #63 holds Q-114 to Q-119. **Status note (9 Nov 2026):** PR #63 merged, so Q-114 to Q-119 are on main ([rendering-layers.md](rendering-layers.md), [rendering-bodies.md](rendering-bodies.md), [contract-tags.md](contract-tags.md)). | Atish | Answered (Atish, 9 Nov 2026) |
| Q-137 | **Demo object and data release.** The MVP demo is 433 Eros on its 20 to 21 Mar 2026 SPHEREx frames; 3I/ATLAS is stretch. The demo is frozen on QR2 with a local cache on the A15 and does not switch to DR1 before the event (DR1 was released in November 2026, month only, see [A3.1](../architecture/data-sources.md#a31-spherex-irsa); it renames collections and flag keywords). **Spec:** [A3.1](../architecture/data-sources.md#a31-spherex-irsa) "For the event", [A3.12](../architecture/targets.md#a312-test-and-demo-targets), [A10.2](../architecture/frontend-platform.md#a102-running-the-event-build), [A19.1](../architecture/moving-objects/track.md#a191-scope), [A19.12](../architecture/moving-objects/track-contract.md#a1912-cache-offline-and-pre-fetch) (pre-fetch with production settings). **Status note (9 Nov 2026):** the D-31 demo objects stay the spectrum quick picks; D-25's "every demo object" also means 433 Eros (Q-197). | Atish | Answered (Atish, 9 Nov 2026) |
| Q-183 | **Owners for Track and the star list (amends D-17; Q-135 precedent).** Track backend ([A19](../architecture/moving-objects/track.md): path endpoint, Horizons gate, `moving_windows`, overlays and star list for movers, ECSV writer, contract fields, pre-fetch): Kevin. Track screen and sound ([A20](../architecture/moving-objects/track-ui.md), `frontend/src/app/track/` and the `track` slice of `state/store.ts`): Atish, although `frontend/src/app/` and `state/` are Moon's. The star list for movers, shared by Track and Discovery (Q-143): Kevin only. The OUTLIER-core rule in Stage 2 (A4.2): Moon. Spec: [A16.3](../architecture/moving-objects/area-search.md#a163-architecture) (owner table), [A19](../architecture/moving-objects/track.md#a19-track) and [A20](../architecture/moving-objects/track-ui.md#a20-track-in-the-sky-view) (status lines), [A19.14](../architecture/moving-objects/track-contract.md#a1914-owners-tickets-and-tests). Amends D-17 (see its "Amended by" line). **Session note (11 Nov 2026; for the decision session, status unchanged):** Options: (a) as written (Track screen Atish); (b) match the live tickets: T1 backend Kevin (#74), T2 Track-lite screen Moon (#82, assigned to MintHerbs), T3 sound Atish (#78), star list Kevin. Rec: (b). Decides: Moon, Atish and Kevin (it amends D-17). **Amended by Q-404 (proposed, 11 Nov 2026):** the star list for movers is built by Atish (issue #95); Kevin keeps T1's other parts. | Moon, Atish, Kevin | Proposed |
| Q-404 | **Owner of the star list for movers (amends Q-183 and D-17; issue #95).** Atish builds the star list for movers (A19.6: `backend/app/core/find/stars.py`, `catalogs.py`, the mover branch of `overlays.py` and its pre-fetch), shared by Track and Discovery (Q-143), Atish was assigned issue #95 on 11 Nov 2026 and builds every Area search ticket (issues #92, #95–#97); the D-17 hand-over for the Area UI was agreed by Moon on 11 Nov 2026 (Q-406). Kevin to confirm on #74. Kevin keeps T1 (#74): mover footprints, `/path`, the `track-path` schema and the `path:*` codes. Atish informs Kevin on #74; Kevin does not block the work. Q-405 was reserved with this entry and is not used. Spec: [A19.6](../architecture/moving-objects/track.md#a196-star-list-for-movers), [A16.3](../architecture/moving-objects/area-search.md#a163-architecture), [A19.14](../architecture/moving-objects/track-contract.md#a1914-owners-tickets-and-tests). | Atish, Kevin | Proposed |
| Q-187 | **Track tickets and milestone (A19.14, A20.15).** Open T1 Track backend (Kevin), T2 Track screen (Atish), T3 Track sound (Atish, M3 "Sound" per Q-132), T4 OUTLIER-core rule in Stage 2 (Moon). T1, T2 and T4 in M4 Extras at priority P1, because Track is the MVP demo (Q-137); Area search's D1 to D3 stay P2. Spec: [A19.14](../architecture/moving-objects/track-contract.md#a1914-owners-tickets-and-tests), [A20.15](../architecture/moving-objects/track-ui.md#a2015-tests-and-tickets); [A1.1](../architecture/overview.md#a11-priority-tiers), [A13](../architecture/plan.md#a13-plan-to-14-nov). Amends D-29 and D-30 (see their "Amended by" lines). **Session note (11 Nov 2026; for the decision session, status unchanged):** Options: (a) as written; (b) T2 is Moon's reduced Track-lite (#82) with an end-of-12-Nov gate, and T3 is #78, hidden with #82. Rec: (b), with T1, T2 and T4 at P1. Decides: Atish. | Atish | Proposed |
| Q-197 | **The MVP object in the warm start and pre-fetch.** 433 Eros (the Q-137 MVP) is in `targets.toml` group `fixture`, so `SX_PREFETCH_ON_START=1` with the default `SX_PREFETCH_GROUPS=demo` never warms it. Proposal: move Eros to `group = "demo"` (or run the event with `SX_PREFETCH_GROUPS=demo,fixture`), and state that "demo object" means both the Track MVP and the D-31 spectrum quick picks. Spec: [A3.12](../architecture/targets.md#a312-test-and-demo-targets), A10.2, A19.12. Spec: [A10.2](../architecture/frontend-platform.md#a102-running-the-event-build), [A19.12](../architecture/moving-objects/track-contract.md#a1912-cache-offline-and-pre-fetch); risk in [A14](../architecture/risks.md#a14-risks-and-open-questions). **Session note (11 Nov 2026; for the decision session, status unchanged):** Evidence: `backend/targets.toml:38-42` puts Eros in group `fixture`; `backend/app/settings.py:88` has `prefetch_groups` = `demo`. Rec: move Eros to `demo` (#73 does it). Decides: Kevin. **Implementation note (#73, 11 Nov 2026; status unchanged until the #80 session records it):** Eros is now `group = "demo"` in `backend/targets.toml`, so the default warm start covers it; `scripts.record_fixtures` records the `demo` group too, so the fixtures keep it. Eros is also row 17 of the demo search list (amends Q-161's 16 rows). | Kevin | Proposed |
| Q-199 | **Blind test (A11.1): owner and object.** The example object Bennu has no registered shape model (issue #68). Proposal: optional, not scheduled; owner Atish; 433 Eros built as `asteroid_procedural` from SBDB values with the Gaskell model withheld, compared with NEAR Shoemaker images. Spec: [A11.1](../architecture/honesty-policy.md#a111-blind-test-optional-demo). | Atish | Proposed |
| Q-205 | **Event cut: hide Area search and D4 to D7 (proposed; as decided, Area search is shown, so the header's "would amend Q-146 item 4, Q-203 and D-06" no longer applies).** Evidence: there is no `backend/app/core/area/` and no `/v1/areas` route; D1 to D3 are unbuilt; the Day 0 count has no result; #82 already cuts the Area hand-off; Q-146 item 7 gives the fallback "keep Known and Track and show Discovery's steps with real counts but no tracks" (`docs/decisions/moving-objects.md:27`); Q-203 item 7 sets the gate: the core demo works on fixtures by 12 Nov, and an extra not finished and tested by 13 Nov is cut and hidden (`docs/decisions/moving-objects.md:30`). Options: (a) hide Area search entirely, and D4 to D7 with it; (b) Q-146's own fallback; (c) keep the plan, with the gates deciding. Rec: (a). It goes beyond Q-146's built-in fallback, which is why Moon must sign off. Track and the rest of the demo are unaffected. **Status note (11 Nov 2026):** decided by Moon, not as recommended: Area search **is shown** at the event with precomputed results, on four conditions: (1) the UI states the results are precomputed and shows the run date (`computed_at`); (2) the planted test mover always wears the Injected badge and is never in the real tracks, counts or export; (3) no single catch-rate number anywhere, and an unexplained track is never called a discovery; (4) if the overnight run fails, `AREA_TOOL_ENABLED` turns the tool off and nothing else in the app depends on Area. `AREA_TOOL_ENABLED` is a compile-time constant: switching it off needs a rebuild and redeploy of the frontend. D4 to D7 are not cut by this decision: they stay gated extras under Q-203 (a check not finished and tested by 13 Nov is cut and hidden), and the planted test mover always shows the Injected badge (A18.11). Q-146 item 4, Q-203 and D-06 are therefore unchanged. **Amended by Q-406 (Moon, 13 Nov 2026):** P8 joined main's sky dock; there is no `AREA_TOOL_ENABLED`, so condition (4) is replaced: with no prepared area the dock keeps the tagged demo (Q-414). Conditions (1) and (3) are built in the dock's cards. | Moon (decides); Atish, Kevin | Decided (Moon, 11 Nov 2026) |
| Q-484 | **GitHub code owners and the merge gate (relates to D-17).** The repo is public and `main` is protected by a ruleset: no direct push, force push or delete; one approval from someone who is not the author or the last pusher; code-owner review; resolved threads; required check `ci-gate`; merges go through the merge queue (on since 20 Nov 2026). Code owners (`.github/CODEOWNERS`), lead first and then backups: `docs/` all three equal; `backend/` Kevin, then Atish and Moon; `mockup/` Atish and Moon, then Kevin; `.claude/` and `CLAUDE.md` Atish, then Moon and Kevin; Moon's UI design (`frontend/src/components/`, `frontend/src/index.css`, `frontend/components.json`, `docs/design-language.md`) Moon, then Atish and Kevin; `frontend/package*.json`, `.github/`, `CONTRIBUTING.md` and every unlisted path all three. `frontend/` is otherwise **open**: any collaborator with write access can approve it. Backups exist because GitHub blocks self-approval, so a single-owner path could never merge its owner's PRs. **Differs from D-17:** `frontend/src/sound/`, `viewer/fields/` (Atish), `app/` and `state/` (Moon) are open for merging. D-17 still says who leads that work; Q-484 only decides who can approve the merge. The `atish-syntarengine` and `munazir-syntarengine` accounts were removed from the repo (18 Nov 2026). **Override (Atish, 20 Nov 2026):** the admin and maintain roles (Atish, Moon, Kevin) can bypass the rules **on a PR merge only** (the "bypass rules" checkbox); they say why in the PR. Direct push, force push and delete stay blocked for everyone. Spec: [CONTRIBUTING.md](../../CONTRIBUTING.md). | Atish (decides); Moon, Kevin confirm on the PR | Decided (Atish, 18 Nov 2026) |
| Q-486 | **Animate UI's licence vs the Space Apps terms (D-41, D-38; issue #200).** `@animate-ui/react` 2.4.3 (shipped in the app) and the three icon components copied into `frontend/src/components/animate-ui/icons/hugeicons/` are under **MIT + Commons Clause** (licence text in `.claude/THIRD_PARTY_LICENSES/animate-ui.txt`). The Commons Clause forbids selling or redistributing the components "in their original form", so it is not OSI-approved and not "without restriction", which the 2026 Space Apps terms ask of third-party material (D-41). D-38 makes Animate UI the control library. Options: (a) keep it and record the gap, (b) ask the author for an OSI licence, (c) replace it with an OSI-licensed library or own code. Also open: the copied files carry no notice (the licence asks for one in all copies), and the Hugeicons artwork licence is [verify]. Decides: Atish, with Moon (owner of `frontend/src/components/`). | Atish (decides); Moon | Open |

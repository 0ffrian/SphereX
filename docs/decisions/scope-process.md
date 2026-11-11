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
- **Amended by:** Q-111 item 7 (proposed: object jobs `core/jobs.py` and `core/warm.py`, Kevin), Q-135 (spin slider, Atish), Q-143 (per-visit star list, Kevin), Q-146 (Discovery backend Kevin, Area UI Moon), Q-183 (proposed: Track backend Kevin; Track screen and sound Atish, in `frontend/src/app/track/` and the `track` slice; the star list for movers Kevin only; the OUTLIER-core rule in Stage 2 Moon).

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
- **Amended by:** Q-132 (M3 is renamed "Sound") and Q-187 (proposed: M4 also holds Track tickets T1, T2 and T4, A19.14). Area tickets D1 and D2 are in M4 and D3 in M5 ([A16.7](../architecture/moving-objects/area-plan.md#a167-tickets-and-plan)). Status board: [A13](../architecture/plan.md#a13-plan-to-14-nov).

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
- **Amended by:** Q-132 (M3 is renamed "Sound"; its owner is unchanged). Track tickets: Q-187.

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
| Q-137 | **Demo object and data release.** The MVP demo is 433 Eros on its 20 to 21 Mar 2026 SPHEREx frames; 3I/ATLAS is stretch. The demo is frozen on QR2 with a local cache on the A15 and does not switch to DR1 before the event (DR1 expected 12 Nov 2026 per a draft IRSA tutorial PR **[verify]**; it renames collections and flag keywords). **Spec:** [A3.1](../architecture/data-sources.md#a31-spherex-irsa) "For the event", [A3.12](../architecture/targets.md#a312-test-and-demo-targets), [A10.2](../architecture/frontend-platform.md#a102-running-the-event-build), [A19.1](../architecture/moving-objects/track.md#a191-scope), [A19.12](../architecture/moving-objects/track-contract.md#a1912-cache-offline-and-pre-fetch) (pre-fetch with production settings). **Status note (9 Nov 2026):** the D-31 demo objects stay the spectrum quick picks; D-25's "every demo object" also means 433 Eros (Q-197). | Atish | Answered (Atish, 9 Nov 2026) |
| Q-183 | **Owners for Track and the star list (amends D-17; Q-135 precedent).** Track backend ([A19](../architecture/moving-objects/track.md): path endpoint, Horizons gate, `moving_windows`, overlays and star list for movers, ECSV writer, contract fields, pre-fetch): Kevin. Track screen and sound ([A20](../architecture/moving-objects/track-ui.md), `frontend/src/app/track/` and the `track` slice of `state/store.ts`): Atish, although `frontend/src/app/` and `state/` are Moon's. The star list for movers, shared by Track and Discovery (Q-143): Kevin only. The OUTLIER-core rule in Stage 2 (A4.2): Moon. Spec: [A16.3](../architecture/moving-objects/area-search.md#a163-architecture) (owner table), [A19](../architecture/moving-objects/track.md#a19-track) and [A20](../architecture/moving-objects/track-ui.md#a20-track-in-the-sky-view) (status lines), [A19.14](../architecture/moving-objects/track-contract.md#a1914-owners-tickets-and-tests). Amends D-17 (see its "Amended by" line). **Session note (11 Nov 2026; for the decision session, status unchanged):** Options: (a) as written (Track screen Atish); (b) match the live tickets: T1 backend Kevin (#74), T2 Track-lite screen Moon (#82, assigned to MintHerbs), T3 sound Atish (#78), star list Kevin. Rec: (b). Decides: Moon, Atish and Kevin (it amends D-17). | Moon, Atish, Kevin | Proposed |
| Q-187 | **Track tickets and milestone (A19.14, A20.15).** Open T1 Track backend (Kevin), T2 Track screen (Atish), T3 Track sound (Atish, M3 "Sound" per Q-132), T4 OUTLIER-core rule in Stage 2 (Moon). T1, T2 and T4 in M4 Extras at priority P1, because Track is the MVP demo (Q-137); Area search's D1 to D3 stay P2. Spec: [A19.14](../architecture/moving-objects/track-contract.md#a1914-owners-tickets-and-tests), [A20.15](../architecture/moving-objects/track-ui.md#a2015-tests-and-tickets); [A1.1](../architecture/overview.md#a11-priority-tiers), [A13](../architecture/plan.md#a13-plan-to-14-nov). Amends D-29 and D-30 (see their "Amended by" lines). **Session note (11 Nov 2026; for the decision session, status unchanged):** Options: (a) as written; (b) T2 is Moon's reduced Track-lite (#82) with an end-of-12-Nov gate, and T3 is #78, hidden with #82. Rec: (b), with T1, T2 and T4 at P1. Decides: Atish. | Atish | Proposed |
| Q-197 | **The MVP object in the warm start and pre-fetch.** 433 Eros (the Q-137 MVP) is in `targets.toml` group `fixture`, so `SX_PREFETCH_ON_START=1` with the default `SX_PREFETCH_GROUPS=demo` never warms it. Proposal: move Eros to `group = "demo"` (or run the event with `SX_PREFETCH_GROUPS=demo,fixture`), and state that "demo object" means both the Track MVP and the D-31 spectrum quick picks. Spec: [A3.12](../architecture/targets.md#a312-test-and-demo-targets), A10.2, A19.12. Spec: [A10.2](../architecture/frontend-platform.md#a102-running-the-event-build), [A19.12](../architecture/moving-objects/track-contract.md#a1912-cache-offline-and-pre-fetch); risk in [A14](../architecture/risks.md#a14-risks-and-open-questions). **Session note (11 Nov 2026; for the decision session, status unchanged):** Evidence: `backend/targets.toml:38-42` puts Eros in group `fixture`; `backend/app/settings.py:88` has `prefetch_groups` = `demo`. Rec: move Eros to `demo` (#73 does it). Decides: Kevin. **Implementation note (#73, 11 Nov 2026; status unchanged until the #80 session records it):** Eros is now `group = "demo"` in `backend/targets.toml`, so the default warm start covers it; `scripts.record_fixtures` records the `demo` group too, so the fixtures keep it. Eros is also row 17 of the demo search list (amends Q-161's 16 rows). | Kevin | Proposed |
| Q-199 | **Blind test (A11.1): owner and object.** The example object Bennu has no registered shape model (issue #68). Proposal: optional, not scheduled; owner Atish; 433 Eros built as `asteroid_procedural` from SBDB values with the Gaskell model withheld, compared with NEAR Shoemaker images. Spec: [A11.1](../architecture/honesty-policy.md#a111-blind-test-optional-demo). | Atish | Proposed |
| Q-205 | **Event cut: hide Area search and D4 to D7 (would amend Q-146 item 4, Q-203 and D-06 when confirmed).** Evidence: there is no `backend/app/core/area/` and no `/v1/areas` route; D1 to D3 are unbuilt; the Day 0 count has no result; #82 already cuts the Area hand-off; Q-146 item 7 gives the fallback "keep Known and Track and show Discovery's steps with real counts but no tracks" (`docs/decisions/moving-objects.md:27`); Q-203 item 7 sets the gate: the core demo works on fixtures by 12 Nov, and an extra not finished and tested by 13 Nov is cut and hidden (`docs/decisions/moving-objects.md:30`). Options: (a) hide Area search entirely, and D4 to D7 with it; (b) Q-146's own fallback; (c) keep the plan, with the gates deciding. Rec: (a). It goes beyond Q-146's built-in fallback, which is why Moon must sign off. Track and the rest of the demo are unaffected. | Moon (decides); Atish, Kevin | Proposed |

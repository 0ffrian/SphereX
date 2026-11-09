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

## D-17 Owners (answers Q-07 and the ownership part of Q-14)

- **Decision:**

  | Person | Owns |
  |---|---|
  | Kevin | Backend scaffold, data adapters, pipeline stages 1, 4 and 5, the API, the Gaia and WISE adapters, local hosting (D-24) |
  | Atish | Pipeline stage 3 (classify), stage 7 (`card_to_params`), the texture baker, all haptics (D-13), `frontend/src/viewer/fields/`, the Gemini layer |
  | Moon (Munazir) | `frontend/src/app/`, `frontend/src/state/`, the flipbook UI, the viewer, the shader kinds, the overlay UI; pipeline stage 2 (brightness and spectrum), `shared/schemas/` and `shared/fixtures/`, the physics layer (architecture spec §7) |

- `frontend/src/contract/` and `backend/app/contract/` are generated code (D-18) and follow the owner of `shared/schemas/`.
- Munazir and Moon are the same person (GitHub `MintHerbs`). The separate Munazir row was merged into Moon's on 5 Nov 2026 (answers Q-16).

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
| Q-130 | **Reserved block for the Track tool: Q-130 to Q-149.** When it was set (9 Nov 2026) main ended at Q-113 and open PRs claimed Q-87, Q-88 and Q-113 to Q-120, so Track entries use this block to stop further ID collisions. Main has since taken Q-120 to Q-124; PR #63 holds Q-114 to Q-119. | Atish | Answered (Atish, 9 Nov 2026) |
| Q-137 | **Demo object and data release.** The MVP demo is 433 Eros on its 20 to 21 Mar 2026 SPHEREx frames; 3I/ATLAS is stretch. The demo is frozen on QR2 with a local cache on the A15 and does not switch to DR1 before the event (DR1 expected 12 Nov 2026 per a draft IRSA tutorial PR **[verify]**; it renames collections and flag keywords). | Atish | Answered (Atish, 9 Nov 2026) |

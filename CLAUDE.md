# CLAUDE.md

Project: **Shift & Spectrum**, a public web tool for NASA Space Apps 2026 (Port Louis, 14–15 Nov 2026), challenge "Planet X and SPHEREx". Team: Atish, Kevin and Moon (Munazir).

## Read these first

| Doc | Authority |
|---|---|
| [docs/decisions/](docs/decisions/README.md) | **Wins over every other doc** where it states a decision. Load the index (`README.md`: every D-/Q- entry and its topic file), then only the topic files (`docs/decisions/<topic>.md`) that the task's routing row names. |
| [docs/rendering/](docs/rendering/README.md) | Source of truth for how an object is **displayed**, how its **surface is generated**, how it **feels (haptics)** and how that **sounds (audio pairing)**. Sections `R0`–`R12`. |
| [docs/architecture/](docs/architecture/README.md) | Source of truth for everything else: data sources, pipeline, tiers, plan, risks. Sections `A1`–`A21` (Track and Area search A16–A20 in `moving-objects/`, app shell A21). Terms: [glossary](docs/architecture/glossary.md) (A15). |
| [docs/uml/](docs/uml/README.md) | Architecture diagrams (UML, Mermaid). Keep in sync when a spec changes. |
| [docs/handover.md](docs/handover.md) | Background only (competition, data, early concepts). Not a spec. |
| [mockup/](mockup/) | Visual input only, never a spec (D-01). `spherex-ui.html` is the app shell and the Area search tool (mock-up tool 5; the app adds no number keys); `chase-the-rock.html` is the Track tool (see Layout). |

If two docs disagree and `docs/decisions/` is silent, follow the precedence (decisions > rendering > architecture), add a `Q-` entry to the matching topic file in `docs/decisions/` (and its index row) describing the conflict, and continue. Never pick silently.

**Load only what the task needs.** The specs are split into small fragments. Load `docs/decisions/README.md` (the index), then find the task's row in the "What to load for a task" table in [docs/README.md](docs/README.md): it names the decision topic files and the spec fragments (with section IDs) to load. Load nothing else. "Rendering doc §8.4" means `R8.4` and "architecture spec §7.2" means `A7.2`; each spec's `README.md` has a section map from ID to file.

## Rules for code

- **Pinned versions only.** Never "latest". three.js is **r187** (`three/webgpu`). If an API is not in r187, check the r187 docs before using it.
- **Data first.** An LLM never produces a physical number. Code converts measurements to parameters deterministically.
- **Provenance on everything.** Every value and render layer carries one tag: `measured`, `derived`, `model_dependent`, `inferred_from_analog`, `artistic`. The UI shows them as 3 badges (see decisions D-02).
- **Fall back a tier, don't invent.** A missing value drops one tier and is labelled with it (D-32); a layer is refused and listed in `missing` only when no tier can answer. Physical size and ObjectCard values are still never guessed.
- **Determinism.** Same ObjectCard + seed → byte-identical textures.
- **Never blank.** The code path loads first; optional layers (Gemini) swap in only on success.
- **The event build is a desktop browser on the A15 laptop, sound only** (Q-132). Phones and vibration come after the event.
- Do not invent fields, endpoints or library APIs that are not in the specs. Items marked **[verify]** must be checked against real output first.

## Git workflow

- **All development happens on a branch** (`feat/…`, `fix/…`, `docs/…`) and reaches `main` through a pull request. Review it with `/sx-pr-review`.
- **Never commit or push directly to `main`.** The only exceptions were the initial repo and frontend setup (4 Nov 2026), which the user approved explicitly.
- Agents may create branches and commit locally. Pushing and opening PRs happen when the user asks.

## Agents and skills

Project agents live in `.claude/agents/` and skills in `.claude/skills/`. Agents work autonomously: they don't stop to ask for permission. They make the smallest reasonable choice and report their assumptions.

| Skill | Does |
|---|---|
| `/sx-implement <task>` | auto-implementer, then code-reviewer (with fixes), design-reviewer for UI/haptics, and spec-keeper for docs. `--commit` commits on a feature branch (never pushes). |
| `/sx-code-review [paths] [--fix] [--deep]` | code-reviewer; `--deep` adds security, performance and accessibility passes |
| `/sx-pr-review <n> [--comment] [--deep]` | pr-reviewer on a GitHub PR; `--comment` posts the review |
| `/sx-design-review [target] [--fix]` | design-reviewer, accessibility-tester and ux-microcopy-reviewer (plus haptics-audio-engineer when relevant) |
| `/sx-spec-sync [change]` | spec-keeper: section maps, links, UML, decisions |
| `/sx-verify [item\|all] [--apply]` | astro-verifier resolves **[verify]** items with citations |

**Project agents:**
- `auto-implementer`, `code-reviewer`, `pr-reviewer`, `design-reviewer`
- `spec-keeper`, `astro-verifier`, `haptics-audio-engineer`

**Imported from VoltAgent (MIT, with a project note added):**
- Core: `api-designer`, `backend-developer`, `frontend-developer`, `ui-designer`
- Languages: `typescript-pro`, `react-specialist`, `python-pro`, `fastapi-developer`
- Quality: `accessibility-tester`, `architect-reviewer`, `debugger`, `performance-engineer`, `qa-expert`, `security-auditor`, `test-automator`
- Data and ML: `data-engineer`, `data-scientist`, `ml-engineer`
- Developer experience: `dependency-manager`, `documentation-engineer`, `git-workflow-manager`, `refactoring-specialist`, `build-engineer`, `deployment-engineer`
- Other: `game-developer` (three.js/WebGL), `ux-microcopy-reviewer`

## Build schedule

The team builds from 5 Nov 2026 (decisions D-14), setting aside the event rule against building before 14 Nov. Work is tracked in the GitHub project "SphereX and PlanetX - NASA COMPETITION 2026" as milestones M1–M5 (D-29). M1–M4 build against fixtures and do not depend on each other; only M5 integrates them.

## Layout

```
docs/       decisions/ (index + topic files), architecture/ (A1–A21; moving-objects/ holds A16–A20),
            rendering/ (R0–R12), uml/
mockup/     single-file HTML mock-ups, not the app
  spherex-ui.html       app shell and tools (three.js r128), incl. Area search (mock-up tool 5),
                        which opens chase-the-rock.html in its Track pane
  chase-the-rock.html   Track tool: a known asteroid's path, its SPHEREx frames, a zoom with
                        stars masked, and a spectrum built hop by hop (433 Eros, 20–21 Mar 2026)
backend/    Python 3.12 API, pipeline, texture baker        (Kevin, Moon, Atish)
frontend/   Vite + TypeScript + React app, viewer, haptics   (Moon; Atish for haptics and viewer/fields)
shared/     JSON schemas shared by backend and frontend      (Moon)
```

Owners per area: decisions D-17.

**Moving objects.** Track (one known object's path, frames, zoom and spectrum; the MVP is 433 Eros, Q-131, Q-137) and Area search (draw a square, then Known objects or Discovery, Q-146) are specified in A16–A20 in [docs/architecture/moving-objects/](docs/architecture/README.md#fragments); decisions in [moving-objects.md](docs/decisions/moving-objects.md) (agreed), [moving-frames.md](docs/decisions/moving-frames.md) (the path cone search, its refusal codes, MOST) and [moving-objects-review.md](docs/decisions/moving-objects-review.md) (proposed fixes, Moon's review list Q-202).
- Q-146 is the plan. Q-203 adds four **gated extras** after the core demo works (12 Nov): completeness with a planted test mover, the shuffled-time control, the spectrum smoothness score and the rate-grid linker (A16.7, A16.8, tickets D4 to D7); an extra not finished and tested by 13 Nov is cut and hidden. Phase 2 (after the event, do not build now): ADES, live areas anywhere, a larger completeness grid. Planted data never enters `known`, `tracks`, the step counts or the real export and always carries the Injected badge. No single catch-rate number; an unmatched track is never "an asteroid", "new" or "a discovery" (A16.5).
- Mock-ups: `cd mockup && python3 -m http.server 8766`, open `http://127.0.0.1:8766/spherex-ui.html`, tool 5 for Area search (the Track pane loads `chase-the-rock.html`, whose data is real: PR #53's Eros fixtures and the 2MASS sky mirror).
- Never port these mock-up approximations as values (full list in the A20 header; the real rules are A19):
  - star masks are bright peaks per frame; the app uses Gaia DR3 and CatWISE (A19.6, Q-143);
  - brightness skips Stage 2's sub-pixel weights and clipping; the app uses Stage 2 (A19.7);
  - hollow dots mean "hardware flags"; the app keeps `OUTLIER` on a mover's core as a flagged point and refuses hardware-flagged frames (Q-139, A20.7).

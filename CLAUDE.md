# CLAUDE.md

Project: **Shift & Spectrum**, a public web tool for NASA Space Apps 2026 (Port Louis, 14–15 Nov 2026), challenge "Planet X and SPHEREx". Team: Atish, Kevin and Moon (Munazir).

## Read these first

| Doc | Authority |
|---|---|
| [docs/decisions.md](docs/decisions.md) | **Wins over every other doc** where it states a decision. |
| [docs/rendering/](docs/rendering/README.md) | Source of truth for how an object is **displayed**, how its **surface is generated**, how it **feels (haptics)** and how that **sounds (audio pairing)**. Sections `R0`–`R12`. |
| [docs/architecture/](docs/architecture/README.md) | Source of truth for everything else: data sources, pipeline, tiers, plan, risks. Sections `A1`–`A15`. |
| [docs/uml/](docs/uml/README.md) | Architecture diagrams (UML, Mermaid). Keep in sync when a spec changes. |
| [docs/handover.md](docs/handover.md) | Background only (competition, data, early concepts). Not a spec. |

If two docs disagree and `decisions.md` is silent, follow the precedence (decisions > rendering > architecture), add a `Q-` entry to `decisions.md` describing the conflict, and continue. Never pick silently.

**Load only what the task needs.** The specs are split into small fragments. Read `docs/decisions.md`, then use the "What to load for a task" table in [docs/README.md](docs/README.md) to pick fragments. "Rendering doc §8.4" means `R8.4` and "architecture spec §7.2" means `A7.2`; each spec's `README.md` has a section map from ID to file.

## Rules for code

- **Pinned versions only.** Never "latest". three.js is **r187** (`three/webgpu`). If an API is not in r187, check the r187 docs before using it.
- **Data first.** An LLM never produces a physical number. Code converts measurements to parameters deterministically.
- **Provenance on everything.** Every value and render layer carries one tag: `measured`, `derived`, `model_dependent`, `inferred_from_analog`, `artistic`. The UI shows them as 3 badges (see decisions D-02).
- **Fall back a tier, don't invent.** A missing value drops one tier and is labelled with it (D-32); a layer is refused and listed in `missing` only when no tier can answer. Physical size and ObjectCard values are still never guessed.
- **Determinism.** Same ObjectCard + seed → byte-identical textures.
- **Never blank.** The code path loads first; optional layers (Gemini) swap in only on success.
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
docs/       specs, decisions, UML
mockup/     single-file HTML mock-up (three.js r128, not the app)
backend/    Python 3.12 API, pipeline, texture baker        (Kevin, Moon, Atish)
frontend/   Vite + TypeScript + React app, viewer, haptics   (Moon; Atish for haptics and viewer/fields)
shared/     JSON schemas shared by backend and frontend      (Moon)
```

Owners per area: decisions D-17.

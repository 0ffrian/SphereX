# CLAUDE.md

Project: **Shift & Spectrum**, a public web tool for NASA Space Apps 2026 (Port Louis, 14–15 Nov 2026), challenge "Planet X and SPHEREx". Team: Atish, Kevin, Moon.

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
- **Refuse rather than invent.** Missing data → the layer is not drawn and is listed in `missing`.
- **Determinism.** Same ObjectCard + seed → byte-identical textures.
- **Never blank.** The code path loads first; optional layers (Gemini) swap in only on success.
- Do not invent fields, endpoints or library APIs that are not in the specs. Items marked **[verify]** must be checked against real output first.

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

## Hackathon rule

The official rules say not to start building before the event begins (14 Nov 2026). Before then this repo holds docs, the mock-up and empty scaffolding only.

## Layout

```
docs/       specs, decisions, UML
mockup/     single-file HTML mock-up (three.js r128, not the app)
backend/    Python 3.12 API, pipeline, texture baker        (Atish, Kevin)
frontend/   Vite + TypeScript + React app, viewer, haptics   (Moon)
shared/     JSON schemas shared by backend and frontend
```

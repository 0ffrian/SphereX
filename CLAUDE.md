# CLAUDE.md

Project: **Shift & Spectrum**, a public web tool for NASA Space Apps 2026 (Port Louis, 14–15 Nov 2026), challenge "Planet X and SPHEREx". Team: Atish, Kevin and Moon (Munazir).

## Read these first

| Doc | Authority |
|---|---|
| [docs/decisions/](docs/decisions/README.md) | **Wins over every other doc** where it states a decision. Load the index (`README.md`, every D-/Q- entry with its file) first, then only the topic files the task needs. |
| [docs/rendering/](docs/rendering/README.md) | Source of truth for how an object is **displayed**, how its **surface is generated**, how it **feels (haptics)** and how that **sounds (audio pairing)**. Sections `R0`–`R12`. |
| [docs/architecture/](docs/architecture/README.md) | Source of truth for everything else: data sources, pipeline, tiers, plan, risks. Sections `A1`–`A18`. |
| [docs/uml/](docs/uml/README.md) | Architecture diagrams (UML, Mermaid). Keep in sync when a spec changes. |
| [docs/handover.md](docs/handover.md) | Background only (competition, data, early concepts). Not a spec. |
| [mockup/](mockup/) | Visual input only, never a spec (D-01). `spherex-ui.html` is the app shell and the Area search tool (key 5); `chase-the-rock.html` is the Track tool (see Layout). |

If two docs disagree and `docs/decisions/` is silent, follow the precedence (decisions > rendering > architecture), add a `Q-` entry to the matching topic file in `docs/decisions/` (and its index row) describing the conflict, and continue. Never pick silently.

**Load only what the task needs.** The specs are split into small fragments. Read `docs/decisions/README.md`, then use the "What to load for a task" table in [docs/README.md](docs/README.md) to pick fragments. "Rendering doc §8.4" means `R8.4` and "architecture spec §7.2" means `A7.2`; each spec's `README.md` has a section map from ID to file.

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
mockup/     single-file HTML mock-ups, not the app
  spherex-ui.html       app shell and tools (three.js r128), incl. Area search (key 5), which
                        opens chase-the-rock.html in its Track pane: serve mockup/ over http
  chase-the-rock.html   Track tool: a known asteroid's path, its SPHEREx frames, a zoom with
                        stars masked, and a spectrum built hop by hop (433 Eros, 20–21 Mar 2026)
backend/    Python 3.12 API, pipeline, texture baker        (Kevin, Moon, Atish)
frontend/   Vite + TypeScript + React app, viewer, haptics   (Moon; Atish for haptics and viewer/fields)
shared/     JSON schemas shared by backend and frontend      (Moon)
```

Owners per area: decisions D-17.

**Track tool mock-up (`mockup/chase-the-rock.html`).** It shows the known-objects Track tool (Q-131). In the app it is opened from Area search (Q-146). Its data is real: 16 SPHEREx QR2 cutouts and the JPL Horizons path from SPHEREx (`500@-163182`), both from PR #53's recorded Eros fixtures, plus the local 2MASS sky mirror. Three things in it are mock-up approximations, not app output, so never port them as values:
- Star masks are bright peaks found in each frame; the app places them from Gaia DR3 and CatWISE (A4.9).
- Brightness uses Stage 2's radii (3 px aperture, 6–9 px ring) without its sub-pixel weights or clipping (A4.2).
- `OUTLIER` on Eros's pixels is kept under the moving-object rule of Q-139 (accepted 9 Nov 2026, flagged frames shown as flagged); Stage 2 on main still refuses those frames until it is built.

**Current plan for moving objects: Area search (decisions Q-146, 9 Nov 2026). Follow it; it wins over older text in PR #59's history.**
- One **Area search** tool: the user draws a square on the sky, then picks **Known objects** (SkyBoT list; **Track it** opens Track, Q-131) or **Discovery** (find dots, drop one-exposure glitches, drop stars, join what moves across visits, check SkyBoT). Spec: A16 to A18 ([linker.md](docs/architecture/linker.md), [linker-backend.md](docs/architecture/linker-backend.md), [linker-ui.md](docs/architecture/linker-ui.md)). Visual reference: `mockup/spherex-ui.html`, key 5.
- Labels: "found blind = (designation)", "unexplained track", "possible". An unmatched track is never "an asteroid", "new" or "a discovery".
- **Do not build before the event:** the rate-grid (THOR-style) linker, the SED smoothness score, injection-recovery completeness, the shuffled-time control, ADES, live areas outside the precomputed ones. They are phase 2. Make no catch-rate claim.
- Owners: Track Atish; Discovery backend Kevin (D1, Day 0 count first); Area tool UI, schemas and fixtures Moon (D2); integration in M5 (D3).
- **To see it:** `cd mockup && python3 -m http.server 8766`, open `http://127.0.0.1:8766/spherex-ui.html`, press 5, drag a square, try both options. Opening the file directly works, but the Track pane then shows chase-the-rock.html with its own header.

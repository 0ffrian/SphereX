# Notice: what is licensed under what

The project licence is decided in [D-41](docs/decisions/scope-process.md#d-41-project-licence). This file says which part of the repository falls under which terms. The full text of the code licence is in [LICENSE](LICENSE).

| Part | Licence |
|---|---|
| Source code (`backend/`, `frontend/`, `shared/`) | BSD-3-Clause ([LICENSE](LICENSE)) |
| Documentation (`docs/`, the README files) | CC-BY-4.0 |
| Mock-ups (`mockup/`) | CC-BY-4.0 |
| Data, fixtures and cached archive replies (for example under `backend/tests/fixtures/` and `backend/assets/`), and images derived from archive data | **Keep the terms of their source.** The licence above does not relicense them. Each source's own terms and acknowledgement text apply. |
| Third-party libraries and code copied from other projects | **Keep their own licences.** |
| The 26 agent definitions in `.claude/agents/` imported from VoltAgent (the files that name it as their source) | MIT, as imported. The licence text is in [.claude/THIRD_PARTY_LICENSES/voltagent-awesome-claude-code-subagents.txt](.claude/THIRD_PARTY_LICENSES/voltagent-awesome-claude-code-subagents.txt). |
| Everything else in the repository (the project's own agents and skills in `.claude/`, `.github/`, root configuration files) | BSD-3-Clause ([LICENSE](LICENSE)) |

## GPL code

Under D-41, GPL code is only ever an **optional plugin that the user installs**. Orbit fitting and propagation tools found so far depend on GPL-3 code (R-37 in the Discovery hunts spec). Such a plugin is not part of the code licensed above, and this file does not relicense it.

## Contributions

Each contributor keeps the copyright in their own commits.

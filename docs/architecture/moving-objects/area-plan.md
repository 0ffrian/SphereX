# Area search: tickets, plan and the four checks

> **Part of:** Architecture spec ([index](../README.md)) · **Sections:** A16.7 to A16.8 (A16 to A16.6 in [area-search.md](area-search.md)) · **Implements:** [Q-146](../../decisions/moving-objects.md), [Q-203](../../decisions/moving-objects.md), [Q-137](../../decisions/scope-process.md) · **Read with:** [area-search.md](area-search.md) (A16 to A16.6), [area-backend.md](area-backend.md) (A17), [area-contract.md](area-contract.md) (A17.6 to A17.13), [area-ui.md](area-ui.md) (A18), [plan.md](../plan.md) (A13)

The end of [A16](area-search.md#a16-area-search): the tickets, the Day 0 gate and the plan, and why the four gated checks of [Q-203](../../decisions/moving-objects.md) are worth their cost.

### A16.7 Tickets and plan

Three core Area tickets (D-29 "as few tickets as possible"): D1 and D2 in **M4 Extras**, D3 in **M5**, priority P2. Four **gated extras** (D4 to D7, [Q-203](../../decisions/moving-objects.md)) in **M4 Extras**, priority P3, behind the gate below. Track's tickets T1 to T4 are in [A19.14](track-contract.md#a1914-owners-tickets-and-tests) and [A20.15](track-ui.md#a2015-tests-and-tickets). (M1 to M5 are the event milestones, closed on 20 Nov 2026 and replaced by release milestones, [D-43](../../decisions/scope-process.md#d-43-release-milestones-replace-m1-to-m5); the labels below are kept as history.)

| Ticket | Owner | Checklist |
|---|---|---|
| **D1 Discovery backend** | Kevin | Day 0 count on the Eros frames and one other area: visits, gap, exposures per visit, motion inside a visit, per-exposure S/N, share of dots labelled star (recorded in A16.6 and Q-148) · `[[area]]` config · area frames (A17.1) · dots (A17.2) · glitches, stars, fixed (A17.3) · join with the parallax-aware test, and the Eros test that must give one `track` (A17.4) · known-object check (A17.5) · ECSV (A17.7) · API (A17.8) · determinism test (A17.10) |
| **D2 Area tool UI** | Moon | Schemas and fixtures (A17.9) · Area tool and drawing (A18.1) · layers (A18.2) · visits and blink (A18.3) · cards (A18.4 to A18.7) · hand-off to Track (A18.8) · copy and badges · tests (A18.10) |
| **D3 Integration** | Shared, M5 | Precompute the demo areas, then run under `SX_OFFLINE=1` · e2e on the real cache (Eros found blind, then Track) · this spec and [uml/22](../../uml/22-area-search.md) updated to "as built" |
| **D4 Completeness and planted test mover** | Kevin (backend), Moon (card) | `inject.py` with the PSF decision (A16.6) · one planted test mover at a fixed seed, shown on the sky with the Injected badge · the completeness grid (A17.6) · `checks` endpoint and schema (A17.8, A17.9) · Checks card, grid and switch (A18.11) · tests (A17.6) |
| **D5 Shuffled-time control** | Kevin | `control.py`: 20 seeded runs with permuted frame times through A17.3 and A17.4, count the tracks (A17.6) · the line in the Checks card · test that a control run on the Eros area finds no Eros track |
| ~~D6 Spectrum smoothness score~~ | | Cut by the Q-203 gate; replaced by the spectrum check (A17.13, Q-474), one ticket owned by Moon |
| **D7 Rate-grid linker** | Kevin | `rategrid.py` for 3 or more visits (A17.12) · a synthetic multi-visit area (A17.9) · a real area with 3 or more visits if Day 0 finds one · the Result card's "Linked by" line · test that on 2 visits it does not run and the pair rule is used |

- **Extras gate (Q-203):** the core demo (draw a square, Discovery on Eros, Result card, Open in Track) works on fixtures by **12 Nov**. D4 to D7 start after it; D5 and D6 only need the dots and tracks fixture, so they may start earlier. An extra that is not finished and tested by **13 Nov** is cut: its Checks part is hidden, not shown half done, and the demo does not mention it. Cheapest first if time is short: D5, the D4 test mover, the D4 grid, D6, D7.
- **Order:** agree the JSON shapes (A17.8, A17.9) first, so D1 and D2 build in parallel against fixtures (D-29).
- **Gate:** if Day 0 shows Eros is not found blind on its own frames with the rules of A17, keep Known and Track, and show Discovery only as the five steps on the Eros area with its real counts, without claiming tracks. Never drop the "unexplained, not a discovery" wording.

### A16.8 Why these four checks, and what a reviewer gets

Q-146 cut these four to keep the event build small; [Q-203](../../decisions/moving-objects.md) adds them back as gated extras. The reason is not decoration. Discovery's output is a list of **leads**, and a lead means little until three questions have numbers: how often the search finds a real mover (sensitivity), how often it reports a mover that is not there (false alarms), and whether a lead is one body or unrelated things that happen to line up.

| Check | The question it answers | What a reviewer sees | Why it matters | Ticket |
|---|---|---|---|---|
| Completeness grid and planted test mover | "How many movers does your search miss?" and "Does it find something that is in no catalogue?" | A grid of planted movers recovered per brightness and speed, and one planted mover found live (badge Injected) | Without sensitivity, "we found nothing here" cannot be told from "we could not have found it". Planting known sources and counting the recovered ones is the usual way a source search is validated **[verify]** citation. A real unexplained track cannot be proved from two visits, so a planted mover is the only honest way to show the search can recover something no catalogue holds | D4 |
| Shuffled-time control | "Is it finding motion, or inventing it?" | "n false tracks in m scrambled runs" | A measured false-alarm count. Without it an "unexplained track" could be chance alignment of dots | D5 |
| Spectrum check (Q-474, replaces D6) | "Is this light sunlight off a rock?" | A verdict per track (Rock-like, Very red, Too red, Too blue, Flickers, Too faint, One colour) with the colour points plotted against the Sun's | Uses what only SPHEREx has: two detectors seeing the same spot at the same instant, so each exposure gives a colour that spin cannot fake. Physics bounds (reflectance range, heat glow by distance, spin barrier) rank leads for follow-up | A17.13 |
| Rate-grid linker | "Does it use all your visits?" | Tracks linked across 3 or more visits, tagged with the linker used | Pairing checks two visits at a time. THOR (Moeyens et al. 2021, [arXiv:2105.01056](https://arxiv.org/abs/2105.01056)) and HelioLinC (Holman et al. 2018, [arXiv:1805.02638](https://arxiv.org/abs/1805.02638)) link all visits at once, so a mover too faint to pass every pair can still count. It is the only one of the four that can find more bodies | D7 |

**How this helps with NASA scientists reviewing the work**

- **It is the community's tool, with the numbers the community needs.** The SPHEREx catalogue tracks known orbits and leaves unknown-object mining to community researchers (Lisse, Bauer and Kim 2024, [arXiv:2402.08705](https://arxiv.org/abs/2402.08705)). A researcher will ask for the sensitivity, the false-alarm rate and a sign that a lead is one body before using a list of leads. The grid, the control and the spectrum label are those three answers, inside the tool.
- **We state the limits first.** Showing what the search misses and what it invents, before anyone asks, reads as method. A demo that shows only the success reads as a trick.
- **The demo becomes a test we designed.** The Eros area was chosen because Eros crosses it (A16.5), so finding Eros is a known-answer check. The planted mover adds the case no catalogue covers, and it is labelled as ours.
- **Nothing is overclaimed.** Planted is not a discovery; the grid covers only the squares tested; no single catch-rate number is shown; "unexplained, not a discovery" stays.
- **A reviewer can check it.** Each check has a `method` block with its seeds and settings, the same inputs give the same bytes (A17.10), and the real tracks are exported as ECSV without any planted row.

**What the four do not do.** They do not claim a catch rate for the sky. The control tests chance alignment of dots only. The spectrum label says nothing about composition, and Eros's rotation changes its brightness between exposures, so the label is a flag and never removes a track. Only the rate-grid linker can find more bodies, and only where an area has 3 or more visits.

# Test and demo targets

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A3.12 · **Implements:** [D-25, D-31](../decisions/data-sources.md), [Q-137](../decisions/scope-process.md), [Q-144](../decisions/moving-objects.md) · **Read with:** [data-sources.md](data-sources.md) (A3.1 saturation), [pipeline.md](pipeline.md) (A4.2 counts), [honesty-policy.md](honesty-policy.md) (A11 caveats)

### A3.12 Test and demo targets

Every target is listed in `backend/targets.toml` with a `group`; the pre-fetch script (`scripts.prefetch --group <g>`) and the warm start (`SX_PREFETCH_GROUPS`, [A4.10](jobs.md#a410-object-job-and-fan-out)) fill the cache per group (D-25). D-31 holds the decisions; this section holds the evidence behind them. The per-target counts on the full offline cache are owned by the A4.2 status ([pipeline.md](pipeline.md#a42-stage-2-measure-brightness-and-spectrum)); this section does not repeat them.

| Group | Targets | Role |
|---|---|---|
| `test` | Barnard's Star, Epsilon Indi B, WISE 0855, RW Aurigae, R Draconis | The challenge's five test targets (P0 flipbook). Barnard's Star and R Dra have no measured point and RW Aur keeps 15 (saturation, D-31); their flipbook still works and the refusals stay honest. |
| `demo` | SIMP 0136, TWA 27, IRAS 04302+2247 | Spectrum demo objects that SPHEREx measures cleanly (D-31). Quick picks in the UI: issue #15 (M5). |
| `fixture` | 433 Eros, TRAPPIST-1 e, K2-18 b, HD 209458 b, GJ 1214 b, 51 Peg b, Proxima Cen b | Recorded for tests (shape model, Sun angle, exoplanet rule). |

**The MVP demo is 433 Eros in the Track tool** on its 20 to 21 Mar 2026 SPHEREx frames ([Q-137](../decisions/scope-process.md)); 3I/ATLAS is stretch (its extended coma: Q-144). "Demo object" therefore means two things: the Track MVP (Eros) and the D-31 spectrum quick picks.

- **Proposed (Q-197):** move 433 Eros from `fixture` to `demo` in `targets.toml` (or run the event with `SX_PREFETCH_GROUPS=demo,fixture`), so the event's warm start and the pre-fetch cover the MVP object. Today `SX_PREFETCH_GROUPS=demo` skips it.
- **To build:** `[[area]]` tables for Area search (fields in [A16.4](moving-objects/area-search.md#a164-data-flow) and [A17.1](moving-objects/area-backend.md#a171-area-and-frames-framespy)) and `moving_windows` for 433 Eros (**Proposed (Q-184)**, [A19.3](moving-objects/track.md#a193-frame-list)).

**How the D-31 demo objects were picked** (live screen of 8 candidates on QR2, 6 Nov 2026, the first ~32 frames of each object, 78 for SIMP 0136; the screen table is in PR #28):

| Object | Query | Why |
|---|---|---|
| SIMP 0136 | `SIMP J013656.5+093347.3` | Free-floating planetary-mass T dwarf (12.7 ± 1.0 MJup) with methane and CO bands. Published type T2.5 (Gagné et al. 2017); the cached SIMBAD reply says T2.0, so the card shows T2.0. |
| TWA 27 (2M1207 A) | `TWA 27` | Host of 2M1207 b, the first directly imaged planetary-mass companion (Chauvin et al. 2004). Every point has S/N above 11. |
| IRAS 04302+2247 | `IRAS 04302+2247` | Young star with an edge-on protoplanetary disk; water and CO₂ ice bands at 3.05 and 4.27 µm (Aikawa et al. 2012). |

- PSO J318.5−22 was picked first and dropped: at the SPHEREx epoch (2025.8) a 2MASS star 1.3 mag brighter in J lies 17.3″ (2.8 px) away, inside the 3 px aperture. Its measured flux is 2.5× the 2MASS value at J and 1.8× at K.
- **Neighbours** at the median frame time (2026.0 to 2026.1), proper motions from SIMBAD (targets) and Gaia DR3 (neighbours), 6.15″ per pixel; aperture 3 px (18.5″), annulus 6 to 9 px (36.9″ to 55.4″):
  - SIMP 0136 has moved about 31″ since 2MASS (1.24″/yr). No 2MASS or Gaia source is inside its aperture. Two AllWISE sources at 9.9″ and 12.7″ (W1 16.9 and 16.8) are, about 5 mag fainter in W1 (about 1 % each). The annulus holds only sources at least 3.7 mag fainter in W1.
  - TWA 27: a 2MASS source at 8.6″ (1.4 px), 2.4 mag fainter in J and 2.9 in K, is inside the aperture and adds roughly 7 to 11 %. A star as bright as TWA 27 in J is at 37.3″ (6.07 px), on the inner edge of the annulus; fainter stars at 36.0″, 39.5″ and 43.1″ are in it.
  - IRAS 04302+2247: a 2MASS source (J 15.0, W1 13.3) at 54.0″ (8.8 px) is in the annulus; nothing else brighter than W1 15.3 lies within 9 px.
  - The sigma-clipped background is expected to reject most of an annulus source.
- **Saturation margins** against the quoted limit of about 11.7 to 9.7 AB ([A3.1](data-sources.md#a31-spherex-irsa), **[verify]**): SIMP 0136 and TWA 27 are at least 2 mag fainter than 11.7 AB in 2MASS J and K and WISE W1 and W2. IRAS 04302+2247 is closer: 1.9 mag in K (13.56 AB, an E-quality 2MASS magnitude), 1.4 mag in W1 (13.06 AB) and 1.1 mag in W2 (12.81 AB); its margin rests on its own full-cache result (no saturated source in any frame). AB = Vega + 0.894 (J), + 1.840 (K) from the 2MASS zero points (Cohen et al. 2003) and + 2.699 (W1), + 3.339 (W2) from the WISE All-Sky Explanatory Supplement Sect. 4.4.h **[verify]**.
- **Dead core pixels:** the one `saturated` refusal on TWA 27 and on IRAS 04302+2247 is a NaN core pixel flagged `NONFUNC` as well as `OVERFLOW`, not a saturated source.
- **Caveats the UI and pitch must say** (wording in [A11](honesty-policy.md#a11-honesty-policy-user-facing)): TWA 27 is 2M1207 A and b blended (0.8″ apart, inside one pixel), not the planet's spectrum; IRAS 04302+2247 is extended, so its flux is an aperture flux, and every point is flagged `no_proper_motion`; SIMP 0136 varies by about 5 % in J over about 2.4 h (Artigau et al. 2009) **[verify]**, comparable to its 3 % median error. No flux carries an aperture correction (Q-23).
- **WISE 0855** (a test target): its short-wavelength spectrum is probably a neighbour's (Q-96, open).

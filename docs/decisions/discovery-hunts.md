# Decisions: Discovery hunts

> **Part of:** the decision log ([index](README.md)) · **Holds:** the decisions of [A22.15](../architecture/discovery-hunts.md#a2215-decisions) (R-0 to R-28, R-51 to R-54 and the PD rows), registered by HN-0 (issue #203) as Q-487 to Q-528 · **Authority:** highest; an entry here wins over [rendering/](../rendering/README.md) and [architecture/](../architecture/README.md) (see the index for precedence)

Each entry is the A22.15 row **verbatim**, so where wording is later corrected, correct both. **Not registered yet:** R-29 to R-49 (they wait for V37, ticket #195; HN-0 registers them when it closes), R-50 (a process note, not a decision), and PD-1 and PD-2 (superseded by R-0). Cross-references inside the text (R-n, PD-n) stay as written; the table below maps them to their IDs.

## Map from A22.15 to this log

| A22.15 | ID |
|---|---|
| R-0 | Q-487 |
| R-1 | Q-488 |
| R-2 | Q-489 |
| R-3 | Q-490 |
| R-4 | Q-491 |
| R-5 | Q-492 |
| R-6 | Q-493 |
| R-7 | Q-494 |
| R-8 | Q-495 |
| R-9 | Q-496 |
| R-10 | Q-497 |
| R-11 | Q-498 |
| R-12 | Q-499 |
| R-13 | Q-500 |
| R-14 | Q-501 |
| R-15 | Q-502 |
| R-16 | Q-503 |
| R-17 | Q-504 |
| R-18 | Q-505 |
| R-19 | Q-506 |
| R-20 | Q-507 |
| R-21 | Q-508 |
| R-22 | Q-509 |
| R-23 | Q-510 |
| R-24 | Q-511 |
| R-25 | Q-512 |
| R-26 | Q-513 |
| R-27 | Q-514 |
| R-28 | Q-515 |
| R-51 | Q-516 |
| R-52 | Q-517 |
| R-53 | Q-518 |
| R-54 | Q-519 |
| PD-3 | Q-520 |
| PD-5 | Q-521 |
| PD-6 | Q-522 |
| PD-11 | Q-523 |
| PD-12 | Q-524 |
| PD-13 | Q-525 |
| PD-14 | Q-526 |
| PD-15 | Q-527 |
| PD-16 | Q-528 |

## Questions

| ID | Decision (A22.15 row) | Owner | Status |
|---|---|---|---|
| Q-487 | **R-0.** **Purpose:** a scientific tool meant for research. Outputs are tables usable in a paper: standard formats, provenance, completeness and purity, selection function, reproducibility. Supersedes PD-1 (the first draft's direction: an outreach tool for the public, students and amateurs) and PD-2 (the ten hunts grouped by an ordinary user's odds of a credited find). | Moon | Decided (Moon, 18 Nov 2026) |
| Q-488 | **R-1.** **SPHEREx is the characterisation layer,** not the discovery data. | Moon | Decided |
| Q-489 | **R-2.** **Datasets.** Release 1: SPHEREx DR1, CatWISE2020 and unWISE/unTimely, Gaia DR3 (DR4 after 2 Dec), ZTF DR24 light curves. Release 2: TESS full-frame-image shift-and-stack (H11), DECam archive and NOIRLab Source Catalog with multi-night linking (H4b). IASC dropped. | Moon | Decided |
| Q-490 | **R-3.** **H4 candidates** need detections on at least 2 nights, at least 3 tracklets, an orbit fit passing a χ² test against a calibrated astrometric error model, and a measured false-link rate. Anything less is `possible`. Amends Q-146 (3)'s "unexplained track (a lead)" and A16.5's "unexplained track" / "a lead for follow-up" wording; the card change is R-14. | Moon | Decided (Moon, 18 Nov 2026); wording corrected and confirmed by Atish (code owner), 20 Nov 2026 |
| Q-491 | **R-4.** **Export first.** Every hunt exports the reproducibility bundle (VOTable or ECSV with provenance, selection function and MOC, calibration, method text, citation file; ADES for H4). "Prepare a submission" only for verified routes that take outside data (VSX, Backyard Worlds, RNAAS drafts; the MPC once a code exists). Zooniverse routes dropped. No "Your credit" wording. A Zenodo DOI per tool release. | Moon | Decided |
| Q-492 | **R-5.** **Calibration** against expected signal-to-noise; completeness and purity as functions with intervals; purity from controls (and held-out data) separately from the gate; per-patch injection offered to the user. | Moon | Decided |
| Q-493 | **R-6.** **No silent caps.** A count query before the run; any limit is a stated selection criterion written into the output. Cuts always in the archive's query. | Moon | Decided |
| Q-494 | **R-7.** **H6 lenses removed.** | Moon | Decided (settles PD-9, which asked whether lenses stay in "Good chance" or move to "Possible") |
| Q-495 | **R-8.** **No learning mode.** H7 becomes a context layer; H9 becomes SPHEREx characterisation of excess candidates; H10 becomes a cross-match with Gaia DR4's own black-hole table plus our refit. Release 1: H1, H2, H4, H8, H9, and H7 as context; release 2: H3, H5, H11, H4b. Picker grouped by readiness (Validated, Characterisation, Experimental, Context). | Moon | Decided (settles PD-7, which asked which hunts the picker ticks by default: now Validated and Characterisation) |
| Q-496 | **R-9.** **Time estimate** = the heavy lane's total plus bandwidth contention, from measured per-unit costs. **One pause rule:** both lanes stop at their next unit boundary and the scan leaves the worker (Q-470 (7)). | Moon | Decided |
| Q-497 | **R-10.** **Coverage.** Squares for pixel hunts only; catalogue and light-curve hunts report coverage for the whole patch as a MOC, part of the selection function. | Moon | Decided (settles PD-8, which marked a square done when every ticked hunt had finished it) |
| Q-498 | **R-11.** **Measured only** hides statuses and totals that come from catalogue matches, as Q-479 (1); only measured detections and their counts show. | Moon | Decided |
| Q-499 | **R-12.** **Ask first:** the MPC (SPHEREx observatory code, archive program code, ADES spacecraft fields) before HN-11's ADES export and HN-16; the Gagné et al. team before H2's typing stage; and the licence of every table, model grid, code and network shipped. | Moon | Decided |
| Q-500 | **R-13.** **Mock-up section 5 cut** to a pointer to this spec; the data-path and per-hunt signal diagrams stay as a visual appendix. | Moon | Decided (19 Nov) |
| Q-501 | **R-14.** **Pairs on the results card** (amends Q-146 (3), A16.5 track wording and A18 as built, area-ui.md; Q-483 (4) itself already speaks of single-visit possibles): "unexplained pair · possible", listed in a visible section "Pairs: 1 night only (n)"; not hidden. | Moon | Decided (19 Nov) |
| Q-502 | **R-15.** **Gate labels:** "reference fields, once per version", "fixture, once per version" (H5, H8, H10), "every run" (H4). | Moon | Decided (19 Nov) |
| Q-503 | **R-16.** **H8's route to Validated:** expected S/N = peculiar speed / its uncertainty; controls = motions drawn from the local distribution, plus parallax and motion redrawn within their errors (the second per R-51). | Moon | Decided (Moon, 19 Nov 2026); wording corrected and confirmed by Atish (code owner), 20 Nov 2026 |
| Q-504 | **R-17.** **Offline plan** (amends Q-470 (8)): cached counts only; otherwise "Size not known offline", and only hunts with cached inputs run. | Moon | Decided (19 Nov) |
| Q-505 | **R-18.** **Pause with two lanes** (amends Q-470 (7)): refused only while every lane that still has work is on its last unit (a finished lane does not count). | Moon | Decided (Moon, 19 Nov 2026); wording corrected and confirmed by Atish (code owner), 20 Nov 2026 |
| Q-506 | **R-19.** **Bundle and Measured only** (amends Q-479 (7) for hunt bundles): the bundle is always complete, every column tagged; the export dialog says so. | Moon | Decided (19 Nov) |
| Q-507 | **R-20.** **H4 known-object match** keeps A16.5's `model_dependent` tag. | Moon | Decided (19 Nov) |
| Q-508 | **R-21.** **Injected badge** (A16.5) on every planted object, including per-patch injection. | Moon | Decided (19 Nov) |
| Q-509 | **R-22.** **Calibration cost cap for version 1:** 3 to 4 S/N bins, shipped reference fields only, about 1,000 injections per field per hunt, cost recorded in the table; per-patch injection in release 2 with its estimate in the plan. | Moon | Decided (19 Nov) |
| Q-510 | **R-23.** **First H4 error model:** A4 centroids of known rocks above S/N 10, cross-checked against Track's Eros fixtures. | Moon | Decided (19 Nov) |
| Q-511 | **R-24.** **Multi-day linking, the orbit fit and stacking (stages D and E) move to release 2** (V2 and fitter licences first). Release 1 H4: known rocks plus pairs. | Moon | Decided (Moon, 19 Nov 2026); wording corrected and confirmed by Atish (code owner), 20 Nov 2026 |
| Q-512 | **R-25.** **Held-out years** where possible, not required for Validated. | Moon | Decided (19 Nov) |
| Q-513 | **R-26.** **Download budget enforced before the run:** above 50 GB per hunt (a setting) the row needs a stated limit before Run is enabled. | Moon | Decided (19 Nov) |
| Q-514 | **R-27.** **Release 1 minimum:** HN-0, 1, 2, 3, 4b, 5, 6. A hunt's calibration ships in its own ticket; no separate "Validated" tickets. | Moon | Decided (19 Nov) |
| Q-515 | **R-28.** **Hubble and JWST archives** left out on purpose (small fields; Asteroid Hunters covers Hubble). | Moon | Decided (19 Nov) |
| Q-516 | **R-51.** **Second controls for R-31:** H2 stationary CatWISE sources with the same colours and magnitudes; H5 known inactive asteroids of similar brightness; H8 the same search with parallax and motion redrawn within their errors. A hunt with one control cannot be Validated. | Atish | Decided (Atish, code owner, 20 Nov 2026) |
| Q-517 | **R-52.** **Ambiguous pairs** (A17.4) are listed in the visible "Pairs: 1 night only (n)" section as "ambiguous pair · possible"; each possible carries a kind (`single_visit`, `pair`, `ambiguous_pair`) and "Show possible (n)" hides `single_visit` only (amends A18 as built). | Atish | Decided (Atish, code owner, 20 Nov 2026) |
| Q-518 | **R-53.** **Stale gate:** while its gate is stale (R-34) a Validated hunt shows as Experimental, "gate out of date", until the gate re-runs. | Atish | Decided (Atish, code owner, 20 Nov 2026) |
| Q-519 | **R-54.** **Bundle release split** (refines R-39, R-40): release 1 ships VOTable and ECSV with provenance tags, selection function, MOC, ADQL per cut, methods text, `provenance.json` and `cite.md`; the RO-Crate root, PROV export, DataLink and the ASCL entry come in release 2. | Atish | Decided (Atish, code owner, 20 Nov 2026) |
| Q-520 | **PD-3.** Rates on the row card: the value at the row's own expected signal-to-noise, with its interval. Amends A16.5 (area-search.md, "no single figure goes into a card"), Q-203 (1) and A16's "completeness only as the grid for the squares tested" **for that per-row value only**, and Q-203 (5) and A16.5's "for the square tested" because the value is an average over the reference fields, labelled as such (R-30); the ban stays for any overall catch rate, on a card, an announcement or the export headline. A18.11 to be amended to match at the sync. | Moon | Decided (Moon, 19 Nov 2026); wording corrected and confirmed by Atish (code owner), 20 Nov 2026 |
| Q-521 | **PD-5.** **Tag boundary.** A period, depth, motion or profile computed directly from measured points with its uncertainty is `measured`; anything needing a model or a catalogue parameter is `model_dependent`; classifier outputs are `derived`. Measured statistics still inherit the hunt's cuts (R-49). | Moon | Decided (Moon, 19 Nov 2026) |
| Q-522 | **PD-6.** The selection label drops its time estimate once hunts exist. | Moon | Decided (Moon, 19 Nov 2026) |
| Q-523 | **PD-11.** **Contract** of A22.7: `hunts` and `options` on `POST /v1/scans` defaulting to `["asteroids"]`; rows, ids after the merge, `rows_ready`; `seed` and `software`; the bundle and inject routes. Extends Q-470 and Q-471. | Moon | Decided (Moon, 19 Nov 2026) |
| Q-524 | **PD-12.** **Two lanes** owned by the scan job, with per-archive limits shared by both. Extends Q-470 (6). | Moon | Decided (Moon, 19 Nov 2026); Kevin to confirm feasibility in HN-1 |
| Q-525 | **PD-13.** **Wording** of A22.3.6. Extends A16.5. | Moon | Decided (Moon, 19 Nov 2026) |
| Q-526 | **PD-14.** **H4 first:** the audit and the every-run gate before any search hunt is Validated. | Moon | Decided (Moon, 19 Nov 2026) |
| Q-527 | **PD-15.** Owners of the tickets in A22.12. | Moon | Decided (Moon, 19 Nov 2026), under D-17; `app/sky/HuntMarkers.tsx` under Moon confirmed, as it is outside `app/sky/area/` (Q-406 (7)) |
| Q-528 | **PD-16.** **Determinism** on the CPU path only; the GPU path is tested for agreement within a tolerance; stored results name the path. Amends the determinism rule for GPU work. | Moon | Decided (Moon, 19 Nov 2026) |

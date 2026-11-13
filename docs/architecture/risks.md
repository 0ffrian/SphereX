# Risks and open questions

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A14–A14.1 · **Implements:** [D-14, D-29, Q-137](../decisions/scope-process.md), [D-19, D-25, D-31, Q-328](../decisions/data-sources.md), [D-37](../decisions/rendering-engines.md), [D-24, Q-132](../decisions/platform-hosting.md), [D-09](../decisions/haptics-design.md), [D-10](../decisions/haptics-sound.md), [Q-136, Q-139, Q-141, Q-146](../decisions/moving-objects.md), [Q-112](../decisions/pipeline-jobs.md) · **Read with:** [plan.md](plan.md) (A13), [../decisions/README.md](../decisions/README.md)

## A14 Risks and open questions

As of 9 Nov 2026. Status: **Open** (no mitigation in place), **Mitigated** (a mitigation is built or decided), **Accepted** (the team takes the risk).

**For the event (14 to 15 Nov, desktop browser on the A15, Q-132):**

| Risk or question | Why it matters | Plan | Owner | Status |
|---|---|---|---|---|
| Track MVP depends on Q-141 and Q-126/Q-140 | Track (Q-137) takes its frames from PR #53's path search (merged, issue #26); its path endpoint and frame source (MOST or path cones) are open proposals; no Track issue is opened | Build Track on PR #53's recorded Eros fixtures; open the Track tickets T1 to T4 (A19.14, A20.15); fall back to the flipbook and spectrum demo objects | Atish (screen), Kevin (backend) | Open |
| Mover rule built (issue #72) | Q-139 (OUTLIER as a flag) is built (Q-460): 14 of 16 Eros frames give a point. Q-138 (SPHEREx-centred positions) is built for the frame search (issue #26); SkyBoT is still geocentric (next row) | None for Q-139; run the Eros pre-fetch (#73) after the `measure-2` bump ([A4.2](pipeline.md#a42-stage-2-measure-brightness-and-spectrum)) | Moon (Q-139) | Built |
| SkyBoT positions are geocentric | Known objects and the Discovery match could be off by the LEO parallax | Proposed Q-180: SkyBoT lists candidates, positions come from Horizons seen from SPHEREx ([A3.5](data-sources.md#a35-imcce-skybot), A17.5); built for Area search in issue #108 ([Q-420](../decisions/moving-objects.md) (7)) | Kevin | Open |
| Area search Day 0 gate | Discovery may not find Eros blind | Gate of A16.7: keep Known objects and Track, show the five steps with real counts and no tracks. Passed offline on the recorded-fixture Eros area (issue #108, [A16.6](moving-objects/area-search.md#a166-open-items-and-measured-facts)); the live area run (D3) is still to do | Kevin | Open |
| DR1 expected on 12 Nov **[verify]** | DR1 renames collections and flag keywords | Freeze on QR2 with the local cache; no switch before the event (Q-137) | Kevin | Mitigated |
| JPL Horizons terms | One request at a time with a User-Agent; over-limit replies are HTTP 200 text | Never cache such a reply; pre-fetch every path before the event; offline at the event (Q-141, [A3.4](data-sources.md#a34-jpl-horizons)) | Kevin | Open |
| CDS permission for high-resolution imagery | An offline partial copy of Pan-STARRS or Legacy Surveys needs CDS agreement | Ask CDS; until then use 2MASS around the path (Q-136) | Atish | Open |
| Hosting on the A15 not built | `main.py` serves no frontend; the only full cache is on Atish's PC, not on the A15 | #15; interim run with `vite preview` (Proposed Q-198, [A10.2](frontend-platform.md#a102-running-the-event-build)); copy the zipped cache to the A15 | Kevin | Open |
| Warm start skips Eros | `SX_PREFETCH_GROUPS=demo` did not include 433 Eros (group `fixture`) | Proposed Q-197 ([A3.12](targets.md#a312-test-and-demo-targets)) | Kevin | Mitigated (#73, 11 Nov 2026): Eros is in group `demo`, first of the demo rows with frames, so the warm start covers it; Q-197 still needs sign-off |
| A15 speed unmeasured | Demo may stutter; frame times exist only in headless Chromium | Measure on the A15 early (#16); lower point and triangle counts if needed (R5.5) | Atish | Open |
| Sound never heard on the demo machine | Sound is the only non-visual channel at the event (Q-132) | Test on the A15 speakers; a venue PA may be mono, so direction is never carried by pan alone (Q-134) | Atish | Open |
| Pending sign-offs | D-14 (Kevin, Moon), D-31 (Moon), D-33 and D-34 (team), Q-113 and Q-121 (Moon) are built but not confirmed | Confirm or amend before 13 Nov; record in `docs/decisions/` | Team | Open |
| SPHEREx search is slow and fails | The base tool depends on it | Read-through cache for every external call, filled by the pre-fetch script; the demo runs with `SX_OFFLINE=1` (D-25) | Kevin | Mitigated |
| Venue internet fails | Live calls and the Gemini layer fail | The demo runs offline from the cache (D-25). The Gemini layer stays off and the code path shows (D-24) | Kevin | Mitigated |
| SPHEREx saturates on bright targets | Barnard's Star and R Dra get no measured point and RW Aur only 15 (counts: [A4.2](pipeline.md#a42-stage-2-measure-brightness-and-spectrum)) | Keep the saturated frames as honest refusals; show spectra on the demo objects of [A3.12](targets.md#a312-test-and-demo-targets) (D-31) | Atish | Mitigated |
| Building before 14 Nov | The event rules say not to build before the event | The team's call and risk (D-14) | Team | Accepted |
| NEOWISE access unconfirmed | Diameter and albedo | Use SBDB values (A3.3) | Kevin | Mitigated |
| Exoplanet Archive thresholds unverified | Planet cards | Adapter tested live 2026-11-07 (Q-63). The radius, mass and Zeng 2019 cut-offs are on since issue #68: Moon signed off Q-63 after a source check (1.5 and 6 R_E are project cuts based on the cited papers; the mass cut is as published). Residual risk: the radius and mass cuts disagree for 6-10 R_E planets (recorded in Q-63) | Moon | Mitigated |
| SIMBAD's CDS host unreachable from the dev machine | Star and brown dwarf types | The backend tries CDS then the Harvard mirror (`SX_SIMBAD_TAP_URLS`, tested 5 Nov; A3.10) | Kevin | Mitigated |
| CORS to science services unknown | The browser may be blocked | Backend proxy (A10) | Kevin | Mitigated |
| Gemini model name may change | Code would break | Read from `SX_GEMINI_MODEL`; the name stays **[verify]** (A6.2) | Atish, Kevin | Mitigated |
| Gemini key exposure | Key theft | Server-side call only; admin route needs `SX_ADMIN_TOKEN` (A6.2) | Kevin | Mitigated |
| Two specs drifting apart | Code is built to conflicting rules | `decisions/` and the precedence in [docs/README.md](../README.md); record cross-cutting decisions as the next D- number | Team | Mitigated |
| Time: 5 days left | Not everything lands | Follow the tiers ([A1.1](overview.md#a11-priority-tiers)); cut from the bottom: Discovery before Known objects, Gemini, imagined drive | Team | Accepted |
| Overclaiming | Scientists may reject unsupported claims | Badges, formulas, A11 labels, A16.5 wording ("unexplained track", never "a discovery") | Team | Mitigated |

**After the event** (phones and vibration, Q-132): venue Wi-Fi blocking device-to-device traffic (bring a router, D-24); WebGPU on phones needs HTTPS with a local root certificate (`mkcert`; whether a clicked-through self-signed certificate is enough is **[verify]**, D-24); no vibration on iPhone, iPad or desktop (audio pairing, D-10); `navigator.vibrate` needs a prior user gesture (start from a tap); 8 ms pulses may not be felt (calibrate `minMs` and levels per phone, D-09); battery saver may suppress vibration **[verify]**; Bluetooth audio latency puts sound and touch out of sync (use the phone speaker; measure the offset, A12). Owner: Atish.

### A14.1 [verify] register

Every **[verify]** marker in the architecture fragments, with an owner, the ticket that carries it (D-29) and when it must be settled. Area search thresholds are listed in [A16.6](moving-objects/area-search.md).

| Item | Where | Owner | Ticket | By |
|---|---|---|---|---|
| Revisit within about 0.8 days vs passes of 0.7 to 88 days (Q-148) | A3.1 | Kevin | D1 Day 0 | 10 Nov |
| Polite IRSA concurrency (`SX_CUTOUT_CONCURRENCY=6`) | A4.10 | Kevin | Q-112, #15 | before the last pre-fetch (12 Nov) |
| HiPS credit line per provider | A3.11, A11 | Atish | D-35, #15 | 13 Nov |
| A15 laptop GPU, browser and WebGPU (WebGL2 fallback on a real GPU) | A10, A10.1 | Atish | #16 | 13 Nov |
| A15 laptop sky depth (tile sizes per order) | A3.11 | Atish | Q-88 | 12 Nov |
| DR1 release date | A3.1 | Kevin | Q-137 | none (frozen on QR2) |
| MOST positions SPHEREx-centred or geocentric | A4.1 | Kevin | Q-140, Track | before Track uses MOST |
| SkyBoT largest cone radius and terms of use | A3.5 | Kevin | D1 | before D1 uses SkyBoT |
| CDS permission for a partial high-resolution copy | A3.11 | Atish | Q-136 | before any copy |
| SIMP 0136 variability; AB offsets for J, K, W1, W2 | A3.12 | Atish | D-31 | 13 Nov (caveat text) |
| Gas giant typical zonal wind 50 m/s (`TYPICAL_ZONAL_WIND_MS`, Rhines band count; Showman, Lewis & Fortney 2015 use about 30 m/s); `bands` stays tier 4 meanwhile (Q-119) | A7.2 | Moon | Q-115, R12 #42 | after the event |
| Exoplanet thresholds (settled: Moon signed off Q-63 after a source check; 1.5 and 6 R_E stay noted as project cuts) | A4.3, A3.8 | Moon | Q-63, #68 (PR #69 merged) | done (9 Nov) |
| Gemini model, aspect ratios, REST shape | A3.9, A6.2 | Atish, Kevin | Q-122, R12 #3 | only if the layer is shown |
| Wavelength WCS `W` read with SIP removed | A3.1 | Kevin | #1 follow-up | after the event (Stage 2 cross-checked against `OMEGA_MEDIAN`) |
| Saturation range and per-band values | A3.1, A3.12 | Atish | D-31 | after the event (refusals do not depend on it) |
| CatWISE `pmra` includes cos δ | A3.3 | Kevin | Q-51 | after the event (display only) |
| DAMIT licence and citation | A3.7 | Kevin | Q-61 | before any DAMIT model is registered |
| FLAGS keyword names on a QR3 or DR1 header | A3.1 | Kevin | Q-31 | after the event (frozen on QR2) |
| A15 frame rate of the D-37 engines (rock engine; two world-engine instances per planet) against ≥ 30 fps while rotating | A10.1 | Atish | D-37, #16, R12 #43 | 13 Nov |
| The Sun's spectral class G2V citation (Gray and Corbally 2009) on the `ref-sun` card | A4.1 | Kevin | Q-328 | 13 Nov (card text) |
| Phone items: self-signed certificate, battery saver, vibration amplitude | A14 post-event, A9 | Atish | Q-132 | after the event |

**Closed:** the Horizons geocentre marker of A3.4 is settled by Q-138 (SPHEREx-centred); the frame search uses the SPHEREx observer since issue #26 (A3.4).

# Data sources: catalogues, shape models and sky

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A3.6–A3.11, A3.13 · **Implements:** [D-07](../decisions/gemini.md), [D-19, D-25](../decisions/data-sources.md), [D-35, Q-87, Q-88](../decisions/sky-shell.md), [Q-61](../decisions/pipeline-jobs.md), [Q-63](../decisions/pipeline-stages.md), [Q-136](../decisions/moving-objects.md), [Q-150, Q-168](../decisions/exoplanets.md), [Q-151, Q-152, Q-153, Q-364, Q-366](../decisions/catalogue-values.md), [Q-363](../decisions/contract.md), [Q-359](../decisions/physics-fixes.md), [Q-162, Q-163](../decisions/demo-pack.md) · **Read with:** [data-sources.md](data-sources.md) (A3 intro, A3.1–A3.5), [pipeline-card.md](pipeline-card.md) (A4.3–A4.5)

The second half of [A3](data-sources.md#a3-data-sources): the catalogues behind the ObjectCard, the shape models, the services not used for the base path, the all-sky background and the literature registry (A3.13; A3.12 is [targets.md](targets.md)).

### A3.6 JPL Small-Body Database

| Item | Detail |
|---|---|
| Status | **Tested** |
| Endpoint | `sbdb.api?sstr=<name>&phys-par=1` |
| Attributes | `diameter`, `albedo`, `rot_per`, `spec_B`, `spec_T`, `GM` |
| Note | Each value names its source. For Eros the size came from NEAR, not NEOWISE. |
| Adapter | `backend/app/adapters/sbdb.py`, cache source `sbdb`, base URL `SX_SBDB_URL`. Resolves small-body names first (D-19) and gives `spkid`, the key for Horizons and the shape registry. |

### A3.7 DAMIT

| Item | Detail |
|---|---|
| Status | **Tested** earlier; on 7 Nov 2026 the site returned HTTP 503. The OBJ reader (`backend/scripts/ingest_shape.py`, also used for the Bennu OBJ; it drops unreferenced vertices, Q-163) is built and tested on a synthetic file, but no DAMIT model is registered. Licence and citation terms are **[verify]** (Q-61). |
| File | `damit.cuni.cz/.../AsteroidModel/<id>/shape.obj` |
| Example | One model: 89 KB, 1,022 vertices, 2,040 faces |
| Limit | Shapes are convex, so they miss dips and hollows. Look up the model number from the browse page. |

### A3.8 NASA Exoplanet Archive

| Item | Detail |
|---|---|
| Status | **Tested** 2026-11-07, live and with recorded offline fixtures (`backend/app/adapters/exoplanet_archive.py`) |
| Endpoint | `https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=<ADQL>&format=json` (`SX_EXOPLANET_TAP_URL`); table `pscomppars` (one composite row per planet); ADQL `lower()` works |
| Columns | `pl_name`, `hostname`, `pl_rade`, `pl_radj`, `pl_bmasse`, `pl_bmassj` (each with `err1`/`err2`), `pl_bmassprov` (`Mass`, `Msini`, `Msin(i)/sin(i)`, `M-R relationship`), `pl_dens`, `pl_eqt`, `pl_orbsmax`, `pl_orbper`, `pl_orbeccen`, `st_teff`, `st_rad`, `st_mass`, `st_age`, `sy_dist` (the orbit and host-star columns each with `err1`/`err2`), and `*_reflink` for the radius, mass, `pl_eqt`, `pl_orbsmax`, `pl_orbper`, `st_teff`, `st_rad`, `st_mass` and `st_age`. **Checked 9 Nov 2026 (issue #68):** `st_age` and `st_age_reflink` are columns of `pscomppars`; `pl_bmassprov` has no reflink column; `st_refname`, `pl_refname`, `sy_refname` and `disc_refname` are rejected (HTTP 400). Card fields built from them: Q-150. **Added 11 Nov 2026 (issue #93 section 5 A-B, columns version 3, checked live):** `pl_orbeccenerr1/2` and `pl_orbeccen_reflink` (card `orbit_ecc`; e = 0 with no error is read as a circle fixed in the fit, `model_dependent`), `pl_insol` with errors and reflink (card `insolation_searth`, `derived`), `st_lum` (log10 L/L_sun) with errors and reflink (card `host_lum_lsun` = 10^`st_lum`, `measured`). `pl_eqt_reflink` was already fetched and names the Teq paper. **Radius source (Q-168):** `radius_rjup` is `pl_rade x R_earth / R_Jup` for a planet below the giant cut (`pl_rade` < 6 R_earth, the classifier's `giant_min_radius_earth`), because `pl_radj` is rounded to three decimals; a giant keeps `pl_radj`. |
| Use | Values and type thresholds for `planet_rocky`, `planet_water` and `gas_giant` cards (rule: Q-63, on since issue #68, signed off by Moon; [A4.3](pipeline-card.md#a43-stage-3-classify-and-pick-a-type)). Reached through SIMBAD otype `Pl`; names matched as in Q-63. No row is not an error: the type becomes `candidate` and `exoplanet_archive` goes in `missing`. A planet card's `name` is the archive's `pl_name` ("GJ 1214 b"), not SIMBAD's `main_id`. Calculated archive values (`refstr=CALCULATED_VALUE` in `<column>_reflink`) count as missing for the type rule and are tagged with their assumption on the card (Q-63). |
| Cache | D-25 source `exoplanet_archive`, key `pl_name` = the lower-case candidate names and `cols` = the column-list version, so a reply recorded with fewer columns is never served for a card that needs `st_age`. Version 3 (issue #93) re-keys every planet: re-warm the A15 cache (A10.2). |
| Names (issue #68) | **Tested 9 Nov 2026:** `TRAPPIST-1 f`, `TRAPPIST-1f`, `Kepler-186 f` and `Kepler-186f` all resolve through SIMBAD (otype `Pl`, main id `TRAPPIST-1f` / `Kepler-186f`) and reach the archive row, because `name_candidates` adds the spaced spelling. No alias is needed (Q-151). |
| Calculated values | `refstr=CALCULATED_VALUE` is never `measured` (pscp_calc.html): the radius and mass come from the Chen & Kipping 2017 mass-radius relation (`model_dependent`), `pl_eqt` from the zero-albedo formula (`derived`). A published `pl_eqt` is `derived` too, with the formula and the paper's own albedo and redistribution as its assumption, because an equilibrium temperature is never measured (issue #93, Q-359; it was `measured`). Kepler-186 f's `pl_eqt` (177 K) is not calculated by the archive: it comes from the Kepler KOI table, which assumes a Bond albedo of 0.3 (KOI column docs), so it is not the zero-albedo value. |

### A3.9 Not used for the base path

| Item | Status | Role |
|---|---|---|
| Gemini image models | **Documented** (lists `gemini-nano-banana-2.1` and four others, up to 14 reference images, no mesh output) | Optional artistic layer (P3, D-07; built, [A6.2](generators.md#a62-optional-gemini-artistic-layer)). The model is read from `SX_GEMINI_MODEL` (default `gemini-nano-banana-2.1`); the name, aspect ratios and REST shape are **[verify]** (R12 #3, Atish and Kevin). |
| Gemini Live API | **Documented** (WebSocket, 16 kHz audio in, 24 kHz out, function calling, short-lived tokens for browsers, no session limit stated) | Voice control. Post-event backlog (B-02). |
| Sound-effect services | **Not confirmed** | Post-event backlog (B-03). Procedural sound is the default. |
| TRELLIS, Hunyuan3D, TripoSR | **Not confirmed** | Image-to-3D. Post-event backlog (B-04). |

### A3.10 Added for the object view

These sources come from the rendering doc.

| Item | Status | Use |
|---|---|---|
| SIMBAD | **Tested** 5 Nov 2026 through TAP (`ident.id = '<name>'`, JSON). The CDS host did not answer from the dev machine; the `simbad.harvard.edu` mirror did, so the backend tries both. `WISE 0855` is not a SIMBAD identifier (use `WISE J085510.83-071442.5`). Positions are ICRS epoch J2000; high proper-motion targets move tens of SPHEREx pixels by 2026. | Name resolution and object type, which sets stars and brown dwarfs (rendering doc §3.3; otype mapping Q-55). Resolver order with SBDB: D-19 ([A4.1](pipeline.md#a41-stage-1-find-the-object)). Adapter `backend/app/adapters/simbad.py`, cache source `simbad`, hosts `SX_SIMBAD_TAP_URLS` (CDS, then the Harvard mirror). **Measurement tables (issue #68, Q-152), tested 9 Nov 2026 on the Harvard mirror:** `mesFe_h` (published spectroscopic Teff, log g, [Fe/H]; columns `teff` in K and `bibcode` used) and `mesVar` (variability; `period` in days, `vartyp`, `magtyp`, `bibcode`). Joined through `ident` on `oidref`, plain `WHERE`, no `ORDER BY` (a qualified `ORDER BY mesFe_h.bibcode` is a TAP syntax error). Barnard's Star has 55 non-null Teff rows (3083 to 3530 K); RW Aur has one (3885 K, 2021ApJ...921...53L); R Dra has none. R Dra's `mesVar` has three periods typed LPV or M (246 to 247.2 d); Barnard's `mesVar` rows are typed ROT, which is why the Mira period takes only LPV or M rows. Cache: source `simbad`, key `ident` + `table`. |
| NASA mission shape models | **Tested for Eros (7 Nov 2026)** | Gaskell Eros Shape Model V1.1, PDS4 bundle `urn:nasa:pds:gaskell.ast-eros.shape-model`, DOI 10.26033/d0gq-9427, licence CC0-1.0, ICQ files `data/quad/quad{64,128,256,512}q.tab` (km, body-fixed). The PDS Small Bodies Node host (sbnarchive.psi.edu) refuses scripted clients (403), so the zip is downloaded by hand and ingested from the local file: `uv run python -m scripts.ingest_shape` (see backend README). Eros is registered (Q-61) in `backend/assets/shapes/registry.toml` (`SX_SHAPES_DIR`) and served at `/data/shapes/<slug>.glb` (LOD0, 49,152 triangles) and `<slug>.lod1.glb`. **Comet 67P (Q-162):** Rosetta SPC SHAP5 (Gaskell et al. 2017, PDS dataset `RO-C-MULTI-5-67P-SHAPE-V2.0`, DOI 10.26007/34vg-8s07; the label states no licence, so the registry row cites it through the label's `CITATION_DESC`), PDS3 plate tables in a VRML `.wrl` file (km, Cheops frame), fetched from `pdssbn.astro.umd.edu`. LOD0 is `cg_spc_shap5_050k_cart.wrl` (24,877 vertices, 49,748 plates) and LOD1 the official `…_012k_cart.wrl` (11,716 plates); the reader in `ingest_shape.py` checks the header counts, the `-1` face terminators and the 0-based plate indices. **Bennu (Q-163) is registered.** The OSIRIS-REx altimetry bundle (`urn:nasa:pds:orex.altimetry` v1.0, DOI 10.26033/pzcf-qs69, SPOv54, OBJ in km, 49,152 triangles, 24,578 vertices) sits behind a Cloudflare challenge on `sbnarchive.psi.edu`, so the OBJ was downloaded in a browser and ingested with the command in `backend/assets/shapes/README.md`; its key is SBDB spkid `20101955`. The licence (CC0-1.0) and the OBJ header's `DATASRC = SPC` against the SPO file name are still **[verify]**. Vesta is not registered. Real meshes (GLB) for `asteroid_shape`, inside the 50k-triangle mesh budget ([R5.5](../rendering/display-rules.md)). |

### A3.11 Sky background (IRSA HiPS)

Built in issue #47 (PR #49, merged 8 Nov 2026). Not SPHEREx data: an all-sky picture behind the search, for context (Q-88). The sky view that draws it is A21 ([sky-shell.md](sky-shell.md)); the routes are listed in [A4.11](endpoints.md#a411-endpoint-register).

| Item | Detail |
|---|---|
| Status | **Tested** 7 Nov 2026 (mirror and bake run on the dev PC). The survey, its tag and the A15 depth are open (Q-88). |
| Surveys | IRSA's 2MASS colour HiPS (`2mass_color`: R = Ks 2.16 µm, G = H 1.66 µm, B = J 1.23 µm, sqrt-stretched by CDS), the default; AllWISE colour (`allwise_color`: W4/W2/W1) registered as an alternative. Base URLs and credit lines are in `backend/app/core/sky/surveys.py`. |
| Local copy | `scripts.sky_mirror` copies the tiles to `{SX_CACHE_DIR}/sky/<survey>/hips/` in IRSA's layout, lowest orders first, at most 4 requests at a time; `scripts.sky_bake` bakes equirectangular JPEGs next to them (4096×2048 and 8192×4096). Orders 0–4 on a dev machine: about 357 MB (D-35). See [backend/README.md](../../backend/README.md#sky-background-prototype). |
| Never at request time | The copy is separate from the D-25 read-through cache. `/v1/sky/…` serves only files already on disk and never fetches upstream; `scripts.sky_mirror` refuses to run under `SX_OFFLINE=1` (Q-87). |
| Licence | Both `properties` files say `hips_status = public mirror unclonable`. A local, non-redistributed copy is accepted for this project, with the survey credit always shown next to the sky and `--allow-unclonable` required to mirror (D-35). The UI shows the `credit` string of `surveys.py` next to the sky (D-35). The exact credit line each provider asks for is **[verify]** (`surveys.py`; Atish). |
| Budget | Under 1 GB on dev machines, up to 50 GB on the A15 (D-35). A15 depth: Q-88. |
| High resolution, Track only ([Q-136](../decisions/moving-objects.md), decided for scope 9 Nov 2026; owner Atish) | No high-resolution survey on the sky background. A sharper image is used only around the object's path in the Track detail view (A19, [moving-objects/track.md](moving-objects/track.md)). Candidates: Pan-STARRS DR1 colour (Dec above −30°) or Legacy Surveys DR10 colour (about 67 % of the sky), both HiPS order 11 (about 0.2″ per pixel), with 2MASS as the fallback; DSS2 is order 9 and adds nothing. An offline partial copy needs CDS agreement, taken from the CDS master **[verify]** (CDS permission open, Atish). IRSA's HiPS list says not to mirror HiPS marked "unclonable", which is the status of the 2MASS colour copy already mirrored; D-35's local, non-redistributed use stands. **To build.** |

### A3.13 Literature registry (`literature.toml`)

Added by issue #68 (Q-153). A curated, read-only table of values for objects the catalogues leave empty, in the same spirit as the shape registry (A3.10, Q-61) and `targets.toml` (A3.12). It is reviewed config, not a model output: no LLM and no code writes it.

| Item | Detail |
|---|---|
| File | `backend/assets/literature.toml` (`SX_LITERATURE_FILE`). A missing or broken file means no literature values (a warning, never a crash); a row that breaks a rule below is skipped with a warning. |
| Key | The SBDB SPK-ID for a small body; the card's object id (for example `simbad-eps-ind-b`) for anything else, because stars and brown dwarfs have no SPK-ID. |
| A row | `key`, `field` (an ObjectCard field), `value` (a number, or a list for a pair field), optional `err`, `tag`, `citation` (paper) and `table` (table or section), `note`. `[[refusal]]` rows (`key`, `field`, `reason`) keep a field refused and say why. |
| Tag rules | The tag follows the source. A measurement is `measured`. A number computed from an assumed input is `model_dependent`, with that input in `assumption` (for example a diameter from an assumed albedo). `derived` needs a `formula`. `citation` is required. The card's `source` reads `literature: <citation>, <table> (backend/assets/literature.toml)`. |
| Use | Stage 4 fills a card field from it **only when the catalogue value is null**, and only for a field the object's type already writes. It never overrides a catalogue value. One exception is by design: a registry `radius_rsun` (an interferometric radius) goes before Gaia FLAME, which is a model value (Q-152); no such row exists yet. |
| Rows today | 1I/'Oumuamua (SPK-ID 50788063 (SBDB; recorded reply in `backend/tests/fixtures/cache`)): `lightcurve_amp_mag` 2.5 mag (`measured`), `diameter_km` 0.204 and `albedo` 0.04 (`model_dependent`: the albedo is assumed), all from Meech et al. 2017, Nature 552, 378. `slope_075_25` is refused: the paper's 23 ± 3 %/100 nm slope is optical (g to Y), the field covers 0.75 to 2.5 µm, and its unit is not settled. Epsilon Indi Ba and Bb: `component_teff_K` 1312 ± 13 K and 972 ± 13 K (`model_dependent`, Chen et al. 2022, AJ 163, 288; the table number is **[verify]**). Issue #93 (Q-364): `rot_period_h` for ε Eri (Petit et al. 2021), Barnard's Star (Toledo-Padrón et al. 2019) and TRAPPIST-1 (Luger et al. 2017); `flare_rate_per_d` for TRAPPIST-1 (Luger et al. 2017), refused for ε Eri and Barnard's Star; `dayside_temp_K`, `nightside_temp_K` and `hotspot_offset_deg` for HD 189733 b (Knutson et al. 2012; Bell et al. 2021), WASP-39 b (dayside only, Kammer et al. 2015) and 55 Cnc e (Demory et al. 2016). Rotation periods are in hours (the paper's days × 24). |
| Not in it | WISE 0855's `flux_45um` (no cited value), Barnard's Star's interferometric radius (Lane et al. 2001, 0.201 ± 0.008 R☉, was seen only second-hand: **[verify]** before adding), any value from memory. |
| Dwarf Teff table | `backend/assets/pm13_dwarf_teff.toml` is the same kind of file: Pecaut & Mamajek 2013, ApJS 208, 9, Table 5 (updated online version 2022.04.16), main-sequence Teff by spectral type O9V to M9V. It is the third source for a star's `teff_K` (Q-152), dwarfs only; no verified table exists for M giants, Miras or pre-main-sequence stars. |

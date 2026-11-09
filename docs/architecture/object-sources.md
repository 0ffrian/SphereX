# Data sources: catalogues, shape models and sky

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A3.6–A3.11 · **Implements:** [D-07](../decisions/gemini.md), [D-19, D-25](../decisions/data-sources.md), [D-35, Q-87, Q-88](../decisions/sky-shell.md), [Q-61, Q-63](../decisions/pipeline-jobs.md), [Q-136](../decisions/moving-objects.md) · **Read with:** [data-sources.md](data-sources.md) (A3 intro, A3.1–A3.5), [pipeline-card.md](pipeline-card.md) (A4.3–A4.5)

The second half of [A3](data-sources.md#a3-data-sources): the catalogues behind the ObjectCard, the shape models, the services not used for the base path and the all-sky background.

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
| Status | **Tested** earlier; on 7 Nov 2026 the site returned HTTP 503. The OBJ reader (`backend/scripts/ingest_shape.py`) is built and tested on a synthetic file, but no DAMIT model is registered. Licence and citation terms are **[verify]** (Q-61). |
| File | `damit.cuni.cz/.../AsteroidModel/<id>/shape.obj` |
| Example | One model: 89 KB, 1,022 vertices, 2,040 faces |
| Limit | Shapes are convex, so they miss dips and hollows. Look up the model number from the browse page. |

### A3.8 NASA Exoplanet Archive

| Item | Detail |
|---|---|
| Status | **Tested** 2026-11-07, live and with recorded offline fixtures (`backend/app/adapters/exoplanet_archive.py`) |
| Endpoint | `https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=<ADQL>&format=json` (`SX_EXOPLANET_TAP_URL`); table `pscomppars` (one composite row per planet); ADQL `lower()` works |
| Columns | `pl_name`, `hostname`, `pl_rade`, `pl_radj`, `pl_bmasse`, `pl_bmassj` (each with `err1`/`err2`), `pl_bmassprov` (`Mass`, `Msini`, `Msin(i)/sin(i)`, `M-R relationship`), `pl_dens`, `pl_eqt`, `pl_orbsmax`, `pl_orbper`, `pl_orbeccen`, `st_teff`, `st_rad`, `st_mass`, `sy_dist`, and `pl_*_reflink` for the radius, mass, `pl_eqt` and `pl_orbsmax` |
| Use | Values and type thresholds for `planet_rocky`, `planet_water` and `gas_giant` cards (rule: Q-63, built but off until Atish signs off; [A4.3](pipeline-card.md#a43-stage-3-classify-and-pick-a-type)). Reached through SIMBAD otype `Pl`; names matched as in Q-63. No row is not an error: the type becomes `candidate` and `exoplanet_archive` goes in `missing`. A planet card's `name` is the archive's `pl_name` ("GJ 1214 b"), not SIMBAD's `main_id`. Calculated archive values (`refstr=CALCULATED_VALUE` in `<column>_reflink`) count as missing for the type rule and are tagged with their assumption on the card (Q-63). |
| Cache | D-25 source `exoplanet_archive`, key `pl_name` = the lower-case candidate names. |

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
| SIMBAD | **Tested** 5 Nov 2026 through TAP (`ident.id = '<name>'`, JSON). The CDS host did not answer from the dev machine; the `simbad.harvard.edu` mirror did, so the backend tries both. `WISE 0855` is not a SIMBAD identifier (use `WISE J085510.83-071442.5`). Positions are ICRS epoch J2000; high proper-motion targets move tens of SPHEREx pixels by 2026. | Name resolution and object type, which sets stars and brown dwarfs (rendering doc §3.3; otype mapping Q-55). Resolver order with SBDB: D-19 ([A4.1](pipeline.md#a41-stage-1-find-the-object)). Adapter `backend/app/adapters/simbad.py`, cache source `simbad`, hosts `SX_SIMBAD_TAP_URLS` (CDS, then the Harvard mirror). |
| NASA mission shape models | **Tested for Eros (7 Nov 2026)** | Gaskell Eros Shape Model V1.1, PDS4 bundle `urn:nasa:pds:gaskell.ast-eros.shape-model`, DOI 10.26033/d0gq-9427, licence CC0-1.0, ICQ files `data/quad/quad{64,128,256,512}q.tab` (km, body-fixed). The PDS Small Bodies Node host (sbnarchive.psi.edu) refuses scripted clients (403), so the zip is downloaded by hand and ingested from the local file: `uv run python -m scripts.ingest_shape` (see backend README). Eros is registered (Q-61) in `backend/assets/shapes/registry.toml` (`SX_SHAPES_DIR`) and served at `/data/shapes/<slug>.glb` (LOD0, 49,152 triangles) and `<slug>.lod1.glb`. Bennu and Vesta are not; a Bennu shape is part of issue #68 (open, Moon). Real meshes (GLB) for `asteroid_shape`, inside the 50k-triangle mesh budget ([R5.5](../rendering/display-rules.md)). |

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

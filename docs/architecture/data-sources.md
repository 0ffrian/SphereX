# Data sources

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A3–A3.12 · **Implements:** D-07, D-19, D-25, D-31, D-35

## A3 Data sources

Only the attributes listed are fetched. All checks below were run on 4 Nov 2026 unless noted.

### A3.1 SPHEREx (IRSA)

| Item | Detail |
|---|---|
| Status | **Tested** (slow and sometimes fails) |
| Product | Level-2 FITS, about 72 MB per frame, 2040 x 2040 px, 6.15 arcsec per pixel, about 114 s exposure |
| Extensions used | `IMAGE` (MJy/sr), `FLAGS`, `VARIANCE`, `WCS-WAVE` |
| Skipped | `PSF` (101 x 101 x 121, about 5 MB), `ZODI` unless background subtraction needs it |
| Detectors | 6, covering 0.75 to 5.0 micron. One frame covers a range of wavelengths across its field. |
| Revisit | Bands for one spot are captured within about 0.8 days. |
| Search | Simple Image Access: `https://irsa.ipac.caltech.edu/SIA?COLLECTION=spherex_qr2&POS=circle+RA+DEC+RADIUS&MAXREC=N` |
| Cutouts | Work through the same service. Use small cutouts, never whole frames. |
| Storage path | `s3://nasa-irsa-spherex/qr2/level2/<week>/<obs>/<detector>/` |
| Data releases | QR2 (DOI 10.26131/IRSA652), QR3 (DOI 10.26131/IRSA662, began Sept 2026) |
| Known problems | A time filter or a large cone timed out with 504 errors. A tiny cone worked. **Cache every result ahead of time.** Every call goes through the backend's read-through cache, filled by the pre-fetch script; the demo runs offline (D-25). |
| Checked 5 Nov 2026 (backend, issue #1) | A tiny cone (`r = 0.001°`) answers in about 4 s. `MAXREC=2000` timed out at 120 s; `MAXREC=500` returned all 240 frames for Barnard's Star. `QUERY_STATUS=OVERFLOW` marks a cut-off answer. Cutouts: `access_url?center=<ra>,<dec>&size=<deg>` on the IBE URL, 10–30 s each. A cutout holds `IMAGE`, `FLAGS`, `VARIANCE`, `ZODI`, `PSF` (about 4.9 MB, not cached, Q-20) and `WCS-WAVE`. Times: `TIMESYS='UTC'`; the SIA `t_min`/`t_max` midpoint matches `DATE-AVG` to a few ms. Wavelength at a pixel: alternate WCS key `W` (`WAVE-TAB`, table in `WCS-WAVE`), read with the SIP keywords removed **[verify]**. FLAGS bit names are the `MP_<name> = <bit>` header keywords in QR2 (16 flags in pipeline 6.4 frames, 22 in 6.5.6); names and bits match the Explanatory Supplement (SSDC-DP-017 v2.0, Table 16). Later releases may use `MSKNnnnn`/`MSKDnnnn` keywords instead (IRSA tutorials draft PR #401, Q-31) **[verify on a QR3 or DR1 header]**. |
| Saturation (checked 6 Nov 2026, issue #25) | A star that is too bright overflows the detector: its core pixels carry `OVERFLOW`, set when a pixel's charge passes a commandable threshold; the well depth is of order 1e5 e⁻ (Korngut et al. 2026, arXiv:2603.29835). Stage 2 refuses such frames as `saturated` (A4.2); the same reason also covers a dead core pixel (D-31), so the UI words it without a cause (A11). The saturation limit is about 11.7 to 9.7 AB mag depending on the band, with bands 5 and 6 more lenient, as quoted by Clark et al. 2026 (arXiv:2604.22983, Sect. IV.2) from "Table 16 of the SPHEREx Explanatory Supplement". The range and the value for each band are **[verify]** against the Supplement itself; in SSDC-DP-017 v2.0, Table 16 is the flag table (Q-31). Before launch, sources brighter than about 11 AB at 2 µm were expected to saturate (Crill et al. 2024, arXiv:2404.11017). The largest source current with no `OVERFLOW` is about 630 e⁻/s in bands 1–3 and 470 e⁻/s in bands 4–6 (Fazar et al. 2026, arXiv:2608.09862). For scale, the 5σ full-survey depth is 19.5–19.9 AB at 0.75–3.8 µm and 17.8–18.8 AB at 3.8–5.0 µm (Bock et al. 2026, ApJ, doi:10.3847/1538-4357/ae2be2). In this tool, Barnard's Star and R Dra saturate in every frame that is not refused for another reason, and RW Aur keeps only 15 measured points (0.74–1.09 µm); Epsilon Indi B and WISE 0855 measured cleanly (2 objects, not a limit). The demo objects are chosen fainter than the quoted limit (D-31). |
| Not checked | Whether frames exist for 3I/ATLAS on its exact dates. |

### A3.2 Gaia DR3

| Item | Detail |
|---|---|
| Status | **Tested**, 24 s per query |
| Table | `gaiadr3.sso_reflectance_spectrum` through the TAP service |
| Columns | wavelength, reflectance, reflectance error, flag |
| Coverage | Visible light, 60,518 asteroids |
| Use | Visible colour and class of known asteroids. SPHEREx starts at 0.75 micron, so it cannot give visible colour. |
| Source catalogue (overlays, issue #12) | **Tested** 6 Nov 2026. A cone on the source table through TAP (sync, CSV): IRSA `gaia_dr3_source` first (a 0.05° cone answered in about 20 s), then the ESA archive `gaiadr3.gaia_source` (about 60 s; one attempt timed out at 90 s). Both serve the same columns: `source_id, ra, dec, ref_epoch, pmra, pmdec, parallax, phot_g_mean_mag`. Positions are ICRS at `ref_epoch` (J2016.0 in DR3), `pmra` is µα·cos δ in mas/yr. The cone keeps only `phot_g_mean_mag < 20`, brightest first, at most 5000 rows (`overlay:gaia:truncated` when capped). G < 20 is a display cut, not a physical value (Q-52). Mirrors are set by `SX_GAIA_TAP_MIRRORS`. Used by [A4.9](pipeline.md#a49-overlays-flag-mask-and-combine). |
| Astrophysical parameters of one star (issue #68, Q-152) | **Tested** 9 Nov 2026. IRSA serves the table as `gaia_dr3_astrophys_param` (not `astrophysical_parameters`); the ESA archive as `gaiadr3.astrophysical_parameters`. Both join `gaia_source` on `source_id`, so one cone query with a `LEFT OUTER JOIN` returns the source and its values (`backend/app/adapters/gaia.py`, `astro_near`). The SIMBAD position (ICRS, J2000) is first moved to J2016.0 with the SIMBAD proper motion (Barnard's Star moves about 166 arcsec in that time), and the nearest source within 3 arcsec is taken (ASSUMPTION: the radius is a project choice). Columns used: `teff_gspphot` (+ `_lower`, `_upper`), `radius_flame` (+ `_lower`, `_upper`). Results: Barnard's Star (source 4472832130942575872) has `teff_gspphot` 3099.6 K and `radius_flame` 0.2022 R☉; **R Dra and RW Aur have all-null astrophysical parameters**, so Gaia gives them nothing. **Quality:** the Gaia DR3 documentation (Sec 11.4.4) gives no GSP-Phot flag; it says the spectra of cool stars (Teff about 4000 K and below) show molecular absorption that is not modelled well, and extinction affects the result. The pipeline therefore skips `teff_gspphot` at or below 4000 K (`GSPPHOT_COOL_STAR_LIMIT_K`, the docs' own figure) and does not filter `radius_flame` on `flags_flame` (its meaning is not documented here). `radius_flame` is computed from `teff_gspphot`, so it inherits that weakness; it is tagged `model_dependent`. |

### A3.3 WISE / NEOWISE

| Item | Detail |
|---|---|
| Status | **Not confirmed** for diameter and albedo (IRSA TAP timed out twice). **Tested** 6 Nov 2026 for source positions (overlays, below). |
| Use | Diameter and albedo. Take these through the JPL Small-Body Database for now. |
| Source catalogue (overlays, issue #12) | "WISE/NEOWISE sources" are served from **CatWISE2020** (`catwise_2020` on IRSA TAP, sync, CSV), which combines WISE and NEOWISE epochs (Q-51). Checked live 6 Nov 2026 (`TAP_SCHEMA.columns`): `ra_pm`/`dec_pm` are positions at MJD 57170 from the PSF fit with motion; `pmra`/`pmdec` are apparent motions in arcsec/yr (relative, not absolute, noisy for faint sources); `w1mpro_pm` is the W1 profile-fit magnitude. A 0.03° cone answered in about 17 s. Columns: `source_name, ra_pm, dec_pm, pmra, pmdec, w1mpro_pm`; the cone is applied to `ra`/`dec`, brightest W1 first, at most 5000 rows (`overlay:wise:truncated`); a row without `ra_pm`/`dec_pm` is dropped. Whether `pmra` includes cos δ is **[verify]**. **CatWISE2020 has no rows within at least 3′ of R Draconis** (checked live 6 Nov 2026: a box and a cone both return 0, while AllWISE returns sources there), so that target shows no WISE markers (Q-51). AllWISE and the NEOWISE single-exposure table are not used. Used by [A4.9](pipeline.md#a49-overlays-flag-mask-and-combine). |

### A3.4 JPL Horizons

| Item | Detail |
|---|---|
| Status | **Tested**, 3I/ATLAS returned in 1.4 s. The backend uses `COMMAND='DES=<spkid>;'`, `TLIST_TYPE=JD`, `TIME_TYPE=UT` and the geocentre `500@399` **[verify against a SPHEREx-centred ephemeris]**. Positions are predictions, tagged `model_dependent`. |
| Designation | 3I/ATLAS is `C/2025 N1` |
| Use | Position over time for any moving object. Also the phase angle used for lighting (rendering doc §5.1). |
| Lighting | **Tested 7 Nov 2026** (433 Eros). Observer ephemeris with `QUANTITIES='1,24'` and `CENTER='500@-163182'` (SPHEREx) adds the S-T-O phase angle; `EPHEM_TYPE=VECTORS`, `CENTER='500@10'`, `REF_PLANE=FRAME` gives the heliocentric ICRF vector, so the Sun direction is `-r/\|r\|`. Both are taken at the resolve epoch and the geocentre is the fallback if Horizons has no SPHEREx ephemeris (Q-62). Phase angle is tagged `measured` (R5.1), the Sun vector `derived`. |
| Comets (issue #68, Q-151, amends Q-62) | **Tested 9 Nov 2026** (67P, SPK-ID 1000012). A comet seen on several apparitions has one orbit record per apparition, so `COMMAND='DES=1000012;'` answers with the small-body index table and no `$$SOE` block ("Horizons result has no ephemeris block"). The `CAP` flag (closest apparition) selects one record: `COMMAND='DES=1000012;CAP;'` returns the ephemeris (Horizons API documentation, "unique comet selection": `DES=141P;CAP`). It also works for a comet with a single record (C/2025 N1). An asteroid has no apparitions and `CAP` finds no match (`DES=20000433;CAP;` fails), so the backend adds it only when SBDB `kind` starts with `c` (`horizons.command`). |

### A3.5 IMCCE SkyBoT

| Item | Detail |
|---|---|
| Status | **Tested** |
| Endpoint | `ssp.imcce.fr/webservices/skybot/api/conesearch.php` |
| Gotcha | The epoch `-ep` must be a Julian day or `now`. A normal date returned an empty 204 answer. |
| Use | All known objects in a field, with magnitude and motion. |

### A3.6 JPL Small-Body Database

| Item | Detail |
|---|---|
| Status | **Tested** |
| Endpoint | `sbdb.api?sstr=<name>&phys-par=1` |
| Attributes | `diameter`, `albedo`, `rot_per`, `spec_B`, `spec_T`, `GM` |
| Note | Each value names its source. For Eros the size came from NEAR, not NEOWISE. |

### A3.7 DAMIT

| Item | Detail |
|---|---|
| Status | **Tested** earlier; on 7 Nov 2026 the site returned HTTP 503. The OBJ reader (`backend/scripts/ingest_shape.py`, also used for the Bennu OBJ; it drops unreferenced vertices, Q-163) is built and tested on a synthetic file, but no DAMIT model is registered. Licence and citation terms: [verify] DAMIT licence. |
| File | `damit.cuni.cz/.../AsteroidModel/<id>/shape.obj` |
| Example | One model: 89 KB, 1,022 vertices, 2,040 faces |
| Limit | Shapes are convex, so they miss dips and hollows. Look up the model number from the browse page. |

### A3.8 NASA Exoplanet Archive

| Item | Detail |
|---|---|
| Status | **Tested** 2026-11-07, live and with recorded offline fixtures (`backend/app/adapters/exoplanet_archive.py`) |
| Endpoint | `https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=<ADQL>&format=json` (`SX_EXOPLANET_TAP_URL`); table `pscomppars` (one composite row per planet); ADQL `lower()` works |
| Columns | `pl_name`, `hostname`, `pl_rade`, `pl_radj`, `pl_bmasse`, `pl_bmassj` (each with `err1`/`err2`), `pl_bmassprov` (`Mass`, `Msini`, `Msin(i)/sin(i)`, `M-R relationship`), `pl_dens`, `pl_eqt`, `pl_orbsmax`, `pl_orbper`, `pl_orbeccen`, `st_teff`, `st_rad`, `st_mass`, `st_age`, `sy_dist` (the orbit and host-star columns each with `err1`/`err2`), and `*_reflink` for the radius, mass, `pl_eqt`, `pl_orbsmax`, `pl_orbper`, `st_teff`, `st_rad`, `st_mass` and `st_age`. **Checked 9 Nov 2026 (issue #68):** `st_age` and `st_age_reflink` are columns of `pscomppars`; `pl_bmassprov` has no reflink column; `st_refname`, `pl_refname`, `sy_refname` and `disc_refname` are rejected (HTTP 400). Card fields built from them: Q-150. |
| Use | Values and type thresholds for `planet_rocky`, `planet_water` and `gas_giant` cards (rule: Q-63). Reached through SIMBAD otype `Pl`; names matched as in Q-63. No row is not an error: the type becomes `candidate` and `exoplanet_archive` goes in `missing`. |
| Cache | D-25 source `exoplanet_archive`, key `pl_name` = the lower-case candidate names and `cols` = the column-list version, so a reply recorded with fewer columns is never served for a card that needs `st_age`. |
| Names (issue #68) | **Tested 9 Nov 2026:** `TRAPPIST-1 f`, `TRAPPIST-1f`, `Kepler-186 f` and `Kepler-186f` all resolve through SIMBAD (otype `Pl`, main id `TRAPPIST-1f` / `Kepler-186f`) and reach the archive row, because `name_candidates` adds the spaced spelling. No alias is needed (Q-151). |
| Calculated values | `refstr=CALCULATED_VALUE` is never `measured` (pscp_calc.html): the radius and mass come from the Chen & Kipping 2017 mass-radius relation (`model_dependent`), `pl_eqt` from the zero-albedo formula (`derived`). Kepler-186 f's `pl_eqt` (177 K) is not calculated by the archive: it comes from the Kepler KOI table, which assumes a Bond albedo of 0.3 (KOI column docs), so it is not the zero-albedo value. |

### A3.9 Not used for the base path

| Item | Status | Role |
|---|---|---|
| Gemini image models | **Documented** (lists `gemini-nano-banana-2.1` and four others, up to 14 reference images, no mesh output) | Optional artistic layer (P3, D-07). Confirm the model name before coding. |
| Gemini Live API | **Documented** (WebSocket, 16 kHz audio in, 24 kHz out, function calling, short-lived tokens for browsers, no session limit stated) | Voice control. Post-event backlog (B-02). |
| Sound-effect services | **Not confirmed** | Post-event backlog (B-03). Procedural sound is the default. |
| TRELLIS, Hunyuan3D, TripoSR | **Not confirmed** | Image-to-3D. Post-event backlog (B-04). |

### A3.10 Added for the object view

These sources come from the rendering doc. Neither has been called yet.

| Item | Status | Use |
|---|---|---|
| SIMBAD | **Tested** 5 Nov 2026 through TAP (`ident.id = '<name>'`, JSON). The CDS host did not answer from the dev machine; the `simbad.harvard.edu` mirror did, so the backend tries both. `WISE 0855` is not a SIMBAD identifier (use `WISE J085510.83-071442.5`). Positions are ICRS epoch J2000; high proper-motion targets move tens of SPHEREx pixels by 2026. | Name resolution and object type, which sets stars and brown dwarfs (rendering doc §3.3). Resolver order with SBDB: D-19 ([section 4.1](pipeline.md#a41-stage-1-find-the-object)). **Measurement tables (issue #68, Q-152), tested 9 Nov 2026 on the Harvard mirror:** `mesFe_h` (published spectroscopic Teff, log g, [Fe/H]; columns `teff` in K and `bibcode` used) and `mesVar` (variability; `period` in days, `vartyp`, `magtyp`, `bibcode`). Joined through `ident` on `oidref`, plain `WHERE`, no `ORDER BY` (a qualified `ORDER BY mesFe_h.bibcode` is a TAP syntax error). Barnard's Star has 55 non-null Teff rows (3083 to 3530 K); RW Aur has one (3885 K, 2021ApJ...921...53L); R Dra has none. R Dra's `mesVar` has three periods typed LPV or M (246 to 247.2 d); Barnard's `mesVar` rows are typed ROT, which is why the Mira period takes only LPV or M rows. Cache: source `simbad`, key `ident` + `table`. |
| NASA mission shape models | **Tested for Eros (7 Nov 2026)** | Gaskell Eros Shape Model V1.1, PDS4 bundle `urn:nasa:pds:gaskell.ast-eros.shape-model`, DOI 10.26033/d0gq-9427, licence CC0-1.0, ICQ files `data/quad/quad{64,128,256,512}q.tab` (km, body-fixed). The PDS Small Bodies Node host (sbnarchive.psi.edu) refuses scripted clients (403), so the zip is downloaded by hand and ingested from the local file: `uv run python -m scripts.ingest_shape` (see backend README). Eros is registered (Q-61). **Comet 67P (Q-162):** Rosetta SPC SHAP5 (Gaskell et al. 2017, PDS dataset `RO-C-MULTI-5-67P-SHAPE-V2.0`, DOI 10.26007/34vg-8s07; the label states no licence, so the registry row cites it through the label's `CITATION_DESC`), PDS3 plate tables in a VRML `.wrl` file (km, Cheops frame), fetched from `pdssbn.astro.umd.edu`. LOD0 is `cg_spc_shap5_050k_cart.wrl` (24,877 vertices, 49,748 plates) and LOD1 the official `…_012k_cart.wrl` (11,716 plates); the reader in `ingest_shape.py` checks the header counts, the `-1` face terminators and the 0-based plate indices. **Bennu (Q-163): not registered yet.** The OSIRIS-REx altimetry bundle (`urn:nasa:pds:orex.altimetry` v1.0, DOI 10.26033/pzcf-qs69, CC0 1.0, SPOv54, OBJ in km, 49,152 facets) sits behind a Cloudflare challenge on `sbnarchive.psi.edu`, so someone downloads the OBJ in a browser and runs the command in `backend/assets/shapes/README.md`; its key is SBDB spkid `20101955`. Vesta is not registered. Real meshes (GLB) for `asteroid_shape`. Reduce offline to the mesh budget ([section 10.1](frontend-platform.md#a101-performance-budget-d-05)). |

### A3.11 Sky background (IRSA HiPS)

Added by the sky-view prototype (branch `feat/sky-view-prototype`, 7 Nov 2026). Not SPHEREx data: an all-sky picture behind the search, for context (Q-88).

| Item | Detail |
|---|---|
| Status | **Tested** 7 Nov 2026 (mirror and bake run on the dev PC). The survey, its tag and the A15 depth are open (Q-88). |
| Surveys | IRSA's 2MASS colour HiPS (`2mass_color`: R = Ks 2.16 µm, G = H 1.66 µm, B = J 1.23 µm, sqrt-stretched by CDS), used by the prototype; AllWISE colour (`allwise_color`: W4/W2/W1) registered as an alternative. Base URLs and credit lines are in `backend/app/core/sky/surveys.py`. |
| Local copy | `scripts.sky_mirror` copies the tiles to `{SX_CACHE_DIR}/sky/<survey>/hips/` in IRSA's layout, lowest orders first, at most 4 requests at a time; `scripts.sky_bake` bakes equirectangular JPEGs next to them (4096×2048 and 8192×4096). Orders 0–4 on a dev machine: about 357 MB (D-35). See [backend/README.md](../../backend/README.md#sky-background-prototype). |
| Never at request time | The copy is separate from the D-25 read-through cache. `/v1/sky/…` serves only files already on disk and never fetches upstream; `scripts.sky_mirror` refuses to run under `SX_OFFLINE=1` (Q-87). |
| Licence | Both `properties` files say `hips_status = public mirror unclonable`. A local, non-redistributed copy is accepted for this project, with the survey credit always shown next to the sky and `--allow-unclonable` required to mirror (D-35). The exact credit line each provider asks for is **[verify]** (`surveys.py`). |
| Budget | Under 1 GB on dev machines, up to 50 GB on the A15 (D-35). A15 depth: Q-88. |

### A3.12 Literature registry (`literature.toml`)

Added by issue #68 (Q-153). A curated, read-only table of values for objects the catalogues leave empty, in the same spirit as the shape registry (A3.10, Q-61) and `targets.toml`. It is reviewed config, not a model output: no LLM and no code writes it.

| Item | Detail |
|---|---|
| File | `backend/assets/literature.toml` (`SX_LITERATURE_FILE`). A missing or broken file means no literature values (a warning, never a crash); a row that breaks a rule below is skipped with a warning. |
| Key | The SBDB SPK-ID for a small body; the card's object id (for example `simbad-eps-ind-b`) for anything else, because stars and brown dwarfs have no SPK-ID. |
| A row | `key`, `field` (an ObjectCard field), `value` (a number, or a list for a pair field), optional `err`, `tag`, `citation` (paper) and `table` (table or section), `note`. `[[refusal]]` rows (`key`, `field`, `reason`) keep a field refused and say why. |
| Tag rules | The tag follows the source. A measurement is `measured`. A number computed from an assumed input is `model_dependent`, with that input in `assumption` (for example a diameter from an assumed albedo). `derived` needs a `formula`. `citation` is required. The card's `source` reads `literature: <citation>, <table> (backend/assets/literature.toml)`. |
| Use | Stage 4 fills a card field from it **only when the catalogue value is null**, and only for a field the object's type already writes. It never overrides a catalogue value. One exception is by design: a registry `radius_rsun` (an interferometric radius) goes before Gaia FLAME, which is a model value (Q-152); no such row exists yet. |
| Rows today | 1I/'Oumuamua (SPK-ID 50788063): `lightcurve_amp_mag` 2.5 mag (`measured`), `diameter_km` 0.204 and `albedo` 0.04 (`model_dependent`: the albedo is assumed), all from Meech et al. 2017, Nature 552, 378. `slope_075_25` is refused: the paper's 23 ± 3 %/100 nm slope is optical (g to Y), the field covers 0.75 to 2.5 µm, and its unit is not settled. Epsilon Indi Ba and Bb: `component_teff_K` 1312 ± 13 K and 972 ± 13 K (`model_dependent`, Chen et al. 2022, AJ 163, 288; the table number is **[verify]**). |
| Not in it | WISE 0855's `flux_45um` (no cited value), Barnard's Star's interferometric radius (Lane et al. 2001, 0.201 ± 0.008 R☉, was seen only second-hand: **[verify]** before adding), any value from memory. |
| Dwarf Teff table | `backend/assets/pm13_dwarf_teff.toml` is the same kind of file: Pecaut & Mamajek 2013, ApJS 208, 9, Table 5 (updated online version 2022.04.16), main-sequence Teff by spectral type O9V to M9V. It is the third source for a star's `teff_K` (Q-152), dwarfs only; no verified table exists for M giants, Miras or pre-main-sequence stars. |

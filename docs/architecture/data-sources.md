# Data sources

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A3–A3.10 · **Implements:** D-07, D-19, D-25, D-31

## A3 Data sources

Only the attributes listed are fetched. All checks below were run on 4 Nov 2026 unless noted.

### A3.1 SPHEREx (IRSA)

| Item | Detail |
|---|---|
| Status | **Tested** (slow and sometimes fails) |
| Product | Level-2 FITS, about 72 MB per frame, 2040 x 2040 px (3.5° × 3.5°), 6.15 arcsec per pixel, 113.58 s exposure (astro-verifier, 7 Nov 2026) |
| Extensions used | `IMAGE` (MJy/sr), `FLAGS`, `VARIANCE`, `WCS-WAVE` |
| Skipped | `PSF` (101 x 101 x 121, about 5 MB), `ZODI` unless background subtraction needs it |
| Detectors | 6, covering 0.75 to 5.0 micron. One frame covers a range of wavelengths across its field. |
| Revisit | Bands for one spot are captured within about 0.8 days. |
| Search | Simple Image Access: `https://irsa.ipac.caltech.edu/SIA?COLLECTION=spherex_qr2&POS=circle+RA+DEC+RADIUS&MAXREC=N` |
| Cutouts | Work through the same service. Use small cutouts, never whole frames. |
| Storage path | `s3://nasa-irsa-spherex/qr2/level2/<week>/<obs>/<detector>/` |
| Data releases | QR2 (DOI 10.26131/IRSA652; collection `spherex_qr2` reprocesses all data since the mission start in 2025), QR3 (DOI 10.26131/IRSA662, `spherex_qr3`, began Sept 2026, surveys 3–4) (astro-verifier, 7 Nov 2026) |
| Known problems | A time filter or a large cone timed out with 504 errors. A tiny cone worked. **Cache every result ahead of time.** Every call goes through the backend's read-through cache, filled by the pre-fetch script; the demo runs offline (D-25). |
| Checked 5 Nov 2026 (backend, issue #1) | A tiny cone (`r = 0.001°`) answers in about 4 s. `MAXREC=2000` timed out at 120 s; `MAXREC=500` returned all 240 frames for Barnard's Star. `QUERY_STATUS=OVERFLOW` marks a cut-off answer. Cutouts: `access_url?center=<ra>,<dec>&size=<deg>` on the IBE URL, 10–30 s each. A cutout holds `IMAGE`, `FLAGS`, `VARIANCE`, `ZODI`, `PSF` (about 4.9 MB, not cached, Q-20) and `WCS-WAVE`. Times: `TIMESYS='UTC'`; the SIA `t_min`/`t_max` midpoint matches `DATE-AVG` to a few ms. Wavelength at a pixel: alternate WCS key `W` (`WAVE-TAB`, table in `WCS-WAVE`), read with the SIP keywords removed **[verify]**. FLAGS bit names are the `MP_<name> = <bit>` header keywords in QR2 (16 flags in pipeline 6.4 frames, 22 in 6.5.6); names and bits match the Explanatory Supplement (SSDC-DP-017 v2.0, Table 16). Later releases may use `MSKNnnnn`/`MSKDnnnn` keywords instead (IRSA tutorials draft PR #401, Q-31) **[verify on a QR3 or DR1 header]**. |
| Saturation (checked 6 Nov 2026, issue #25) | A star that is too bright overflows the detector: its core pixels carry `OVERFLOW`, set when a pixel's charge passes a commandable threshold; the well depth is of order 1e5 e⁻ (Korngut et al. 2026, arXiv:2603.29835). Stage 2 refuses such frames as `saturated` (A4.2); the same reason also covers a dead core pixel (D-31), so the UI words it without a cause (A11). The saturation limit is about 11.7 to 9.7 AB mag depending on the band, with bands 5 and 6 more lenient, as quoted by Clark et al. 2026 (arXiv:2604.22983, Sect. IV.2) from "Table 16 of the SPHEREx Explanatory Supplement". The range and the value for each band are **[verify]** against the Supplement itself; in SSDC-DP-017 v2.0, Table 16 is the flag table (Q-31). Before launch, sources brighter than about 11 AB at 2 µm were expected to saturate (Crill et al. 2024, arXiv:2404.11017). The largest source current with no `OVERFLOW` is about 630 e⁻/s in bands 1–3 and 470 e⁻/s in bands 4–6 (Fazar et al. 2026, arXiv:2608.09862). For scale, the 5σ full-survey depth is 19.5–19.9 AB at 0.75–3.8 µm and 17.8–18.8 AB at 3.8–5.0 µm (Bock et al. 2026, ApJ, doi:10.3847/1538-4357/ae2be2). In this tool, Barnard's Star and R Dra saturate in every frame that is not refused for another reason, and RW Aur keeps only 15 measured points (0.74–1.09 µm); Epsilon Indi B and WISE 0855 measured cleanly (2 objects, not a limit). The demo objects are chosen fainter than the quoted limit (D-31). |
| Moving objects (issue #26, checked 7 Nov 2026) | The frame search for a moving body runs SIA cones along its Horizons path (A4.1, Q-21). **3I/ATLAS is in QR2:** frames on 2025-08-01 to 08-16 and 2025-12-08 to 12-15, plus predicted coverage in Mar–Apr 2026 that is likely a non-detection (astro-verifier, live IRSA queries, 7 Nov 2026). SPHEREx field of view 3.5° × 3.5°, exposure 113.58 s; an SIA2 `POS` circle matches every frame that overlaps it, so a frame taken between two cones is found when the path moves less than the cone radius R between them (dt ≤ R / rate). Path rates: 433 Eros up to about 143″/h (about 0.95°/day) May 2025–Oct 2026; 3I/ATLAS about 0.66–1.16°/day. **IRSA publishes no rate limit** for SIA, TAP or IBE (astro-verifier, 7 Nov 2026; ask the IRSA helpdesk): the backend sends cones one at a time, the HTTP client retries 5xx/504 with exponential backoff, and the pacing (`SX_MOVING_CONE_PACE_S`, default 0 s), cone radius (default 0.1°), step clamp (1–24 h), cone cap (450) and MAXREC per cone (500) are **[verify]** settings. The exact observation window of a data release is not published: `SX_MOVING_WINDOW_START`/`END` default to 2025-04-01 to 2026-06-01, which covers every frame time in the cached QR2 answers (2025-04-24 to 2026-05-14) **[verify]**. A live search for 433 Eros on 20 Mar–10 Apr 2026 found 102 frames in 22 cones (7 Nov 2026). IRSA also has a Moving Object Search Tool (MOST, `catalog=spherex`), not used yet (Q-88). |

### A3.2 Gaia DR3

| Item | Detail |
|---|---|
| Status | **Tested**, 24 s per query |
| Table | `gaiadr3.sso_reflectance_spectrum` through the TAP service |
| Columns | wavelength, reflectance, reflectance error, flag |
| Coverage | Visible light, 60,518 asteroids |
| Use | Visible colour and class of known asteroids. SPHEREx starts at 0.75 micron, so it cannot give visible colour. |
| Source catalogue (overlays, issue #12) | **Tested** 6 Nov 2026. A cone on the source table through TAP (sync, CSV): IRSA `gaia_dr3_source` first (a 0.05° cone answered in about 20 s), then the ESA archive `gaiadr3.gaia_source` (about 60 s; one attempt timed out at 90 s). Both serve the same columns: `source_id, ra, dec, ref_epoch, pmra, pmdec, parallax, phot_g_mean_mag`. Positions are ICRS at `ref_epoch` (J2016.0 in DR3), `pmra` is µα·cos δ in mas/yr. The cone keeps only `phot_g_mean_mag < 20`, brightest first, at most 5000 rows (`overlay:gaia:truncated` when capped). G < 20 is a display cut, not a physical value (Q-52). Mirrors are set by `SX_GAIA_TAP_MIRRORS`. Used by [A4.9](pipeline.md#a49-overlays-flag-mask-and-combine). |

### A3.3 WISE / NEOWISE

| Item | Detail |
|---|---|
| Status | **Not confirmed** for diameter and albedo (IRSA TAP timed out twice). **Tested** 6 Nov 2026 for source positions (overlays, below). |
| Use | Diameter and albedo. Take these through the JPL Small-Body Database for now. |
| Source catalogue (overlays, issue #12) | "WISE/NEOWISE sources" are served from **CatWISE2020** (`catwise_2020` on IRSA TAP, sync, CSV), which combines WISE and NEOWISE epochs (Q-51). Checked live 6 Nov 2026 (`TAP_SCHEMA.columns`): `ra_pm`/`dec_pm` are positions at MJD 57170 from the PSF fit with motion; `pmra`/`pmdec` are apparent motions in arcsec/yr (relative, not absolute, noisy for faint sources); `w1mpro_pm` is the W1 profile-fit magnitude. A 0.03° cone answered in about 17 s. Columns: `source_name, ra_pm, dec_pm, pmra, pmdec, w1mpro_pm`; the cone is applied to `ra`/`dec`, brightest W1 first, at most 5000 rows (`overlay:wise:truncated`); a row without `ra_pm`/`dec_pm` is dropped. Whether `pmra` includes cos δ is **[verify]**. **CatWISE2020 has no rows within at least 3′ of R Draconis** (checked live 6 Nov 2026: a box and a cone both return 0, while AllWISE returns sources there), so that target shows no WISE markers (Q-51). AllWISE and the NEOWISE single-exposure table are not used. Used by [A4.9](pipeline.md#a49-overlays-flag-mask-and-combine). |

### A3.4 JPL Horizons

| Item | Detail |
|---|---|
| Status | **Tested**, 3I/ATLAS returned in 1.4 s. The backend uses `COMMAND='DES=<spkid>;'`, `TLIST_TYPE=JD`, `TIME_TYPE=UT`. The `resolve` position uses the geocentre `500@399`. The moving-object frame search (issue #26) uses the **SPHEREx spacecraft**, Horizons id `-163182` (`CENTER='500@-163182'`; astro-verifier, 7 Nov 2026; checked live the same day for 2025-04-01 to 2026-06-01): from low Earth orbit the geocentric parallax of a near-Earth asteroid can exceed a 6.15″ pixel. The path is one `START_TIME`/`STOP_TIME`/`STEP_SIZE` ephemeris (`TIME_DIGITS=FRACSEC`, URL-encoded `STEP_SIZE`), split into requests of at most 90,000 samples (Horizons answers at most about 90,024 lines per request); the per-frame positions are a `TLIST` of the frame midpoints. Positions are predictions, tagged `model_dependent`. Whether `TIME_TYPE=UT` applies to `START_TIME`/`STOP_TIME` as to `TLIST` is **[verify]**. |
| Designation | 3I/ATLAS is `C/2025 N1` |
| Use | Position over time for any moving object. Also the phase angle used for lighting (rendering doc §5.1). |

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
| Status | **Tested** |
| File | `damit.cuni.cz/.../AsteroidModel/<id>/shape.obj` |
| Example | One model: 89 KB, 1,022 vertices, 2,040 faces |
| Limit | Shapes are convex, so they miss dips and hollows. Look up the model number from the browse page. |

### A3.8 NASA Exoplanet Archive

| Item | Detail |
|---|---|
| Status | **Not confirmed** (never called) |
| Planned columns | planet radius, planet mass, equilibrium temperature, orbit distance, star temperature, star radius |
| Use | Values for `planet_rocky`, `planet_water` and `gas_giant` cards. |
| Action | Test the table service before relying on it. |

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
| SIMBAD | **Tested** 5 Nov 2026 through TAP (`ident.id = '<name>'`, JSON). The CDS host did not answer from the dev machine; the `simbad.harvard.edu` mirror did, so the backend tries both. `WISE 0855` is not a SIMBAD identifier (use `WISE J085510.83-071442.5`). Positions are ICRS epoch J2000; high proper-motion targets move tens of SPHEREx pixels by 2026. | Name resolution and object type, which sets stars and brown dwarfs (rendering doc §3.3). Resolver order with SBDB: D-19 ([section 4.1](pipeline.md#a41-stage-1-find-the-object)). |
| NASA mission shape models | **Not confirmed** | Real meshes (GLB) for `asteroid_shape`, such as Bennu, Eros and Vesta. Decimate offline to the mesh budget ([section 10.1](frontend-platform.md#a101-performance-budget-d-05)). |

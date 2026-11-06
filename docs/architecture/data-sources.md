# Data sources

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A3–A3.10 · **Implements:** D-07, D-19, D-25, D-31

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
| Saturation (checked 6 Nov 2026, issue #25) | A star that is too bright overflows the detector: its core pixels carry `OVERFLOW`, set when a pixel's charge passes a commandable threshold; the well depth is of order 1e5 e⁻ (Korngut et al. 2026, arXiv:2603.29835). Stage 2 refuses such frames as `saturated` (A4.2). The saturation limit is about 11.7 to 9.7 AB mag depending on the band, with bands 5 and 6 more lenient, as quoted by Clark et al. 2026 (arXiv:2604.22983, Sect. IV.2) from "Table 16 of the SPHEREx Explanatory Supplement". The range and the value for each band are **[verify]** against the Supplement itself; in SSDC-DP-017 v2.0, Table 16 is the flag table (Q-31). Before launch, sources brighter than about 11 AB at 2 µm were expected to saturate (Crill et al. 2024, arXiv:2404.11017). The largest source current with no `OVERFLOW` is about 630 e⁻/s in bands 1–3 and 470 e⁻/s in bands 4–6 (Fazar et al. 2026, arXiv:2608.09862). For scale, the 5σ full-survey depth is 19.5–19.9 AB at 0.75–3.8 µm and 17.8–18.8 AB at 3.8–5.0 µm (Bock et al. 2026, ApJ, doi:10.3847/1538-4357/ae2be2). In this tool, Barnard's Star and R Dra saturate in every frame that is not refused for another reason, and RW Aur keeps only 15 measured points (0.74–1.09 µm); Epsilon Indi B and WISE 0855 measured cleanly (2 objects, not a limit). The demo objects are chosen fainter than the quoted limit (D-31). |
| Not checked | Whether frames exist for 3I/ATLAS on its exact dates. |

### A3.2 Gaia DR3

| Item | Detail |
|---|---|
| Status | **Tested**, 24 s per query |
| Table | `gaiadr3.sso_reflectance_spectrum` through the TAP service |
| Columns | wavelength, reflectance, reflectance error, flag |
| Coverage | Visible light, 60,518 asteroids |
| Use | Visible colour and class of known asteroids. SPHEREx starts at 0.75 micron, so it cannot give visible colour. |

### A3.3 WISE / NEOWISE

| Item | Detail |
|---|---|
| Status | **Not confirmed** (IRSA TAP timed out twice) |
| Use | Diameter and albedo. Take these through the JPL Small-Body Database for now. |

### A3.4 JPL Horizons

| Item | Detail |
|---|---|
| Status | **Tested**, 3I/ATLAS returned in 1.4 s. The backend uses `COMMAND='DES=<spkid>;'`, `TLIST_TYPE=JD`, `TIME_TYPE=UT` and the geocentre `500@399` **[verify against a SPHEREx-centred ephemeris]**. Positions are predictions, tagged `model_dependent`. |
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

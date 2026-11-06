# Data sources

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A3–A3.10 · **Implements:** D-07, D-19, D-25

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
| Lighting | **Tested 6 Nov 2026** (433 Eros). Observer ephemeris with `QUANTITIES='1,24'` and `CENTER='500@-163182'` (SPHEREx) adds the S-T-O phase angle; `EPHEM_TYPE=VECTORS`, `CENTER='500@10'`, `REF_PLANE=FRAME` gives the heliocentric ICRF vector, so the Sun direction is `-r/\|r\|`. Both are taken at the resolve epoch and the geocentre is the fallback if Horizons has no SPHEREx ephemeris (Q-62). Phase angle is tagged `measured` (R5.1), the Sun vector `derived`. |

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
| Status | **Tested** earlier; on 7 Nov 2026 the site returned HTTP 503. The OBJ reader (`backend/scripts/ingest_shape.py`) is built and tested on a synthetic file, but no DAMIT model is registered. Licence and citation terms: [verify] DAMIT licence. |
| File | `damit.cuni.cz/.../AsteroidModel/<id>/shape.obj` |
| Example | One model: 89 KB, 1,022 vertices, 2,040 faces |
| Limit | Shapes are convex, so they miss dips and hollows. Look up the model number from the browse page. |

### A3.8 NASA Exoplanet Archive

| Item | Detail |
|---|---|
| Status | **Tested** 2026-11-07, live and with recorded offline fixtures (`backend/app/adapters/exoplanet_archive.py`) |
| Endpoint | `https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=<ADQL>&format=json` (`SX_EXOPLANET_TAP_URL`); table `pscomppars` (one composite row per planet); ADQL `lower()` works |
| Columns | `pl_name`, `hostname`, `pl_rade`, `pl_radj`, `pl_bmasse`, `pl_bmassj` (each with `err1`/`err2`), `pl_bmassprov` (`Mass`, `Msini`, `Msin(i)/sin(i)`, `M-R relationship`), `pl_dens`, `pl_eqt`, `pl_orbsmax`, `pl_orbper`, `pl_orbeccen`, `st_teff`, `st_rad`, `st_mass`, `sy_dist`, and `pl_*_reflink` for the radius, mass, `pl_eqt` and `pl_orbsmax` |
| Use | Values and type thresholds for `planet_rocky`, `planet_water` and `gas_giant` cards (rule: Q-63). Reached through SIMBAD otype `Pl`; names matched as in Q-63. No row is not an error: the type becomes `candidate` and `exoplanet_archive` goes in `missing`. |
| Cache | D-25 source `exoplanet_archive`, key `pl_name` = the lower-case candidate names. |

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
| NASA mission shape models | **Tested for Eros (7 Nov 2026)** | Gaskell Eros Shape Model V1.1, PDS4 bundle `urn:nasa:pds:gaskell.ast-eros.shape-model`, DOI 10.26033/d0gq-9427, licence CC0-1.0, ICQ files `data/quad/quad{64,128,256,512}q.tab` (km, body-fixed). The PDS Small Bodies Node host (sbnarchive.psi.edu) refuses scripted clients (403), so the zip is downloaded by hand and ingested from the local file: `uv run python -m scripts.ingest_shape` (see backend README). Eros is registered (Q-61); Bennu and Vesta are not. Real meshes (GLB) for `asteroid_shape`. Reduce offline to the mesh budget ([section 10.1](frontend-platform.md#a101-performance-budget-d-05)). |

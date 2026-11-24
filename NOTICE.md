# Notice: what is licensed under what

The project licence is recorded in [D-41](docs/decisions/scope-process.md#d-41-project-licence). This file says which part of the repository falls under which terms. The full text of the code licence is in [LICENSE](LICENSE).

| Part | Licence |
|---|---|
| Source code (`backend/`, `frontend/`, `shared/`) and the mock-ups (`mockup/`) | BSD-3-Clause ([LICENSE](LICENSE)) |
| Documentation (`docs/`, the README files) | CC-BY-4.0 ([legal text](https://creativecommons.org/licenses/by/4.0/legalcode)) |
| Data, fixtures and cached archive replies (for example under `backend/tests/fixtures/` and `backend/assets/`), and images derived from archive data | **Keep the terms of their source.** The licence above does not relicense them. Each source's own terms and acknowledgement text apply. |
| Third-party libraries and code copied from other projects | **Keep their own licences.** They are listed in [Third-party data and libraries](#third-party-data-and-libraries) below. |
| The three Animate UI icon components copied into `frontend/src/components/animate-ui/` | **MIT + Commons Clause** (Animate UI's own licence), not BSD-3-Clause. **Not OSI-approved:** see [Flagged](#flagged-licences-that-are-not-osi-approved). |
| The 26 agent definitions in `.claude/agents/` imported from VoltAgent (the files that name it as their source) | MIT, as imported. The licence text is in [.claude/THIRD_PARTY_LICENSES/voltagent-awesome-claude-code-subagents.txt](.claude/THIRD_PARTY_LICENSES/voltagent-awesome-claude-code-subagents.txt). |
| Everything else in the repository (the project's own agents and skills in `.claude/`, `.github/`, root configuration files) | BSD-3-Clause ([LICENSE](LICENSE)) |

## Third-party data and libraries

The 2026 NASA Space Apps terms (D-41) ask that every licence that applies to the project be named here and that every source be cited. Data from NASA or a partner space agency (ESA) is exempt from their open-licence condition but is still cited. Every page below was checked on 24 Nov 2026. Anything not confirmed on a primary page is marked **[verify]**, with what was tried.

### Data and services

| Source | Used for (where in the repo) | Licence or terms | NASA or partner agency? | Cite |
|---|---|---|---|---|
| SPHEREx Quick Release 2, through IRSA | Spectral images, cutouts and frame search (`backend/app/adapters/irsa_*.py`; cached under `backend/tests/fixtures/cache/v1/irsa_cutout/spherex_qr2/` and `irsa_sia/spherex_qr2/`) | No licence stated on the [SPHEREx QR page](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_qr.html) or the DOI record | NASA (JPL and Caltech) | Dataset DOI [10.26131/IRSA652](https://doi.org/10.26131/IRSA652) (QR2). Mission: Bock et al. 2026, ApJ 999, 139 (DOI [verify]) |
| NASA/IPAC Infrared Science Archive (IRSA) | Archive for SPHEREx, CatWISE2020 and the sky tiles | No licence stated ([IRSA knowledgebase](https://irsa.ipac.caltech.edu/docs/knowledgebase/general.html)) | NASA | Acknowledgement text below |
| CatWISE2020 (WISE and NEOWISE data) | Catalogue matches (`backend/app/adapters/wise.py`; cache `wise/`) | No licence stated ([CatWISE page](https://irsa.ipac.caltech.edu/data/WISE/CatWISE/overview.html)) | NASA | Dataset DOI [10.26131/IRSA551](https://doi.org/10.26131/IRSA551); Marocco et al. 2021, "The CatWISE2020 Catalog", ApJS 253, 8, DOI [10.3847/1538-4365/abd805](https://doi.org/10.3847/1538-4365/abd805); Eisenhardt et al. 2020, ApJS 247, 69; Wright et al. 2010, AJ 140, 1868, DOI [10.1088/0004-6256/140/6/1868](https://doi.org/10.1088/0004-6256/140/6/1868) |
| 2MASS | The colour sky background | No licence stated | NASA and NSF | Skrutskie et al. 2006, AJ 131, 1163, DOI [10.1086/498708](https://doi.org/10.1086/498708) |
| HiPS sky tiles made by CDS: 2MASS Color and AllWISE RGB-W4-W2-W1, served by IRSA | The sky background tiles and the offline mirror (D-35; the app's credit line in `backend/app/core/sky/surveys.py`) | **2MASS Color: ODbL-1.0** (`hips_license = ODbL-1.0`, `hips_copyright = CNRS/Unistra` in its [`properties` file](https://irsa.ipac.caltech.edu/data/hips/CDS/2MASS/Color/properties)). **AllWISE:** `hips_copyright = CNRS/Unistra`, no licence stated in its [`properties` file](https://irsa.ipac.caltech.edu/data/hips/CDS/AllWISE/RGB-W4-W2-W1/properties) [verify] | The images are NASA data; CDS made the tiles | The survey papers (2MASS, WISE). HiPS format: Fernique et al. 2015, A&A 578, A114, DOI [10.1051/0004-6361/201526075](https://doi.org/10.1051/0004-6361/201526075) |
| Gaia DR3 | Star positions, motions and parameters (`backend/app/adapters/gaia.py`; cache `gaia/`) | **CC BY-NC 3.0 IGO** ([Gaia licence](https://www.cosmos.esa.int/web/gaia-users/license)): non-commercial, so not an open licence; ESA asks for a licence request before any commercial use | ESA (partner agency, exempt) | Gaia Collaboration, Prusti et al. 2016, A&A 595, A1, DOI [10.1051/0004-6361/201629272](https://doi.org/10.1051/0004-6361/201629272); Gaia Collaboration, Vallenari et al. 2023, A&A 674, A1, DOI [10.1051/0004-6361/202243940](https://doi.org/10.1051/0004-6361/202243940). Credit: "ESA/Gaia/DPAC" |
| JPL Horizons | Ephemerides and paths (`backend/app/adapters/horizons.py`; cache `horizons/`) | "The data provided on this site are considered public domain" ([SSD FAQ](https://ssd.jpl.nasa.gov/faq.html)) | NASA (JPL) | Giorgini et al. 1996, BAAS 28, 1158. "Giorgini, JD and JPL Solar System Dynamics Group, NASA/JPL Horizons On-Line Ephemeris System, https://ssd.jpl.nasa.gov/horizons/, data retrieved YYYY-MON-DD." |
| JPL Small-Body Database (SBDB) | Small-body parameters (`backend/app/adapters/sbdb.py`; cache `sbdb/`) | Public domain, as above | NASA (JPL) | "NASA/JPL Solar System Dynamics. Data retrieved on (Downloaded Year, Month, Date)." |
| NASA Exoplanet Archive (`pscomppars`) | Exoplanet and host-star parameters (`backend/app/adapters/exoplanet_archive.py`; cache `exoplanet_archive/`) | No licence stated ([acknowledgement page](https://exoplanetarchive.ipac.caltech.edu/docs/acknowledge.html)) | NASA | Christiansen et al. 2025, PSJ 6, 186, DOI [10.3847/PSJ/ade3c2](https://doi.org/10.3847/PSJ/ade3c2); table DOI [10.26133/NEA13](https://doi.org/10.26133/NEA13) |
| SIMBAD (CDS, Strasbourg) | Name resolving and object data (`backend/app/adapters/simbad.py`; cache `simbad/`; the `simbad-*.json` files under `backend/assets/`) | **ODbL** (Open Database License), an open data licence: "Use of SIMBAD service is free without any registration under ODbL licence." Version [verify]: every CDS host in Strasbourg refused the connection; the sentence is from [SIMBAD at the CfA](https://simbad.harvard.edu/simbad/) | No (CNRS and Université de Strasbourg) | Wenger et al. 2000, A&AS 143, 9, DOI [10.1051/aas:2000332](https://doi.org/10.1051/aas:2000332) |
| SkyBoT (IMCCE, Paris Observatory) | Known solar-system objects in a field (`backend/app/adapters/skybot.py`; cache `skybot/`) | **No licence stated** [verify]: the [SkyBoT page](https://ssp.imcce.fr/webservices/skybot/) has only a disclaimer. Ask the operators (vossp.lte@obspm.fr) to settle it | No (CNRS and Paris Observatory) | Berthier et al. 2006, ASP Conf. Ser. 351, 367 |
| Eros shape model (Gaskell, V1.1) | The Eros mesh (`backend/assets/shapes/`) | CC0-1.0 in the repo's registry, but **not confirmed** [verify]: the [PDS landing page](https://sbn.psi.edu/pds/resource/doi/erosshape_1.1.html) and the DOI record state no licence, and the bundle label returns 403 to scripts | NASA (PDS) | Gaskell, R. (2021), Gaskell Eros Shape Model V1.1, NASA PDS, DOI [10.26033/d0gq-9427](https://doi.org/10.26033/d0gq-9427) |
| Bennu shape model (OSIRIS-REx, SPO v54) | The Bennu mesh (`backend/assets/shapes/`) | CC0-1.0, confirmed by the DOI record ("Creative Commons Zero v1.0 Universal"; "a work of the U.S. Government"). This settles the [verify] still in `backend/assets/shapes/README.md` | NASA (PDS) | Daly, Barnouin, Espiritu, Lauretta (2026), Origins, Spectral Interpretation, Resource Identification, Security, Regolith Explorer (OSIRIS-REx): Altimetry Working Group Shape Model Bundle V1.0, NASA PDS, DOI [10.26033/pzcf-qs69](https://doi.org/10.26033/pzcf-qs69) |
| 67P shape model (Rosetta, SPC SHAP5) | The 67P mesh (`backend/assets/shapes/`) | CC0-1.0 on the DOI record for the PDS copy the repo uses (the PDS label itself states none) | ESA (partner agency) | "Collected Shape Models of Comet 67P/Churyumov-Gerasimenko Produced by the Rosetta Mission", PDS 2017, DOI [10.26007/34vg-8s07](https://doi.org/10.26007/34vg-8s07); cite with the label's CITATION_DESC |

### Code copied into the repository

| Code | Where | Licence | Notice |
|---|---|---|---|
| Animate UI icon components (from the Animate UI registry; icon artwork from Hugeicons) | `frontend/src/components/animate-ui/icons/hugeicons/` (`view.tsx`, `menu-01.tsx`, `orbit.tsx`) | **MIT + Commons Clause**, not OSI-approved (see Flagged). Hugeicons' own licence [verify] | The files carry no notice; the licence text is in [.claude/THIRD_PARTY_LICENSES/animate-ui.txt](.claude/THIRD_PARTY_LICENSES/animate-ui.txt) |
| smoothui grid-loader (Eduardo Calvo) | `frontend/src/app/island/GridLoader.tsx` | MIT | In the file header |
| ISO 226:2003 equal-loudness table, as reproduced in J. Tackett's `iso226.m` (MathWorks File Exchange) | `frontend/src/sound/iso226.ts` | BSD (as stated in the file; version [verify]) | In the file header |
| three.js r128 and KaTeX 0.16.11, loaded from cdnjs (not copied) | `mockup/spherex-ui.html` | MIT | Loaded from the CDN |

### Values copied from publications

These files hold reviewed values, each with its source named inside the file: `backend/assets/literature.toml` (a citation per value), `backend/assets/pm13_dwarf_teff.toml` (mean dwarf temperatures) and `backend/assets/reference_objects.toml` (the NASA Goddard Planetary Fact Sheets). Cite those sources when you use the values.

### Fonts

| Font | Where | Licence |
|---|---|---|
| Inter | The app (`@fontsource/inter` 5.3.0) and the mock-ups (Google Fonts) | SIL OFL 1.1 (OSI-approved), "Copyright 2016 The Inter Project Authors" |
| KaTeX fonts | Formulas in the app (`katex` 0.16.11) | SIL OFL, according to the KaTeX maintainers; version 1.1 [verify] (the package ships no OFL file). KaTeX's code is MIT |
| IBM Plex Sans and Mono | `mockup/closeup-star.html` (Google Fonts) | SIL OFL 1.1, Reserved Font Name "Plex" |

### Software dependencies

[THIRD_PARTY_DEPENDENCIES.md](THIRD_PARTY_DEPENDENCIES.md) lists every npm package (263, of which 17 ship in the app) and every Python package (54, of which 31 are runtime) with its declared licence, and says how it was generated. Almost all are MIT, Apache-2.0, BSD, ISC or MPL-2.0.

### Flagged: licences that are not OSI-approved

- **Animate UI** (`@animate-ui/react` 2.4.3, shipped in the app, and the three icon components in `frontend/src/components/animate-ui/`): **MIT + Commons Clause**. The Commons Clause forbids selling or redistributing the components "in their original form", so this is not an OSI licence and not "without restriction". D-38 makes Animate UI the project's control library. **Needs a decision: Q-486.**
- **Gaia DR3 data:** CC BY-NC 3.0 IGO (non-commercial). Exempt as ESA data, but not open for commercial use.
- **`caniuse-lite`** (CC-BY-4.0): a build-tool database, not shipped in the app.
- **CC0-1.0** (`mdn-data`, a dev package; parts of `numpy`): a public-domain dedication, so no restriction, but not an OSI licence.
- **OSI status [verify]:** `pillow` (MIT-CMU), `typing_extensions` and `argparse` 3.0.4 (PSF-2.0).

### Acknowledgement texts

Quoted as each provider asks.

- **IRSA:** "This research has made use of the NASA/IPAC Infrared Science Archive, which is funded by the National Aeronautics and Space Administration and operated by the California Institute of Technology."
- **SPHEREx:** "This publication makes use of data products from the Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory and the California Institute of Technology, and is funded by the National Aeronautics and Space Administration."
- **2MASS:** "This publication makes use of data products from the Two Micron All Sky Survey, which is a joint project of the University of Massachusetts and the Infrared Processing and Analysis Center/California Institute of Technology, funded by the National Aeronautics and Space Administration and the National Science Foundation."
- **WISE:** "This publication makes use of data products from the Wide-field Infrared Survey Explorer, which is a joint project of the University of California, Los Angeles, and the Jet Propulsion Laboratory/California Institute of Technology, funded by the National Aeronautics and Space Administration."
- **NEOWISE:** "This publication makes use of data products from the Near-Earth Object Wide-field Infrared Survey Explorer (NEOWISE), which is a joint project of the Jet Propulsion Laboratory/California Institute of Technology and the University of California, Los Angeles. NEOWISE is funded by the National Aeronautics and Space Administration."
- **Gaia:** "This work has made use of data from the European Space Agency (ESA) mission Gaia (https://www.cosmos.esa.int/gaia), processed by the Gaia Data Processing and Analysis Consortium (DPAC, https://www.cosmos.esa.int/web/gaia/dpac/consortium). Funding for the DPAC has been provided by national institutions, in particular the institutions participating in the Gaia Multilateral Agreement."
- **NASA Exoplanet Archive:** "This research has made use of the NASA Exoplanet Archive, which is operated by the California Institute of Technology, under contract with the National Aeronautics and Space Administration under the Exoplanet Exploration Program." (Punctuation [verify] against the page.)
- **SIMBAD:** "This research has made use of the SIMBAD database, operated at CDS, Strasbourg, France."
- **SkyBoT:** "This research has made use of LTE SkyBoT VO tool."
- **JPL (Horizons, SBDB):** use the citations in the table. JPL adds: "If the data obtained is subsequently modified, that modification should be made clear."

## GPL code

Under D-41, GPL code is only ever an **optional plugin that the user installs**. Orbit fitting and propagation tools found so far depend on GPL-3 code (R-37 in the Discovery hunts spec). Such a plugin is not part of the code licensed above, and this file does not relicense it.

## Contributions

Each contributor keeps the copyright in their own commits.

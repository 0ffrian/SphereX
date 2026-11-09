# Shape models

`registry.toml` and the `.glb` files here are written only by `uv run python -m scripts.ingest_shape`
(Q-61). Do not edit them by hand. Specs: A3.7, A3.10, R7.1, R7.3. Decisions: Q-61, Q-162, Q-163.

| Slug | Object | Source | Registry key (SBDB `spkid`) |
|---|---|---|---|
| `eros-gaskell` | 433 Eros | Gaskell ICQ, Q=64 | `20000433` |
| `c67p-shap5` | 67P/Churyumov-Gerasimenko | Rosetta SPC SHAP5, 050K (LOD0) and 012K (LOD1), PDS3 VRML | `1000012` |
| (not yet) | 101955 Bennu | OSIRIS-REx altimetry SPOv54, OBJ | `20101955` |

The key is the SBDB `spkid`, not the Horizons or NAIF id (Bennu is `2101955` there). A row keyed
`2101955` would never match and Bennu would stay `asteroid_procedural`.

## Re-ingest 67P

The two source files are `cg_spc_shap5_050k_cart.wrl` and `cg_spc_shap5_012k_cart.wrl` from
`https://pdssbn.astro.umd.edu/holdings/ro-c-multi-5-67p-shape-v2.0/data/triplate/spc_lam_psi/shap5/`
(SHA-256 of the 050K file: `3304263a...59a68`, in the registry). LOD1 is the official 012K product,
a separate SPC solution, not a decimation of the 050K one (we never decimate). Run from `backend/`:

    uv run python -m scripts.ingest_shape --input PATH/cg_spc_shap5_050k_cart.wrl \
      --source-name cg_spc_shap5_050k_cart.wrl \
      --lod1-input PATH/cg_spc_shap5_012k_cart.wrl --lod1-member cg_spc_shap5_012k_cart.wrl \
      --slug c67p-shap5 --spkid 1000012 --name "67P/Churyumov-Gerasimenko" \
      --citation "<CITATION_DESC of the 050K label>" --doi 10.26007/34vg-8s07 \
      --licence "<the label states none; cited through CITATION_DESC>" --frame "<see the registry row>"

## Bennu: waiting for a browser download

`sbnarchive.psi.edu` answers scripts with a Cloudflare browser challenge, so the OBJ has not been
fetched and there is no Bennu row, hash or triangle count yet (Q-163). Moon downloads this file in a
browser (a few MB; 49,152 facets, 25,350 vertices in the PDS registry; km):

    https://sbnarchive.psi.edu/pds4/orex/orex.altimetry_v1.0/data_derived_altimetry_global_models/global_digital_terrain_models/SPOv54/g_06320mm_spo_obj_0000n00000_v054.obj

Then, from `backend/` (one line; `PATH` is where the file was saved):

    uv run python -m scripts.ingest_shape --input PATH/g_06320mm_spo_obj_0000n00000_v054.obj --format obj --slug bennu-spo-v54 --spkid 20101955 --name "101955 Bennu" --citation "Daly, M., Barnouin, O., Espiritu, R., Lauretta, D. (2026). OSIRIS-REx Altimetry Working Group Shape Model Bundle V1.0, urn:nasa:pds:orex.altimetry::1.0 (SPOv54), NASA Planetary Data System." --doi 10.26033/pzcf-qs69 --licence CC0-1.0 --frame "Bennu body-fixed frame of the model (no named frame in the label): origin at the centre of mass, axes the principal axes of the shape model, +Z the spin axis (positive pole); pole RA 85.65 deg, Dec -60.17 deg and period 4.296056 h from Lauretta et al. 2019, not from this product; km in the OBJ" --source-url "https://doi.org/10.26033/pzcf-qs69"

Checks to do on the printed registry entry before committing (all still **[verify]**):

- `triangles_lod0` is 49,152 (not above 50,000). The script refuses a larger file; it never decimates.
- `vertices_lod0` is 24,578 if the 772 extra vertices in the PDS count (25,350) are unreferenced;
  the script drops unreferenced vertices.
- `extents_km` is close to SBDB's `extent` for Bennu, 0.5047 x 0.4918 x 0.4567 km (body x, y, z; the registry lists glTF x, y, z = body x, z, y; the SBDB figures are principal-axis extents, so a small difference is expected). The OBJ header's
  `Extent` lines and the spin axis (+Z) should agree with the frame text. If the header says
  something else, fix `--frame` before committing.
- The OBJ has no stated unit in the file itself; km comes from the PDS label (registry record).

LOD1 for an OBJ is the same mesh as LOD0 (Q-61). If a lighter official product is wanted for mobile,
the 12.62 m model (`g_12620mm_spo_obj_0000n00000_v054.obj`, 12,288 facets) can be ingested under its
own slug; it is not used for LOD1 automatically.

# Shape models

`registry.toml` and the `.glb` files here are written only by `uv run python -m scripts.ingest_shape`
(Q-61). Do not edit them by hand. Specs: A3.7, A3.10, R7.1, R7.3. Decisions: Q-61, Q-162, Q-163.

| Slug | Object | Source | Registry key (SBDB `spkid`) |
|---|---|---|---|
| `eros-gaskell` | 433 Eros | Gaskell ICQ, Q=64 | `20000433` |
| `c67p-shap5` | 67P/Churyumov-Gerasimenko | Rosetta SPC SHAP5, 050K (LOD0) and 012K (LOD1), PDS3 VRML | `1000012` |
| `bennu-spo-v54` | 101955 Bennu | OSIRIS-REx altimetry SPOv54 (6.3 m model), OBJ; 49,152 triangles, 24,578 vertices; LOD0 and LOD1 are the same mesh | `20101955` |

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

## Re-ingest Bennu

Bennu is registered (Q-163). `sbnarchive.psi.edu` answers scripts with a Cloudflare browser challenge, so
the OBJ is downloaded by hand in a browser (a few MB; km):

    https://sbnarchive.psi.edu/pds4/orex/orex.altimetry_v1.0/data_derived_altimetry_global_models/global_digital_terrain_models/SPOv54/g_06320mm_spo_obj_0000n00000_v054.obj

Its SHA-256 must be `705d03b390ecb619083168e2e3a27f9a471398ace8bf542d5a431031c06567a6` (the registry's `source_sha256`). Then, from `backend/` (one line;
`PATH` is where the file was saved):

    uv run python -m scripts.ingest_shape --input PATH/g_06320mm_spo_obj_0000n00000_v054.obj --format obj --slug bennu-spo-v54 --spkid 20101955 --name "101955 Bennu" --citation "Daly, M., Barnouin, O., Espiritu, R., Lauretta, D. (2026). OSIRIS-REx Altimetry Working Group Shape Model Bundle V1.0, urn:nasa:pds:orex.altimetry::1.0 (SPOv54), NASA Planetary Data System." --doi 10.26033/pzcf-qs69 --licence CC0-1.0 --frame "Bennu body-fixed frame of the model (no named frame in the label): origin at the centre of mass (OBJ header centroid within 1.4 m of it), +Z the spin axis (positive pole; the axis of largest moment of inertia in the OBJ header); +X and +Y are body-fixed and about 7 deg from the principal axes listed in the OBJ header, not equal to them; pole RA 85.65 deg, Dec -60.17 deg and period 4.296056 h from Lauretta et al. 2019, not from this product; km in the OBJ" --source-url "https://doi.org/10.26033/pzcf-qs69"

Findings from the first ingest (all checked on the committed GLB and the OBJ header; Q-163):

- 49,152 triangles (not above 50,000) and 24,578 vertices: the 772 vertices that the PDS record
  counts beyond that (25,350) are unreferenced and were dropped. The script never decimates.
- `extents_km` (0.568, 0.495, 0.543 in glTF order: body x, z, y) match the OBJ header's `Extent` lines
  exactly. They do **not** match the SBDB `extent` figures 0.5047 x 0.4918 x 0.4567 km, by up to 12%,
  so the earlier "close to SBDB" check was wrong and is dropped. The volume in the header,
  0.061633 km^3 (0.061633 km^3 also from the committed GLB), gives an equal-volume diameter of
  490.09 m against the published 490.06 +/- 0.16 m (Lauretta et al. 2019), which confirms the scale
  and km units.
- The model's X and Y axes are about 7.17 degrees from the principal axes listed in the header, and
  +Z is the largest-moment axis (the `--frame` text says so).
- The OBJ header gives `DATASRC = SPC` and `PRODNAME = g_06320mm_spc_obj_...` although the file name
  and the PDS path say SPO v54. Left **[verify]**: which solution the product is.
- Licence CC0-1.0 stays **[verify]**: it comes from the PDS record as relayed in Q-163, and no
  primary page for it is cited in this repository yet.
- The OBJ has no stated unit in the file itself; km comes from the PDS label (registry record).
- LOD1 for an OBJ is the same mesh as LOD0 (Q-61): `triangles_lod1` is 49,152. If a lighter official
  product is wanted for mobile, the 12.62 m model (`g_12620mm_spo_obj_0000n00000_v054.obj`,
  12,288 facets) can be ingested under its own slug; it is not used for LOD1 automatically.

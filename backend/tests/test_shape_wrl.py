"""Comet 67P and Bennu shape models (issue #68 track E; Q-162, Q-163; A3.7, A3.10, R7.3).

- the PDS3 VRML plate reader (``read_wrl``) on a small synthetic file, with refusals;
- the committed 67P meshes against their registry row and the published values (Q-43 check);
- the OBJ path on a Bennu-like file with unreferenced vertices;
- typing through stage 3 with a temporary registry and recorded SBDB replies (offline).
"""

from __future__ import annotations

import argparse
import hashlib
import tomllib
from pathlib import Path

import numpy as np
import pytest

from app.adapters.sbdb import sbdb_key
from app.cache.store import LiveResponse
from app.context import make_context
from app.core.card.catalogue import gather, load_shape_registry
from app.core.classify import classify
from app.core.find.resolver import ResolvedObject
from scripts import ingest_shape as ing
from tests.conftest import FIXTURES, make_settings
from tests.test_card_to_params import load, params_for

SHAPES = Path(__file__).resolve().parents[1] / "assets" / "shapes"
WRL0 = FIXTURES / "shapes" / "octahedron_lod0.wrl"
WRL1 = FIXTURES / "shapes" / "tetra_lod1.wrl"


def registry_row(slug: str) -> dict[str, object]:
    rows = tomllib.loads((SHAPES / "registry.toml").read_text("utf-8"))["model"]
    return next(r for r in rows if r["slug"] == slug)


def positions(glb: bytes) -> np.ndarray:
    doc, blob = ing.read_glb(glb)
    return np.frombuffer(blob, "<f4", count=doc["accessors"][0]["count"] * 3).reshape(-1, 3)


# --- the WRL reader ----------------------------------------------------------------------------


def test_wrl_reader_reads_the_synthetic_file() -> None:
    v, f = ing.read_wrl(WRL0.read_text("ascii"))
    assert v.shape == (7, 3) and f.shape == (8, 3)  # 6 used vertices and 1 unreferenced
    assert f.min() == 0 and f.max() == 5  # 0-based, per the label's PLATE_TABLE description
    assert np.allclose(v[0], [2.0, 0.0, 0.0])


def test_wrl_build_drops_the_unreferenced_vertex_and_reports_km_extents() -> None:
    levels = ing.build_levels(WRL0.read_bytes(), False, fmt="wrl", lod1_data=WRL1.read_bytes())
    (v0, t0, n0), (v1, t1, _) = levels
    assert len(v0) == 6 and len(t0) == 8 and len(v1) == 4 and len(t1) == 4
    assert np.allclose(np.linalg.norm(n0, axis=1), 1.0, atol=1e-6)
    # km in, metres out; the stray vertex at (9, 9, 9) must not widen the box.
    assert np.allclose(v0.max(axis=0) - v0.min(axis=0), [4000, 3000, 2000])  # glTF x, y=z, z=-y
    assert ing.signed_volume(v0, t0) > 0 and ing.signed_volume(v1, t1) > 0


def test_wrl_is_never_decimated() -> None:
    with pytest.raises(ing.ShapeError, match="no exact reduction"):
        ing.build_levels(WRL0.read_bytes(), False, fmt="wrl")


def test_wrl_lod1_must_be_lighter_and_the_same_body() -> None:
    wrl0, wrl1 = WRL0.read_bytes(), WRL1.read_bytes()
    with pytest.raises(ing.ShapeError, match="not fewer"):
        ing.build_levels(wrl1, False, fmt="wrl", lod1_data=wrl0)  # LOD1 larger than LOD0
    with pytest.raises(ing.ShapeError, match="not fewer"):
        ing.build_levels(wrl0, False, fmt="wrl", lod1_data=wrl0)
    far = wrl1.replace(b"2.00000000E+00", b"4.00000000E+00")  # a bigger, different body
    with pytest.raises(ing.ShapeError, match="different body"):
        ing.build_levels(wrl0, False, fmt="wrl", lod1_data=far)


def test_lod1_input_is_refused_for_non_wrl() -> None:
    with pytest.raises(ing.ShapeError, match="only for a WRL"):
        ing.build_levels(b"v 0 0 0", False, fmt="obj", lod1_data=WRL1.read_bytes())


def test_wrl_nan_coordinate_is_refused() -> None:
    text = WRL0.read_text("ascii").replace("2.00000000E+00", "nan", 1)
    with pytest.raises(ing.ShapeError, match="non-finite"):
        ing.read_wrl(text)


def mutate(old: str, new: str) -> str:
    text = WRL0.read_text("ascii")
    assert old in text
    return text.replace(old, new, 1)


@pytest.mark.parametrize(
    ("text", "match"),
    [
        (mutate("point [", "point"), "no vertex count line"),
        (mutate("#           7         8", "#           8         8"), "header says 8 vertices"),
        (mutate("#           7         8", "#           7         9"), "expected 9 triangles"),
        # A 1-based file: every index shifted up by one reaches len(v) or is a quad.
        (mutate("         5   -1", "         7   -1"), "outside 0..6"),
        (mutate("   -1", "    4"), "ended by -1"),
        (mutate("2.00000000E+00", "2.0000x000E+00"), "non-numeric"),
    ],
)
def test_wrl_refusals(text: str, match: str) -> None:
    with pytest.raises(ing.ShapeError, match=match):
        ing.read_wrl(text)


def test_wrl_one_based_file_is_refused() -> None:
    _, f = ing.read_wrl(WRL0.read_text("ascii"))
    lines = [f"{a + 1:10d}{b + 1:11d}{c + 1:11d}   -1" for a, b, c in f]  # same triangles, 1-based
    text = WRL0.read_text("ascii")
    head = text[: text.index("coordIndex [")] + "coordIndex [\n" + "\n".join(lines) + "\n] }\n}"
    # With the stray vertex removed the highest shifted index (6) leaves the 6-vertex table.
    head = head.replace("#           7         8", "#           6         8")
    head = head.replace(" 9.00000000E+00  9.00000000E+00  9.00000000E+00", "")
    with pytest.raises(ing.ShapeError, match=r"outside 0\.\.5"):
        ing.read_wrl(head)


def wrl_args(tmp_path: Path) -> argparse.Namespace:
    return argparse.Namespace(
        zip=None, member=None, input=str(WRL0), lod1_input=str(WRL1),
        lod1_member="tetra_lod1.wrl", source_name="", format="auto", slug="demo-wrl",
        spkid="1000012", name="Demo comet", citation="Cite.", doi="10.0/x",
        licence="not stated", frame="Cheops frame", convex=False, source_url="",
        out_dir=str(tmp_path / "out"),
    )  # fmt: skip


def test_wrl_ingest_is_byte_deterministic(tmp_path: Path) -> None:
    entry = ing.ingest(wrl_args(tmp_path))
    out = tmp_path / "out"
    first = {p.name: p.read_bytes() for p in out.iterdir()}
    ing.ingest(wrl_args(tmp_path))
    assert {p.name: p.read_bytes() for p in out.iterdir()} == first
    assert set(first) == {"demo-wrl.glb", "demo-wrl.lod1.glb", "registry.toml"}
    assert entry["triangles_lod0"] == 8 and entry["triangles_lod1"] == 4
    assert entry["lod1_source_sha256"] == hashlib.sha256(WRL1.read_bytes()).hexdigest()
    assert entry["source_sha256"] == hashlib.sha256(WRL0.read_bytes()).hexdigest()
    assert entry["extents_km"] == [4.0, 3.0, 2.0]  # glTF x, y (= body z), z (= body y)
    assert entry["bbox_half_diagonal_km"] == pytest.approx(np.sqrt(29) / 2, abs=1e-3)
    assert entry["lod0_sha256"] == hashlib.sha256(first["demo-wrl.glb"]).hexdigest()


# --- Bennu: the OBJ path ----------------------------------------------------------------------


def test_bennu_obj_with_unreferenced_vertices(tmp_path: Path) -> None:
    """The PDS registry lists 25,350 vertices for 49,152 facets; a closed genus-0 mesh has
    F/2 + 2 = 24,578, so 772 vertices may be unreferenced. They are dropped, not drawn."""
    assert 49_152 // 2 + 2 == 24_578 and 25_350 - 24_578 == 772
    assert 49_152 <= ing.TRIANGLE_BUDGET < 196_608  # the 6.32 m model fits, the 3.17 m does not
    obj = (
        "# km, principal axes, z = spin\n"
        "v 0.25 0 0\nv -0.25 0 0\nv 0 0.24 0\nv 0 -0.24 0\nv 0 0 0.23\nv 0 0 -0.23\n"
        "v 5 5 5\nv -5 -5 -5\n"  # unreferenced, far outside
        "f 1 3 5\nf 3 2 5\nf 2 4 5\nf 4 1 5\nf 3 1 6\nf 2 3 6\nf 4 2 6\nf 1 4 6\n"
    )
    src = tmp_path / "bennu.obj"
    src.write_text(obj)
    args = wrl_args(tmp_path)
    args.input, args.lod1_input, args.slug, args.spkid = str(src), None, "bennu-t", "20101955"
    entry = ing.ingest(args)
    assert entry["vertices_lod0"] == 6 and entry["triangles_lod0"] == 8
    assert entry["extents_km"] == [0.5, 0.46, 0.48]  # glTF x, y (= body z), z (= body y)
    pos = positions((tmp_path / "out" / "bennu-t.glb").read_bytes())
    assert np.abs(pos).max() == pytest.approx(250.0)  # metres; the (5, 5, 5) km vertex is gone
    assert "lod1_source_sha256" not in entry  # an OBJ has one source


def test_obj_over_budget_still_refuses() -> None:
    n = 12_500  # a closed strip of 2n triangles would pass; 100,000 triangles must not
    verts = "".join(f"v {i} 0 0\n" for i in range(3))
    faces = "".join("f 1 2 3\n" for _ in range(2 * n * 4))
    with pytest.raises(ing.ShapeError):
        ing.build_levels((verts + faces).encode(), False)


# --- 67P: the committed meshes --------------------------------------------------------------


def test_committed_c67p_row() -> None:
    row = registry_row("c67p-shap5")
    assert row["spkid"] == "1000012" and row["doi"] == "10.26007/34vg-8s07"
    assert row["triangles_lod0"] == 49_748 <= ing.TRIANGLE_BUDGET
    assert row["triangles_lod1"] == 11_716  # the official 012K product, not a decimation of 050K
    assert row["source_member"] == "cg_spc_shap5_050k_cart.wrl"
    assert row["lod1_source_member"] == "cg_spc_shap5_012k_cart.wrl"
    assert (
        row["source_sha256"] == "3304263aaae23de3a82cdf13f754b3c075a57ccd1bdbe4c80117e01a02859a68"
    )
    frame = str(row["frame"])
    for text in ("Cheops", "+Z", "69.57", "64.01", "12.4041", "pre-perihelion"):
        assert text in frame
    assert "states none" in str(row["licence"]) or "Not stated" in str(row["licence"])
    assert "Gaskell" in str(row["citation"]) and "CG_SPC_SHAP5_050K_CART" in str(row["citation"])
    for level in ("lod0", "lod1"):
        blob = (SHAPES / Path(str(row[level])).name).read_bytes()
        assert hashlib.sha256(blob).hexdigest() == row[f"{level}_sha256"]
        assert len(blob) < 1_000_000


def test_c67p_mesh_scale_check_q43() -> None:
    """Q-43 against the mesh's own extents and the published values (SHAP5_MODEL_INFO.ASC)."""
    row = registry_row("c67p-shap5")
    glb = (SHAPES / "c67p-shap5.glb").read_bytes()
    doc, blob = ing.read_glb(glb)
    pos = positions(glb).astype(np.float64) / 1000.0  # km
    idx = np.frombuffer(blob, "<u2", offset=doc["bufferViews"][2]["byteOffset"]).reshape(-1, 3)
    a, b, c = pos[idx[:, 0]], pos[idx[:, 1]], pos[idx[:, 2]]
    volume = float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)
    area = np.linalg.norm(np.cross(b - a, c - a), axis=1) / 2
    cen = (a + b + c) / 3
    mean_d = 2 * float((np.linalg.norm(cen, axis=1) * area).sum() / area.sum())
    equiv_d = 2 * (3 * volume / (4 * np.pi)) ** (1 / 3)
    ext = pos.max(axis=0) - pos.min(axis=0)
    assert volume == pytest.approx(18.8, abs=0.3)  # published 18.8 +/- 0.3 km3
    assert equiv_d == pytest.approx(3.30, abs=0.02)  # the sphere of 18.8 km3
    assert mean_d == pytest.approx(3.48, abs=0.03)  # the document's mean diameter
    assert float(area.sum()) == pytest.approx(
        48.4, rel=0.05
    )  # published 48.4 km2 (050K is coarser)
    # The published A, B, C (4.34, 2.60, 2.12 km) are not the box: the box is larger on every side.
    assert sorted(ext)[0] > 2.12 and sorted(ext)[1] > 2.60 and sorted(ext)[2] > 4.34
    assert list(np.round(ext, 3)) == row["extents_km"]
    # The viewer scales a mesh by its Box3 bounding sphere = half the box diagonal (Q-43).
    assert float(np.linalg.norm(ext)) / 2 == pytest.approx(row["bbox_half_diagonal_km"], abs=2e-3)
    # So a card radius equal to the volume-equivalent one would draw the nucleus this much small:
    shrink = (equiv_d / 2) / float(row["bbox_half_diagonal_km"])
    assert shrink == pytest.approx(0.467, abs=0.01)


def test_c67p_axes_follow_the_registry_note() -> None:
    row = registry_row("c67p-shap5")
    assert row["axes"] == ing.AXES_NOTE
    ext = (
        np.subtract(
            *(lambda p: (p.max(axis=0), p.min(axis=0)))(
                positions((SHAPES / "c67p-shap5.glb").read_bytes())
            )
        )
        / 1000.0
    )
    # body x, z, y = glTF x, y, z. The body +Z pole is glTF +Y: the spin axis is not the longest.
    assert np.argmax(ext) == 0 and ext[1] < ext[2] < ext[0]


# --- typing through stage 3 (offline, recorded replies) -----------------------------------


def stub_registry(tmp_path: Path, spkid: str, slug: str = "stub") -> Path:
    shapes = tmp_path / "shapes"
    shapes.mkdir(parents=True)
    for name in (f"{slug}.glb", f"{slug}.lod1.glb"):
        (shapes / name).write_bytes(b"glTF")  # presence only: the loader checks the files exist
    (shapes / "registry.toml").write_text(
        f'[[model]]\nspkid = "{spkid}"\nname = "Test"\nlod0 = "/data/shapes/{slug}.glb"\n'
        f'lod1 = "/data/shapes/{slug}.lod1.glb"\ncitation = "C."\ndoi = "10.0/x"\n'
        'licence = "CC0-1.0"\nconvex = false\n',
        "utf-8",
    )
    return shapes


def facts_for(tmp_path: Path, reply: str, query: str, spkid: str, registry_spkid: str):  # type: ignore[no-untyped-def]
    shapes = stub_registry(tmp_path, registry_spkid)
    ctx = make_context(make_settings(tmp_path / "cache", shapes_dir=shapes))
    body = (FIXTURES / "shapes" / reply).read_bytes()
    ctx.cache.put(sbdb_key(query), LiveResponse(body, "recorded", 200, "application/json"))
    obj = ResolvedObject(
        id="o", name=query, ra=0.0, dec=0.0, moving=True, resolver="sbdb", spkid=spkid, query=query
    )
    data = gather(ctx, obj)
    return data, classify(data.facts)


def test_bennu_with_a_registry_row_is_asteroid_shape(tmp_path: Path) -> None:
    """SBDB's spkid for Bennu is 20101955 (2101955 is the Horizons and NAIF id), like Eros."""
    data, cls = facts_for(tmp_path, "sbdb_bennu.json", "Bennu", "20101955", "20101955")
    assert data.facts.shape_model == "/data/shapes/stub.glb"
    assert cls.type == "asteroid_shape" and cls.class_label == "B"


def test_bennu_without_a_row_or_with_the_naif_id_stays_procedural(tmp_path: Path) -> None:
    _, cls = facts_for(tmp_path / "a", "sbdb_bennu.json", "Bennu", "20101955", "2101955")
    assert cls.type == "asteroid_procedural"  # a row keyed 2101955 never matches SBDB's id
    (tmp_path / "b").mkdir()
    assert load_shape_registry(tmp_path / "b") == {}  # no registry: no shape models, no crash


def test_c67p_registry_row_reaches_the_comet_facts(tmp_path: Path) -> None:
    """A registered comet keeps type comet (R3.3.1); the mesh path rides on facts.shape_model."""
    data, cls = facts_for(tmp_path, "sbdb_67p.json", "67P", "1000012", "1000012")
    assert cls.type == "comet"
    assert data.facts.shape_model == "/data/shapes/stub.glb" and data.shape is not None


def test_committed_registry_types_c67p_from_its_recorded_reply(tmp_path: Path) -> None:
    ctx = make_context(make_settings(tmp_path / "cache", shapes_dir=SHAPES))
    body = (FIXTURES / "shapes" / "sbdb_67p.json").read_bytes()
    ctx.cache.put(sbdb_key("67P"), LiveResponse(body, "recorded", 200, "application/json"))
    obj = ResolvedObject(
        id="o", name="67P", ra=0.0, dec=0.0, moving=True, resolver="sbdb", spkid="1000012",
        query="67P",
    )  # fmt: skip
    data = gather(ctx, obj)
    assert classify(data.facts).type == "comet"
    assert data.shape is not None and data.shape.doi == "10.26007/34vg-8s07"
    assert data.shape.bbox_half_diagonal_km == pytest.approx(3.527)


# --- the comet mesh layer (R7.3, Q-162) -------------------------------------------------------


def test_comet_mesh_layer_needs_a_shape_source_and_a_nucleus_size() -> None:
    card = load("comet", "cards")
    assert not any(layer["id"] == "mesh" for layer in params_for(card)["layers"])
    assert "mesh" not in params_for(card)["missing"]  # a comet with no model has no mesh row

    card["shape_source"] = {
        "value": "/data/shapes/c67p-shap5.glb", "tag": "measured", "source": "SHAP5",
    }  # fmt: skip
    layer = next(layer for layer in params_for(card)["layers"] if layer["id"] == "mesh")
    assert layer["requires"] == ["shape_source", "nucleus_radius_km_max"]
    assert layer["tag"] in {"measured", "derived", "model_dependent", "inferred_from_analog"}

    del card["nucleus_radius_km_max"]  # no size: refused, never guessed
    p = params_for(card)
    assert "mesh" in p["missing"] and not any(layer["id"] == "mesh" for layer in p["layers"])

"""Issue #40 stream A: ICQ and OBJ ingest, GLB writer, registry loader, Eros served end to end."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import tomllib
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.core.card.catalogue import load_shape_registry
from app.core.card.validate import errors
from app.main import create_app
from scripts import ingest_shape as ing
from tests.conftest import make_settings
from tests.test_api import resolve_id

SHAPES = Path(__file__).resolve().parents[1] / "assets" / "shapes"


def cube_sphere_icq(q: int) -> str:
    """A unit sphere as an ICQ grid: six cube faces, each wound so (I,J) faces outward."""
    axes = [  # (normal, I direction); the J direction is u x n so that v x u = n
        ((0, 0, 1), (1, 0, 0)),
        ((1, 0, 0), (0, 1, 0)),
        ((0, 1, 0), (-1, 0, 0)),
        ((-1, 0, 0), (0, -1, 0)),
        ((0, -1, 0), (1, 0, 0)),
        ((0, 0, -1), (0, 1, 0)),
    ]
    lines = [str(q)]
    for n_, u_ in axes:
        n, u = np.array(n_), np.array(u_)
        v = np.cross(u, n)
        assert np.array_equal(np.cross(v, u), n)
        for j in range(q + 1):
            for i in range(q + 1):
                p = n + (2 * i / q - 1) * u + (2 * j / q - 1) * v
                p = p / np.linalg.norm(p)
                lines.append(f"{p[0]:.9f} {p[1]:.9f} {p[2]:.9f}")
    return "\n".join(lines) + "\n"


def test_icq_counts_welding_and_normals() -> None:
    q = 4
    grid = ing.read_icq(cube_sphere_icq(q))
    verts, tris = ing.icq_to_mesh(grid, tol=1e-6)
    assert len(tris) == 6 * q * q * 2
    assert len(verts) == 6 * q * q + 2
    assert ing.edge_check(tris) == (0, 0)
    tris = ing.orient_outward(verts, tris)
    assert ing.signed_volume(verts, tris) > 0
    nor = ing.vertex_normals(verts, tris)
    assert np.allclose(np.linalg.norm(nor, axis=1), 1)
    assert (np.einsum("ij,ij->i", nor, verts) > 0.9).all()  # outward on a unit sphere


def test_icq_weld_tolerates_rounded_duplicates() -> None:
    grid = ing.read_icq(cube_sphere_icq(4))
    noisy = grid + np.random.default_rng(1).normal(0, 1e-5, grid.shape)
    verts, tris = ing.icq_to_mesh(noisy, tol=1e-3)
    assert len(verts) == 6 * 16 + 2 and ing.edge_check(tris) == (0, 0)


def test_inward_winding_is_flipped() -> None:
    grid = ing.read_icq(cube_sphere_icq(4))
    verts, tris = ing.icq_to_mesh(grid, tol=1e-6)
    inside_out = tris[:, ::-1]
    assert ing.signed_volume(verts, inside_out) < 0
    assert ing.signed_volume(verts, ing.orient_outward(verts, inside_out)) > 0


def test_downsample_halves_q() -> None:
    grid = ing.read_icq(cube_sphere_icq(4))
    half = ing.downsample_icq(grid)
    assert half.shape == (6, 3, 3, 3)
    verts, tris = ing.icq_to_mesh(half, tol=1e-6)
    assert len(tris) == 6 * 2 * 2 * 2 and len(verts) == 6 * 4 + 2
    with pytest.raises(ing.ShapeError):
        ing.downsample_icq(ing.read_icq(cube_sphere_icq(3)))


def test_bad_icq_is_refused() -> None:
    with pytest.raises(ing.ShapeError):
        ing.read_icq("2\n1 2 3\n")


def test_obj_reader_and_over_budget_refusal() -> None:
    obj = "# tetra\nv 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4\n"
    v, f = ing.read_obj(obj)
    assert v.shape == (4, 3) and f.shape == (4, 3)
    quad = ing.read_obj("v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1/1 2/2 3/3 4/4\n")[1]
    assert len(quad) == 2
    levels = ing.build_levels(obj.encode(), is_icq=False, km_to_m=1.0)
    assert len(levels) == 2 and ing.signed_volume(levels[0][0], levels[0][1]) > 0
    with pytest.raises(ing.ShapeError):
        ing.read_obj("v 0 0 0\n")
    with pytest.raises(ing.ShapeError):
        ing.read_obj("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 9\n")
    open_obj = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"  # one triangle: not closed
    with pytest.raises(ing.ShapeError, match="not closed"):
        ing.build_levels(open_obj.encode(), is_icq=False)


def make_args(tmp_path: Path, src: Path) -> argparse.Namespace:
    return argparse.Namespace(
        zip=None, member=None, input=str(src), format="auto", slug="demo", spkid="1",
        name="Demo", citation="Cite.", doi="10.0/x", licence="CC0-1.0", frame="body-fixed",
        convex=False, source_url="", out_dir=str(tmp_path / "out"),
    )  # fmt: skip


def test_ingest_glb_roundtrip_and_determinism(tmp_path: Path) -> None:
    src = tmp_path / "s.tab"
    src.write_text(cube_sphere_icq(4))
    entry = ing.ingest(make_args(tmp_path, src))
    out = tmp_path / "out"
    first = {p.name: p.read_bytes() for p in out.iterdir()}
    ing.ingest(make_args(tmp_path, src))
    assert {p.name: p.read_bytes() for p in out.iterdir()} == first
    assert set(first) == {"demo.glb", "demo.lod1.glb", "registry.toml"}

    doc, blob = ing.read_glb(first["demo.glb"])
    assert doc["asset"]["generator"].startswith("Shift & Spectrum ingest_shape")
    assert "CC0-1.0" in doc["asset"]["copyright"] and "10.0/x" in doc["asset"]["copyright"]
    pos_acc, nor_acc, idx_acc = doc["accessors"]
    assert pos_acc["count"] == entry["vertices_lod0"] == 6 * 16 + 2
    pos = np.frombuffer(blob, "<f4", count=pos_acc["count"] * 3).reshape(-1, 3)
    assert np.allclose(pos.max(axis=0), pos_acc["max"]) and np.allclose(
        pos.min(axis=0), pos_acc["min"]
    )
    assert pos.max() == pytest.approx(1000.0, rel=0.01)  # km -> m
    assert idx_acc["componentType"] == 5123 and idx_acc["count"] == 6 * 16 * 2 * 3
    off = doc["bufferViews"][1]["byteOffset"]
    nor = np.frombuffer(blob, "<f4", count=nor_acc["count"] * 3, offset=off).reshape(-1, 3)
    assert np.allclose(np.linalg.norm(nor, axis=1), 1, atol=1e-5)
    reg = json.loads(json.dumps(__import__("tomllib").loads((out / "registry.toml").read_text())))
    assert reg["model"][0]["lod1"] == "/data/shapes/demo.lod1.glb"
    assert reg["model"][0]["triangles_lod1"] == 6 * 4 * 2


def test_registry_loader_missing_and_broken(tmp_path: Path) -> None:
    assert load_shape_registry(tmp_path) == {}
    (tmp_path / "registry.toml").write_text("not = [valid")
    assert load_shape_registry(tmp_path) == {}
    (tmp_path / "registry.toml").write_text("[[model]]\nspkid = '1'\n")  # fields missing
    assert load_shape_registry(tmp_path) == {}


def test_committed_registry_matches_files() -> None:
    models = load_shape_registry(SHAPES)
    eros = models["20000433"]
    assert eros.lod0 == "/data/shapes/eros-gaskell.glb" and not eros.convex
    for path in (eros.lod0, eros.lod1):
        doc, _ = ing.read_glb((SHAPES / Path(path).name).read_bytes())
        assert doc["accessors"][2]["count"] // 3 <= ing.TRIANGLE_BUDGET
    raw = tomllib.loads((SHAPES / "registry.toml").read_text("utf-8"))["model"][0]
    for level in ("lod0", "lod1"):  # the committed GLBs are the ones the registry describes
        blob = (SHAPES / Path(raw[level]).name).read_bytes()
        assert hashlib.sha256(blob).hexdigest() == raw[f"{level}_sha256"]


def test_axes_are_gltf_y_up() -> None:
    # A point on the body +Z pole lands on glTF +Y; +X stays; +Y goes to -Z. Proper rotation.
    r = ing.Z_UP_TO_Y_UP
    assert np.allclose(r @ [0, 0, 1], [0, 1, 0]) and np.allclose(r @ [1, 0, 0], [1, 0, 0])
    assert np.allclose(r @ [0, 1, 0], [0, 0, -1]) and np.linalg.det(r) == pytest.approx(1.0)


def test_eros_spin_axis_is_gltf_y() -> None:
    """The viewer spins about +Y (PR #45 review); Eros's short axis is its spin pole."""
    raw = tomllib.loads((SHAPES / "registry.toml").read_text("utf-8"))["model"][0]
    assert raw["axes"] == ing.AXES_NOTE
    doc, _ = ing.read_glb((SHAPES / "eros-gaskell.glb").read_bytes())
    ext = np.subtract(doc["accessors"][0]["max"], doc["accessors"][0]["min"]) / 1000.0
    assert int(np.argmin(ext)) == 1  # Y is the shortest extent
    assert np.allclose(ext, raw["extents_km"], atol=0.001)


def test_registry_entry_without_its_mesh_is_skipped(tmp_path: Path) -> None:
    shutil.copy(SHAPES / "registry.toml", tmp_path / "registry.toml")
    shutil.copy(SHAPES / "eros-gaskell.glb", tmp_path / "eros-gaskell.glb")  # lod1 missing
    assert load_shape_registry(tmp_path) == {}  # refuse rather than serve a 404 mesh
    shutil.copy(SHAPES / "eros-gaskell.lod1.glb", tmp_path / "eros-gaskell.lod1.glb")
    assert "20000433" in load_shape_registry(tmp_path)


def test_unregistered_glb_on_disk_is_not_served(tmp_path: Path) -> None:
    shapes = tmp_path / "shapes"
    shutil.copytree(SHAPES, shapes)
    shutil.copy(shapes / "eros-gaskell.glb", shapes / "stray.glb")
    client = TestClient(create_app(make_settings(tmp_path / "cache", shapes_dir=shapes)))
    assert client.get("/data/shapes/eros-gaskell.glb").status_code == 200
    assert client.get("/data/shapes/stray.glb").status_code == 404


@pytest.mark.parametrize("slug", ["Eros", "../x", "a/b", "-x", ""])
def test_ingest_rejects_unservable_slug(slug: str) -> None:
    args = argparse.Namespace(slug=slug)
    with pytest.raises(ing.ShapeError):
        ing.ingest(args)


def test_eros_card_is_asteroid_shape_with_served_mesh(client: TestClient) -> None:
    oid = resolve_id(client, "433 Eros")
    card = client.get(f"/v1/objects/{oid}/card").json()
    assert card["type"] == "asteroid_shape"
    src = card["shape_source"]
    assert src["value"] == "/data/shapes/eros-gaskell.glb" and src["tag"] == "measured"
    assert "10.26033/d0gq-9427" in src["source"] and "CC0-1.0" in src["source"]
    assert card["diameter_km"]["value"] == 16.84
    assert errors(card, "object-card.schema.json") == []
    params = client.get(f"/v1/objects/{oid}/render-params")
    assert params.status_code == 200 and errors(params.json(), "render-params.schema.json") == []
    assert params.json()["type"] == "asteroid_shape"
    mesh = client.get(src["value"])
    assert mesh.status_code == 200 and mesh.content[:4] == b"glTF"
    assert mesh.headers["content-type"] == "model/gltf-binary"
    assert client.get("/data/shapes/eros-gaskell.lod1.glb").status_code == 200


@pytest.mark.parametrize("name", ["registry.toml", "..%2Fregistry.toml", "nope.glb", "X.glb"])
def test_only_registered_glb_names_are_served(client: TestClient, name: str) -> None:
    assert client.get(f"/data/shapes/{name}").status_code == 404

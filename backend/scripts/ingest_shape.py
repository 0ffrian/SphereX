"""Ingest a shape model into two GLB levels of detail and a registry entry (A3.7, A3.10, R7.1).

    uv run python -m scripts.ingest_shape --zip PATH --member NAME.tab --slug eros-gaskell \\
        --spkid 2000433 --name "433 Eros" --citation ... --doi ... --licence CC0-1.0

Input is an ICQ file (Gaskell, PDS) or a Wavefront OBJ (DAMIT). Output is ``<slug>.glb`` (LOD0)
and ``<slug>.lod1.glb`` (LOD1) in ``assets/shapes`` plus an entry in ``registry.toml``.
No decimation: an ICQ grid is halved exactly (keep every second grid point); an OBJ is used as is.
The output is byte-deterministic (no timestamps, sorted JSON keys, fixed padding).
Units: km in, metres out (glTF). The body-fixed frame and origin are kept as given.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
import sys
import tomllib
import zipfile
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

INGEST_VERSION = "1"
GENERATOR = f"Shift & Spectrum ingest_shape {INGEST_VERSION}"
TRIANGLE_BUDGET = 50_000  # R5.5
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "assets" / "shapes"

Array = NDArray[Any]


class ShapeError(ValueError):
    """Input cannot be turned into a mesh without inventing data."""


# --- readers ---------------------------------------------------------------------------------


def read_icq(text: str) -> Array:
    """Return the grid ``g[F, J, I] = (x, y, z)`` (shape ``(6, Q+1, Q+1, 3)``, input units)."""
    lines = text.split()
    if not lines:
        raise ShapeError("empty ICQ file")
    q = int(lines[0])
    n = 6 * (q + 1) ** 2
    vals = np.array(lines[1:], dtype=np.float64)
    if q < 1 or vals.size != 3 * n:
        raise ShapeError(f"ICQ file: expected {3 * n} numbers for Q={q}, found {vals.size}")
    return vals.reshape(6, q + 1, q + 1, 3)


def downsample_icq(grid: Array) -> Array:
    """Q -> Q/2 by keeping v(2I, 2J, F). Exact (no new vertices); Q must be even."""
    q = grid.shape[1] - 1
    if q % 2:
        raise ShapeError(f"cannot halve an ICQ grid with odd Q={q}")
    return grid[:, ::2, ::2, :]


def read_obj(text: str) -> tuple[Array, Array]:
    """Minimal OBJ: ``v x y z`` and ``f a b c`` (1-based, ``a/b/c`` accepted; quads are split)."""
    verts: list[list[float]] = []
    tris: list[list[int]] = []
    for raw in text.splitlines():
        parts = raw.split()
        if not parts:
            continue
        if parts[0] == "v" and len(parts) >= 4:
            verts.append([float(p) for p in parts[1:4]])
        elif parts[0] == "f" and len(parts) >= 4:
            idx = [int(p.split("/")[0]) for p in parts[1:]]
            idx = [i - 1 if i > 0 else len(verts) + i for i in idx]
            for k in range(1, len(idx) - 1):
                tris.append([idx[0], idx[k], idx[k + 1]])
    if not verts or not tris:
        raise ShapeError("OBJ file has no vertices or no faces")
    v = np.array(verts, dtype=np.float64)
    f = np.array(tris, dtype=np.int64)
    if f.min() < 0 or f.max() >= len(v):
        raise ShapeError("OBJ face index out of range")
    return v, f


# --- mesh ------------------------------------------------------------------------------------


# The ICQ spec says shared edge vertices are identical. In the Gaskell files they differ by up to
# about 3 m (the PDS table is rounded and each face is solved separately), while distinct grid
# neighbours are at least ~17 m apart at Q=64. 5 m sits in that gap (measured on quad64q.tab).
ICQ_WELD_TOL_KM = 0.005


def _near_pairs(points: Array, tol: float) -> Array:
    """Index pairs closer than ``tol`` (sweep over points sorted by x; exact match when 0)."""
    order = np.argsort(points[:, 0], kind="stable")
    s = points[order]
    out: list[Array] = []
    k = 1
    while k < len(s):
        dx = s[k:, 0] - s[:-k, 0]
        if not (dx <= tol).any():
            break
        d = np.linalg.norm(s[k:] - s[:-k], axis=1)
        hit = np.nonzero(d <= tol)[0]
        out.append(np.stack([order[hit], order[hit + k]], axis=1))
        k += 1
    return np.concatenate(out) if out else np.empty((0, 2), dtype=np.int64)


def weld(points: Array, tris: Array, tol: float = 0.0) -> tuple[Array, Array]:
    """Merge vertices closer than ``tol`` (cluster mean, first-occurrence order); drop slivers."""
    labels = np.arange(len(points))
    pairs = _near_pairs(points, tol)
    while len(pairs):
        m = np.minimum(labels[pairs[:, 0]], labels[pairs[:, 1]])
        before = labels.copy()
        np.minimum.at(labels, pairs[:, 0], m)
        np.minimum.at(labels, pairs[:, 1], m)
        labels = labels[labels]  # path compression
        if np.array_equal(before, labels):
            break
    uniq, inverse = np.unique(labels, return_inverse=True)  # ascending = first occurrence
    inverse = inverse.reshape(-1)
    sums = np.zeros((len(uniq), 3))
    np.add.at(sums, inverse, points)
    verts = sums / np.bincount(inverse)[:, None]
    f = inverse[tris]
    keep = (f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])
    return verts, f[keep]


def icq_to_mesh(grid: Array, tol: float = ICQ_WELD_TOL_KM) -> tuple[Array, Array]:
    """Triangulate an ICQ grid: facet (I,J) -> (a,b,c) and (a,c,d), a..d = ICQ vertex order."""
    q = grid.shape[1] - 1
    pts = grid.reshape(-1, 3)
    idx = np.arange(6 * (q + 1) ** 2).reshape(6, q + 1, q + 1)  # [F, J, I]
    a = idx[:, :q, :q]
    b = idx[:, 1:, :q]  # (I, J+1)
    c = idx[:, 1:, 1:]  # (I+1, J+1)
    d = idx[:, :q, 1:]  # (I+1, J)
    quads = np.stack([a, b, c, d], axis=-1).reshape(-1, 4)
    tris = np.concatenate([quads[:, [0, 1, 2]], quads[:, [0, 2, 3]]], axis=0)
    # Interleave so both triangles of a facet are adjacent (cache friendly, stable order).
    n = len(quads)
    tris = np.stack([tris[:n], tris[n:]], axis=1).reshape(-1, 3)
    return weld(pts, tris, tol)


def signed_volume(verts: Array, tris: Array) -> float:
    a, b, c = verts[tris[:, 0]], verts[tris[:, 1]], verts[tris[:, 2]]
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)


def edge_check(tris: Array) -> tuple[int, int]:
    """Return (edges not shared by exactly two triangles, edges with the same direction twice).

    Both are 0 for a closed, consistently wound surface.
    """
    e = np.concatenate([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]])
    key = e[:, 0].astype(np.int64) * (int(tris.max()) + 1) + e[:, 1]
    _, counts = np.unique(key, return_counts=True)
    same_dir = int((counts > 1).sum())
    und = np.sort(e, axis=1)
    ukey = und[:, 0].astype(np.int64) * (int(tris.max()) + 1) + und[:, 1]
    _, ucounts = np.unique(ukey, return_counts=True)
    return int((ucounts != 2).sum()), same_dir


def orient_outward(verts: Array, tris: Array) -> Array:
    """Counter-clockwise seen from outside means signed volume > 0; flip every triangle if not."""
    if signed_volume(verts, tris) < 0:
        return tris[:, ::-1].copy()
    return tris


def vertex_normals(verts: Array, tris: Array) -> Array:
    """Area-weighted face normals summed per vertex (the cross product length is 2 x area)."""
    a, b, c = verts[tris[:, 0]], verts[tris[:, 1]], verts[tris[:, 2]]
    fn = np.cross(b - a, c - a)
    acc = np.zeros_like(verts)
    for k in range(3):
        np.add.at(acc, tris[:, k], fn)
    length = np.linalg.norm(acc, axis=1, keepdims=True)
    return np.divide(acc, length, out=np.zeros_like(acc), where=length > 0)


# --- glTF ------------------------------------------------------------------------------------


def _pad(b: bytes, fill: bytes) -> bytes:
    return b + fill * (-len(b) % 4)


def write_glb(
    verts_m: Array, tris: Array, normals: Array, copyright_text: str, extras: Any
) -> bytes:
    """One mesh, POSITION (with min/max), NORMAL, indices; glTF 2.0 binary, byte-deterministic."""
    pos = np.ascontiguousarray(verts_m, dtype="<f4")
    nor = np.ascontiguousarray(normals, dtype="<f4")
    wide = len(pos) >= 65536
    idx = np.ascontiguousarray(tris.reshape(-1), dtype="<u4" if wide else "<u2")
    pb, nb = pos.tobytes(), nor.tobytes()
    ib = _pad(idx.tobytes(), b"\0")
    blob = pb + nb + ib
    doc = {
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": len(pos),
                "max": [float(x) for x in pos.max(axis=0)],
                "min": [float(x) for x in pos.min(axis=0)],
                "type": "VEC3",
            },
            {"bufferView": 1, "componentType": 5126, "count": len(nor), "type": "VEC3"},
            {
                "bufferView": 2,
                "componentType": 5125 if wide else 5123,
                "count": int(idx.size),
                "type": "SCALAR",
            },
        ],
        "asset": {
            "copyright": copyright_text,
            "extras": extras,
            "generator": GENERATOR,
            "version": "2.0",
        },
        "bufferViews": [
            {"buffer": 0, "byteLength": len(pb), "byteOffset": 0, "target": 34962},
            {"buffer": 0, "byteLength": len(nb), "byteOffset": len(pb), "target": 34962},
            {
                "buffer": 0,
                "byteLength": int(idx.nbytes),
                "byteOffset": len(pb) + len(nb),
                "target": 34963,
            },
        ],
        "buffers": [{"byteLength": len(blob)}],
        "meshes": [
            {"primitives": [{"attributes": {"NORMAL": 1, "POSITION": 0}, "indices": 2, "mode": 4}]}
        ],
        "nodes": [{"mesh": 0}],
        "scene": 0,
        "scenes": [{"nodes": [0]}],
    }
    js = _pad(
        json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode(), b" "
    )
    total = 12 + 8 + len(js) + 8 + len(blob)
    return (
        struct.pack("<III", 0x46546C67, 2, total)
        + struct.pack("<II", len(js), 0x4E4F534A)
        + js
        + struct.pack("<II", len(blob), 0x004E4942)
        + blob
    )


def read_glb(data: bytes) -> tuple[dict[str, Any], bytes]:
    """Parse the JSON and BIN chunks (used by tests and the self-check)."""
    magic, version, total = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67 or version != 2 or total != len(data):
        raise ShapeError("not a glTF 2.0 binary")
    jl, jt = struct.unpack_from("<II", data, 12)
    doc = json.loads(data[20 : 20 + jl])
    bl, bt = struct.unpack_from("<II", data, 20 + jl)
    if jt != 0x4E4F534A or bt != 0x004E4942:
        raise ShapeError("unexpected chunk types")
    return doc, data[28 + jl : 28 + jl + bl]


# --- registry --------------------------------------------------------------------------------


def _toml_value(v: Any) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, list):
        return "[" + ", ".join(_toml_value(x) for x in v) + "]"
    return json.dumps(str(v), ensure_ascii=True)


def dump_registry(models: list[dict[str, Any]]) -> str:
    out = [
        "# Shape-model registry (A3.7, A3.10, Q-61). Written by scripts/ingest_shape.py; do not",
        "# edit by hand. Paths are same-origin (Q-44); `convex` is true for DAMIT inversions.",
    ]
    for m in sorted(models, key=lambda m: m["spkid"]):
        out.append("\n[[model]]")
        out.extend(f"{k} = {_toml_value(m[k])}" for k in sorted(m))
    return "\n".join(out) + "\n"


def update_registry(path: Path, entry: dict[str, Any]) -> None:
    models: list[dict[str, Any]] = []
    if path.exists():
        models = [m for m in tomllib.loads(path.read_text("utf-8")).get("model", [])]
    models = [m for m in models if m.get("spkid") != entry["spkid"]]
    models.append(entry)
    path.write_text(dump_registry(models), "utf-8", newline="\n")


# --- driver ----------------------------------------------------------------------------------


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def build_levels(
    data: bytes, is_icq: bool, km_to_m: float = 1000.0
) -> list[tuple[Array, Array, Array]]:
    """Return [(verts_m, tris, normals) for LOD0, LOD1] after the welding and winding checks."""
    if is_icq:
        grid = read_icq(data.decode("ascii"))
        grids = [grid, downsample_icq(grid)]
        meshes = [icq_to_mesh(g) for g in grids]
    else:
        v, f = read_obj(data.decode("utf-8"))
        meshes = [weld(v, f)]
        meshes.append(meshes[0])  # no exact reduction for an OBJ: LOD1 is the same mesh
    out = []
    for verts, tris in meshes:
        if len(tris) > TRIANGLE_BUDGET:
            raise ShapeError(
                f"{len(tris)} triangles exceeds the {TRIANGLE_BUDGET} budget (R5.5) and no exact "
                "reduction applies; reduce the model offline first"
            )
        open_edges, dup_dir = edge_check(tris)
        if open_edges or dup_dir:
            raise ShapeError(
                f"mesh is not closed and consistently wound ({open_edges} open or non-manifold "
                f"edges, {dup_dir} same-direction edges); refusing to ship it"
            )
        tris = orient_outward(verts, tris)
        out.append((verts * km_to_m, tris, vertex_normals(verts, tris)))
    return out


def ingest(args: argparse.Namespace) -> dict[str, Any]:
    if args.zip:
        with zipfile.ZipFile(args.zip) as z:
            data = z.read(args.member)
        member = args.member
    else:
        data = Path(args.input).read_bytes()
        member = Path(args.input).name
    is_icq = member.lower().endswith(".tab") if args.format == "auto" else args.format == "icq"
    levels = build_levels(data, is_icq)
    cite = f"{args.citation} DOI {args.doi}. Licence {args.licence}."
    extras = {"doi": args.doi, "licence": args.licence, "spkid": args.spkid, "units": "m"}
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    names = [f"{args.slug}.glb", f"{args.slug}.lod1.glb"]
    blobs = [write_glb(v, t, n, cite, extras) for v, t, n in levels]
    for name, blob in zip(names, blobs, strict=True):
        (out_dir / name).write_bytes(blob)
    v0, t0, _ = levels[0]
    ext_km = (v0.max(axis=0) - v0.min(axis=0)) / 1000.0
    entry: dict[str, Any] = {
        "spkid": args.spkid,
        "name": args.name,
        "slug": args.slug,
        "lod0": f"/data/shapes/{names[0]}",
        "lod1": f"/data/shapes/{names[1]}",
        "triangles_lod0": len(t0),
        "triangles_lod1": len(levels[1][1]),
        "vertices_lod0": len(v0),
        "vertices_lod1": len(levels[1][0]),
        "extents_km": [round(float(x), 3) for x in ext_km],
        "units": "metres in the GLB (source km x 1000)",
        "frame": args.frame,
        "citation": args.citation,
        "doi": args.doi,
        "licence": args.licence,
        "convex": bool(args.convex),
        "source_member": member,
        "source_sha256": sha256(data),
        "lod0_sha256": sha256(blobs[0]),
        "lod1_sha256": sha256(blobs[1]),
        "ingest_version": INGEST_VERSION,
    }
    if args.source_url:
        entry["source_url"] = args.source_url
    update_registry(out_dir / "registry.toml", entry)
    return entry


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--input", help="local ICQ (.tab) or OBJ file")
    p.add_argument("--zip", help="zip archive holding the member")
    p.add_argument("--member", help="path of the file inside --zip")
    p.add_argument("--format", choices=["auto", "icq", "obj"], default="auto")
    p.add_argument("--slug", required=True)
    p.add_argument("--spkid", required=True, help="SBDB spkid, e.g. 2000433")
    p.add_argument("--name", required=True)
    p.add_argument("--citation", required=True)
    p.add_argument("--doi", required=True)
    p.add_argument("--licence", required=True)
    p.add_argument("--frame", required=True, help="coordinate frame note")
    p.add_argument("--convex", action="store_true", help="convex inversion (DAMIT)")
    p.add_argument("--source-url", default="")
    p.add_argument("--out-dir", default=str(DEFAULT_OUT))
    args = p.parse_args(argv)
    if bool(args.zip) == bool(args.input) or bool(args.zip) != bool(args.member):
        p.error("give either --input, or --zip together with --member")
    try:
        entry = ingest(args)
    except ShapeError as e:
        print(f"refused: {e}", file=sys.stderr)
        return 1
    print(json.dumps(entry, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

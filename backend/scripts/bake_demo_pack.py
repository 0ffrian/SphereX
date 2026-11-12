"""Bake the pre-built demo pack (issue #68 Track F, 7c; Q-164, A5.4, D-25).

    uv run python -m scripts.bake_demo_pack            # rewrite the pack (catalogues needed once)
    uv run python -m scripts.bake_demo_pack --check    # exit 1 if a committed byte differs
    uv run python -m scripts.bake_demo_pack --check --strict   # never fall back (see below)

For every row of the demo search list (``SEARCH_LIST``, the order of the search bar) this runs the
real pipeline on the D-25 cache, the way ``ObjectPipeline`` builds an object: resolve, stage 3
(classify, geometry, star data), the card, stage 7 (``card_to_params``) and the baker. It writes:

- ``backend/assets/<type>/<id>.json``: the saved Asset (A5.4). ``AssetStore`` reads it first, so a
  pack hit answers with ``X-SX-Asset-Status: saved``. ``created_at`` is the fixed ``PACK_EPOCH``
  (not a release date), so a rerun is byte-identical. Each asset also holds ``asset_version`` and
  ``inputs_sha256`` (Q-167): the store refuses an asset whose version differs, and ``--check``
  fails when either differs from this code, with no cache needed.
- ``backend/assets/textures/<id>/<generator_version>/<seed>/<W>x<H>/{albedo.webp, height.png,
  height.bin, normal.png}`` at the R5 mobile size (``PACK_SIZES``, Q-164), for the types with maps.
  The Asset's texture URLs point at ``/data/demo-textures`` (a read-only mount of that tree).
- ``frontend/src/app/search/demoTargets.ts``: the list the search bar shows, with each row's class
  label (``TYPE_NAME`` from ``altText.ts`` plus the card's spectral class; null with no card).

No SPHEREx frames or spectra are fetched or written: the pack has a card without a spectrum
(``spectrum`` is in ``missing``, as for a ``frames = false`` target), so the 3D body, the legend and
the alt text work with no frames. A row the pipeline cannot resolve or build gets no asset and a
null class label; nothing is invented.

``--check`` rebuilds everything in memory and compares every byte; PNG maps are compared by their
chunks and inflated image data (Q-204). It needs the catalogue answers
(SIMBAD, SBDB, Exoplanet Archive, Horizons) of each row in the D-25 cache (``SX_CACHE_DIR``,
filled by running this script once online). For a row whose answers are not cached (a fresh CI
checkout has no cache), plain ``--check`` falls back to what the committed card alone gives
(stage 7, the textures, the JSON and the TypeScript) and says so per row; ``--strict`` makes that
a failure. Run ``--check --strict`` on a machine with the cache after any change to stage 3.

Cache-free guards (``stale_inputs``, Q-167), run by every ``--check``: each committed asset's
``asset_version`` equals ``ASSET_VERSION``; its ``inputs_sha256`` equals the hash of
``literature.toml``, ``pm13_dwarf_teff.toml`` and the shape ``registry.toml``; and every literature
registry field of the committed card equals what the registry gives now.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import quote

from app.cache.store import CacheMissOffline, UpstreamUnavailable
from app.context import Context, make_context
from app.core.card import literature as lit
from app.core.card.assets import ASSET_VERSION, Asset, AssetStore
from app.core.card.catalogue import apply_geometry, fetch_geometry, gather, with_star_data
from app.core.card.service import GEOMETRY_TYPES, ObjectPipeline
from app.core.card.stars import STAR_TYPES
from app.core.classify import classify
from app.core.find.frames import FrameService
from app.core.find.resolver import load_aliases, resolve
from app.core.render.background import SIZES
from app.core.render.bake import bake, bake_dir, encode, same_png
from app.core.render.card_to_params import (
    GENERATOR_VERSION,
    TEXTURE_URL_ROOT,
    card_to_params,
)
from app.core.render.params import BakeRefusal, params_from_card
from app.settings import BACKEND_DIR, Settings

REPO = BACKEND_DIR.parent
ASSETS_DIR = BACKEND_DIR / "assets"
TEXTURES_DIR = ASSETS_DIR / "textures"
DEMO_TARGETS_TS = REPO / "frontend" / "src" / "app" / "search" / "demoTargets.ts"
ALT_TEXT_TS = REPO / "frontend" / "src" / "viewer" / "altText.ts"
DEMO_TEXTURE_URL_ROOT = "/data/demo-textures"
# Q-164: the pack holds the R5 mobile size only. Both sizes of the four textured rows measured
# 33.3 MB (height.bin and normal.png are 4 MB each at 2048x1024) against the 15 MB budget (7c);
# 1024x512 is a quarter of that. The URLs point at this size, and the viewer reads any 2:1 map.
DESKTOP_SIZE, MOBILE_SIZE = SIZES
PACK_SIZES = (MOBILE_SIZE,)

# The fixed ``created_at`` of every pack asset, so a rerun is byte-identical (Q-164). It is NOT a
# data release date. IRSA's page (irsa.ipac.caltech.edu/Missions/spherex.html) says only "October
# 2025: First reprocessed Quick Release Products (QR2) available at IRSA", with no day. Changing it
# re-bakes the pack.
PACK_EPOCH = "2025-10-01T00:00:00.000Z"


def inputs_sha256(settings: Settings) -> str:
    """Hash of the reviewed read-only inputs a pack asset depends on: the literature registry, the
    Pecaut and Mamajek dwarf Teff table and the shape registry (Q-167). Each file's name is hashed
    with its bytes; a missing file hashes as empty, so a deleted input changes the hash."""
    h = hashlib.sha256()
    for path in (
        settings.literature_file,
        settings.dwarf_teff_file,
        settings.shapes_dir / "registry.toml",
    ):
        h.update(path.name.encode() + b"\0" + (_read(path) or b"") + b"\0")
    return h.hexdigest()


@dataclass(frozen=True)
class SearchRow:
    """One row of the search list (issue #68, 7b). ``aliases`` only filter the list; the backend
    resolver's aliases come from ``targets.toml`` (``query`` must be a target there)."""

    name: str
    query: str
    aliases: tuple[str, ...]


# The rows in the order the search bar shows them.
SEARCH_LIST: tuple[SearchRow, ...] = (
    SearchRow("Barnard's Star", "Barnard's star", ("barnard", "barnards")),
    SearchRow("Epsilon Indi B", "eps Ind B", ("eps indi b", "epsilon indi")),
    SearchRow("WISE 0855-0714", "WISE J085510.83-071442.5", ("wise 0855", "w0855")),
    SearchRow("RW Aurigae", "RW Aur", ("rw aur",)),
    SearchRow("R Draconis", "R Dra", ("r dra",)),
    SearchRow("TRAPPIST-1 f", "TRAPPIST-1 f", ("trappist-1f", "trappist 1 f")),
    SearchRow("Kepler-186 f", "Kepler-186 f", ("kepler-186f", "kepler 186 f")),
    SearchRow("Bennu", "101955 Bennu", ("bennu", "101955")),
    SearchRow("'Oumuamua", "1I/2017 U1", ("oumuamua", "'oumuamua", "1i")),
    SearchRow("3I/ATLAS", "3I/ATLAS", ("3i", "atlas")),
    SearchRow("HD 189733 b", "HD 189733 b", ("hd 189733", "hd189733b")),
    SearchRow("TRAPPIST-1 e", "TRAPPIST-1 e", ("trappist-1e",)),
    SearchRow("K2-18 b", "K2-18 b", ("k2-18", "k218")),
    SearchRow("Comet 67P", "67P/Churyumov-Gerasimenko", ("67p", "churyumov", "gerasimenko")),
    SearchRow("Orion Nebula", "M 42", ("orion", "m42")),
    SearchRow("Crab Nebula", "M 1", ("crab", "m1")),
    # Row 17 (issue #73, Q-197): the Track MVP (Q-137), appended so rows 1 to 16 keep Q-161's order.
    SearchRow("433 Eros", "433 Eros", ("eros", "433")),
    # Issue #71 stream S (Q-280 to Q-284): two more stars and two more exoplanets.
    SearchRow("Procyon A", "Procyon", ("procyon", "alpha cmi", "alf cmi")),
    SearchRow("Epsilon Eridani", "eps Eri", ("eps eri", "epsilon eri", "eps eridani")),
    SearchRow("TOI-700 d", "TOI-700 d", ("toi-700", "toi700d", "toi 700 d")),
    SearchRow("WASP-39 b", "WASP-39 b", ("wasp-39", "wasp39b", "wasp 39 b")),
    # Issue #71 stream S2 (Q-317 to Q-319): a lava world.
    SearchRow("55 Cancri e", "55 Cnc e", ("55 cnc e", "55 cnc", "55cnce", "cancri e")),
)

FileMap = dict[Path, bytes]
UNAVAILABLE = "catalogue answer unavailable"


@dataclass
class RowResult:
    row: SearchRow
    object_id: str | None = None
    type: str | None = None
    asset: Asset | None = None
    class_label: str | None = None
    error: str = ""  # why there is no asset
    missing: tuple[str, ...] = ()
    from_card_only: bool = False  # --check: the catalogues were not in the cache
    notes: list[str] = field(default_factory=list)


# --- class labels ---------------------------------------------------------------------------


def type_names(path: Path = ALT_TEXT_TS) -> dict[str, str]:
    """``TYPE_NAME`` of ``altText.ts``, read from the source so there is one list (7a)."""
    text = path.read_text(encoding="utf-8")
    block = re.search(r"export const TYPE_NAME[^{]*\{(.*?)\n\};", text, re.S)
    if block is None:
        raise ValueError(f"TYPE_NAME not found in {path}")
    names = dict(re.findall(r"^\s*(\w+):\s*'([^']*)',?\s*$", block.group(1), re.M))
    if not names:
        raise ValueError(f"TYPE_NAME in {path} is empty")
    return names


def class_label(card: dict[str, Any], names: dict[str, str]) -> str | None:
    """The type name, plus the card's spectral class when it has one. None for an unknown type,
    and for ``candidate``: TYPE_NAME says "unidentified moving source", which is false for a fixed
    object (M 42, M 1) the pipeline could not type (Q-164)."""
    base = names.get(str(card.get("type")))
    if base is None or card.get("type") == "candidate":
        return None
    sc = card.get("spectral_class")
    value = sc.get("value") if isinstance(sc, dict) else None
    return f"{base} \u00b7 {value}" if isinstance(value, str) and value.strip() else base


# --- one row --------------------------------------------------------------------------------


def _to_pack_urls(textures: dict[str, Any] | None) -> dict[str, Any] | None:
    """Point the texture URLs at the demo mount (the R6.7 path is unchanged)."""
    if textures is None:
        return None
    out: dict[str, Any] = {}
    for key, value in textures.items():
        if isinstance(value, str):
            if not value.startswith(TEXTURE_URL_ROOT + "/"):
                raise ValueError(f"unexpected texture URL {value!r}")
            value = DEMO_TEXTURE_URL_ROOT + value.removeprefix(TEXTURE_URL_ROOT)
            desktop = f"/{DESKTOP_SIZE[0]}x{DESKTOP_SIZE[1]}/"
            if desktop not in value:
                raise ValueError(f"texture URL {value!r} has no {desktop} size directory")
            value = value.replace(desktop, f"/{MOBILE_SIZE[0]}x{MOBILE_SIZE[1]}/")
        out[key] = value
    return out


def _asset(card: dict[str, Any], params: dict[str, Any], settings: Settings) -> Asset:
    params = dict(params)
    if "textures" in params:
        params["textures"] = _to_pack_urls(params["textures"])
    return Asset(
        card=card,
        render_params=params,
        textures=params.get("textures"),
        generator_version=str(params["generator_version"]),
        seed=int(params["seed"]),
        created_at=PACK_EPOCH,
        asset_version=ASSET_VERSION,
        inputs_sha256=inputs_sha256(settings),
    )


def build_row(
    ctx: Context, pipeline: ObjectPipeline, aliases: dict[str, str], row: SearchRow
) -> RowResult:
    """Resolve, stage 3, card, stage 7: the answer a live build gives with no frames, through the
    same assembly the API uses (``ObjectPipeline.assemble_without_spectrum``)."""
    res = RowResult(row)
    try:
        obj = resolve(ctx, row.query, aliases).obj
    except LookupError as exc:  # not found, ambiguous: an honest refusal, no asset
        res.error = f"resolve: {exc}"
        return res
    res.object_id = obj.id
    data = gather(ctx, obj)
    cls = classify(data.facts)
    if cls.type in GEOMETRY_TYPES:
        data = apply_geometry(data, fetch_geometry(ctx, obj))
    elif cls.type in STAR_TYPES:
        data = with_star_data(ctx, data, obj, cls.type)
    result = pipeline.assemble_without_spectrum(obj, data, cls)
    res.type = str(result.card["type"])
    res.missing = tuple(result.params.get("missing", ()))
    res.asset = _asset(result.card, result.params, ctx.settings)
    return res


def rebuild_from_card(asset: Asset, settings: Settings) -> Asset:
    """Stage 7 again from the committed card, for ``--check`` with no catalogue answers."""
    params = card_to_params(
        asset.card,
        seed=asset.seed,
        generator_version=GENERATOR_VERSION,
        extra_missing=tuple(asset.render_params.get("missing", ())),
    )
    return _asset(asset.card, params, settings)


# --- files ----------------------------------------------------------------------------------


def asset_path(asset: Asset) -> Path:
    """``<type>/<id>.json`` relative to ``ASSETS_DIR`` (the path ``AssetStore`` globs)."""
    return Path(str(asset.card["type"])) / (quote(str(asset.card["id"]), safe="") + ".json")


def asset_bytes(asset: Asset) -> bytes:
    text = json.dumps(asset.to_json(), indent=2, sort_keys=True, ensure_ascii=False)
    return (text + "\n").encode()


def texture_files(asset: Asset) -> FileMap:
    """The baked maps of an asset at ``PACK_SIZES``, relative to ``ASSETS_DIR``."""
    if asset.textures is None:
        return {}
    try:
        bake_params = params_from_card(asset.card, asset.seed)
    except BakeRefusal:
        return {}  # card_to_params adds textures only when the bake is allowed
    out: FileMap = {}
    for w, h in PACK_SIZES:
        folder = bake_dir(
            Path("textures"), str(asset.card["id"]), asset.generator_version, asset.seed, w, h
        )
        for name, data in encode(bake(bake_params, w, h)).items():
            out[folder / name] = data
    return out


def _q(text: str) -> str:
    """A TypeScript string literal the way Prettier writes it: single quotes, unless the text has
    a single quote and no double quote (so ``frontend`` ``format:check`` keeps the file as is)."""
    if "'" in text and '"' not in text:
        return '"' + text.replace("\\", "\\\\") + '"'
    return "'" + text.replace("\\", "\\\\").replace("'", "\\'") + "'"


TS_HEAD = """// A4.1 / Q-161 / Q-164: the demo search list, in the order the search bar shows it.
//
// GENERATED by `backend/scripts/bake_demo_pack.py` (issue #68, 7c). Do not edit by hand: change
// SEARCH_LIST there and run the script. `classLabel` is the type name from altText.ts::TYPE_NAME
// plus the card's spectral class ("brown dwarf \\u00b7 T1"), taken from the pre-built card; null
// when the pipeline gave no card for the row (the row then shows its name only). `id` is the
// resolved object id, null when the row did not resolve. A row never holds a physical value.
//
// `backend/targets.toml` lists the same objects with the aliases the backend resolver accepts;
// the aliases here only filter the list.

export interface DemoTarget {
  /** Display name, also the text sent to the resolver when the row is picked. */
  name: string;
  /** Extra search texts the list filter matches (the name is always matched). */
  aliases: readonly string[];
  /** What `/v1/resolve` is given for this row (backend/targets.toml `query`). */
  query: string;
  /** The resolved object id, or null when the pipeline could not resolve the row. */
  id: string | null;
  /** From the pre-built card, never hand-written. null: the row shows its name only. */
  classLabel: string | null;
}

"""

TS_TAIL = """
/** The five A1.1 targets (rows 1 to 5): the sky view marks these when they are cached. */
export const TEST_TARGETS: readonly string[] = DEMO_TARGETS.slice(0, 5).map((t) => t.name);

/** Lower case, without apostrophes or spaces: how the filter compares texts (7a). */
export function squash(text: string): string {
  return text.toLowerCase().replace(/[\u2019'\\s]/g, '');
}

/** Rows whose name or any alias contains the typed text. Empty text keeps every row. */
export function filterTargets(targets: readonly DemoTarget[], text: string): readonly DemoTarget[] {
  const k = squash(text);
  if (k === '') return targets;
  return targets.filter(
    (t) => squash(t.name).includes(k) || t.aliases.some((a) => squash(a).includes(k)),
  );
}
"""


def ts_bytes(results: list[RowResult]) -> bytes:
    rows = []
    for r in results:
        label = "null" if r.class_label is None else _q(r.class_label)
        rows.append(
            "  {\n"
            f"    name: {_q(r.row.name)},\n"
            f"    aliases: [{', '.join(_q(a) for a in r.row.aliases)}],\n"
            f"    query: {_q(r.row.query)},\n"
            f"    id: {'null' if r.object_id is None else _q(r.object_id)},\n"
            f"    classLabel: {label},\n"
            "  },\n"
        )
    body = "export const DEMO_TARGETS: readonly DemoTarget[] = [\n" + "".join(rows) + "];\n"
    return (TS_HEAD + body + TS_TAIL).encode()


def expected_files(results: list[RowResult]) -> FileMap:
    out: FileMap = {}
    for r in results:
        if r.asset is None:
            continue
        out[asset_path(r.asset)] = asset_bytes(r.asset)
        out.update(texture_files(r.asset))
    return out


# --- driver ---------------------------------------------------------------------------------


def missing_from_targets_toml(path: Path) -> list[str]:
    """Search rows whose query is not a ``targets.toml`` target (prefetch and aliases miss them)."""
    doc = tomllib.loads(path.read_text(encoding="utf-8"))
    queries = {t["query"] for t in doc.get("target", [])}
    return [r.query for r in SEARCH_LIST if r.query not in queries]


def build_all(ctx: Context, names: dict[str, str]) -> list[RowResult]:
    aliases = load_aliases(ctx.settings.targets_file)
    frames = FrameService(ctx)
    pipeline = ObjectPipeline(frames, AssetStore(ctx.cache, None, ctx.settings.data_release))
    try:
        results = []
        for row in SEARCH_LIST:
            try:
                res = build_row(ctx, pipeline, aliases, row)
            except (CacheMissOffline, UpstreamUnavailable) as exc:
                res = RowResult(row, error=f"{UNAVAILABLE}: {exc}")
            if res.asset is not None:
                res.class_label = class_label(res.asset.card, names)
            results.append(res)
        return results
    finally:
        pipeline.close()
        frames.close()


def _read(path: Path) -> bytes | None:
    try:
        return path.read_bytes()
    except OSError:
        return None


def _same(rel: Path, on_disk: bytes | None, fresh: bytes) -> bool:
    """Byte-exact, except a PNG map: same chunks and inflated image data suffices (Q-204)."""
    if on_disk is None:
        return False
    if rel.suffix == ".png":
        return same_png(on_disk, fresh)
    return on_disk == fresh


def managed_on_disk(assets_dir: Path, names: dict[str, str]) -> set[Path]:
    """Files this script owns: the texture tree and ``<type>/<id>.json`` of the object types."""
    out = {p.relative_to(assets_dir) for p in (assets_dir / "textures").rglob("*") if p.is_file()}
    for t in names:
        out |= {p.relative_to(assets_dir) for p in (assets_dir / t).glob("*.json")}
    return out


def committed_row(
    row: SearchRow, names: dict[str, str], assets_dir: Path, ts_path: Path
) -> RowResult | None:
    """The committed asset built for ``row``: its id is read from the committed TypeScript list."""
    text = _read(ts_path)
    if text is None:
        return None
    m = re.search(
        r"name: " + re.escape(_q(row.name)) + r",\n.*?\n    id: (null|'[^']*'),",
        text.decode(),
        re.S,
    )
    if m is None or m.group(1) == "null":
        return None
    object_id = m.group(1)[1:-1]
    for path in assets_dir.glob("*/" + quote(object_id, safe="") + ".json"):
        try:
            asset = Asset.from_json(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue
        if asset is not None and asset.card.get("id") == object_id:
            res = RowResult(row, object_id, str(asset.card["type"]), asset)
            res.class_label = class_label(asset.card, names)
            return res
    return None


def _literature_key(card: dict[str, Any]) -> str:
    """The registry key of a card (``literature_key`` in catalogue.py): the SPK-ID for a small
    body, the object id otherwise."""
    cid = str(card["id"])
    return cid.removeprefix("sbdb-") if cid.startswith("sbdb-") else cid


def stale_inputs(asset: Asset, settings: Settings) -> list[str]:
    """Cache-free reasons a committed asset is out of date (Q-167): empty when it is current."""
    why: list[str] = []
    name = asset_path(asset)
    if asset.asset_version != ASSET_VERSION:
        why.append(f"{name}: asset_version {asset.asset_version!r}, code is {ASSET_VERSION!r}")
    if asset.inputs_sha256 != inputs_sha256(settings):
        why.append(
            f"{name}: inputs_sha256 differs (literature, dwarf Teff table or shape registry)"
        )
    registry = lit.load_literature(settings.literature_file, _literature_key(asset.card))
    for field_name, row in registry.values.items():
        tv = asset.card.get(field_name)
        if not isinstance(tv, dict):
            continue  # the type does not use the field
        # The registry fills a null field, or a field it filled before; a catalogue value stays.
        source = str(tv.get("source", ""))
        filled = tv.get("value") is None or source.startswith("literature:")
        if filled and tv != row.to_tv():
            why.append(f"{name}: {field_name} differs from literature.toml")
    return why


def run_check(
    results: list[RowResult],
    names: dict[str, str],
    settings: Settings,
    assets_dir: Path,
    ts_path: Path,
    *,
    strict: bool,
) -> int:
    """Rows rebuilt from the catalogues where the cache has them; else, unless ``strict``, from
    the committed card (stage 7 and the maps only)."""
    bad: list[str] = []
    final: list[RowResult] = []
    for path in sorted(assets_dir.glob("*/*.json")):
        try:
            committed = Asset.from_json(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue
        if committed is not None and committed.card.get("type") in names:
            bad.extend(stale_inputs(committed, settings))
    for r in results:
        if r.asset is None and r.error.startswith(UNAVAILABLE) and not strict:
            old = committed_row(r.row, names, assets_dir, ts_path)
            if old is not None and old.asset is not None:
                old.asset = rebuild_from_card(old.asset, settings)
                old.from_card_only = True
                print(f"[{r.row.name}] catalogues not cached: checked from the committed card")
                final.append(old)
                continue
        if r.asset is None and (strict or r.error.startswith(UNAVAILABLE)):
            bad.append(f"{r.row.name}: {r.error}")
        final.append(r)
    files = expected_files(final)
    for rel, data in files.items():
        if not _same(rel, _read(assets_dir / rel), data):
            bad.append(f"differs: {rel}")
    for rel in sorted(managed_on_disk(assets_dir, names) - set(files)):
        bad.append(f"unexpected file: {rel}")
    if _read(ts_path) != ts_bytes(final):
        bad.append(f"differs: {ts_path}")
    for line in bad:
        print(line, file=sys.stderr)
    return 1 if bad else 0


def main(
    argv: list[str] | None = None,
    *,
    assets_dir: Path = ASSETS_DIR,
    ts_path: Path = DEMO_TARGETS_TS,
    settings: Settings | None = None,
) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--check", action="store_true", help="compare with the files on disk")
    ap.add_argument("--strict", action="store_true", help="--check: no card-only fallback")
    args = ap.parse_args(argv)

    s = settings or Settings()
    if args.check:
        # The check reads the cache only, so its result does not vary with what upstream says today.
        s = s.model_copy(update={"offline": True})
    gaps = missing_from_targets_toml(s.targets_file)
    if gaps:
        print(f"not in targets.toml: {gaps}", file=sys.stderr)
        return 1
    ctx = make_context(s)
    names = type_names()
    try:
        results = build_all(ctx, names)
    finally:
        ctx.http.close()

    if args.check:
        return run_check(results, names, s, assets_dir, ts_path, strict=args.strict)

    for r in results:
        status = r.error or f"{r.type}, label {r.class_label!r}, missing {list(r.missing)}"
        print(f"[{r.row.name}] {r.object_id or '-'}: {status}")
    files = expected_files(results)
    for rel, data in files.items():
        if _read(assets_dir / rel) != data:
            (assets_dir / rel).parent.mkdir(parents=True, exist_ok=True)
            (assets_dir / rel).write_bytes(data)
    for rel in sorted(managed_on_disk(assets_dir, names) - set(files)):
        (assets_dir / rel).unlink()
    ts = ts_bytes(results)
    if _read(ts_path) != ts:
        ts_path.write_bytes(ts)
    print(f"{len(files)} files, {sum(len(d) for d in files.values())} bytes under {assets_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

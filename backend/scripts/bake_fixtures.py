"""Bake the shared fixtures' textures with the real baker (issue #62, R6, R6.7, D-18).

    uv run python -m scripts.bake_fixtures           # rewrite shared/fixtures/textures/
    uv run python -m scripts.bake_fixtures --check   # exit 1 if a committed file differs

Every ``shared/fixtures/params/<kind>.json`` that lists ``textures`` is baked from its own card
(``shared/fixtures/cards/<kind>.json``) with its own ``seed``, through the same path the API uses
(``params_from_card`` -> ``bake`` -> ``encode``). Nothing here sets a generator parameter.

Layout: ``shared/fixtures/textures/{id}/{generator_version}/{seed}/{file}``, the R6.7 path with the
baker's own directory names (``texture_dir``: ``fixture:brown_dwarf`` -> ``fixture%3Abrown_dwarf``).
The fixture params' URLs carry no Q-47 ``{width}x{height}/`` size directory, so none is written
here (ASSUMPTION: one reduced size is enough for fixtures; see FIXTURE_TEXTURE_WIDTH). The fixtures
dev server (``frontend/fixtures/handler.ts``) maps ``/data/textures/...`` onto this tree.

Issue #68 Part 6 (Q-165) and Part 8a: the demo fixtures (``planet_trappist1f``,
``planet_kepler186f``, ``asteroid_shape_bennu``) have no textures; their ``params/<name>.json``
is written here from the card
with the same ``card_to_params`` the API uses, plus the one display value the fixtures add
(``lighting.sun_dir``). So the params are baked, not edited by hand, and ``--check`` fails if
they drift.

The output is byte-stable: lossless WebP and timestamp-free PNG (``encode``), no ``bake.json``
(its key would only repeat the parameters), so a rerun on one machine reproduces its own bytes.
Across machines Pillow's zlib-ng may write another deflate stream for the same pixels, so a PNG
map counts as unchanged when ``same_png`` holds (Q-204 (2)): ``--check`` passes and no file is
rewritten. WebP, ``height.bin`` and the params JSON stay byte-exact.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from app.core.render.bake import FILES, bake, encode, same_png, texture_dir
from app.core.render.card_to_params import card_to_params
from app.core.render.params import params_from_card
from app.settings import BACKEND_DIR

FIXTURES = BACKEND_DIR.parent / "shared" / "fixtures"
OUT_DIR = FIXTURES / "textures"
PARAMS_DIR = FIXTURES / "params"
# Issue #68 Part 6: demo exoplanet fixtures whose params are baked here: name -> seed. ASSUMPTION:
# seeds 21 and 22 are arbitrary (the fixtures' small seeds); the generator version is the fixtures'.
DEMO_PLANET_SEEDS = {"planet_trappist1f": 21, "planet_kepler186f": 22}
# Issue #68 Part 8a: the real Bennu model as an `asteroid_shape` fixture (real values only), so
# it has golden frames beside Eros. ASSUMPTION: seed 23 is arbitrary, like the planets' seeds.
DEMO_ASTEROID_SEEDS = {"asteroid_shape_bennu": 23}
DEMO_PARAMS_SEEDS = {**DEMO_PLANET_SEEDS, **DEMO_ASTEROID_SEEDS}
FIXTURE_GENERATOR_VERSION = "fixture-0"
# ASSUMPTION: the display direction of the star's light, as the other planet fixtures set it (the
# card has no phase angle for a planet); not a physical value.
FIXTURE_SUN_DIR = [1.0, 0.0, 0.0]
TEXTURE_URL_ROOT = "/data/textures/"
# ASSUMPTION: 512x256 keeps the repo small (issue #62); D-05's 2048x1024 is for the live backend.
FIXTURE_TEXTURE_WIDTH, FIXTURE_TEXTURE_HEIGHT = 512, 256


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def url_to_relpath(url: str) -> Path:
    """The file a fixture texture URL names, relative to ``OUT_DIR``.

    Each URL segment is decoded once (a server's job) and then given the baker's directory name,
    so ``fixture:x`` and ``fixture%3Ax`` both land in ``fixture%3Ax``. The handler does the same.
    """
    if not url.startswith(TEXTURE_URL_ROOT):
        raise ValueError(f"not a texture URL: {url}")
    parts = [unquote(p) for p in url.removeprefix(TEXTURE_URL_ROOT).split("/")]
    if len(parts) != 4 or not parts[2].isdigit():
        raise ValueError(f"not an R6.7 texture URL (id/version/seed/file): {url}")
    object_id, version, seed, name = parts
    return texture_dir(Path(), object_id, version, int(seed)) / name


def fixture_files() -> dict[Path, bytes]:
    """Every fixture texture file (relative to ``OUT_DIR``) and its bytes. Deterministic."""
    out: dict[Path, bytes] = {}
    for params_path in sorted((FIXTURES / "params").glob("*.json")):
        params = _load(params_path)
        textures: dict[str, Any] | None = params.get("textures")
        if not textures:
            continue
        card = _load(FIXTURES / "cards" / params_path.name)
        if card["id"] != params["id"]:
            raise ValueError(f"{params_path.name}: card and params ids differ")
        baked = encode(
            bake(
                params_from_card(card, int(params["seed"])),
                FIXTURE_TEXTURE_WIDTH,
                FIXTURE_TEXTURE_HEIGHT,
            )
        )
        base = texture_dir(Path(), params["id"], params["generator_version"], params["seed"])
        for name in FILES:
            out[base / name] = baked[name]
        for url in textures.values():
            if not isinstance(url, str):
                continue  # relief_amp is a number (R7.2), not a file
            if url_to_relpath(url) not in out:
                raise ValueError(f"{params_path.name}: {url} names no baked file")
    return out


def demo_planet_params() -> dict[str, str]:
    """``params/<name>.json`` text of each demo planet fixture, from its own card. Deterministic."""
    out: dict[str, str] = {}
    for name, seed in DEMO_PARAMS_SEEDS.items():
        card = _load(FIXTURES / "cards" / f"{name}.json")
        params = card_to_params(card, seed=seed, generator_version=FIXTURE_GENERATOR_VERSION)
        params["lighting"]["sun_dir"] = FIXTURE_SUN_DIR
        out[f"{name}.json"] = json.dumps(params, indent=2) + "\n"
    return out


def main(
    argv: list[str] | None = None, *, out_dir: Path = OUT_DIR, params_dir: Path = PARAMS_DIR
) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--check", action="store_true", help="compare with the files on disk")
    args = ap.parse_args(argv)
    files = fixture_files()
    stale = [rel for rel, data in files.items() if not _same(rel, _read(out_dir / rel), data)]
    params = {Path(n): t.encode("utf-8") for n, t in demo_planet_params().items()}
    stale_params = [n for n, data in params.items() if _read(params_dir / n) != data]
    if args.check:
        for rel in stale:
            print(f"differs: {rel}", file=sys.stderr)
        for n in stale_params:
            print(f"differs: params/{n}", file=sys.stderr)
        return 1 if stale or stale_params else 0
    for rel in stale:
        (out_dir / rel).parent.mkdir(parents=True, exist_ok=True)
        (out_dir / rel).write_bytes(files[rel])
    for n in stale_params:
        params_dir.mkdir(parents=True, exist_ok=True)
        (params_dir / n).write_bytes(params[n])
    print(
        f"{len(files)} files, {len(stale)} written, under {out_dir}; "
        f"{len(params)} demo params, {len(stale_params)} written"
    )
    return 0


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


if __name__ == "__main__":
    raise SystemExit(main())

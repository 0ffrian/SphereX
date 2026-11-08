"""Bake all-sky equirectangular JPEGs from a locally mirrored colour HiPS (no network).

    uv run python -m scripts.sky_bake                         # 2mass_color, default sizes
    uv run python -m scripts.sky_bake --width 4096 --order 3
    uv run python -m scripts.sky_bake --preview out.jpg       # also save a 1024x512 copy

Default sizes: 4096x2048 from the highest complete order (3 or more), and 8192x4096 when
order 4 or deeper is complete. Writes ``{SX_CACHE_DIR}/sky/{survey}/equirect_{W}x{H}.jpg``
atomically. Convention: ``app.core.sky.surveys.CONVENTION`` (RA 0 at the left, increasing
right; north up; ICRS).
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from PIL import Image

from app.core.sky import bake
from app.core.sky.surveys import (
    SURVEYS,
    check_properties,
    equirect_name,
    hips_dir,
    max_contiguous,
    read_manifest,
    read_properties,
    survey_dir,
    tile_relpath,
    write_atomic,
)
from app.settings import Settings

MIN_ORDER_4096 = 3
MIN_ORDER_8192 = 4
# A bake reads no order deeper than this: order 4 already holds finer pixels than 8192 px.
MAX_BAKE_ORDER = 4


def plan(complete_max: int, widths: list[int] | None, order: int | None) -> list[tuple[int, int]]:
    """(width, order) pairs to bake; an empty list when nothing is possible."""
    use = min(complete_max, MAX_BAKE_ORDER) if order is None else order
    if widths:
        return [(w, use) for w in widths]
    out = []
    if use >= MIN_ORDER_4096:
        out.append((4096, use))
    if use >= MIN_ORDER_8192:
        out.append((8192, use))
    return out


def main(argv: list[str] | None = None, *, settings: Settings | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--survey", default="2mass_color", choices=sorted(SURVEYS))
    p.add_argument("--width", type=int, action="append", help="output width (repeatable)")
    p.add_argument("--order", type=int, help="tile order to read (default: deepest complete)")
    p.add_argument("--preview", type=Path, help="also save a 1024x512 copy of the first bake")
    args = p.parse_args(argv)
    s = settings or Settings()
    survey = SURVEYS[args.survey]
    hdir = hips_dir(s.cache_dir, survey.id)

    props = read_properties(s.cache_dir, survey.id)
    if props is None:
        print(f"no {hdir / 'properties'}; run scripts.sky_mirror first", file=sys.stderr)
        return 1
    problems = check_properties(props, survey)
    if problems:
        print("properties do not match the registry: " + "; ".join(problems), file=sys.stderr)
        return 1
    manifest = read_manifest(s.cache_dir, survey.id) or {}
    orders = manifest.get("complete_orders")
    complete_max = max_contiguous(orders if isinstance(orders, list) else [])
    if complete_max is None:
        print("no complete order in mirror.json; run scripts.sky_mirror first", file=sys.stderr)
        return 1
    if args.order is not None and args.order > complete_max:
        print(f"order {args.order} is not complete locally (max {complete_max})", file=sys.stderr)
        return 1
    jobs = plan(complete_max, args.width, args.order)
    if not jobs:
        print(f"order {complete_max} is too shallow for the default sizes", file=sys.stderr)
        return 1

    preview_done = False
    for width, order in jobs:
        height = width // 2
        t0 = time.monotonic()
        sub = bake.choose_sub_width(order, survey.tile_width, width)

        def read_tile(n: int, o: int = order) -> bytes:
            return (hdir / tile_relpath(o, n)).read_bytes()

        tiles = bake.load_tiles(read_tile, order, survey.tile_width, sub)
        img = bake.bake_equirect(tiles, order, width, height)
        del tiles
        data = bake.encode_jpeg(img)
        out = survey_dir(s.cache_dir, survey.id) / equirect_name(width, height)
        write_atomic(out, data)
        print(
            f"{out}: {width}x{height} from order {order} (sub-width {sub}), "
            f"{len(data) / 1e6:.1f} MB in {time.monotonic() - t0:.1f} s",
            flush=True,
        )
        if args.preview and not preview_done:
            small = Image.fromarray(img).resize((1024, 512), Image.Resampling.LANCZOS)
            args.preview.parent.mkdir(parents=True, exist_ok=True)
            small.save(args.preview, format="JPEG", quality=90)
            print(f"preview {args.preview}", flush=True)
            preview_done = True
        del img
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Area search, Discovery precompute (A16.4 step 2, A17): run offline, never in a web request.

    uv run python -m scripts.area_discovery --area eros-2026-03 --steps frames,dots \\
        --day0 <outside the repo>/day0-eros.json --day0-object 20000433

Stages, in order, each with its own log line and time:

1. ``frames``: the cone grid (A17.1), then cutouts and coverage. A failed cone stops the run here
   (incomplete). Every call goes through the read-through cache (D-25): live unless
   ``SX_OFFLINE=1``, where a cache miss is a failed cone.
2. ``dots``: every cutout (A17.2), on ``SX_MEASURE_WORKERS`` spawn processes.

P3 writes **no** ``derived.area`` entry: P7 adds the stored, served entries (and P4 to P6 their
stages). ``--day0`` writes the Day 0 count (A16.6, Q-148, Q-401) as JSON.

Exit codes, so an overnight run that failed can be detected and the Area tool switched off
(Moon, 11 Nov 2026; Q-205, Q-400 (12)): 0 done; 1 not storable (a cone or a cutout download
failed, a cone hit MAXREC, no usable cutout, or no dots); 2 unknown area or bad arguments, or an
area of another data release. Leave ``AREA_TOOL_ENABLED`` off unless the exit is 0 (Q-205).
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path

from app.context import Context, make_context
from app.core.area import day0
from app.core.area.config import DEFAULT_AREA_CONFIG, AreaConfig, load_areas
from app.core.area.dots import run_dots
from app.core.area.frames import AreaReleaseMismatch, find_frames
from app.core.area.records import AreaFrames, FrameDots
from app.core.find import moving
from app.settings import Settings

log = logging.getLogger("shift_spectrum")

STEPS = ("frames", "dots")
EXIT_DONE, EXIT_INCOMPLETE, EXIT_USAGE = 0, 1, 2


def run_frames(
    ctx: Context, area_id: str, cfg: AreaConfig, refresh: bool
) -> tuple[AreaFrames, dict[str, bytes]]:
    """``find_frames`` (cones, then cutouts and coverage), with one log line per stage."""
    spec = load_areas(ctx)[area_id]
    t0 = time.perf_counter()
    frames, bodies = find_frames(ctx, spec, cfg, refresh=refresh)
    st = frames.stats
    print(
        f"[frames] {frames.n_cones} cones in {st.get('cone_seconds', 0.0):.1f} s: "
        f"{len(frames.frames)} frames"
    )
    if frames.frames:
        print(
            f"[cutouts] {len(bodies)} of {len(frames.frames)} usable, "
            f"{st.get('cutout_bytes', 0) / 1e6:.1f} MB in {st.get('cutout_seconds', 0.0):.1f} s "
            f"({st.get('cutout_fetch_failed', 0)} downloads failed)"
        )
    print(f"[frames] missing {list(frames.missing)} ({time.perf_counter() - t0:.1f} s)")
    return frames, bodies


def failures(
    frames: AreaFrames, bodies: dict[str, bytes], dots: list[FrameDots] | None
) -> list[str]:
    """Why a run must not be stored (exit 1, Q-400 (12)); empty when it may be."""
    out: list[str] = []
    if not frames.complete:
        out.append("incomplete: " + ", ".join(frames.missing))
    if any(m.startswith("frames:cone_maxrec:") for m in frames.missing):
        out.append("a cone hit MAXREC, so frames inside the windows may be missing")
    if not bodies:
        out.append("no usable cutout")
    if dots is not None and not any(fd.dots for fd in dots):
        out.append("no dots")
    return out


def object_positions(ctx: Context, spkid: str) -> dict[str, tuple[float, float]] | None:
    """Predicted positions per frame from Track's path search (Day 0 only)."""
    found = moving.search_path(ctx, spkid)
    if not found.positions:
        print(f"[day0] no positions for {spkid}: {found.missing}")
        return None
    return dict(found.positions)


def main(argv: list[str] | None = None, *, settings: Settings | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--area", required=True, help="id of an [[area]] in targets.toml")
    p.add_argument("--steps", default="frames,dots", help="comma list of: frames, dots")
    p.add_argument("--day0", type=Path, help="write the Day 0 count as JSON here")
    p.add_argument("--day0-object", help="SPK id of a known object to look for (Day 0)")
    p.add_argument("--refresh", action="store_true", help="fetch again, ignoring the cache")
    try:
        args = p.parse_args(argv)
    except SystemExit:
        return EXIT_USAGE
    steps = [s.strip() for s in args.steps.split(",") if s.strip()]
    if not steps or any(s not in STEPS for s in steps) or "frames" not in steps:
        print(f"--steps must list frames (then dots): {args.steps}", file=sys.stderr)
        return EXIT_USAGE
    ctx = make_context(settings or Settings())
    if args.area not in load_areas(ctx):
        print(f"unknown area {args.area!r}; known: {sorted(load_areas(ctx))}", file=sys.stderr)
        return EXIT_USAGE
    cfg = DEFAULT_AREA_CONFIG
    try:
        frames, bodies = run_frames(ctx, args.area, cfg, args.refresh)
    except AreaReleaseMismatch as exc:
        print(str(exc), file=sys.stderr)
        return EXIT_USAGE
    except ValueError as exc:
        print(f"INCOMPLETE: {exc}; nothing may be stored", file=sys.stderr)
        return EXIT_INCOMPLETE
    per_frame: list[FrameDots] | None = None
    if frames.complete and "dots" in steps:
        t0 = time.perf_counter()
        per_frame = run_dots(frames, bodies, cfg, workers=ctx.settings.measure_workers)
        n = sum(len(fd.dots) for fd in per_frame)
        print(f"[dots] {n} dots in {len(per_frame)} frames, {time.perf_counter() - t0:.1f} s")
    if args.day0 is not None:
        positions = object_positions(ctx, args.day0_object) if args.day0_object else None
        rep = day0.report(frames, per_frame, cfg, positions=positions, object_name=args.day0_object)
        args.day0.parent.mkdir(parents=True, exist_ok=True)
        args.day0.write_text(json.dumps(rep, indent=1, sort_keys=True), encoding="utf-8")
        print(f"[day0] written to {args.day0}")
    problems = failures(frames, bodies, per_frame)
    if problems:
        print("INCOMPLETE: " + "; ".join(problems) + "; nothing may be stored", file=sys.stderr)
        return EXIT_INCOMPLETE
    print("DONE")
    return EXIT_DONE


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    raise SystemExit(main())

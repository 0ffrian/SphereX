"""Area search, Discovery precompute (A16.4 step 2, A17): run offline, never in a web request.

    uv run python -m scripts.area_discovery --area eros-2026-03 --steps frames,dots \\
        --day0 <outside the repo>/day0-eros.json --day0-object 20000433
    uv run python -m scripts.area_discovery --area eros-2026-03 --steps all     # live, stores
    uv run python -m scripts.area_discovery --area eros-2026-03 --recorded --steps all \\
        --pack assets/areas                    # the committed Eros pack (issue #108)

Stages, in order, each with its own log line and time:

1. ``frames``: the cone grid (A17.1), then cutouts and coverage. A failed cone stops the run here
   (incomplete). Every call goes through the read-through cache (D-25): live unless
   ``SX_OFFLINE=1``, where a cache miss is a failed cone.
2. ``dots``: every cutout (A17.2), on ``SX_MEASURE_WORKERS`` spawn processes.
3. ``labels``: glitch, star, fixed (A17.3, P4), with the per-visit star cones (A19.6).
4. ``join``: tracklets paired across visits, parallax-aware (A17.4, P5).
5. ``known``: SkyBoT candidates, Horizons positions from SPHEREx, verdicts (A17.5, P6).
6. ``export``: the replies, the ECSV and the ``derived.area`` entries (A17.7 to A17.10, P7),
   written to the D-25 cache, or to ``--pack DIR`` (the committed pack the API also reads).

Each step needs the ones before it (``--steps all`` runs the six). Steps 3 to 5 run together.
Nothing is stored unless ``export`` runs and the run is storable. ``--day0`` writes the Day 0
count (A16.6, Q-148, Q-401) as JSON.

``--recorded`` (the Eros area only) builds the frames and dots from PR #53's recorded fixtures
and uses Track's recorded star cones (``scripts/area_recorded.py``, Q-400 (13)), on a scratch copy
of ``tests/fixtures/cache`` with ``SX_OFFLINE=1``: it is how the committed pack is made.
``--recorded --record`` works on the fixture cache itself, online, to record the SkyBoT, Horizons
and SPHEREx-vector answers the later steps need, then removes the ``derived.*`` files it wrote
(the committed ``derived.object`` fixtures stay).

Exit codes, so an overnight run that failed can be detected and the Area tool switched off
(Moon, 11 Nov 2026; Q-205, Q-400 (12)): 0 done; 1 not storable (a cone or a cutout download
failed, a cone hit MAXREC, no usable cutout, or no dots); 2 unknown area or bad arguments, or an
area of another data release. Leave ``AREA_TOOL_ENABLED`` off unless the exit is 0 (Q-205).
"""

from __future__ import annotations

import argparse
import json
import logging
import shutil
import sys
import tempfile
import time
from collections.abc import Mapping
from pathlib import Path

from app.cache.store import ReadThroughCache
from app.context import Context, make_context
from app.core.area import day0, service
from app.core.area.config import DEFAULT_AREA_CONFIG, AreaConfig, load_areas
from app.core.area.dots import run_dots
from app.core.area.frames import AreaReleaseMismatch, find_frames
from app.core.area.match import Candidate
from app.core.area.records import AreaFrames, FrameDots
from app.core.find import moving
from app.core.find.resolver import resolve
from app.core.find.stars import StarCone
from app.settings import Settings

log = logging.getLogger("shift_spectrum")

STEPS = ("frames", "dots", "labels", "join", "known", "export")
LATER = ("labels", "join", "known", "export")
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


def object_id_from_resolver(ctx: Context) -> service.ObjectIds:
    """``object_id`` from the cached resolver (A17.5 step 4); ``None`` when it cannot answer."""

    def ids(c: Candidate) -> str | None:
        try:
            return resolve(ctx, c.designation, {}).obj.id
        except Exception as exc:  # any resolver failure leaves the id empty, never a guess
            log.info("area: no object id for %s: %s", c.designation, exc)
            return None

    return ids


def run_later(
    ctx: Context,
    frames: AreaFrames,
    bodies: Mapping[str, bytes],
    per_frame: list[FrameDots],
    cfg: AreaConfig,
    *,
    star_cones: Mapping[int, StarCone] | None,
    inputs: str,
    sources: Mapping[str, str] | None,
    refresh: bool,
) -> service.AreaResult:
    """Steps 3 to 5 (labels, join, known), with one log line each."""
    t0 = time.perf_counter()
    result = service.run_area(
        ctx,
        frames,
        bodies,
        per_frame,
        cfg,
        star_cones=star_cones,
        object_ids=object_id_from_resolver(ctx),
        inputs=inputs,
        sources=sources,
        refresh=refresh,
    )
    lab = result.labels
    print(
        f"[labels] {len(lab.points)} dots: {lab.count('glitch')} glitch, "
        f"{lab.count('star')} star, {lab.count('fixed')} fixed, {lab.count('mover')} mover; "
        f"missing {lab.missing}"
    )
    status = [t.status for t in result.joined.tracks]
    print(
        f"[join] {status.count('track')} tracks, {status.count('possible')} possible, "
        f"{result.joined.n_static_one_visit} static one-visit ({result.joined.pair_test})"
    )
    named = [(v.verdict, v.match.designation if v.match else None) for v in result.verdicts]
    print(
        f"[known] skybot {result.known.skybot}; {len(result.known.candidates)} candidates, "
        f"{len(result.known_objects)} in coverage; verdicts {named}; "
        f"missing {result.known.missing} ({time.perf_counter() - t0:.1f} s)"
    )
    return result


def object_positions(ctx: Context, spkid: str) -> dict[str, tuple[float, float]] | None:
    """Predicted positions per frame from Track's path search (Day 0 only)."""
    found = moving.search_path(ctx, spkid)
    if not found.positions:
        print(f"[day0] no positions for {spkid}: {found.missing}")
        return None
    return dict(found.positions)


def derived_files(root: Path) -> set[Path]:
    return {f for f in (root / "v1").glob("derived.*/**/*") if f.is_file()}


def purge_derived(root: Path, keep: set[Path] | None = None) -> None:
    """Remove ``derived.*`` from a cache. With ``keep``, only the files not in it (the ones this
    run wrote), so the committed fixtures (``derived.object``, the resolver registry) stay."""
    if keep is None:
        for d in sorted((root / "v1").glob("derived.*")):
            shutil.rmtree(d)
        return
    for f in sorted(derived_files(root) - keep):
        f.unlink()


def main(argv: list[str] | None = None, *, settings: Settings | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--area", required=True, help="id of an [[area]] in targets.toml")
    p.add_argument(
        "--steps",
        default="frames,dots",
        help="comma list of: frames, dots, labels, join, known, export; or all",
    )
    p.add_argument("--day0", type=Path, help="write the Day 0 count as JSON here")
    p.add_argument("--day0-object", help="SPK id of a known object to look for (Day 0)")
    p.add_argument("--refresh", action="store_true", help="fetch again, ignoring the cache")
    p.add_argument("--recorded", action="store_true", help="the recorded Eros fixture area")
    p.add_argument("--record", action="store_true", help="with --recorded: record live answers")
    p.add_argument("--pack", type=Path, help="write the derived.area entries here (a pack)")
    try:
        args = p.parse_args(argv)
    except SystemExit:
        return EXIT_USAGE
    raw = args.steps.strip()
    steps = list(STEPS) if raw == "all" else [s.strip() for s in raw.split(",") if s.strip()]
    if not steps or steps != list(STEPS[: len(steps)]):
        print(f"--steps must be frames, dots, ... in order (or all): {raw}", file=sys.stderr)
        return EXIT_USAGE
    if args.record and not args.recorded:
        print("--record needs --recorded", file=sys.stderr)
        return EXIT_USAGE
    base = settings or Settings()
    scratch: Path | None = None
    recorded_before: set[Path] | None = None
    if args.recorded:
        from scripts import area_recorded

        if args.area != area_recorded.EROS_AREA.id:
            print(f"--recorded is the {area_recorded.EROS_AREA.id} area only", file=sys.stderr)
            return EXIT_USAGE
        if args.record:
            recorded_before = derived_files(area_recorded.FIXTURE_CACHE)
            base = base.model_copy(
                update={"cache_dir": area_recorded.FIXTURE_CACHE, "offline": False}
            )
        else:
            scratch = Path(tempfile.mkdtemp(prefix="sx-area-"))
            shutil.copytree(area_recorded.FIXTURE_CACHE, scratch / "cache")
            purge_derived(scratch / "cache")
            base = base.model_copy(update={"cache_dir": scratch / "cache", "offline": True})
    try:
        return _run(args, steps, base)
    finally:
        if recorded_before is not None:
            from scripts import area_recorded

            purge_derived(area_recorded.FIXTURE_CACHE, keep=recorded_before)
        if scratch is not None:
            shutil.rmtree(scratch, ignore_errors=True)


def _run(args: argparse.Namespace, steps: list[str], settings: Settings) -> int:
    ctx = make_context(settings)
    if args.area not in load_areas(ctx):
        print(f"unknown area {args.area!r}; known: {sorted(load_areas(ctx))}", file=sys.stderr)
        return EXIT_USAGE
    cfg = DEFAULT_AREA_CONFIG
    star_cones: Mapping[int, StarCone] | None = None
    sources: Mapping[str, str] | None = None
    inputs = "area_cones"
    per_frame: list[FrameDots] | None = None
    if args.recorded:
        from scripts import area_recorded

        frames, bodies = area_recorded.recorded_frames(cfg)
        print(f"[frames] recorded: {len(frames.frames)} frames, missing {list(frames.missing)}")
        star_cones = area_recorded.recorded_star_cones()
        inputs = area_recorded.INPUTS
        sources = area_recorded.SOURCES
        if "dots" in steps:
            per_frame = list(area_recorded.recorded_dots(cfg))
    else:
        try:
            frames, bodies = run_frames(ctx, args.area, cfg, args.refresh)
        except AreaReleaseMismatch as exc:
            print(str(exc), file=sys.stderr)
            return EXIT_USAGE
        except ValueError as exc:
            print(f"INCOMPLETE: {exc}; nothing may be stored", file=sys.stderr)
            return EXIT_INCOMPLETE
        if frames.complete and "dots" in steps:
            per_frame = run_dots(frames, bodies, cfg, workers=ctx.settings.measure_workers)
    if per_frame is not None:
        print(f"[dots] {sum(len(fd.dots) for fd in per_frame)} dots in {len(per_frame)} frames")
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
    if per_frame is not None and any(s in steps for s in LATER):
        result = run_later(
            ctx,
            frames,
            bodies,
            per_frame,
            cfg,
            star_cones=star_cones,
            inputs=inputs,
            sources=sources,
            refresh=args.refresh,
        )
        if "export" in steps:
            prepared = service.prepare(result)
            target = ReadThroughCache(args.pack, offline=True) if args.pack else ctx.cache
            service.store_area(target, result, prepared)
            print(f"[export] stored {args.area} p={prepared.params_hash[:12]} in {target.root}")
    print("DONE")
    return EXIT_DONE


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    raise SystemExit(main())

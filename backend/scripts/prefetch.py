"""Fill the read-through cache for the targets in targets.toml (D-25).

Run while the internet is good, then serve with ``SX_OFFLINE=1``:

    uv run python -m scripts.prefetch                  # all targets
    uv run python -m scripts.prefetch --only "R Draconis" --concurrency 4
    uv run python -m scripts.prefetch --refresh        # re-download; keeps old entries on failure

Resumable: entries already cached are skipped. Exit code 1 if any target is incomplete.

Catalogue overlays (issue #12): one Gaia DR3 and one CatWISE2020 cone per fixed target. A
failed cone is reported (``overlays: FAILED``) but does not make the target incomplete or change
the exit code: overlays are optional layers, and the frames and spectrum do not depend on them.
``--overlays-only`` resolves, searches SIA and fetches the cones, skipping cutout downloads.
"""

from __future__ import annotations

import argparse
import sys
import tomllib
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path

from app.adapters import exoplanet_archive, horizons, irsa_cutout, irsa_sia, simbad, skybot
from app.adapters.http import UpstreamError
from app.cache.store import CacheMissOffline, UpstreamUnavailable
from app.context import Context, make_context
from app.core.classify.rules import SIMBAD_PLANET
from app.core.find.frames import FrameService, frame_time, is_complete, position_at
from app.core.find.overlays import CATALOGS, fetch_catalog, overlay_cone
from app.core.find.resolver import ResolvedObject, load_aliases, resolve
from app.settings import Settings
from app.timefmt import parse_utc


@dataclass
class Report:
    name: str
    object_id: str = ""
    frames: int = 0
    rows: int = 0
    maxrec: int = 0
    cutout_failures: int = 0
    missing: list[str] = field(default_factory=list)
    error: str = ""
    overlays: dict[str, str] = field(default_factory=dict)  # catalog -> "N sources" or error
    frames_skipped: bool = False

    @property
    def complete(self) -> bool:
        if self.error:
            return False
        return is_complete(self.missing)


def load_targets(
    path: Path, only: list[str] | None, groups: list[str] | None
) -> list[dict[str, str]]:
    doc = tomllib.loads(path.read_text(encoding="utf-8"))
    out = []
    for t in doc.get("target", []):
        if only and t["name"] not in only and t["query"] not in only:
            continue
        if groups and t.get("group") not in groups:
            continue
        out.append(t)
    return out


def sia_with_fallback(
    ctx: Context, ra: float, dec: float, maxrec: int, min_maxrec: int, timeout: float, refresh: bool
) -> tuple[irsa_sia.SiaResult, int]:
    """Halve MAXREC after a failed search (IRSA times out on large answers, A3.1)."""
    n = maxrec
    while True:
        try:
            return irsa_sia.search(
                ctx, ra, dec, refresh=refresh, maxrec=n, read_timeout_s=timeout
            ), n
        except UpstreamUnavailable:
            if n // 2 < min_maxrec:
                raise
            n //= 2
            print(f"    SIA failed; retrying with MAXREC={n}", flush=True)


def prefetch_overlays(ctx: Context, obj: ResolvedObject, refresh: bool) -> dict[str, str]:
    """Fetch the Gaia and CatWISE cones (same keys as the overlays endpoint). Never raises."""
    out: dict[str, str] = {}
    try:
        cone = overlay_cone(ctx, obj)
    except (CacheMissOffline, UpstreamUnavailable) as exc:
        return {cat: f"FAILED (no SIA answer: {exc})" for cat in CATALOGS}
    for cat in CATALOGS:
        try:
            tbl, table, truncated, _ = fetch_catalog(ctx, cat, cone, refresh=refresh)
        except (CacheMissOffline, UpstreamUnavailable, UpstreamError, ValueError, KeyError) as exc:
            out[cat] = f"FAILED ({exc})"
        else:
            out[cat] = f"{len(tbl.ids)} sources from {table}" + (
                " (truncated)" if truncated else ""
            )
        print(f'  overlay {cat}: {out[cat]} (cone r={cone.radius_deg * 3600:.0f}")', flush=True)
    return out


def prefetch_target(
    ctx: Context, target: dict[str, str], aliases: dict[str, str], args: argparse.Namespace
) -> Report:
    rep = Report(target["name"])
    try:
        obj = resolve(ctx, target["query"], aliases, refresh=args.refresh).obj
    except (CacheMissOffline, UpstreamUnavailable, LookupError) as exc:
        rep.error = f"resolve failed: {exc}"
        return rep
    rep.object_id = obj.id
    print(f"  resolved {target['name']!r} -> {obj.id} ({obj.ra:.5f}, {obj.dec:+.5f})", flush=True)

    simbad_name = obj.query or obj.name
    if obj.resolver == "simbad" and simbad_name:
        # A3.8: a SIMBAD planet (otype Pl) also needs its Exoplanet Archive row for the card.
        try:
            hit, _ = simbad.query(ctx, simbad_name)
            if hit is not None and hit.otype in SIMBAD_PLANET:
                row, _ = exoplanet_archive.query(
                    ctx, (simbad_name, hit.main_id), refresh=args.refresh
                )
                print(f"  Exoplanet Archive: {'row ' + row['pl_name'] if row else 'no row'}")
        except (CacheMissOffline, UpstreamUnavailable) as exc:
            rep.error = f"Exoplanet Archive failed: {exc}"
            return rep
    if str(target.get("frames", True)).lower() == "false":
        return rep  # `frames = false` in targets.toml: catalogue answers only (small fixtures)

    if obj.moving:
        # Record the neighbours in the field at the resolve epoch (A4.1 step 2, SkyBoT).
        when = parse_utc(ctx.settings.ephemeris_epoch)
        radius = ctx.settings.cutout_size_arcsec / 3600.0 / 2.0
        try:
            bodies, _ = skybot.conesearch(ctx, obj.ra, obj.dec, radius, when, refresh=args.refresh)
            print(f"  SkyBoT: {len(bodies)} known bodies in the field", flush=True)
        except (CacheMissOffline, UpstreamUnavailable) as exc:
            rep.error = f"SkyBoT failed: {exc}"
            return rep
        # Phase angle and Sun vector for the card (Q-62); the same two cached Horizons calls.
        # Optional, like in the app: a failure is reported but the frames are still fetched.
        if obj.spkid:
            try:
                geom, _ = horizons.geometry(ctx, obj.spkid, when, refresh=args.refresh)
                print(f"  Horizons: phase {geom.phase_angle_deg:.2f} deg ({geom.observer})")
            except (CacheMissOffline, UpstreamUnavailable) as exc:
                print(f"  Horizons geometry failed (card lighting refused): {exc}", flush=True)
        rep.missing = FrameService(ctx).get_frames(obj, rebuild=True).missing
        return rep

    search_ra, search_dec = position_at(obj, parse_utc(ctx.settings.search_epoch))
    try:
        sia, n = sia_with_fallback(
            ctx,
            search_ra,
            search_dec,
            args.maxrec or ctx.settings.sia_maxrec,
            args.min_maxrec,
            args.read_timeout,
            args.refresh,
        )
    except (CacheMissOffline, UpstreamUnavailable) as exc:
        rep.error = f"SIA search failed: {exc}"
        return rep
    rep.rows, rep.maxrec = len(sia.rows), n
    print(
        f"  SIA: {len(sia.rows)} frames (MAXREC={sia.served.entry.meta.get('maxrec')}, "
        f"truncated={sia.truncated})",
        flush=True,
    )
    rep.overlays = prefetch_overlays(ctx, obj, args.refresh)
    if getattr(args, "overlays_only", False):
        rep.frames_skipped = True
        return rep

    def one(row: irsa_sia.SiaRow) -> bool:
        ra, dec = position_at(obj, frame_time(row))
        try:
            irsa_cutout.fetch_cutout(
                ctx, row, ra, dec, refresh=args.refresh, read_timeout_s=args.read_timeout
            )
            return True
        except (CacheMissOffline, UpstreamUnavailable) as exc:
            print(f"    cutout {row.frame_id} failed: {exc}", flush=True)
            return False

    done = 0
    with ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as pool:
        futures = [pool.submit(one, r) for r in sia.rows]
        for fut in as_completed(futures):
            done += 1
            if not fut.result():
                rep.cutout_failures += 1
            if done % 10 == 0 or done == len(futures):
                print(f"    cutouts {done}/{len(futures)}", flush=True)

    # Rebuild from the cache just filled (never the stored list), with no live-download cap.
    result = FrameService(ctx).get_frames(obj, rebuild=True, unlimited_live=True)
    rep.frames, rep.missing = len(result.frames), result.missing
    return rep


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--targets", type=Path, default=None, help="targets.toml (default: settings)")
    p.add_argument("--only", action="append", help="target name or query; repeatable")
    p.add_argument("--group", action="append", help="target group (test, demo, fixture)")
    p.add_argument("--refresh", action="store_true", help="re-download even when cached")
    p.add_argument("--concurrency", type=int, default=4)
    p.add_argument("--read-timeout", type=float, default=180.0)
    p.add_argument("--maxrec", type=int, default=0, help="SIA MAXREC (default: SX_SIA_MAXREC)")
    p.add_argument("--min-maxrec", type=int, default=25)
    p.add_argument(
        "--overlays-only",
        action="store_true",
        help="resolve, SIA search and catalogue cones only; no cutouts, no frame rebuild",
    )
    args = p.parse_args(argv)

    settings = Settings()
    if settings.offline:
        print("SX_OFFLINE=1: the pre-fetch needs the network.", file=sys.stderr)
        return 2
    ctx = make_context(settings)
    targets_file = args.targets or settings.targets_file
    targets = load_targets(targets_file, args.only, args.group)
    aliases = load_aliases(targets_file)
    print(
        f"cache: {settings.cache_dir}  release: {settings.data_release}  targets: {len(targets)}",
        flush=True,
    )

    reports = []
    for t in targets:
        print(f"[{t['name']}]", flush=True)
        reports.append(prefetch_target(ctx, t, aliases, args))
    ctx.http.close()

    print("\nsummary")
    for r in reports:
        status = "OK " if r.complete else "INCOMPLETE"
        print(
            f"  {status} {r.name:<16} id={r.object_id or '-'} frames={r.frames} rows={r.rows} "
            f"cutout_failures={r.cutout_failures} missing={len(r.missing)} "
            f"{('error=' + r.error) if r.error else ''}"
        )
        if r.frames_skipped:
            print("      frames: skipped (--overlays-only)")
        for cat, text in r.overlays.items():
            print(f"      overlays {cat}: {text}")
        for m in r.missing[:5]:
            print(f"      missing: {m}")
    return 0 if all(r.complete for r in reports) else 1


if __name__ == "__main__":
    raise SystemExit(main())

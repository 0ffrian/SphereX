"""Invariants that tie the six Area search replies of one area together (A17.8, Q-208).

The schemas check each reply alone; these functions check what the replies must agree on: step
counts against the dots and tracks, ids and their order, verdicts against ``missing``, the known
list, the checks. They take plain reply dicts, so the fixture tests (``test_area_fixtures.py``)
and later the pipeline (P3) and API (P7) tests can run the same rules on their own output.

Each function raises ``AssertionError`` with a message on the first broken rule.

``check_area(..., strict=True)`` adds two rules that hold for the synthetic fixtures but depend
on thresholds a real run may tune (P3/D1): a found-blind track has at least two thirds of its dots
within 3 px of the matched object (A17.5 step 3, ``r_known`` at its floor), and the mover dots
left outside every track, grouped per visit and detector, span less than ``min_motion_px``
(a dropped static one-visit tracklet, A17.4). Without ``strict`` only the contract-level rules run.
"""

from __future__ import annotations

import math
from collections import Counter
from typing import Any

from app.timefmt import parse_utc

PIXEL_DEG = 6.15 / 3600.0
WILSON_Z = 1.959964
PART_KEYS = ("test_mover", "completeness", "control", "linker")
UNCHECKED_PREFIXES = ("skybot:", "horizons:")

Reply = dict[str, Any]


def _fail(message: str) -> None:
    raise AssertionError(message)


def _check(condition: bool, message: str) -> None:
    if not condition:
        _fail(message)


def _n(dot_id: str) -> int:
    return int(dot_id.rsplit(":", 1)[1])


def _frame_of(dot_id: str) -> str:
    return dot_id.rsplit(":", 1)[0]


def sep_px(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    """Small-angle separation in SPHEREx pixels."""
    dra = ((ra1 - ra2 + 180.0) % 360.0 - 180.0) * math.cos(math.radians((dec1 + dec2) / 2))
    return math.hypot(dra, dec1 - dec2) / PIXEL_DEG


def inside(polygon: list[list[float]], ra: float, dec: float) -> bool:
    """Point in polygon on the (ra, dec) plane, RA unwrapped around the first vertex."""
    ref = polygon[0][0]

    def unwrap(a: float) -> float:
        return ref + (a - ref + 180.0) % 360.0 - 180.0

    pts = [(unwrap(a), b) for a, b in polygon]
    x, y = unwrap(ra), dec
    hit = False
    for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1], strict=True):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            hit = not hit
    return hit


def wilson95(k: int, n: int) -> tuple[float, float]:
    p = k / n
    z2 = WILSON_Z**2
    centre = (p + z2 / (2 * n)) / (1 + z2 / n)
    half = WILSON_Z * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / (1 + z2 / n)
    return max(0.0, centre - half), min(1.0, centre + half)


def all_dots(dots: Reply) -> list[dict[str, Any]]:
    return [d for v in dots["visits"] for d in v["dots"]]


# ----------------------------------------------------------------------------- per reply


def check_missing_lists(*replies: Reply) -> None:
    for reply in replies:
        missing = reply["missing"]
        _check(missing == sorted(set(missing)), f"missing not sorted and unique: {missing}")
        # Python's jsonschema lets a pattern's `$` match before a trailing newline (ajv and
        # pydantic do not), so a stray "\n" or space is refused here (Q-208).
        _check(all(m == m.strip() for m in missing), f"missing code with whitespace: {missing}")


def check_provenance_rules(*replies: Reply) -> None:
    """The card's tag rules, which the generated models drop (Q-40), and never artistic."""
    for reply in replies:
        for key, entry in reply["provenance"].items():
            tag = entry["tag"]
            _check(tag in {"measured", "derived", "model_dependent"}, f"{key}: tag {tag}")
            if tag == "derived":
                _check(bool(str(entry.get("formula", "")).strip()), f"{key}: derived, no formula")
            if tag == "model_dependent":
                _check(
                    bool(str(entry.get("assumption", "")).strip()),
                    f"{key}: model_dependent, no assumption",
                )


def check_summary(summary: Reply, index_entry: Reply | None = None) -> None:
    frames = summary["frames"]
    if index_entry is not None:
        for key, value in index_entry.items():
            _check(summary[key] == value, f"summary.{key} differs from the index entry")
    ids = [f["frame_id"] for f in frames]
    _check(len(ids) == len(set(ids)), "frame ids are not unique")
    order = [(f["time"], f["detector"], f["frame_id"]) for f in frames]
    _check(order == sorted(order), "frames are not sorted by (time, detector, frame_id)")
    _check(summary["n_frames"] == len(frames), "n_frames != len(frames)")
    visits = sorted({f["visit"] for f in frames})
    _check(summary["n_visits"] == len(visits), "n_visits != distinct visits")
    _check(visits == list(range(1, len(visits) + 1)), f"visits are not 1..n: {visits}")
    _check([c["visit"] for c in summary["coverage"]] == visits, "one coverage per visit, in order")
    for f in frames:
        _check(f["wavelength_min_um"] < f["wavelength_max_um"], f"{f['frame_id']}: band")
        exposures = {(g["exposure"], g["time"]) for g in frames if g["visit"] == f["visit"]}
        times_of = Counter(e for e, _ in exposures)
        _check(times_of[f["exposure"]] == 1, f"{f['frame_id']}: one exposure, one mid-time")


# ----------------------------------------------------------------------------- across replies


def check_dots(summary: Reply, dots: Reply) -> None:
    frames = {f["frame_id"]: f for f in summary["frames"]}
    frame_index = {fid: i for i, fid in enumerate(frames)}
    coverage = {c["visit"]: c["polygon"] for c in summary["coverage"]}
    _check(
        [v["visit"] for v in dots["visits"]] == [c["visit"] for c in summary["coverage"]],
        "dots: one block per visit, in order",
    )
    per_frame: dict[str, list[dict[str, Any]]] = {}
    previous: tuple[int, int] | None = None
    for block in dots["visits"]:
        for d in block["dots"]:
            f = frames.get(d["frame_id"])
            _check(f is not None, f"{d['dot_id']}: unknown frame")
            assert f is not None
            _check(f["visit"] == block["visit"], f"{d['dot_id']}: in the wrong visit block")
            for field_name in ("detector", "exposure", "time"):
                _check(
                    d[field_name] == f[field_name],
                    f"{d['dot_id']}: {field_name} differs from its frame",
                )
            _check(_frame_of(d["dot_id"]) == d["frame_id"], f"{d['dot_id']}: id has another frame")
            lo, hi = f["wavelength_min_um"], f["wavelength_max_um"]
            _check(lo <= d["wavelength_um"] <= hi, f"{d['dot_id']}: wavelength outside its frame")
            _check(
                inside(coverage[block["visit"]], d["ra"], d["dec"]),
                f"{d['dot_id']}: outside its visit's coverage",
            )
            order = (frame_index[d["frame_id"]], _n(d["dot_id"]))
            _check(previous is None or order > previous, f"{d['dot_id']}: dots out of order")
            previous = order
            per_frame.setdefault(d["frame_id"], []).append(d)
    for frame_id, group in per_frame.items():
        _check(
            [_n(d["dot_id"]) for d in group] == list(range(1, len(group) + 1)),
            f"{frame_id}: dot numbers are not 1..k",
        )
        peaks = [(math.floor(d["y"] + 0.5), math.floor(d["x"] + 0.5)) for d in group]
        _check(peaks == sorted(peaks), f"{frame_id}: dots not numbered by row, then column")
    # A fixed dot was seen at the same place in another visit (A17.3), so every visit covers it.
    # Stars come from the catalogue match and need no second visit (Q-208).
    for d in all_dots(dots):
        if d["label"] == "fixed":
            for v, polygon in coverage.items():
                _check(inside(polygon, d["ra"], d["dec"]), f"{d['dot_id']}: not in visit {v}")


def check_steps(summary: Reply, dots: Reply, tracks: Reply, *, strict: bool = False) -> None:
    steps = summary["steps"]
    labels = Counter(d["label"] for d in all_dots(dots))
    status = Counter(t["status"] for t in tracks["tracks"])
    verdict = Counter(t["verdict"] for t in tracks["tracks"])
    expected = {
        "n_dots": sum(labels.values()),
        "n_glitches": labels["glitch"],
        "n_stars": labels["star"],
        "n_fixed": labels["fixed"],
        "n_tracks": status["track"],
        "n_possible": status["possible"],
        "n_found_blind": verdict["found_blind"],
        "n_unexplained": verdict["unexplained"],
        "n_unchecked": verdict["unchecked"],
    }
    for key, value in expected.items():
        _check(steps[key] == value, f"steps.{key} = {steps[key]}, counted {value}")
    in_tracks = {i for t in tracks["tracks"] for tl in t["tracklets"] for i in tl["dot_ids"]}
    loose = [d for d in all_dots(dots) if d["label"] == "mover" and d["dot_id"] not in in_tracks]
    if steps["n_static_one_visit"] > 0:
        _check(bool(loose), "a static tracklet was dropped, but every mover dot is in a track")
    if not strict:
        return
    # A static one-visit tracklet moves less than min_motion_px (A17.4).
    limit = float(summary["method"]["settings"].get("min_motion_px", 1.0))
    groups: dict[tuple[int, int], list[dict[str, Any]]] = {}
    frames = {f["frame_id"]: f for f in summary["frames"]}
    for d in loose:
        groups.setdefault((frames[d["frame_id"]]["visit"], d["detector"]), []).append(d)
    for group in groups.values():
        _check(_span_px(group) < limit, "a dropped static tracklet moves min_motion_px or more")


def _span_px(group: list[dict[str, Any]]) -> float:
    return max(
        (sep_px(a["ra"], a["dec"], b["ra"], b["dec"]) for a in group for b in group), default=0.0
    )


def check_tracks(
    summary: Reply, dots: Reply, tracks: Reply, known: Reply, *, strict: bool = False
) -> None:
    frames = {f["frame_id"]: f for f in summary["frames"]}
    frame_index = {fid: i for i, fid in enumerate(frames)}
    by_id = {d["dot_id"]: d for d in all_dots(dots)}
    coverage = {c["visit"]: c["polygon"] for c in summary["coverage"]}
    settings = summary["method"]["settings"]
    n_visits = summary["n_visits"]
    missing = set(tracks["missing"])
    skybot = {a["visit"]: a["fetched_at"] for a in tracks["skybot"]}
    _check(sorted(skybot) == sorted(coverage), "tracks.skybot: one answer per visit")
    for v, fetched in skybot.items():
        _check((fetched is None) == (f"skybot:{v}" in missing), f"skybot visit {v} vs missing")
    designations = {k["designation"] for k in known["known"]}

    ids = [t["track_id"] for t in tracks["tracks"]]
    _check(ids == [f"T{i}" for i in range(1, len(ids) + 1)], f"track ids are not T1..Tn: {ids}")

    def first(t: dict[str, Any]) -> tuple[int, int]:
        return min(
            (frame_index[_frame_of(i)], _n(i)) for tl in t["tracklets"] for i in tl["dot_ids"]
        )

    firsts = [first(t) for t in tracks["tracks"]]
    _check(firsts == sorted(firsts), "tracks are not numbered by their first dot")

    seen: set[str] = set()
    for t in tracks["tracks"]:
        tid = t["track_id"]
        _check(
            t["visits"] == sorted({tl["visit"] for tl in t["tracklets"]}),
            f"{tid}: visits != its tracklets' visits",
        )
        track_dots = []
        for tl in t["tracklets"]:
            for dot_id in tl["dot_ids"]:
                d = by_id.get(dot_id)
                _check(d is not None, f"{tid}: {dot_id} is not in /dots")
                assert d is not None
                _check(d["label"] == "mover", f"{tid}: {dot_id} is not a mover")
                _check(dot_id not in seen, f"{tid}: {dot_id} is in two tracks")
                _check(frames[d["frame_id"]]["visit"] == tl["visit"], f"{tid}: {dot_id} visit")
                seen.add(dot_id)
                track_dots.append(d)
        _check_verdict(t, track_dots, coverage, missing, skybot, designations)
        _check_sed(t, track_dots, settings)
        _check_match(t, track_dots, known, strict=strict)
    if n_visits < 3:
        _check(
            all(t["linker"] == "pairs" for t in tracks["tracks"]),
            "rate_grid needs 3 or more visits (A17.12)",
        )


def _check_verdict(
    t: dict[str, Any],
    track_dots: list[dict[str, Any]],
    coverage: dict[int, list[list[float]]],
    missing: set[str],
    skybot: dict[int, str | None],
    designations: set[str],
) -> None:
    tid, status, verdict, reason = t["track_id"], t["status"], t["verdict"], t["reason"]
    if status == "track":
        _check(reason is None, f"{tid}: a track has no reason")
        _check(verdict in {"found_blind", "unexplained", "unchecked"}, f"{tid}: verdict")
        _check(len(t["visits"]) >= 2, f"{tid}: a track spans 2 or more visits")
        # A track's rate and PA come from one v_AB: both or neither. Neither when its chain fit
        # and every pair fit fail the chain's window (A17.4 Output, Q-208 (21)), then no u either.
        _check((t["rate_deg_day"] is None) == (t["pa_deg"] is None), f"{tid}: rate and PA")
        if t["rate_deg_day"] is None:
            _check(t["u_inv_au"] is None, f"{tid}: a track without a rate has no u")
    else:
        _check(reason is not None, f"{tid}: a possible names its reason")
        _check(verdict == "possible", f"{tid}: a possible's verdict is possible")
        _check(t["match"] is None, f"{tid}: a possible has no match")
    if reason in {"one_visit", "no_partner"}:
        # No partner, so no between-visit rate, direction or distance (Q-208).
        for key in ("rate_deg_day", "pa_deg", "u_inv_au"):
            _check(t[key] is None, f"{tid}: {reason} possible with {key}")
    if reason == "one_visit":
        _check(len(t["visits"]) == 1, f"{tid}: one_visit spans one visit")
        others = [v for v in coverage if v not in t["visits"]]
        for d in track_dots:
            for v in others:
                _check(
                    not inside(coverage[v], d["ra"], d["dec"]),
                    f"{tid}: one_visit, but visit {v} covers {d['dot_id']}",
                )
        _check(_span_px(track_dots) >= 1.0, f"{tid}: a possible moves at least 1 px")
    _check((verdict == "found_blind") == (t["match"] is not None), f"{tid}: match vs verdict")
    if t["match"] is not None:
        _check(t["match"]["designation"] in designations, f"{tid}: match not in /known")
    _check((verdict == "unchecked") == bool(t["unchecked_by"]), f"{tid}: unchecked_by vs verdict")
    for code in t["unchecked_by"]:
        _check(code in missing, f"{tid}: {code} is not in missing")
        _check(code.startswith(UNCHECKED_PREFIXES), f"{tid}: {code} cannot make it unchecked")
    if verdict == "unexplained":
        for v in t["visits"]:
            _check(skybot.get(v) is not None, f"{tid}: unexplained needs SkyBoT for visit {v}")
            _check(f"skybot:{v}" not in missing, f"{tid}: unexplained with skybot:{v} missing")
    if t["linker"] == "rate_grid":
        _check(len(t["visits"]) >= 3, f"{tid}: rate_grid with fewer than 3 visits")


def _check_sed(t: dict[str, Any], track_dots: list[dict[str, Any]], settings: Reply) -> None:
    sed = t.get("sed")
    if sed is None:
        return
    tid = t["track_id"]
    label, chi2 = sed["label"], sed["chi2_red"]
    if label == "too_few":
        _check(chi2 is None, f"{tid}: too_few with a chi2_red")
    if label in {"smooth", "rough"}:
        _check(chi2 is not None, f"{tid}: {label} without chi2_red")
    if "sed_sigma_floor" in settings:
        _check(sed["sigma_floor"] == settings["sed_sigma_floor"], f"{tid}: sed sigma_floor")
    used = [d for d in track_dots if d["snr"] >= float(settings.get("sed_snr_min", 3.0))]
    _check(sed["n_dots"] == len(used), f"{tid}: sed n_dots != dots with snr >= sed_snr_min")
    detectors = {d["detector"] for d in used}
    few = len(used) < int(settings.get("sed_min_dots", 6)) or len(detectors) < 2
    _check((label == "too_few") == few, f"{tid}: too_few iff < sed_min_dots or one detector")
    if label in {"smooth", "rough"} and "sed_chi2_max" in settings:
        smooth = chi2 <= float(settings["sed_chi2_max"])
        _check((label == "smooth") == smooth, f"{tid}: smooth iff chi2_red <= sed_chi2_max")


def _check_match(
    t: dict[str, Any], track_dots: list[dict[str, Any]], known: Reply, *, strict: bool
) -> None:
    """The match names a listed object; with ``strict``, A17.5 step 3 at r_known = 3 px."""
    match = t["match"]
    if match is None:
        return
    obj = next(k for k in known["known"] if k["designation"] == match["designation"])
    at = {p["frame_id"]: p for p in obj["positions"]}
    r_known = 3.0
    near = 0
    seps = []
    for d in track_dots:
        p = at.get(d["frame_id"])
        if p is None:
            continue
        s = sep_px(d["ra"], d["dec"], p["ra"], p["dec"])
        seps.append(s)
        near += s <= r_known
    if strict:
        _check(3 * near >= 2 * len(track_dots), f"{t['track_id']}: under 2/3 near the match")
    seps.sort()
    median = (seps[(len(seps) - 1) // 2] + seps[len(seps) // 2]) / 2
    _check(abs(median - match["median_sep_px"]) <= 0.01, f"{t['track_id']}: median_sep_px")


def check_known(summary: Reply, known: Reply) -> None:
    frames = {f["frame_id"]: f for f in summary["frames"]}
    coverage = {c["visit"]: c["polygon"] for c in summary["coverage"]}
    _check(sorted(a["visit"] for a in known["skybot"]) == sorted(coverage), "known.skybot visits")
    for v, fetched in ((a["visit"], a["fetched_at"]) for a in known["skybot"]):
        _check((fetched is None) == (f"skybot:{v}" in known["missing"]), f"skybot {v} vs missing")
    names = [k["designation"] for k in known["known"]]
    _check(len(names) == len(set(names)), "known designations are not unique")
    for k in known["known"]:
        name = k["designation"]
        visits = set()
        for p in k["positions"]:
            f = frames.get(p["frame_id"])
            _check(f is not None, f"{name}: position at an unknown frame")
            assert f is not None
            _check(p["time"] == f["time"], f"{name}: position time != frame time")
            _check(inside(coverage[f["visit"]], p["ra"], p["dec"]), f"{name}: outside coverage")
            visits.add(f["visit"])
        _check(k["n_frames"] == len(k["positions"]), f"{name}: n_frames != positions")
        _check(k["n_visits"] == len(visits), f"{name}: n_visits")
        _check(not k["track_available"] or k["object_id"] is not None, f"{name}: Track needs id")


def check_checks(summary: Reply, dots: Reply, checks: Reply) -> None:
    """Per ticket (A18.11, Q-208 (12)): D4 is test_mover + completeness, D5 is control.

    ``checks:not_run`` means nothing ran (no part, no linker, no ``method.checks``, empty
    provenance); ``checks:d4_not_run`` / ``checks:d5_not_run`` drop one ticket's parts and their
    provenance keys, and never come with ``checks:not_run``.
    """
    missing = set(checks["missing"])
    not_run = "checks:not_run" in missing
    ran = {
        "d4": not not_run and "checks:d4_not_run" not in missing,
        "d5": not not_run and "checks:d5_not_run" not in missing,
    }
    owned = {"d4": ("test_mover", "completeness"), "d5": ("control",)}
    has_method = "checks" in checks["method"]
    if not_run:
        _check(
            not {"checks:d4_not_run", "checks:d5_not_run"} & missing,
            "checks:not_run with a per-ticket code",
        )
        present = [k for k in PART_KEYS if k in checks]
        _check(not present and not has_method, f"checks:not_run, but parts present: {present}")
        _check(checks["provenance"] == {}, "checks:not_run, but provenance has keys")
    else:
        _check("linker" in checks, "checks ran without stating the linker")
        _check(has_method == (ran["d4"] or ran["d5"]), "method.checks iff D4 or D5 ran")
        for ticket, keys in owned.items():
            for part in keys:
                _check((part in checks) == ran[ticket], f"{part} present iff {ticket} ran")
                _check(
                    (part in checks["provenance"]) == ran[ticket],
                    f"provenance.{part} present iff {ticket} ran",
                )
    _check(
        checks["method"]["settings"] == summary["method"]["settings"],
        "checks settings differ from the summary's",
    )
    if not_run:
        return
    if summary["n_visits"] < 3:
        _check("rate_grid:visits" in missing, "checks ran on < 3 visits, no rate_grid:visits")
    if ran["d4"]:
        _check_d4(summary, dots, checks)
    if ran["d5"]:
        method = checks["method"]["checks"]
        control = checks["control"]
        runs = control["tracks_per_run"]
        _check(len(runs) == control["n_runs"] == method["n_control_runs"], "control run count")
        _check(abs(control["mean"] - sum(runs) / len(runs)) <= 1e-9, "control mean")
        _check(control["max"] == max(runs), "control max")


def _check_d4(summary: Reply, dots: Reply, checks: Reply) -> None:
    method = checks["method"]["checks"]
    grid = checks["completeness"]
    _check(grid["snr_bins"] == method["snr_bins"], "completeness snr_bins != method.checks")
    _check(grid["rate_bins"] == method["rate_bins"], "completeness rate_bins != method.checks")
    cells = {(c["snr_bin"], c["rate_bin"]) for c in grid["cells"]}
    full = {(s, r) for s in range(len(grid["snr_bins"])) for r in range(len(grid["rate_bins"]))}
    _check(cells == full and len(grid["cells"]) == len(full), "completeness grid is not complete")
    for c in grid["cells"]:
        _check(c["k"] <= c["n"], "k > n")
        _check(abs(c["frac"] - c["k"] / c["n"]) <= 1e-4, "frac != k/n")
        lo, hi = wilson95(c["k"], c["n"])
        _check(abs(c["wilson95"][0] - lo) <= 1e-4 and abs(c["wilson95"][1] - hi) <= 1e-4, "wilson")
        _check(c["n"] == method["n_per_cell"], "cell n != n_per_cell")
    frames = {f["frame_id"]: f for f in summary["frames"]}
    real = all_dots(dots)
    for p in checks["test_mover"]["dots"]:
        f = frames.get(p["frame_id"])
        _check(f is not None, "planted dot at an unknown frame")
        assert f is not None
        for field_name in ("detector", "exposure", "time"):
            _check(
                p[field_name] == f[field_name], f"planted dot: {field_name} differs from its frame"
            )
        for d in real:
            if d["frame_id"] == p["frame_id"]:
                _check(
                    math.hypot(d["x"] - p["x"], d["y"] - p["y"]) >= 0.5,
                    f"planted dot on top of the real dot {d['dot_id']} (A17.6: never in /dots)",
                )


def check_area(
    summary: Reply,
    known: Reply,
    dots: Reply,
    tracks: Reply,
    checks: Reply,
    index_entry: Reply | None = None,
    *,
    strict: bool = False,
) -> None:
    """Every rule above, for one area's five replies (and its index entry, if given).

    ``strict`` adds the fixture-only threshold rules described in the module docstring.
    """
    replies = (summary, known, dots, tracks, checks)
    check_missing_lists(*replies)
    check_provenance_rules(*replies)
    for reply in (known, dots, tracks):
        _check(reply["computed_at"] == summary["computed_at"], "replies of one run differ")
    # The gated checks may run later, as their own offline run (Q-208).
    _check(
        parse_utc(checks["computed_at"]) >= parse_utc(summary["computed_at"]),
        "checks computed before the area they check",
    )
    union = sorted({m for r in (known, dots, tracks, checks) for m in r["missing"]})
    _check(summary["missing"] == union, "summary.missing != union of the other replies'")
    _check(
        ("sed" in tracks["provenance"]) == any("sed" in t for t in tracks["tracks"]),
        "tracks.provenance.sed present iff a track has sed",
    )
    if summary["n_visits"] < 3 and "checks:not_run" not in checks["missing"]:
        _check("rate_grid:visits" in tracks["missing"], "fewer than 3 visits: rate_grid:visits")
    check_summary(summary, index_entry)
    check_dots(summary, dots)
    check_steps(summary, dots, tracks, strict=strict)
    check_known(summary, known)
    check_tracks(summary, dots, tracks, known, strict=strict)
    check_checks(summary, dots, checks)

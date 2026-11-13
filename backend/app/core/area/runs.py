"""Run records (Q-471, issue #156): every scan, and every single live area job, is recorded with
a timeline so the app can list past runs and replay them.

Light on purpose (A16.2): plain JSON files and arithmetic, no pipeline module, no numpy.

- **Where:** one JSON file per run, ``<SX_CACHE_DIR>/runs/<run_id>.json``, written atomically
  (a temp file, then ``os.replace``) on every change, so a crash keeps everything up to it.
- **Id:** ``run-`` + UTC ``yyyymmddThhmmss`` + ``-`` + 6 random hex.
- **Timeline:** ``events`` in order; ``t`` is seconds since ``started_at`` (ms precision).
- **Restart:** a run left ``queued``, ``running`` or ``paused`` (its job lived in memory) is
  marked ``stopped`` on load; its running square goes back to ``todo``. Finished squares stay
  stored and usable.
- **Objects:** read from each finished square's stored replies (``known``, ``tracks``, ``dots``,
  ``summary``), never computed here. ``found`` events and ``/results`` share ``square_objects``
  and ``merge``.
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
import secrets
import threading
import time
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Any

from app.core.area.live import Box
from app.core.area.scan import grid_shape
from app.timefmt import iso_utc_z, parse_utc, utc_now

log = logging.getLogger(__name__)

RUN_ID = re.compile(r"^run-[0-9]{8}T[0-9]{6}-[0-9a-f]{6}$")
LIVE_STATES = ("queued", "running", "paused")
FINISHED_STATES = ("done", "stopped", "failed")
DUP_ARCSEC = 30.0
MERGE_FORMULA = (
    "known objects merged by designation; found and unexplained tracks merged when they share "
    "a SkyBoT designation, or when tracks of neighbouring squares have a dot on the same frame "
    "within 30 arcsec"
)
TRACK_POSITIONS_SOURCE = "dot positions of the stored areas (A17.3)"
KNOWN_POSITIONS_ASSUMPTION = (
    "orbit solutions from SkyBoT (candidates) and JPL Horizons (positions), seen from SPHEREx, "
    "as stored with each area"
)


def new_run_id() -> str:
    return "run-" + utc_now().strftime("%Y%m%dT%H%M%S") + "-" + secrets.token_hex(3)


def _now() -> str:
    return iso_utc_z(utc_now())


def _seconds(a: str, b: str) -> float:
    return (parse_utc(b) - parse_utc(a)).total_seconds()


def empty_totals() -> dict[str, int]:
    return {"known": 0, "found": 0, "unexplained": 0, "squares_done": 0, "squares_skipped": 0}


def write_atomic(path: Path, body: bytes) -> None:
    """Write ``body`` to a temp file next to ``path``, then ``os.replace`` it into place."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        with tmp.open("wb") as f:
            f.write(body)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


class RunNotFound(KeyError):
    """No run with this id; the API answers 404 ``run_not_found``."""


class RunStore:
    """The run records in memory and on disk. Thread-safe: the worker writes, the API reads."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self._lock = threading.RLock()
        self._runs: dict[str, dict[str, Any]] = {}
        self._t0: dict[str, float] = {}  # monotonic start of each run started in this process
        self._load()

    # --- disk ---------------------------------------------------------------------------

    def _path(self, run_id: str) -> Path:
        return self.root / f"{run_id}.json"

    def _write(self, run: Mapping[str, Any]) -> None:
        body = json.dumps(run, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
        write_atomic(self._path(str(run["run_id"])), body)

    def _load(self) -> None:
        if not self.root.is_dir():
            return
        for path in sorted(self.root.glob("run-*.json")):
            try:
                run = json.loads(path.read_text(encoding="utf-8"))
                ok = isinstance(run, dict) and run.get("run_id") == path.stem
            except (OSError, ValueError):
                ok = False
            if not ok or not RUN_ID.match(path.stem):
                log.warning("runs: skipping unreadable run record %s", path)
                continue
            if run.get("state") in LIVE_STATES:
                self._stop_on_load(run)
                self._write(run)
            self._runs[path.stem] = run

    @staticmethod
    def _stop_on_load(run: dict[str, Any]) -> None:
        """The server stopped while this run was live: it is ``stopped`` (Q-471)."""
        for sq in run.get("squares", []):
            if sq.get("state") == "running":
                sq["state"] = "todo"
        events = run.setdefault("events", [])
        last = float(events[-1]["t"]) if events else 0.0
        started = run.get("started_at")
        if started is not None:
            events.append({"t": last, "type": "run_stopped"})
            run["finished_at"] = iso_utc_z(parse_utc(started) + timedelta(seconds=last))
        else:
            run["finished_at"] = run.get("created_at")
        run["state"] = "stopped"

    # --- writes -------------------------------------------------------------------------

    def create(
        self,
        kind: str,
        release: str,
        region: Box,
        squares: Sequence[tuple[int, Box, str | None]],
    ) -> str:
        """A new ``queued`` run; returns its id."""
        with self._lock:
            run_id = new_run_id()
            while run_id in self._runs:
                run_id = new_run_id()
            run: dict[str, Any] = {
                "run_id": run_id,
                "kind": kind,
                "release": release,
                "region": region.reply(),
                "squares": [
                    {"index": i, "box": b.reply(), "area_id": a, "state": "todo"}
                    for i, b, a in squares
                ],
                "state": "queued",
                "created_at": _now(),
                "started_at": None,
                "finished_at": None,
                "totals": empty_totals(),
                "events": [],
            }
            self._runs[run_id] = run
            self._write(run)
            return run_id

    def _mutate(self, run_id: str, fn: Callable[[dict[str, Any]], None]) -> None:
        with self._lock:
            run = self._runs.get(run_id)
            if run is None:
                raise RunNotFound(run_id)
            fn(run)
            self._write(run)

    def _event(self, run: dict[str, Any], type_: str, **fields: Any) -> None:
        t0 = self._t0.get(str(run["run_id"]))
        t = round(time.monotonic() - t0, 3) if t0 is not None else 0.0
        events = run["events"]
        if events:
            t = max(t, float(events[-1]["t"]))  # ordered by t, whatever the clock does
        events.append({"t": t, "type": type_, **{k: v for k, v in fields.items() if v is not None}})

    def start(self, run_id: str) -> None:
        def fn(run: dict[str, Any]) -> None:
            if run["started_at"] is None:
                self._t0[run_id] = time.monotonic()
                run["started_at"] = _now()
                run["state"] = "running"
                self._event(run, "run_started")
            else:
                run["state"] = "running"

        self._mutate(run_id, fn)

    def event(self, run_id: str, type_: str, **fields: Any) -> None:
        self._mutate(run_id, lambda run: self._event(run, type_, **fields))

    def set_state(self, run_id: str, state: str, event: str | None = None) -> None:
        def fn(run: dict[str, Any]) -> None:
            run["state"] = state
            if state in FINISHED_STATES:
                run["finished_at"] = _now()
                for sq in run["squares"]:
                    if sq["state"] == "running":
                        sq["state"] = "todo"
            if event is not None:
                self._event(run, event)

        self._mutate(run_id, fn)

    def square(
        self,
        run_id: str,
        index: int,
        state: str,
        *,
        area_id: str | None = None,
        error: Mapping[str, str] | None = None,
        event: str | None = None,
        objects: Iterable[Mapping[str, Any]] = (),
        totals: Mapping[str, int] | None = None,
    ) -> None:
        """Set one square's state (and area id or error), append its event and its ``found``
        events, and replace the totals, in one write."""

        def fn(run: dict[str, Any]) -> None:
            sq = run["squares"][index - 1]
            sq["state"] = state
            if area_id is not None:
                sq["area_id"] = area_id
            if error is not None:
                sq["error"] = dict(error)
            if event is not None:
                self._event(run, event, square=index, area_id=area_id or sq.get("area_id"))
            for obj in objects:
                self._event(run, "found", square=index, area_id=sq.get("area_id"), object=obj)
            if totals is not None:
                run["totals"] = dict(totals)

        self._mutate(run_id, fn)

    # --- reads --------------------------------------------------------------------------

    def get(self, run_id: str) -> dict[str, Any]:
        with self._lock:
            run = self._runs.get(run_id)
            if run is None:
                raise RunNotFound(run_id)
            copy: dict[str, Any] = json.loads(json.dumps(run))
            return copy

    def ids(self) -> list[str]:
        with self._lock:
            return list(self._runs)

    def summaries(self) -> list[dict[str, Any]]:
        """Newest first (``created_at``, then id)."""
        with self._lock:
            runs = sorted(
                self._runs.values(), key=lambda r: (r["created_at"], r["run_id"]), reverse=True
            )
            return [summary(r) for r in runs]


def duration_s(run: Mapping[str, Any]) -> float | None:
    started = run.get("started_at")
    if started is None:
        return None
    end = run.get("finished_at") or _now()
    return round(max(0.0, _seconds(str(started), str(end))), 3)


def summary(run: Mapping[str, Any]) -> dict[str, Any]:
    squares = run["squares"]
    return {
        "run_id": run["run_id"],
        "kind": run["kind"],
        "region": dict(run["region"]),
        "state": run["state"],
        "created_at": run["created_at"],
        "duration_s": duration_s(run),
        "totals": dict(run["totals"]),
        "squares_done": sum(1 for s in squares if s["state"] == "done"),
        "squares_total": len(squares),
    }


# --- objects of the stored areas ---------------------------------------------------------


@dataclass(frozen=True)
class SquareReplies:
    """The stored replies of one finished square (any may be ``None`` if absent)."""

    index: int
    area_id: str
    summary: Mapping[str, Any] | None
    known: Mapping[str, Any] | None
    tracks: Mapping[str, Any] | None
    dots: Mapping[str, Any] | None


ReadStage = Callable[[str, str], Mapping[str, Any] | None]


def read_square(index: int, area_id: str, read: ReadStage) -> SquareReplies:
    return SquareReplies(
        index,
        area_id,
        read(area_id, "summary"),
        read(area_id, "known"),
        read(area_id, "tracks"),
        read(area_id, "dots"),
    )


def _pos(p: Mapping[str, Any]) -> dict[str, Any]:
    return {"ra": p["ra"], "dec": p["dec"], "time": p["time"]}


def _dot_map(sq: SquareReplies) -> dict[str, Mapping[str, Any]]:
    if sq.dots is None:
        return {}
    return {d["dot_id"]: d for v in sq.dots.get("visits", []) for d in v.get("dots", [])}


def _track_dots(track: Mapping[str, Any], dots: Mapping[str, Mapping[str, Any]]) -> list[Any]:
    ids = [i for tl in track.get("tracklets", []) for i in tl.get("dot_ids", [])]
    got = [dots[i] for i in ids if i in dots]
    return sorted(got, key=lambda d: (d["time"], d["frame_id"]))


def _known_rows(sq: SquareReplies) -> list[Mapping[str, Any]]:
    return list(sq.known.get("known", [])) if sq.known is not None else []


def _tracks(sq: SquareReplies) -> list[Mapping[str, Any]]:
    return list(sq.tracks.get("tracks", [])) if sq.tracks is not None else []


def _visit_starts(sq: SquareReplies) -> list[str]:
    if sq.summary is None:
        return []
    first: dict[int, str] = {}
    for f in sq.summary.get("frames", []):
        v, t = int(f["visit"]), str(f["time"])
        if v not in first or t < first[v]:
            first[v] = t
    return sorted(first.values())


def square_objects(sq: SquareReplies) -> list[dict[str, Any]]:
    """The ``found`` event objects of one finished square (Q-471): a track with a SkyBoT match
    is ``known`` (Horizons positions), an ``unexplained`` track carries its measured dots, and
    a known-list row no track matched is ``predicted`` (the UI hides those by default)."""
    dots = _dot_map(sq)
    known = {str(k["designation"]): k for k in _known_rows(sq)}
    out: list[dict[str, Any]] = []
    matched: set[str] = set()
    for t in _tracks(sq):
        match = t.get("match")
        if match is not None:
            des = str(match["designation"])
            matched.add(des)
            row = known.get(des)
            src = row["positions"] if row is not None else _track_dots(t, dots)
            out.append(
                {
                    "kind": "known",
                    "designation": des,
                    "track_id": t["track_id"],
                    "square": sq.index,
                    "positions": [_pos(p) for p in src],
                }
            )
        elif t.get("verdict") == "unexplained":
            out.append(
                {
                    "kind": "unexplained",
                    "track_id": t["track_id"],
                    "square": sq.index,
                    "positions": [_pos(d) for d in _track_dots(t, dots)],
                }
            )
    for des, row in known.items():
        if des not in matched:
            out.append(
                {
                    "kind": "predicted",
                    "designation": des,
                    "square": sq.index,
                    "positions": [_pos(p) for p in row["positions"]],
                }
            )
    return out


def sep_arcsec(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    """Great-circle separation (haversine), in arcseconds."""
    r1, d1, r2, d2 = (math.radians(v) for v in (ra1, dec1, ra2, dec2))
    a = math.sin((d2 - d1) / 2) ** 2 + math.cos(d1) * math.cos(d2) * math.sin((r2 - r1) / 2) ** 2
    return math.degrees(2 * math.asin(min(1.0, math.sqrt(a)))) * 3600.0


def _merge_positions(groups: Iterable[Iterable[Mapping[str, Any]]]) -> list[dict[str, Any]]:
    """Positions of several squares, one per time (the first square's on a tie), by time."""
    seen: dict[str, dict[str, Any]] = {}
    for ps in groups:
        for p in ps:
            seen.setdefault(str(p["time"]), _pos(p))
    return [seen[t] for t in sorted(seen)]


class _Union:
    def __init__(self, n: int) -> None:
        self.parent = list(range(n))

    def find(self, i: int) -> int:
        while self.parent[i] != i:
            self.parent[i] = self.parent[self.parent[i]]
            i = self.parent[i]
        return i

    def join(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)


def neighbours(a: int, b: int, cols: int) -> bool:
    """Two different squares (1-based indexes) side by side or corner to corner."""
    ra, ca = divmod(a - 1, cols)
    rb, cb = divmod(b - 1, cols)
    return a != b and abs(ra - rb) <= 1 and abs(ca - cb) <= 1


@dataclass(frozen=True)
class _Cand:
    square: int
    area_id: str
    track_id: str
    designation: str | None
    dots: tuple[Mapping[str, Any], ...]
    visits: tuple[str, ...]


def _same_mover(a: _Cand, b: _Cand) -> bool:
    by_frame: dict[str, list[Mapping[str, Any]]] = {}
    for d in a.dots:
        by_frame.setdefault(str(d["frame_id"]), []).append(d)
    for d in b.dots:
        for e in by_frame.get(str(d["frame_id"]), []):
            if sep_arcsec(d["ra"], d["dec"], e["ra"], e["dec"]) <= DUP_ARCSEC:
                return True
    return False


def merge(region: Mapping[str, Any], squares: Sequence[SquareReplies]) -> dict[str, Any]:
    """Known objects and tracks of the finished squares with the duplicates merged (Q-471)."""
    cols, _ = grid_shape(float(region["width_deg"]), float(region["height_deg"]))
    ordered = sorted(squares, key=lambda s: s.index)

    cands: list[_Cand] = []
    for sq in ordered:
        dots, visits = _dot_map(sq), tuple(_visit_starts(sq))
        for t in _tracks(sq):
            match = t.get("match")
            if match is None and t.get("verdict") != "unexplained":
                continue
            des = str(match["designation"]) if match is not None else None
            cands.append(
                _Cand(
                    sq.index,
                    sq.area_id,
                    str(t["track_id"]),
                    des,
                    tuple(_track_dots(t, dots)),
                    visits,
                )
            )
    u = _Union(len(cands))
    for i, a in enumerate(cands):
        for j in range(i + 1, len(cands)):
            b = cands[j]
            same_name = a.designation is not None and a.designation == b.designation
            if same_name or (neighbours(a.square, b.square, cols) and _same_mover(a, b)):
                u.join(i, j)
    groups: dict[int, list[_Cand]] = {}
    for i, c in enumerate(cands):
        groups.setdefault(u.find(i), []).append(c)
    tracks = []
    detected: set[str] = set()
    for root in sorted(groups):
        members = groups[root]
        names = sorted({m.designation for m in members if m.designation is not None})
        detected.update(names)
        tracks.append(
            {
                "kind": "found" if names else "unexplained",
                "designation": names[0] if names else None,
                "squares": sorted({m.square for m in members}),
                "tracks": [
                    {"square": m.square, "area_id": m.area_id, "track_id": m.track_id}
                    for m in members
                ],
                "visits": sorted({v for m in members for v in m.visits}),
                "positions": _merge_positions(m.dots for m in members),
            }
        )

    known_by: dict[str, list[tuple[SquareReplies, Mapping[str, Any]]]] = {}
    for sq in ordered:
        for row in _known_rows(sq):
            known_by.setdefault(str(row["designation"]), []).append((sq, row))
    known = []
    for des in sorted(known_by):
        rows = known_by[des]
        first = rows[0][1]
        known.append(
            {
                "designation": des,
                "number": first["number"],
                "object_id": first["object_id"],
                "kind": first["kind"],
                "v_mag": first["v_mag"],
                "detected": des in detected,
                "track_available": any(bool(r["track_available"]) for _, r in rows),
                "squares": sorted({sq.index for sq, _ in rows}),
                "visits": sorted({v for sq, _ in rows for v in _visit_starts(sq)}),
                "positions": _merge_positions(r["positions"] for _, r in rows),
            }
        )
    return {"known": known, "tracks": tracks}


def totals_of(merged: Mapping[str, Any], squares: Sequence[Mapping[str, Any]]) -> dict[str, int]:
    """``known`` = merged known objects, ``found`` and ``unexplained`` = merged tracks."""
    return {
        "known": len(merged["known"]),
        "found": sum(1 for t in merged["tracks"] if t["kind"] == "found"),
        "unexplained": sum(1 for t in merged["tracks"] if t["kind"] == "unexplained"),
        "squares_done": sum(1 for s in squares if s["state"] == "done"),
        "squares_skipped": sum(1 for s in squares if s["state"] == "skipped"),
    }


def results_reply(run: Mapping[str, Any], merged: Mapping[str, Any]) -> dict[str, Any]:
    """The ``run-results.schema.json`` body."""
    return {
        "run_id": run["run_id"],
        "kind": run["kind"],
        "release": run["release"],
        "region": dict(run["region"]),
        "state": run["state"],
        "squares": [
            {"index": s["index"], "area_id": s["area_id"], "state": s["state"]}
            for s in run["squares"]
        ],
        "known": list(merged["known"]),
        "tracks": list(merged["tracks"]),
        "provenance": {
            "merge": {"tag": "derived", "formula": MERGE_FORMULA},
            "known_positions": {
                "tag": "model_dependent",
                "source": "JPL Horizons, as stored with each area",
                "assumption": KNOWN_POSITIONS_ASSUMPTION,
            },
            "track_positions": {"tag": "measured", "source": TRACK_POSITIONS_SOURCE},
        },
    }


__all__ = [
    "DUP_ARCSEC",
    "RUN_ID",
    "RunNotFound",
    "RunStore",
    "SquareReplies",
    "duration_s",
    "merge",
    "new_run_id",
    "read_square",
    "results_reply",
    "sep_arcsec",
    "square_objects",
    "summary",
    "totals_of",
    "write_atomic",
]

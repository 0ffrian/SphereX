"""Live area jobs (Q-462, issue #141): one worker thread runs one area at a time, in order.

The API submits a ``live.Plan`` and reads job states; it never computes (A16.2). The worker
runs the area pipeline (frames, dots, labels, join, known) and stores the result as
``derived.area`` entries in the D-25 cache, where ``/v1/areas/{area_id}/...`` serve it like a
prepared area. The pipeline modules are imported inside the worker only, so importing this
module (and ``app.main``) loads none of them.

States: ``queued`` → ``running`` → ``done`` or ``failed`` (``error.code`` says why; a stopped
job fails with ``cancelled``). A queued job stops at once; a running one at its next check (each
step and each cutout), so it reads ``running`` for a moment after ``DELETE``, and a job past its
last check before storing finishes ``done``. Jobs live in memory: after a restart a stored
area still answers ``done`` through the store, and a lost job is simply asked for again.
At most ``MAX_WAITING`` jobs wait (more: ``QueueFull``) and ``MAX_FINISHED`` finished jobs
are remembered. A job that fails in any way, even with a ``BaseException``, is marked failed
and the worker goes on with the queue.

**Scans (issue #156, Q-470):** a ``ScanJob`` takes one queue slot and runs its squares in order
on the same worker: skipped without a visit pair, done at once when stored, else run; a failed
square is marked and the scan goes on. A pause takes effect after the current square and the
paused scan leaves the worker; resume queues it again at the back; stop is at the next
check. **Runs (Q-471):** every scan, and every single job submitted with a ``kind``, is
recorded in ``runs.RunStore`` with its timeline. A scan ends ``failed`` when it was not
stopped, no square is done and at least one failed (Q-481).

**Honest failures (Q-482):** a cutout that fails gets a second pass (``CUTOUT_SECOND_PASS_S``)
within a failure budget; a stored area is reused only when it is ``reusable`` (its known-object
check did not fail, or it was rechecked within ``RECHECK_COOLDOWN_S``, or the server is
offline), else it is computed again; a reused area missing its ``spectra`` stage gets it here,
in the worker (``ensure_spectra``), never in a request (A16.2).
"""

from __future__ import annotations

import contextlib
import json
import logging
import re
import threading
import time
from collections import deque
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

from app.adapters.http import NetworkDisabled, UpstreamError
from app.cache.store import CacheMissOffline, UpstreamUnavailable
from app.context import Context
from app.core.area.live import Box, LiveAreaError, Plan, estimate_seconds, plan_area
from app.core.area.runs import (
    RunNotFound,
    RunStore,
    Snapshot,
    SquareReplies,
    check_codes,
    merge,
    read_square,
    square_boxes,
    square_counts,
    square_objects,
    totals_of,
)
from app.core.area.scan import ScanPlan, Square
from app.core.area.store import AreaStore

log = logging.getLogger(__name__)

STEPS: tuple[tuple[str, str], ...] = (
    ("visits", "Find a pair of visits"),
    ("frames", "Download frames"),
    ("dots", "Find dots"),
    ("labels", "Drop glitches and stars"),
    ("join", "Join what moves across visits"),
    ("known", "Check known objects (SkyBoT)"),
)
STEP_IDS = tuple(s for s, _ in STEPS)
INPUTS = "live_area"
# A public server must not be flooded: at most this many jobs wait behind the running one
# (each takes minutes of SIA, cutout, SkyBoT and Horizons load), and at most this many
# finished jobs are remembered (the oldest are forgotten; a stored area still answers done).
MAX_WAITING = 5
MAX_FINISHED = 50
# Merged results kept per run (``results``), keyed by the squares done, so polling
# ``/v1/runs/{id}/results`` does not re-read and re-merge every stored square each time.
MAX_RESULTS = 16
# The second pass of a failed cutout (Q-482): the waits before each new attempt, after the
# HTTP policy's own retries (1, 2 and 4 s) gave up. The archive's 503s last longer than those
# 7 s but pass within a minute (issue #169: a failed cutout answered 200 15.7 s later). An
# engineering choice, not a physical value; tests set it to zeros.
CUTOUT_SECOND_PASS_S: tuple[float, ...] = (5.0, 15.0, 30.0)
# The failure budget of one square (Q-482): failed cutouts are retried only while at most this
# many have failed (the larger of the two); past it the archive is taken to be down and every
# waiting retry gives up at once, so the square fails as fast as before.
CUTOUT_RETRY_BUDGET_MIN = 2
CUTOUT_RETRY_BUDGET_FRAC = 0.25
# A stored area whose known-object check failed is computed again at most once per this many
# seconds per process (Q-482), so a lasting Horizons or SkyBoT failure cannot make every start
# a full recompute. Same as ``live_failure_ttl_s``.
RECHECK_COOLDOWN_S = 600.0
_WAIT_SLICE_S = 0.25  # how often a second-pass wait looks at the give-up flag
SPECTRA_INPUTS = ("summary", "dots", "tracks")  # the stored stages the spectrum check reads
# The http adapter's own texts for a failure that may pass (``UpstreamError(f"{url}: {last}")``):
# a 429 or 5xx status, a refused or dropped connection, a timeout. Anything else (a 4xx, the
# cutout adapter's own refusals: a foreign host, a redirect off IRSA, a body that is not FITS)
# cannot change on a second pass (code review of #169).
_TRANSIENT = re.compile(
    r": (HTTP (429|5[0-9]{2})|connection failed: .*|timeout: .*|transport error: .*)$", re.S
)


class QueueFull(Exception):
    """``MAX_WAITING`` jobs already wait; the API answers 429 ``queue_full``."""


class Cancelled(Exception):
    """The job was stopped (``DELETE``); raised at the next step or cutout."""


@dataclass
class _StepState:
    state: str = "todo"
    done: int | None = None
    total: int | None = None


@dataclass(eq=False)
class Job:
    plan: Plan
    state: str = "queued"
    step: str | None = None
    steps: dict[str, _StepState] = field(default_factory=dict)
    started: float | None = None
    finished: float | None = None
    error: tuple[str, str] | None = None
    cancel: threading.Event = field(default_factory=threading.Event)
    run_id: str | None = None  # the run recording this job (Q-471), if any
    scan_id: str | None = None  # the scan whose square this job computes (Q-470), if any

    def __post_init__(self) -> None:
        self.steps = {s: _StepState() for s in STEP_IDS}
        self.steps["visits"].state = "done"  # the plan already holds the visit pair

    @property
    def area_id(self) -> str:
        return self.plan.area_id

    def estimate_s(self) -> int:
        return self.plan.estimate_s()

    def remaining_s(self, now: float) -> int:
        """Rough time left (the estimate less the time it has run)."""
        if self.started is None:
            return self.estimate_s()
        return max(0, self.estimate_s() - int(now - self.started))

    @property
    def active(self) -> bool:
        """Queued or running and not stopped."""
        return self.state in ("queued", "running") and not self.cancel.is_set()

    @property
    def joinable(self) -> bool:
        """Active and not a scan's square: the job a new request for the same area joins. A
        square's job is never joined, because stopping its scan cancels it and it has no run
        record of its own (PR #160 review)."""
        return self.active and self.scan_id is None


class Progress:
    """What the pipeline calls to report a step or a count; raises ``Cancelled`` once stopped."""

    def __init__(self, job: Job, lock: threading.Lock) -> None:
        self._job = job
        self._lock = lock

    def check(self) -> None:
        if self._job.cancel.is_set():
            raise Cancelled()

    def step(self, name: str) -> None:
        self.check()
        with self._lock:
            j = self._job
            for s in STEP_IDS:
                if s == name:
                    break
                j.steps[s].state = "done"
            j.steps[name].state = "running"
            j.step = name

    def wait(self, seconds: float) -> None:
        """Sleep up to ``seconds``; a stop ends the wait at once with ``Cancelled``."""
        if self._job.cancel.wait(max(0.0, seconds)):
            raise Cancelled()

    def count(self, done: int, total: int | None = None) -> None:
        self.check()
        with self._lock:
            j = self._job
            if j.step is None:
                return
            st = j.steps[j.step]
            st.done = done
            st.total = max(total, done) if total is not None else st.total


Runner = Callable[[Context, Plan, Progress], None]


def run_live_area(ctx: Context, plan: Plan, progress: Progress) -> None:
    """The area pipeline for one live area, then ``store_area`` into ``ctx.cache``. Raises
    ``LiveAreaError`` for a result that must not be stored (as ``area_discovery.failures``)."""
    from app.core.area import dots as area_dots
    from app.core.area import frames as area_frames
    from app.core.area import service, spectrum
    from app.core.area.config import DEFAULT_AREA_CONFIG as cfg
    from app.core.area.match import Candidate
    from app.core.find.resolver import resolve

    spec = plan.spec()
    progress.step("frames")
    live = area_frames.live_fetch(ctx)
    lock = threading.Lock()
    fetched = [0]
    failed = [0]  # cutouts that failed at least once (the failure budget, Q-482)
    budget = max(CUTOUT_RETRY_BUDGET_MIN, int(CUTOUT_RETRY_BUDGET_FRAC * plan.n_frames))
    give_up = threading.Event()

    def fetch(row: Any, cut: Any) -> tuple[str, bytes]:
        # The second pass (Q-482): a failure worth retrying waits CUTOUT_SECOND_PASS_S and asks
        # again, while the square's failures stay within the budget. The count moves only on
        # a success, so the step count never goes backwards.
        waits = iter(CUTOUT_SECOND_PASS_S)
        first = True
        while True:
            progress.check()
            try:
                got = live(row, cut)
                break
            except (CacheMissOffline, UpstreamUnavailable, UpstreamError, OSError) as exc:
                if not cutout_retryable(exc) or give_up.is_set():
                    raise
                if first:
                    first = False
                    with lock:
                        failed[0] += 1
                        over = failed[0] > budget
                    if over:
                        give_up.set()
                        raise
                wait = next(waits, None)
                if wait is None:
                    raise
                _second_pass_wait(progress, wait, give_up)
                if give_up.is_set():
                    raise
        with lock:
            fetched[0] += 1
            n = fetched[0]
        progress.count(n, plan.n_frames)
        return got

    frames, bodies = area_frames.find_frames(ctx, spec, cfg, fetch=fetch)
    if not frames.complete:
        raise LiveAreaError("area:frames_incomplete", "Some frames could not be found or read.")
    if any(m.startswith("frames:cone_maxrec:") for m in frames.missing):
        raise LiveAreaError("area:frames_incomplete", "A frame search hit its row limit.")
    if not bodies:
        raise LiveAreaError("area:no_cutouts", "No usable cutout was downloaded.")
    progress.step("dots")
    per_frame = area_dots.run_dots(frames, bodies, cfg, workers=ctx.settings.measure_workers)
    if not any(fd.dots for fd in per_frame):
        raise LiveAreaError("area:no_dots", "No dots were found in the frames.")

    def ids(c: Candidate) -> str | None:
        try:
            return resolve(ctx, c.designation, {}).obj.id
        except Exception as exc:  # any resolver failure leaves the id empty, never a guess
            log.info("live area: no object id for %s: %s", c.designation, exc)
            return None

    result = service.run_area(
        ctx, frames, bodies, per_frame, cfg, object_ids=ids, inputs=INPUTS, on_step=progress.step
    )
    progress.check()
    service.with_track(ctx, result)
    prepared = service.prepare(result)
    service.store_area(ctx.cache, result, prepared)
    # The spectrum check (Q-474): milliseconds on the stored replies, so no job step of its own.
    # The area is already stored and served; a failure here only leaves /spectra answering
    # spectra_not_prepared (scripts/area_spectra.py fills it), so it does not fail the job.
    try:
        spectrum.store_prepared(ctx.cache, spec.data_release, prepared.params_hash, prepared.bodies)
    except Exception:
        log.exception("live area %s: the spectrum check failed; /spectra is not prepared", spec.id)


def cutout_retryable(exc: BaseException) -> bool:
    """A failed cutout worth a second pass (Q-482): only an archive error the http adapter
    reports as passing (HTTP 429 or 5xx, a failed connection, a timeout, a transport error).
    Not an offline miss or a refused network, not a client error (HTTP 4xx other than 429),
    and not the cutout adapter's own refusals (a foreign host, a redirect off IRSA, a body
    that is not FITS), which cannot change. The cache wraps the adapter's error, so its
    ``__cause__`` is looked at too."""
    for e in (exc, exc.__cause__):
        if isinstance(e, (CacheMissOffline, NetworkDisabled)):
            return False
    return any(
        isinstance(e, UpstreamError) and _TRANSIENT.search(str(e)) is not None
        for e in (exc, exc.__cause__)
    )


def _second_pass_wait(progress: Progress, seconds: float, give_up: threading.Event) -> None:
    """Wait ``seconds`` before a second-pass attempt; a stop raises ``Cancelled`` at once and a
    spent failure budget (``give_up``) ends the wait early."""
    deadline = time.monotonic() + seconds
    while not give_up.is_set():
        left = deadline - time.monotonic()
        if left <= 0:
            return
        progress.wait(min(left, _WAIT_SLICE_S))


def _error_of(exc: BaseException) -> tuple[str, str]:
    if isinstance(exc, Cancelled):
        return "cancelled", "The job was stopped. Nothing was saved."
    if isinstance(exc, LiveAreaError):
        return exc.code, exc.detail
    if isinstance(exc, CacheMissOffline):
        return "offline", "The server is offline (SX_OFFLINE=1). Nothing was saved."
    if isinstance(exc, (UpstreamUnavailable, UpstreamError)):
        return "upstream_unavailable", "An archive did not answer. Nothing was saved."
    return "internal", "Something went wrong on the server. Nothing was saved."


class RunConflict(Exception):
    """A pause, resume or stop that does not apply to the run's state: 409 with ``code``."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail


@dataclass(eq=False)
class ScanJob:
    """A scan (Q-470): one queue slot, its squares run one after another on the worker."""

    run_id: str
    release: str
    squares: tuple[Square, ...]
    stored: dict[int, str] = field(default_factory=dict)  # area ids the plan found stored
    state: str = "queued"  # queued, running, paused, done, stopped, failed
    started: float | None = None
    pause_requested: bool = False
    current: Job | None = None  # the running square's job (its steps and counts)
    current_square: int | None = None
    square_started: float | None = None  # monotonic start of the current square
    done: set[int] = field(default_factory=set)  # squares finished (done, skipped or failed)
    cache: dict[int, SquareReplies] = field(default_factory=dict)  # replies of done squares
    cancel: threading.Event = field(default_factory=threading.Event)

    def _todo(self) -> list[Square]:
        return [s for s in self.squares if s.index not in self.done]

    def estimate_s(self) -> int:
        return sum(estimate_seconds(s.box) for s in self._todo())

    def remaining_s(self, now: float) -> int:
        """Rough time left: the squares not started, plus what is left of the current one."""
        left = 0
        for s in self._todo():
            est = estimate_seconds(s.box)
            if s.index == self.current_square and self.square_started is not None:
                est = max(0, est - int(now - self.square_started))
            left += est
        return left


QueueItem = Job | ScanJob
Planner = Callable[[Context, Box], Plan]


class _Stage(Protocol):
    def entry(self, area_id: str, stage: str) -> Any: ...

    def spectra_entry(self, area_id: str) -> Any: ...

    def heads(self, area_id: str) -> Sequence[tuple[Any, str, Mapping[str, Any]]]: ...


def _default_planner(ctx: Context, box: Box) -> Plan:
    return plan_area(ctx, box)


class LiveJobs:
    """The queue and its one worker thread. Thread-safe; the worker starts on demand.

    A queue item is a single live area (``Job``) or a scan (``ScanJob``); each takes one slot
    and the worker runs one at a time (Q-470). Every scan, and every single job submitted with
    a ``kind``, is recorded in ``runs`` (Q-471). No run-record file is written while
    ``self._lock`` is held: writes made under it are deferred and flushed after it."""

    def __init__(
        self,
        ctx: Context,
        runner: Runner | None = None,
        *,
        planner: Planner | None = None,
        store: _Stage | None = None,
        runs: RunStore | None = None,
    ) -> None:
        self.ctx = ctx
        self._runner = runner or run_live_area
        self._planner = planner or _default_planner
        self.store: _Stage = store or AreaStore(ctx, ctx.settings.area_pack_dir)
        self.runs = runs or RunStore(ctx.settings.cache_dir / "runs")
        self._lock = threading.Lock()
        self._jobs: dict[str, Job] = {}
        self._by_run: dict[str, QueueItem] = {}  # live runs only; finished ones are on disk
        self._queue: deque[QueueItem] = deque()
        self._thread: threading.Thread | None = None
        self._running: QueueItem | None = None
        self._closed = False  # set by ``close()``: nothing new is queued during shutdown
        self._results_lock = threading.Lock()
        self._results: dict[str, tuple[tuple[tuple[int, str], ...], dict[str, Any]]] = {}
        self._results_gen = 0  # moves on every store, so a merge read before it is not kept
        self._rechecked: dict[str, float] = {}  # area id -> monotonic time of its last compute
        self._no_refill: set[str] = set()  # areas whose spectra refill could not be done

    # --- stored areas (Q-482) -----------------------------------------------------------

    def reusable(self, area_id: str | None) -> bool:
        """A stored area that needs no new computation: its summary lists no ``skybot:`` or
        ``horizons:`` code, or it was rechecked less than ``RECHECK_COOLDOWN_S`` ago, or the
        server is offline (a recheck would only fail again). Reads the store only."""
        summary = None if area_id is None else self._read(area_id, "summary")
        if summary is None:
            return False
        if self.ctx.settings.offline or not check_codes(summary.get("missing", [])):
            return True
        assert area_id is not None
        with self._lock:
            since = self._rechecked.get(area_id)
        return since is not None and time.monotonic() - since < RECHECK_COOLDOWN_S

    def _mark_recheck(self, area_id: str) -> None:
        """Start the cooldown of ``area_id`` (Q-482). Called when a compute starts and again
        when it stores the area, so neither a recheck nor a first compute that stored a
        ``skybot:`` or ``horizons:`` code is followed by another compute within
        ``RECHECK_COOLDOWN_S`` (a job for the same box queued behind a scan's square is then
        done at once, as ``submit`` says). A compute that fails keeps it, so a lasting failure
        cannot make every start a recompute; a stopped one clears it (``_unmark_recheck``)."""
        now = time.monotonic()
        with self._lock:
            for a in [a for a, t in self._rechecked.items() if now - t >= RECHECK_COOLDOWN_S]:
                del self._rechecked[a]
            self._rechecked[area_id] = now

    def _unmark_recheck(self, area_id: str) -> None:
        """A compute was stopped: it checked nothing, so the area may be rechecked at once."""
        with self._lock:
            self._rechecked.pop(area_id, None)

    def _stored_again(self, area_id: str) -> None:
        """A compute stored ``area_id``: the cooldown starts, a refill may be tried again and
        every kept merge may be out of date."""
        self._mark_recheck(area_id)
        with self._lock:
            self._no_refill.discard(area_id)
        self._forget_results()

    def needs_spectra(self, area_id: str) -> bool:
        """The stored area lacks its ``spectra`` stage and a refill may still fill it: false
        once a refill was tried in this process and could not be done (served from the pack, a
        stage missing, the check failing), so ``start=true`` does not queue a job every time
        only for it to fail again (Q-482 (2)). Reads the store and memory only."""
        with self._lock:
            if area_id in self._no_refill:
                return False
        return self.store.spectra_entry(area_id) is None

    def ensure_spectra(self, area_id: str) -> None:
        """Fill a stored area's missing ``spectra`` stage (Q-474, Q-482) from its stored
        ``summary``, ``dots`` and ``tracks``, as ``scripts/area_spectra.py`` does. Worker only:
        the check never runs in a request (A16.2). Written only into the app's own cache (the
        committed pack is read only); a failure is logged and never fails the job, and the
        area is remembered (``needs_spectra``)."""
        try:
            if self.store.spectra_entry(area_id) is not None:
                return
            self._fill_spectra(area_id)
            if self.store.spectra_entry(area_id) is not None:
                return
        except Exception:
            log.exception("area %s: the spectrum check failed; /spectra is not prepared", area_id)
        with self._lock:
            self._no_refill.add(area_id)

    def _fill_spectra(self, area_id: str) -> None:
        """``ensure_spectra``'s work; raises on a failing check."""
        from app.core.area import spectrum
        from app.core.area.config import area_key

        for root, release, head in self.store.heads(area_id):
            p = str(head["params_hash"])
            bodies = {s: root.get(area_key(release, area_id, s, p)) for s in SPECTRA_INPUTS}
            if bodies["summary"] is None:
                continue  # not the head the store serves (as ``spectra_entry``)
            if root is not self.ctx.cache:
                log.warning("area %s: no spectra, and its head is not in the cache", area_id)
                return
            if any(b is None for b in bodies.values()):
                log.warning("area %s: no spectra, and a stored stage is missing", area_id)
                return
            spectrum.store_prepared(
                root, release, p, {s: b.body for s, b in bodies.items() if b is not None}
            )
            log.info("area %s: spectra stage filled", area_id)
            return

    def _forget_results(self) -> None:
        """An area was stored (maybe again): every kept merge may be out of date (Q-482). The
        generation moves, so a merge read from the store before this is not kept after it."""
        with self._results_lock:
            self._results_gen += 1
            self._results.clear()

    # --- single live areas --------------------------------------------------------------

    def get(self, area_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(area_id)

    def submit(self, plan: Plan, kind: str | None = None) -> Job:
        """Queue a plan; a single job for the area already queued or running (and not
        stopped) is returned as it is. A done job is run again: the caller checks the store
        first, so a done job reaching here means its stored area is gone, needs a recheck or
        lacks its spectra stage (Q-482; the worker decides which). A stopped job that
        is still winding down, or a scan's square computing the area, is replaced here by a
        fresh job queued after it: once the square is stored the fresh job is done at once
        with nothing recomputed, and if the scan is stopped first it computes the area itself.
        With ``kind``, a new job is recorded as a run of one square (Q-471)."""
        post: list[Snapshot] = []
        with self._lock:
            job = self._jobs.get(plan.area_id)
            if job is not None and job.joinable:
                return job
            if self._closed or len(self._queue) >= MAX_WAITING:
                raise QueueFull()
            self._prune()
            job = Job(plan)
            if kind is not None:
                job.run_id = self.runs.create(
                    kind, plan.release, plan.box, [(1, plan.box, plan.area_id)], defer=post
                )
                self._by_run[job.run_id] = job
            self._jobs[plan.area_id] = job
            self._queue.append(job)
            self._ensure_worker()
        self._flush(post)
        return job

    def cancel(self, area_id: str) -> bool:
        """Stop a queued or running job. False when there is none to stop."""
        post: list[Snapshot] = []
        with self._lock:
            job = self._jobs.get(area_id)
            if job is None or job.state not in ("queued", "running"):
                return False
            job.cancel.set()
            if job.state == "queued":
                self._queue.remove(job)
                job.state = "failed"
                job.error = _error_of(Cancelled())
                job.finished = time.monotonic()
                if job.run_id is not None:
                    self._by_run.pop(job.run_id, None)
                    self._defer(post, self.runs.set_state, job.run_id, "stopped", "run_stopped")
        self._flush(post)
        return True

    # --- scans --------------------------------------------------------------------------

    def submit_scan(
        self, scan: ScanPlan, kind: str, release: str, stored: dict[int, str] | None = None
    ) -> str:
        """Queue a scan; returns its run id. Raises ``QueueFull``. ``stored`` maps a square to
        an area the plan found stored for its box: the job uses it without an SIA call."""
        stored = dict(stored or {})
        post: list[Snapshot] = []
        with self._lock:
            if self._closed or len(self._queue) >= MAX_WAITING:
                raise QueueFull()
            run_id = self.runs.create(
                kind,
                release,
                scan.region,
                [(s.index, s.box, stored.get(s.index)) for s in scan.squares],
                defer=post,
            )
            job = ScanJob(run_id, release, scan.squares, stored)
            self._by_run[run_id] = job
            self._queue.append(job)
            self._ensure_worker()
        self._flush(post)
        return run_id

    def pause(self, run_id: str) -> None:
        """Pause a running scan after its current square (Q-470)."""
        with self._lock:
            item = self._live_item(run_id)
            if not isinstance(item, ScanJob) or item.state != "running" or item.cancel.is_set():
                raise RunConflict("run_not_pausable", "Only a running scan can be paused.")
            # A pause takes effect before the next square; with none left it would never
            # apply, so it is refused rather than answered and then dropped (PR #160 review).
            if not any(s.index != item.current_square for s in item._todo()):
                raise RunConflict(
                    "run_not_pausable", "The last square is running; the scan ends after it."
                )
            item.pause_requested = True

    def resume(self, run_id: str) -> None:
        """Resume a paused scan: it is queued again at the back, like any new job (and counts
        towards ``MAX_WAITING``: ``QueueFull``), or drop a pause that has not taken effect."""
        post: list[Snapshot] = []
        with self._lock:
            item = self._live_item(run_id)
            if isinstance(item, ScanJob) and item.state == "running" and item.pause_requested:
                item.pause_requested = False
                return
            if not isinstance(item, ScanJob) or item.state != "paused":
                raise RunConflict("run_not_paused", "Only a paused scan can be resumed.")
            if self._closed or len(self._queue) >= MAX_WAITING:
                raise QueueFull()
            item.state = "queued"
            self._queue.append(item)
            self._defer(post, self.runs.set_state, run_id, "queued", "run_resumed")
            self._ensure_worker()
        self._flush(post)

    def stop(self, run_id: str) -> None:
        """Stop a run: at once when queued or paused, at the next check when running. Squares
        already finished stay stored. Raises ``RunNotFound`` or ``RunConflict``."""
        post: list[Snapshot] = []
        with self._lock:
            item = self._live_item(run_id)
            if item is None or item.cancel.is_set():
                raise RunConflict("run_finished", "This run has already finished or is stopping.")
            if isinstance(item, ScanJob):
                item.cancel.set()
                if item.current is not None:
                    item.current.cancel.set()
                if item.state in ("queued", "paused"):
                    if item in self._queue:
                        self._queue.remove(item)
                    item.state = "stopped"
                    self._by_run.pop(run_id, None)
                    self._defer(post, self.runs.set_state, run_id, "stopped", "run_stopped")
        self._flush(post)
        # A single job: cancel() takes the lock again; it may have finished in between.
        if isinstance(item, Job) and not self.cancel(item.area_id):
            raise RunConflict("run_finished", "This run has already finished.")

    def _live_item(self, run_id: str) -> QueueItem | None:
        item = self._by_run.get(run_id)
        if item is None:
            self.runs.get(run_id)  # RunNotFound for an unknown id
        return item

    def run_reply(self, run_id: str) -> dict[str, Any]:
        """The ``run.schema.json`` body: the record, and while live its queue position or the
        running square's progress."""
        out = self.runs.get(run_id)  # the copy is made outside ``_lock`` (the worker needs it)
        with self._lock:
            item = self._by_run.get(run_id)
            if item is None:
                return out
            if out["state"] == "queued" and item in self._queue:
                out["queue_position"] = list(self._queue).index(item) + 1
            job = item if isinstance(item, Job) else item.current
            if job is not None and job.state == "running":
                square = 1 if isinstance(item, Job) else item.current_square
                out["progress"] = {
                    "square": square,
                    "area_id": job.area_id,
                    "step": job.step,
                    "steps": _steps_reply(job.steps),
                }
            return out

    def results(self, run_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
        """The run record and its finished squares merged (Q-471). A live scan's squares come
        from the replies it already holds; the rest are read from the store once. The merge is
        kept per run until another square is done. Raises ``RunNotFound``."""
        run = self.runs.get(run_id)
        done = tuple(
            (int(s["index"]), str(s["area_id"]))
            for s in run["squares"]
            if s["state"] == "done" and s["area_id"] is not None
        )
        with self._results_lock:
            got = self._results.get(run_id)
            gen = self._results_gen
        if got is not None and got[0] == done:
            return run, got[1]
        with self._lock:
            item = self._by_run.get(run_id)
            held = dict(item.cache) if isinstance(item, ScanJob) else {}
        squares = []
        for index, area_id in done:
            sq = held.get(index)
            if sq is None or sq.area_id != area_id:
                sq = read_square(index, area_id, self._read)
            squares.append(sq)
        merged = merge(square_boxes(run), squares)
        with self._results_lock:
            if gen != self._results_gen:  # an area was stored meanwhile: answer, do not keep
                return run, merged
            self._results.pop(run_id, None)
            self._results[run_id] = (done, merged)
            while len(self._results) > MAX_RESULTS:
                del self._results[next(iter(self._results))]
        return run, merged

    def close(self, timeout: float = 15.0) -> bool:
        """Server shutdown: stop every queued, paused and running item, then wait for the
        worker. A queued or paused item ends at once and its run is recorded ``stopped``; the
        running one ends at its next check, which every queued cutout download makes, so the
        downloads still waiting in its pool end at once. Without this the process could not
        exit until every queued download had run (minutes when the archive is slow).
        True when the worker has ended. Afterwards nothing new is queued (``QueueFull``): a
        request racing the shutdown must not start the worker again."""
        with self._lock:
            self._closed = True
            runs = [run_id for run_id, item in self._by_run.items() if isinstance(item, ScanJob)]
            areas = [a for a, job in self._jobs.items() if job.state in ("queued", "running")]
        for run_id in runs:
            with contextlib.suppress(RunConflict, RunNotFound):  # it ended in between
                self.stop(run_id)
        for area_id in areas:
            self.cancel(area_id)
        return self.wait(timeout)

    def wait(self, timeout: float | None = None) -> bool:
        """Block until the queue is empty and the worker idle (tests). True when it is."""
        t = self._thread
        if t is not None:
            t.join(timeout)
        return t is None or not t.is_alive()

    # --- run-record writes --------------------------------------------------------------

    def _defer(self, post: list[Snapshot], fn: Callable[..., None], *args: Any) -> None:
        """A run-record change made under ``self._lock``; its file write goes to ``post``."""
        try:
            fn(*args, defer=post)
        except Exception:
            log.exception("run record change failed")

    def _flush(self, post: list[Snapshot]) -> None:
        if post:
            self._record(self.runs.flush, post)

    def _record(self, fn: Callable[..., None], *args: Any, **kw: Any) -> None:
        """A run-record write; a failure (disk full, say) is logged and never stops the queue."""
        try:
            fn(*args, **kw)
        except Exception:
            log.exception("run record write failed")

    # --- the worker ---------------------------------------------------------------------

    def _ensure_worker(self) -> None:
        """Start the worker if it is not running (call with the lock held)."""
        if self._thread is None or not self._thread.is_alive():
            self._thread = threading.Thread(target=self._work, name="live-area-jobs", daemon=True)
            self._thread.start()

    def _work(self) -> None:
        while True:
            with self._lock:
                if not self._queue:
                    self._thread = None
                    return
                item = self._queue.popleft()
                item.state = "running"
                item.started = time.monotonic() if item.started is None else item.started
                self._running = item
            try:
                if isinstance(item, Job):
                    self._run_job(item)
                else:
                    self._run_scan(item)
            finally:
                with self._lock:
                    self._running = None

    def _stored(self, area_id: str | None) -> bool:
        return area_id is not None and self.store.entry(area_id, "summary") is not None

    def _read(self, area_id: str, stage: str) -> dict[str, Any] | None:
        got = self.store.entry(area_id, stage)
        if got is None:
            return None
        body: dict[str, Any] = json.loads(got.body)
        return body

    def _square_done(
        self, run_id: str, index: int, area_id: str, cache: dict[int, SquareReplies]
    ) -> None:
        """Mark a square done. Its replies are read once and kept in ``cache``; its ``found``
        events come from them, and the run's totals from merging every cached square (Q-471)."""
        cache[index] = read_square(index, area_id, self._read)
        record = self.runs.get(run_id)
        record["squares"][index - 1]["state"] = "done"
        merged = merge(square_boxes(record), list(cache.values()))
        self.runs.square(
            run_id,
            index,
            "done",
            area_id=area_id,
            event="square_done",
            objects=square_objects(cache[index]),
            totals=totals_of(merged, record["squares"]),
            missing=cache[index].missing,
        )

    def _square_failed(
        self, run_id: str, index: int, exc: BaseException, area_id: str | None = None
    ) -> None:
        code, detail = _error_of(exc)
        skipped = isinstance(exc, LiveAreaError) and code == "area:no_visit_pair"
        record = self.runs.get(run_id)
        record["squares"][index - 1]["state"] = "skipped" if skipped else "failed"
        self.runs.square(
            run_id,
            index,
            "skipped" if skipped else "failed",
            area_id=area_id,
            error={"code": code, "detail": detail},
            event="square_skipped" if skipped else "square_failed",
            totals={**record["totals"], **square_counts(record["squares"])},
        )

    def _finish_job(self, job: Job, state: str, exc: BaseException | None = None) -> None:
        with self._lock:
            job.state = state
            job.step = None
            if state == "done":
                for st in job.steps.values():
                    st.state = "done"
            if exc is not None:
                job.error = _error_of(exc)
            job.finished = time.monotonic()
            if job.run_id is not None:
                self._by_run.pop(job.run_id, None)

    def _run_job(self, job: Job) -> None:
        run_id = job.run_id
        if run_id is not None:
            self._record(self.runs.start, run_id)
            self._record(
                self.runs.square,
                run_id,
                1,
                "running",
                area_id=job.area_id,
                event="square_started",
                write=False,
            )
        try:
            # Stored meanwhile (by a scan's square, say) and reusable: done at once, nothing is
            # recomputed but a missing spectra stage. A stored area whose known-object check
            # failed is computed again; the old result is served until the new one is stored,
            # and stays the job's result when the recheck fails (Q-482 (3)).
            if self.reusable(job.area_id):
                self.ensure_spectra(job.area_id)
            else:
                old = self._stored(job.area_id)
                self._mark_recheck(job.area_id)
                try:
                    self._runner(self.ctx, job.plan, Progress(job, self._lock))
                except Cancelled:
                    self._unmark_recheck(job.area_id)
                    raise
                except Exception as exc:
                    if not (old and self._stored(job.area_id)):
                        raise
                    log.warning(
                        "live area %s: the recheck failed (%r); the stored result stays",
                        job.area_id,
                        exc,
                    )
                    self.ensure_spectra(job.area_id)
                else:
                    self._stored_again(job.area_id)
        except BaseException as exc:
            if not isinstance(exc, (Cancelled, LiveAreaError)):
                log.exception("live area %s failed", job.area_id)
            self._finish_job(job, "failed", exc)
            if run_id is not None:
                if isinstance(exc, Cancelled):
                    self._record(self.runs.set_state, run_id, "stopped", "run_stopped")
                else:  # its one square failed: the run failed (Q-471)
                    self._record(self._square_failed, run_id, 1, exc, job.area_id)
                    self._record(self.runs.set_state, run_id, "failed", "run_done")
            return
        self._finish_job(job, "done")
        if run_id is not None:
            self._record(self._square_done, run_id, 1, job.area_id, {})
            self._record(self.runs.set_state, run_id, "done", "run_done")

    def _run_square(self, scan: ScanJob, sq: Square) -> str:
        """One square of a scan: ``"next"`` to go on, ``"stop"`` once the scan is stopped."""
        run_id = scan.run_id
        self._record(
            self.runs.square, run_id, sq.index, "running", event="square_started", write=False
        )
        area_id = scan.stored.get(sq.index)
        if area_id is not None and self.reusable(area_id):  # stored: no SIA call (Q-470)
            return self._reused(scan, sq, area_id)
        # A stored area that is not reusable is rechecked; its stored result stays the
        # square's result when the recheck cannot be planned or fails (Q-482 (3)).
        old = area_id if self._stored(area_id) else None
        try:
            plan = self._planner(self.ctx, sq.box)
        except BaseException as exc:
            if old is not None and isinstance(exc, Exception):
                log.warning("scan %s square %d: no plan for its recheck: %r", run_id, sq.index, exc)
                return self._reused(scan, sq, old)
            if not isinstance(exc, LiveAreaError):
                log.warning("scan %s square %d: no plan: %r", run_id, sq.index, exc)
            self._record(self._square_failed, run_id, sq.index, exc)
            return "next"
        if self.reusable(plan.area_id):
            return self._reused(scan, sq, plan.area_id)
        if self._stored(plan.area_id):
            old = plan.area_id
        self._mark_recheck(plan.area_id)  # not stored, or its known-object check failed
        got = self._compute(scan, sq, plan, old)
        if got is None:
            return "stop" if scan.cancel.is_set() else "next"
        return self._reused(scan, sq, got)  # computed, or the stored result kept

    def _reused(self, scan: ScanJob, sq: Square, area_id: str) -> str:
        """A square done with a stored area: a missing spectra stage is filled (a no-op when
        the compute just stored it)."""
        self.ensure_spectra(area_id)
        self._record(self._square_done, scan.run_id, sq.index, area_id, scan.cache)
        return "next"

    def _compute(self, scan: ScanJob, sq: Square, plan: Plan, old: str | None) -> str | None:
        """Run the pipeline for one square: the area id the square is done with, or None once
        the square is recorded failed (or back to ``todo`` when the scan was stopped). ``old``
        is a stored area this computes again: when the recheck fails, or only its job is
        stopped, the square is done with ``old``, as it is still served (Q-482 (3)). The
        square's job is listed under its area id while it runs (unless another job for that
        area is active), so ``GET /v1/areas/live/{id}`` shows it; a request for the same box
        does not join it but queues its own job behind it (``submit``)."""
        run_id = scan.run_id
        inner = Job(plan, scan_id=run_id)
        inner.state = "running"
        inner.started = time.monotonic()
        with self._lock:
            if scan.cancel.is_set():
                inner.cancel.set()
            scan.current = inner
            other = self._jobs.get(plan.area_id)
            if other is None or not other.active:
                self._prune()
                self._jobs[plan.area_id] = inner
        try:
            self._runner(self.ctx, plan, Progress(inner, self._lock))
        except Cancelled as exc:
            self._unmark_recheck(plan.area_id)
            self._finish_job(inner, "failed", exc)
            if scan.cancel.is_set():
                # The scan was stopped: the square did not finish in this run, so it goes back
                # to todo like any square not reached, even when an old result is stored.
                self._record(self.runs.square, run_id, sq.index, "todo")
                return None
            # Only this square's job was stopped (DELETE /v1/areas/live/{id}).
            if old is not None and self._stored(old):
                log.warning(
                    "scan %s square %d: recheck stopped; old result stays", run_id, sq.index
                )
                return old
            self._record(self._square_failed, run_id, sq.index, exc, plan.area_id)
            return None
        except BaseException as exc:
            self._finish_job(inner, "failed", exc)
            if isinstance(exc, Exception) and old is not None and self._stored(old):
                log.warning(
                    "scan %s square %d: the recheck failed (%r); the stored result stays",
                    run_id,
                    sq.index,
                    exc,
                )
                return old
            if not isinstance(exc, LiveAreaError):
                log.exception("scan %s square %d failed", run_id, sq.index)
            self._record(self._square_failed, run_id, sq.index, exc, plan.area_id)
            return None
        finally:
            with self._lock:
                scan.current = None
        self._stored_again(plan.area_id)
        self._finish_job(inner, "done")
        return plan.area_id

    def _run_scan(self, scan: ScanJob) -> None:
        """The squares in order (Q-470): skipped without a visit pair, done at once when stored,
        else run; any other failure marks that square and the scan goes on."""
        run_id = scan.run_id
        self._record(self.runs.start, run_id)
        try:
            for sq in scan.squares:
                if sq.index in scan.done:
                    continue
                post: list[Snapshot] = []
                with self._lock:
                    if scan.cancel.is_set():
                        break
                    paused = scan.pause_requested
                    if paused:
                        scan.pause_requested = False
                        scan.state = "paused"
                        scan.current_square = None
                        self._defer(post, self.runs.set_state, run_id, "paused", "run_paused")
                    else:
                        scan.current_square = sq.index
                        scan.square_started = time.monotonic()
                self._flush(post)
                if paused:
                    return  # the paused scan leaves the worker (Q-470)
                if self._run_square(scan, sq) == "stop":
                    break
                scan.done.add(sq.index)
        except BaseException:  # the scan loop itself broke: the run failed, the queue goes on
            log.exception("scan %s failed", run_id)
            with self._lock:
                scan.state = "failed"
                scan.current_square = None
                self._by_run.pop(run_id, None)
            self._record(self.runs.set_state, run_id, "failed", "run_done")
            return
        # Q-481: a scan that was not stopped ends failed when no square is done and at least
        # one failed. A scan whose squares were all skipped (no visit pair, so nothing to
        # search) ends done, as nothing failed; skipped and failed squares, none done: failed.
        states = self._square_states(run_id)
        with self._lock:
            stopped = scan.cancel.is_set()
            failed = not stopped and "done" not in states and "failed" in states
            scan.state = "stopped" if stopped else "failed" if failed else "done"
            scan.current_square = None
            self._by_run.pop(run_id, None)
        if stopped:
            self._record(self.runs.set_state, run_id, "stopped", "run_stopped")
        else:
            self._record(self.runs.set_state, run_id, scan.state, "run_done")

    def _square_states(self, run_id: str) -> list[str]:
        try:
            return [str(s["state"]) for s in self.runs.get(run_id)["squares"]]
        except Exception:  # an unreadable record must not stop the queue
            log.exception("scan %s: cannot read its squares", run_id)
            return []

    def _prune(self) -> None:
        """Forget the oldest finished jobs beyond ``MAX_FINISHED`` (call with the lock held)."""
        done = [j for j in self._jobs.values() if j.state in ("done", "failed")]
        done.sort(key=lambda j: j.finished or 0.0)
        for j in done[: max(0, len(done) - MAX_FINISHED)]:
            if self._jobs.get(j.area_id) is j:
                del self._jobs[j.area_id]

    def reply(self, job: Job) -> dict[str, Any]:
        """The ``area-job.schema.json`` body of one job."""
        with self._lock:
            now = time.monotonic()
            elapsed = 0.0
            if job.started is not None:
                elapsed = (job.finished or now) - job.started
            out: dict[str, Any] = {
                "area_id": job.area_id,
                "state": job.state,
                "step": job.step,
                "steps": _steps_reply(job.steps),
                "elapsed_s": int(elapsed),
                "eta_s": None,
            }
            if job.state == "running":
                out["eta_s"] = job.remaining_s(now)
            elif job.state == "queued":
                ahead = list(self._queue)
                pos = ahead.index(job) + 1 if job in ahead else 1
                out["queue_position"] = pos
                wait = sum(a.estimate_s() for a in ahead[: pos - 1])
                r = self._running  # also a stopped job still winding down, replaced in _jobs
                if r is not None:
                    wait += r.remaining_s(now)
                out["eta_s"] = wait + job.plan.estimate_s()
            if job.error is not None:
                out["error"] = {"code": job.error[0], "detail": job.error[1]}
            if job.run_id is not None:
                out["run_id"] = job.run_id
            return out


def _steps_reply(steps: Mapping[str, _StepState]) -> list[dict[str, Any]]:
    out = []
    for sid, label in STEPS:
        st = steps[sid]
        row: dict[str, Any] = {"id": sid, "label": label, "state": st.state}
        if st.done is not None:
            row["done"] = st.done
        if st.total is not None:
            row["total"] = st.total
        out.append(row)
    return out


def done_reply(area_id: str) -> dict[str, Any]:
    """A stored area with no job in memory (after a restart, or prepared another way)."""
    return {
        "area_id": area_id,
        "state": "done",
        "step": None,
        "steps": [{"id": s, "label": label, "state": "done"} for s, label in STEPS],
        "elapsed_s": 0,
        "eta_s": None,
    }


__all__ = [
    "CUTOUT_SECOND_PASS_S",
    "MAX_WAITING",
    "RECHECK_COOLDOWN_S",
    "STEPS",
    "Cancelled",
    "Job",
    "LiveJobs",
    "Progress",
    "QueueFull",
    "RunConflict",
    "ScanJob",
    "cutout_retryable",
    "done_reply",
    "run_live_area",
]

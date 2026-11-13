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
"""

from __future__ import annotations

import logging
import threading
import time
from collections import deque
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from app.adapters.http import UpstreamError
from app.cache.store import CacheMissOffline, UpstreamUnavailable
from app.context import Context
from app.core.area.live import LiveAreaError, Plan

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


class QueueFull(Exception):
    """``MAX_WAITING`` jobs already wait; the API answers 429 ``queue_full``."""


class Cancelled(Exception):
    """The job was stopped (``DELETE``); raised at the next step or cutout."""


@dataclass
class _StepState:
    state: str = "todo"
    done: int | None = None
    total: int | None = None


@dataclass
class Job:
    plan: Plan
    state: str = "queued"
    step: str | None = None
    steps: dict[str, _StepState] = field(default_factory=dict)
    started: float | None = None
    finished: float | None = None
    error: tuple[str, str] | None = None
    cancel: threading.Event = field(default_factory=threading.Event)

    def __post_init__(self) -> None:
        self.steps = {s: _StepState() for s in STEP_IDS}
        self.steps["visits"].state = "done"  # the plan already holds the visit pair

    @property
    def area_id(self) -> str:
        return self.plan.area_id

    @property
    def active(self) -> bool:
        """Queued or running and not stopped: the job a new request for the same area joins."""
        return self.state in ("queued", "running") and not self.cancel.is_set()


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

    def fetch(row: Any, cut: Any) -> tuple[str, bytes]:
        progress.check()
        got = live(row, cut)
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


class LiveJobs:
    """The queue and its one worker thread. Thread-safe; the worker starts on demand."""

    def __init__(self, ctx: Context, runner: Runner | None = None) -> None:
        self.ctx = ctx
        self._runner = runner or run_live_area
        self._lock = threading.Lock()
        self._jobs: dict[str, Job] = {}
        self._queue: deque[str] = deque()
        self._thread: threading.Thread | None = None
        self._running: Job | None = None

    def get(self, area_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(area_id)

    def submit(self, plan: Plan) -> Job:
        """Queue a plan; an area already queued or running (and not stopped) is returned as it
        is. A done job is run again: the caller checks the store first, so a done job reaching
        here means its stored area is gone. A stopped job that is still winding down is
        replaced by a fresh job queued after it."""
        with self._lock:
            job = self._jobs.get(plan.area_id)
            if job is not None and job.active:
                return job
            if len(self._queue) >= MAX_WAITING:
                raise QueueFull()
            self._prune()
            job = Job(plan)
            self._jobs[plan.area_id] = job
            self._queue.append(plan.area_id)
            if self._thread is None or not self._thread.is_alive():
                self._thread = threading.Thread(
                    target=self._work, name="live-area-jobs", daemon=True
                )
                self._thread.start()
            return job

    def cancel(self, area_id: str) -> bool:
        """Stop a queued or running job. False when there is none to stop."""
        with self._lock:
            job = self._jobs.get(area_id)
            if job is None or job.state not in ("queued", "running"):
                return False
            job.cancel.set()
            if job.state == "queued":
                self._queue.remove(area_id)
                job.state = "failed"
                job.error = _error_of(Cancelled())
                job.finished = time.monotonic()
            return True

    def wait(self, timeout: float | None = None) -> bool:
        """Block until the queue is empty and the worker idle (tests). True when it is."""
        t = self._thread
        if t is not None:
            t.join(timeout)
        return t is None or not t.is_alive()

    def _work(self) -> None:
        while True:
            with self._lock:
                if not self._queue:
                    self._thread = None
                    return
                job = self._jobs[self._queue.popleft()]
                job.state = "running"
                job.started = time.monotonic()
                self._running = job
            try:
                self._runner(self.ctx, job.plan, Progress(job, self._lock))
            except BaseException as exc:
                if not isinstance(exc, (Cancelled, LiveAreaError)):
                    log.exception("live area %s failed", job.area_id)
                with self._lock:
                    job.state = "failed"
                    job.error = _error_of(exc)
                    job.step = None
                    job.finished = time.monotonic()
                    self._running = None
                continue
            with self._lock:
                job.state = "done"
                job.step = None
                for st in job.steps.values():
                    st.state = "done"
                job.finished = time.monotonic()
                self._running = None

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
                out["eta_s"] = max(0, job.plan.estimate_s() - int(elapsed))
            elif job.state == "queued":
                ahead = list(self._queue)
                pos = ahead.index(job.area_id) + 1 if job.area_id in ahead else 1
                out["queue_position"] = pos
                wait = sum(self._jobs[a].plan.estimate_s() for a in ahead[: pos - 1])
                r = self._running  # also a stopped job still winding down, replaced in _jobs
                if r is not None:
                    started = r.started if r.started is not None else now
                    wait += max(0, r.plan.estimate_s() - int(now - started))
                out["eta_s"] = wait + job.plan.estimate_s()
            if job.error is not None:
                out["error"] = {"code": job.error[0], "detail": job.error[1]}
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
    "MAX_WAITING",
    "STEPS",
    "Cancelled",
    "Job",
    "LiveJobs",
    "Progress",
    "QueueFull",
    "done_reply",
    "run_live_area",
]

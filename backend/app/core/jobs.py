"""Job registry: one background job per object (issue #41).

A job runs the object pipeline in its own thread. Its answers improve in up to three steps:

- ``first``: the card and render params from catalogue data, with the SPHEREx layers listed as
  ``measuring:`` (never guessed). Published only while the first frames are still downloading.
- ``partial``: measured from the first batch of frames (the old per-request cap), listed as
  ``measuring:frames`` while the rest download. Published only when frames remain.
- ``final``: the refined answer, from the same inputs whatever order the frames arrived in.

An intermediate answer (``latest``) is never saved; only the final one can be.

Repeat requests join the running job, and a finished job is reused for ``ttl_s`` so the card and
render-params requests of one page load share one run (this replaces the per-object lock and
recent-results memo proposed on ``feat/sculptor-page``). A failed job is not reused: the next
request starts a new one.

Progress (stage, frames n of N) is kept on the job with a sequence number that grows on every
change, so a listener can wait for the next change (``wait_change``) and stream it.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from datetime import datetime
from typing import Any, Literal

from app.timefmt import iso_utc_z, utc_now

log = logging.getLogger("shift_spectrum")

JobState = Literal["running", "done", "failed"]
# Stages a job reports, in order (the build steps on the page).
STAGES = ("queued", "catalogue", "frames", "spectrum", "card", "done")
FINISHED_KEPT = 256  # bound on finished jobs kept for reuse (object ids come from user input)


class Job[T]:
    def __init__(self, key: str) -> None:
        self.key = key
        self.state: JobState = "running"
        self.stage = "queued"
        self.frames_done = 0
        self.frames_total: int | None = None
        self.latest: T | None = None  # the newest intermediate answer (first or partial)
        self.latest_kind: str | None = None
        self.final: T | None = None
        self.error: BaseException | None = None
        self.seq = 0
        self.started = time.monotonic()
        self.started_at: datetime = utc_now()
        self.finished: float | None = None
        self.finished_at: datetime | None = None
        self._cond = threading.Condition()

    # --- updates (job thread) -------------------------------------------------------------

    def _changed(self) -> None:
        self.seq += 1
        self._cond.notify_all()

    def update(
        self,
        *,
        stage: str | None = None,
        frames_done: int | None = None,
        frames_total: int | None = None,
    ) -> None:
        with self._cond:
            if stage is not None:
                self.stage = stage
            if frames_done is not None:
                self.frames_done = frames_done
            if frames_total is not None:
                self.frames_total = frames_total
            self._changed()

    def publish(self, result: T, kind: Literal["first", "partial"]) -> None:
        with self._cond:
            if self.final is None:
                self.latest = result
                self.latest_kind = kind
                self._changed()

    def finish(self, result: T) -> None:
        with self._cond:
            self.final = result
            self.state = "done"
            self.stage = "done"
            self.finished = time.monotonic()
            self.finished_at = utc_now()
            self._changed()

    def fail(self, exc: BaseException) -> None:
        with self._cond:
            self.error = exc
            self.state = "failed"
            self.finished = time.monotonic()
            self.finished_at = utc_now()
            self._changed()

    # --- reads (request threads) ----------------------------------------------------------

    def answer(self, wait_s: float) -> T:
        """The final answer if it comes within ``wait_s``; else the newest intermediate answer
        as soon as there is one; else wait for whichever comes. Re-raises the job's error."""
        deadline = time.monotonic() + max(0.0, wait_s)
        with self._cond:
            while True:
                if self.error is not None:
                    raise self.error
                if self.final is not None:
                    return self.final
                now = time.monotonic()
                if self.latest is not None and now >= deadline:
                    return self.latest
                timeout = deadline - now if self.latest is not None else None
                self._cond.wait(timeout)

    def wait_final(self, timeout: float | None = None) -> T | None:
        end = None if timeout is None else time.monotonic() + timeout
        with self._cond:
            while self.final is None and self.error is None:
                left = None if end is None else end - time.monotonic()
                if left is not None and left <= 0:
                    return None
                self._cond.wait(left)
            if self.error is not None:
                raise self.error
            return self.final

    def wait_change(self, seq: int, timeout: float) -> dict[str, Any]:
        """Wait until the job changed after ``seq`` (or ``timeout``); return a snapshot."""
        with self._cond:
            if self.seq == seq and self.state == "running":
                self._cond.wait(timeout)
            return self._snapshot()

    def snapshot(self) -> dict[str, Any]:
        with self._cond:
            return self._snapshot()

    def _snapshot(self) -> dict[str, Any]:
        return {
            "id": self.key,
            "state": self.state,
            "stage": self.stage,
            "frames_done": self.frames_done,
            "frames_total": self.frames_total,
            "answer": "final" if self.final is not None else (self.latest_kind or "none"),
            "started_at": iso_utc_z(self.started_at),
            "finished_at": iso_utc_z(self.finished_at) if self.finished_at else None,
            "error": type(self.error).__name__ if self.error is not None else None,
            "seq": self.seq,
        }


class JobRegistry[T]:
    def __init__(self, ttl_s: float, max_running: int = 0) -> None:
        """``max_running`` > 0 caps the jobs doing work at once; the others wait in stage
        ``queued``. Object ids come from user input (coordinates), so the cap bounds the
        threads and queued downloads one client can start."""
        self.ttl_s = ttl_s
        self._slots = threading.BoundedSemaphore(max_running) if max_running > 0 else None
        self._jobs: OrderedDict[str, Job[T]] = OrderedDict()
        self._lock = threading.Lock()
        self._closed = False

    def _fresh(self, job: Job[T], now: float) -> bool:
        if job.state == "running":
            return True
        if job.state == "failed" or job.finished is None:
            return False
        return now - job.finished < self.ttl_s

    def ensure(
        self, key: str, run: Callable[[Job[T]], T], *, reuse_finished: bool = True
    ) -> Job[T]:
        """The running or recently finished job for ``key``, or a new one running ``run``.
        ``reuse_finished=False`` joins only a running job."""
        with self._lock:
            now = time.monotonic()
            job = self._jobs.get(key)
            if (
                job is not None
                and (job.state == "running" or reuse_finished)
                and self._fresh(job, now)
            ):
                self._jobs.move_to_end(key)
                return job
            job = Job(key)
            self._jobs[key] = job
            self._prune(now)
            if self._closed:
                job.fail(RuntimeError("shutting down"))
                return job
        thread = threading.Thread(
            target=self._run_in_slot, args=(job, run), name=f"sx-job-{key[:40]}", daemon=True
        )
        thread.start()
        return job

    def get(self, key: str) -> Job[T] | None:
        with self._lock:
            return self._jobs.get(key)

    def _prune(self, now: float) -> None:
        stale = [
            k for k, j in self._jobs.items() if j.state != "running" and not self._fresh(j, now)
        ]
        for k in stale:
            del self._jobs[k]
        finished = [k for k, j in self._jobs.items() if j.state != "running"]
        for k in finished[: max(0, len(finished) - FINISHED_KEPT)]:
            del self._jobs[k]

    def close(self) -> None:
        with self._lock:
            self._closed = True

    def _run_in_slot(self, job: Job[T], run: Callable[[Job[T]], T]) -> None:
        if self._slots is None:
            self._run(job, run)
            return
        while not self._slots.acquire(timeout=1.0):
            if self._closed:
                job.fail(RuntimeError("shutting down"))
                return
        try:
            self._run(job, run)
        finally:
            self._slots.release()

    @staticmethod
    def _run(job: Job[T], run: Callable[[Job[T]], T]) -> None:
        try:
            result = run(job)
        except BaseException as exc:  # reported to every waiting request
            log.warning("job %s failed: %s: %s", job.key, type(exc).__name__, exc)
            job.fail(exc)
        else:
            job.finish(result)

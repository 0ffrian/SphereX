"""Photometry in worker processes (issue #41, A4.2).

``measure_bytes`` is the whole Stage 2 measurement of one cutout: the FITS bytes in, a
``Measurement`` or ``Refusal`` out. It is a pure function of (bytes, pixel position, config), so a
frame measured in a worker process gives the same numbers as one measured in the calling thread,
and the spectrum does not depend on which worker finished first.

Workers are started with ``spawn`` (the same on Linux and on the Windows A15, and safe while the
API has threads running). ``workers = 0`` measures in the calling thread.
"""

from __future__ import annotations

import logging
import multiprocessing
import threading
from concurrent.futures import Executor, Future, ProcessPoolExecutor

from app.core.find import wcs
from app.core.measure.config import DEFAULT_CONFIG, MeasureConfig
from app.core.measure.photometry import Measurement, Refusal, measure_frame

log = logging.getLogger("shift_spectrum")

Outcome = Measurement | Refusal


def measure_bytes(
    body: bytes, x0: float, y0: float, cfg: MeasureConfig = DEFAULT_CONFIG
) -> Outcome:
    try:
        hdul = wcs.open_fits(body)
    except (OSError, ValueError) as exc:
        return Refusal("cutout_unreadable", f"unreadable FITS: {exc}")
    with hdul:
        return measure_frame(hdul, x0, y0, cfg)


class MeasurePool:
    def __init__(self, workers: int) -> None:
        self.workers = max(0, workers)
        self._executor: Executor | None = None
        self._lock = threading.Lock()
        self._closed = False  # after close(), measure in the calling thread; no new processes

    def _pool(self) -> Executor | None:
        if self.workers == 0:
            return None
        with self._lock:
            if self._closed:
                return None
            if self._executor is None:
                self._executor = ProcessPoolExecutor(
                    max_workers=self.workers, mp_context=multiprocessing.get_context("spawn")
                )
            return self._executor

    def submit(
        self, body: bytes, x0: float, y0: float, cfg: MeasureConfig = DEFAULT_CONFIG
    ) -> Future[Outcome]:
        pool = self._pool()
        if pool is not None:
            try:
                return pool.submit(measure_bytes, body, x0, y0, cfg)
            except RuntimeError as exc:  # broken or shut down: measure here instead
                log.warning("photometry pool unavailable, measuring in-thread: %s", exc)
        done: Future[Outcome] = Future()
        try:
            done.set_result(measure_bytes(body, x0, y0, cfg))
        except Exception as exc:
            done.set_exception(exc)
        return done

    def close(self) -> None:
        with self._lock:
            self._closed = True
            pool, self._executor = self._executor, None
        if pool is not None:
            pool.shutdown(wait=False, cancel_futures=True)

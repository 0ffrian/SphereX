"""Warm the cache at start-up (issue #41, D-25).

With ``SX_PREFETCH_ON_START=1`` the API runs the object job for every target in
``SX_PREFETCH_GROUPS`` (default ``demo``) of ``targets.toml``, one object at a time, in a
background thread. A demo object then answers from the asset store or the job's result in under
a second. The job is the same one ``/card`` runs, so a visitor who opens an object while it is
warming joins it instead of starting a second download.

This is not ``scripts.prefetch``: it does not fetch the catalogue overlays or build the
composite, and it never forces a refresh. Under ``SX_OFFLINE=1`` it only reads the cache.
"""

from __future__ import annotations

import logging
import threading
import tomllib
from pathlib import Path

from app.context import Context
from app.core.card.service import ObjectPipeline
from app.core.find.resolver import resolve

log = logging.getLogger("shift_spectrum")


def frames_wanted(target: dict[str, object]) -> bool:
    """``frames = false`` in ``targets.toml`` marks a catalogue-only target (an exoplanet: no
    SPHEREx spectrum is measured for it). Read exactly as ``scripts.prefetch`` reads it."""
    return str(target.get("frames", True)).lower() != "false"


def demo_queries(targets_file: Path, groups: list[str]) -> list[str]:
    """The queries to warm: targets in ``groups`` that want frames. A ``frames = false`` target is
    left out, because the object job downloads the frame list and cutouts for whatever it is given;
    such a target's catalogue answers are two small calls, made when someone opens it."""
    try:
        doc = tomllib.loads(targets_file.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        log.warning("warm cache: cannot read %s: %s", targets_file, exc)
        return []
    return [
        str(t["query"])
        for t in doc.get("target", [])
        if isinstance(t, dict) and t.get("group") in groups and "query" in t and frames_wanted(t)
    ]


class WarmCache:
    def __init__(
        self, ctx: Context, pipeline: ObjectPipeline, aliases: dict[str, str], queries: list[str]
    ) -> None:
        self.ctx = ctx
        self.pipeline = pipeline
        self.aliases = aliases
        self.queries = queries
        # Both hold queries, in order (issue #103): ``done`` warmed, ``failed`` not resolved or
        # whose job could not start or raised. Health exposes only their lengths.
        self.done: list[str] = []
        self.failed: list[str] = []
        self._finished = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="sx-warm", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def join(self, timeout: float | None = None) -> None:
        if self._thread is not None:
            self._thread.join(timeout)

    @property
    def state(self) -> str:
        """``idle`` (built, ``start`` not called yet; the lifespan starts it at once, so health
        does not normally show it), ``running``, ``finished`` (every query in the warm list
        tried; ``failed`` counts the ones that did not warm) or ``stopped`` (shut down first)."""
        if self._finished.is_set():
            return "finished"
        if self._stop.is_set():
            return "stopped"
        return "running" if self._thread is not None else "idle"

    def status(self) -> dict[str, object]:
        """The ``warm`` block of ``/v1/health`` (issue #103)."""
        return {
            "state": self.state,
            "total": len(self.queries),
            "done": len(self.done),
            "failed": len(self.failed),
        }

    def _run(self) -> None:
        log.info("warm cache: %d targets", len(self.queries))
        for q in self.queries:
            if self._stop.is_set():
                return
            try:
                obj = resolve(self.ctx, q, self.aliases).obj
            except Exception as exc:  # NotFound, BadQuery, an outage: skip this target
                log.warning("warm cache: %r not resolved: %s", q, exc)
                self.failed.append(q)
                continue
            try:
                job = self.pipeline.ensure_job(obj)
            except Exception as exc:  # a dead thread would leave health "running" for ever
                log.warning("warm cache: %r job not started: %s", q, exc)
                self.failed.append(q)
                continue
            ok = True
            while not self._stop.is_set():
                try:
                    if job.wait_final(timeout=1.0) is not None:
                        break
                except Exception as exc:  # the job failed; the next request will retry it
                    log.warning("warm cache: %r failed: %s", q, exc)
                    ok = False
                    break
            else:
                return
            if ok:
                self.done.append(q)
                log.info("warm cache: %s ready", obj.id)
            else:
                self.failed.append(q)
        self._finished.set()
        log.info("warm cache: finished (%d ready, %d failed)", len(self.done), len(self.failed))

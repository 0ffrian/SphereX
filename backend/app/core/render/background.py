"""Texture bakes off the request path (issue #41, R6.7).

When a reply's render params point at baked textures, the bake is queued here and the reply goes
out at once: the viewer shows the plain body first and swaps the texture in when it is there.
Both sizes are baked (R5: 2048x1024 desktop, 1024x512 mobile; R6.7 keeps them in separate size
directories). ``bake_to_cache`` is safe for concurrent callers and skips a valid entry, so a
repeat submission costs one stat.

Workers are processes started with ``spawn``; ``workers = 0`` bakes in one background thread.
"""

from __future__ import annotations

import functools
import logging
import multiprocessing
import threading
from collections.abc import Mapping
from concurrent.futures import Executor, Future, ProcessPoolExecutor, ThreadPoolExecutor
from pathlib import Path
from typing import Any

from app.core.render.bake import bake_key, bake_to_cache
from app.core.render.card_to_params import TEXTURE_HEIGHT, TEXTURE_WIDTH
from app.core.render.params import BakeRefusal, params_from_card

log = logging.getLogger("shift_spectrum")

# R5 display rules: desktop size first (the one RenderParams.textures points at), then mobile.
SIZES = ((TEXTURE_WIDTH, TEXTURE_HEIGHT), (TEXTURE_WIDTH // 2, TEXTURE_HEIGHT // 2))


class TextureBaker:
    def __init__(self, root: Path, workers: int) -> None:
        self.root = root
        self.workers = max(0, workers)
        self._executor: Executor | None = None
        self._inflight: dict[tuple[str, str, int, int, int, str], Future[Path]] = {}
        # Re-entrant: add_done_callback runs _done at once, under this lock, if the bake is done.
        self._lock = threading.RLock()
        self._closed = False

    def _pool(self) -> Executor:
        if self._executor is None:
            if self.workers == 0:
                self._executor = ThreadPoolExecutor(1, thread_name_prefix="sx-bake")
            else:
                self._executor = ProcessPoolExecutor(
                    max_workers=self.workers, mp_context=multiprocessing.get_context("spawn")
                )
        return self._executor

    def submit(self, card: Mapping[str, Any], params: Mapping[str, Any]) -> list[Future[Path]]:
        """Queue both sizes when ``params`` has textures. Never raises; returns the futures."""
        if "textures" not in params:
            return []
        object_id, version = str(card["id"]), str(params["generator_version"])
        seed = int(params["seed"])
        try:
            bake_params = params_from_card(card, seed)
        except BakeRefusal as exc:  # card_to_params only adds URLs when the bake is allowed
            log.warning("textures for %s refused at bake time: %s", object_id, exc.reason)
            return []
        out: list[Future[Path]] = []
        with self._lock:
            if self._closed:
                return []
            for w, h in SIZES:
                key = (object_id, version, seed, w, h, bake_key(bake_params, w, h))
                fut = self._inflight.get(key)
                if fut is None:
                    try:
                        fut = self._pool().submit(
                            bake_to_cache, bake_params, self.root, object_id, version, w, h
                        )
                    except RuntimeError as exc:  # pool broken or shut down
                        log.warning("texture bake for %s not queued: %s", object_id, exc)
                        continue
                    self._inflight[key] = fut
                    fut.add_done_callback(functools.partial(self._done, key))
                out.append(fut)
        return out

    def _done(self, key: tuple[str, str, int, int, int, str], fut: Future[Path]) -> None:
        with self._lock:
            self._inflight.pop(key, None)
        if not fut.cancelled() and fut.exception() is not None:
            log.warning("texture bake %s failed: %s", key[:5], fut.exception())

    def close(self) -> None:
        with self._lock:
            self._closed = True
            pool, self._executor = self._executor, None
        if pool is not None:
            pool.shutdown(wait=False, cancel_futures=True)

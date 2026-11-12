"""Done-when check on a real cache: every target in targets.toml returns its frame list and
every cutout PNG with SX_OFFLINE=1 and all non-loopback network blocked.

    uv run python -m scripts.smoke_offline [--group test]

Exit code 1 if any target has no frames, a cutout fails, or `missing` lists anything other
than a per-frame geometric refusal. A moving object may honestly have no frames. A
``frames = false`` target (a catalogue-only exoplanet) has no frame list by design and is skipped.

This checks the cache in-process. The go/no-go check before going on stage is
``scripts.preflight``, against the running backend (issue #103).
"""

from __future__ import annotations

import argparse
import ipaddress
import os
import socket
import tomllib
from typing import Any


def block_network() -> None:
    """Allow loopback only (asyncio on Windows needs it); refuse every other connection."""

    def loopback(host: Any) -> bool:
        h = (host.decode() if isinstance(host, bytes) else str(host or "localhost")).strip("[]")
        if h == "localhost":
            return True
        try:
            return ipaddress.ip_address(h.split("%")[0]).is_loopback
        except ValueError:
            return False

    real_connect = socket.socket.connect
    real_getaddrinfo = socket.getaddrinfo

    def connect(self: socket.socket, address: Any) -> None:
        if isinstance(address, tuple) and not loopback(address[0]):
            raise RuntimeError(f"network blocked: {address!r}")
        real_connect(self, address)

    def getaddrinfo(host: Any, *args: Any, **kwargs: Any) -> Any:
        if not loopback(host):
            raise RuntimeError(f"network blocked: {host!r}")
        return real_getaddrinfo(host, *args, **kwargs)

    socket.socket.connect = connect  # type: ignore[method-assign, assignment]
    socket.getaddrinfo = getaddrinfo


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--group", action="append", default=None)
    args = p.parse_args(argv)

    os.environ["SX_OFFLINE"] = "1"
    block_network()
    from fastapi.testclient import TestClient

    from app.core.find.frames import is_complete
    from app.core.warm import frames_wanted
    from app.main import create_app
    from app.settings import Settings

    settings = Settings()
    doc = tomllib.loads(settings.targets_file.read_text(encoding="utf-8"))
    targets = [t for t in doc["target"] if not args.group or t.get("group") in args.group]
    ok = True
    print(f"cache: {settings.cache_dir}  offline: {settings.offline}")
    with TestClient(create_app(settings)) as client:
        for t in targets:
            if not frames_wanted(t):  # catalogue only: no frame list is fetched for it
                print(f"  SKIP {t['name']:<16} frames = false")
                continue
            r = client.get("/v1/resolve", params={"q": t["name"]})
            if r.status_code != 200:
                print(f"  FAIL {t['name']}: resolve {r.status_code} {r.text}")
                ok = False
                continue
            oid = r.json()["id"]
            fr = client.get(f"/v1/objects/{oid}/frames")
            body = fr.json()
            if fr.status_code != 200:
                print(f"  FAIL {t['name']}: frames {fr.status_code} {fr.text}")
                ok = False
                continue
            bad = 0
            for f in body["frames"]:
                png = client.get(f["cutout_url"])
                if png.status_code != 200 or not png.content.startswith(b"\x89PNG"):
                    bad += 1
            # Data gaps fail the check; per-frame geometric refusals (object outside a cutout at
            # a frame edge, no wavelength) are honest refusals and are only reported.
            missing = [] if is_complete(body["missing"]) else body["missing"]
            moving = r.json()["moving"]
            good = (moving or body["frames"]) and not bad and not missing
            ok = ok and bool(good)
            print(
                f"  {'OK  ' if good else 'FAIL'} {t['name']:<16} {oid:<34}"
                f" frames={len(body['frames'])} pngs_failed={bad}"
                f" missing={body['missing'][:3]} cached_at={body['cached_at']}"
            )
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())

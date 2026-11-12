"""Done-when check on a real cache: every target in targets.toml returns its frame list and
every cutout PNG with SX_OFFLINE=1 and all non-loopback network blocked, and its render
parameters carry no data gap.

    uv run python -m scripts.smoke_offline [--group test] [--group demo]

`--group` can be repeated; with none, every target is checked. Exit code 1 if any target has no
frames, a cutout fails, the frames' `missing` lists anything other than a per-frame geometric
refusal, or the render parameters' `missing` lists a data gap (see `data_gaps`). A moving
object may honestly have no frames. A target with `frames = false` (a catalogue-only exoplanet)
has no frame list by design: its `/frames` call and cutouts are skipped, but its render
parameters are still checked for data gaps (a lost `exoplanet_archive` answer fails it). The
render parameters' asset status (generated, saved, ...) is printed for each target.

This checks the cache in-process. The go/no-go check before going on stage is
`scripts.preflight`, against the running backend (issue #103); where they disagree, it counts.
"""

from __future__ import annotations

import argparse
import ipaddress
import os
import socket
import tomllib
from collections.abc import Iterable
from typing import Any

# Render-parameter `missing` ids that mean the cache lost an answer (issue #93 C2): the card is
# then degraded although frames and cutouts are fine. Must match MEASURING_PREFIX and the
# catalogue ids of app.core.card.service.CATALOGUE_GAPS (a unit test checks both).
DATA_GAP_IDS = frozenset({"catalogue", "star_catalogue", "exoplanet_archive"})
MEASURING_PREFIX = "measuring:"


def data_gaps(missing: Iterable[str], frames_expected: bool) -> list[str]:
    """The ids in a render-parameters `missing` list that fail the offline check: a lost
    catalogue answer, anything still being measured, and `spectrum` when frames are expected.
    Other ids (a layer refused for lack of a measured property) are honest refusals."""
    return [
        m
        for m in missing
        if m in DATA_GAP_IDS
        or m.startswith(MEASURING_PREFIX)
        or (m == "spectrum" and frames_expected)
    ]


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


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--group", action="append", default=None, help="repeatable; default: all")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

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
            r = client.get("/v1/resolve", params={"q": t["name"]})
            if r.status_code != 200:
                print(f"  FAIL {t['name']}: resolve {r.status_code} {r.text}")
                ok = False
                continue
            oid = r.json()["id"]
            frames_expected = frames_wanted(t)
            # Issue #103: a frames = false target has no frame list in the cache (offline the
            # call is a 503), so only /frames and the cutouts are skipped, not the gap check.
            body: dict[str, Any] = {"frames": [], "missing": [], "cached_at": None}
            if frames_expected:
                fr = client.get(f"/v1/objects/{oid}/frames")
                if fr.status_code != 200:
                    print(f"  FAIL {t['name']}: frames {fr.status_code} {fr.text}")
                    ok = False
                    continue
                body = fr.json()
            bad = 0
            for f in body["frames"]:
                png = client.get(f["cutout_url"])
                if png.status_code != 200 or not png.content.startswith(b"\x89PNG"):
                    bad += 1
            # Data gaps fail the check; per-frame geometric refusals (object outside a cutout at
            # a frame edge, no wavelength) are honest refusals and are only reported.
            missing = [] if is_complete(body["missing"]) else body["missing"]
            moving = r.json()["moving"]
            needs_frames = frames_expected and not moving
            rp = client.get(f"/v1/objects/{oid}/render-params")
            if rp.status_code != 200:
                print(f"  FAIL {t['name']}: render-params {rp.status_code} {rp.text}")
                ok = False
                continue
            gaps = data_gaps(rp.json()["missing"], frames_expected and bool(body["frames"]))
            status = rp.headers.get("X-SX-Asset-Status", "?")
            good = (body["frames"] or not needs_frames) and not bad and not missing and not gaps
            ok = ok and bool(good)
            print(
                f"  {'OK  ' if good else 'FAIL'} {t['name']:<16} {oid:<34}"
                f" frames={len(body['frames']) if frames_expected else 'skipped'} pngs_failed={bad}"
                f" missing={body['missing'][:3]} cached_at={body['cached_at']}"
                f" asset={status} gaps={gaps}"
            )
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())

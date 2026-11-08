"""scripts.sky_mirror against a fake IRSA (httpx.MockTransport): budget, resume, refusals."""

from __future__ import annotations

import json
from pathlib import Path

import httpx

from app.core.sky.surveys import SURVEYS, hips_dir, survey_dir, tile_relpath
from scripts import sky_mirror
from tests.conftest import make_settings

PROPS = """# test
hips_frame           = equatorial
hips_order           = 9
hips_tile_width      = 512
hips_tile_format     = jpeg
hips_status          = public master clonable
"""
TILE = b"\xff\xd8" + b"x" * 998  # 1000 bytes; the mirror does not decode tiles


class FakeIrsa:
    def __init__(self, props: str = PROPS, missing: set[str] | None = None) -> None:
        self.props = props
        self.missing = missing or set()
        self.requests: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.requests.append(path)
        assert request.headers["user-agent"].startswith("ShiftSpectrum/")
        base = httpx.URL(SURVEYS["2mass_color"].base_url).path
        rel = path.removeprefix(base + "/")
        if rel in self.missing:
            return httpx.Response(404)
        if rel == "properties":
            return httpx.Response(200, content=self.props.encode())
        return httpx.Response(200, content=TILE)


def run(tmp_path: Path, fake: FakeIrsa, *args: str, offline: bool = False) -> int:
    s = make_settings(tmp_path, offline=offline, http_backoff_s=0.0)
    return sky_mirror.main(
        ["--max-order", "1", "--concurrency", "2", *args],
        settings=s,
        transport=httpx.MockTransport(fake),
    )


def test_refuses_offline(tmp_path: Path) -> None:
    fake = FakeIrsa()
    assert run(tmp_path, fake, offline=True) == 2
    assert fake.requests == []
    assert not (tmp_path / "sky").exists()


def test_mirrors_orders_and_resumes(tmp_path: Path) -> None:
    fake = FakeIrsa()
    assert run(tmp_path, fake) == 0
    hdir = hips_dir(tmp_path, "2mass_color")
    assert (hdir / "properties").is_file() and (hdir / "Norder3/Allsky.jpg").is_file()
    for k in (0, 1):
        for n in range(12 * 4**k):
            assert (hdir / tile_relpath(k, n)).read_bytes() == TILE
    assert not (hdir / "Norder2").exists()
    manifest = json.loads((survey_dir(tmp_path, "2mass_color") / "mirror.json").read_text())
    assert manifest["complete_orders"] == [0, 1]
    assert not list(tmp_path.rglob("*.part"))
    first = len(fake.requests)
    assert first == 2 + 12 + 48

    assert run(tmp_path, fake) == 0
    assert len(fake.requests) == first  # nothing fetched again


def test_budget_is_a_hard_cap(tmp_path: Path) -> None:
    fake = FakeIrsa()
    # properties (~150 B) + Allsky + order 0 (12 tiles) fit; order 1 (48 more) does not.
    budget_bytes = len(PROPS) + 1000 * (1 + 12 + 20)
    rc = run(tmp_path, fake, "--max-mb", str(budget_bytes / 1e6))
    assert rc == 1
    used = sum(p.stat().st_size for p in (tmp_path / "sky").rglob("*") if p.is_file())
    manifest_size = (survey_dir(tmp_path, "2mass_color") / "mirror.json").stat().st_size
    assert used - manifest_size <= budget_bytes
    manifest = json.loads((survey_dir(tmp_path, "2mass_color") / "mirror.json").read_text())
    assert manifest["complete_orders"] == [0]


def test_existing_files_count_towards_the_budget(tmp_path: Path) -> None:
    other = tmp_path / "sky" / "allwise_color" / "equirect_4096x2048.jpg"
    other.parent.mkdir(parents=True)
    other.write_bytes(b"x" * 5000)
    assert run(tmp_path, FakeIrsa(), "--max-mb", "0.004") == 1
    assert not hips_dir(tmp_path, "2mass_color").joinpath("properties").exists()


def test_unclonable_needs_the_flag(tmp_path: Path) -> None:
    fake = FakeIrsa(props=PROPS.replace("master clonable", "mirror unclonable"))
    assert run(tmp_path, fake) == 1
    assert not hips_dir(tmp_path, "2mass_color").joinpath("Norder0").exists()
    assert run(tmp_path, fake, "--allow-unclonable") == 0


def test_properties_that_do_not_match_are_refused(tmp_path: Path) -> None:
    fake = FakeIrsa(props=PROPS.replace("equatorial", "galactic"))
    assert run(tmp_path, fake) == 1
    assert not hips_dir(tmp_path, "2mass_color").joinpath("Norder0").exists()


def test_failed_tiles_leave_the_order_incomplete(tmp_path: Path) -> None:
    fake = FakeIrsa(missing={tile_relpath(1, 7)})
    assert run(tmp_path, fake) == 1
    manifest = json.loads((survey_dir(tmp_path, "2mass_color") / "mirror.json").read_text())
    assert manifest["complete_orders"] == [0]
    assert manifest["tiles"]["1"] == 47

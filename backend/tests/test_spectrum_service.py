"""SpectrumService: frame accounting, ordering, refusals, determinism and the derived cache."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

import app.core.measure.spectrum as spectrum_mod
from app.cache.store import LiveResponse, ReadThroughCache
from app.context import Context, make_context
from app.core.find.frames import FrameRecord, FramesResult
from app.core.find.resolver import ResolvedObject
from app.core.measure.config import MeasureConfig
from app.core.measure.spectrum import ALL_SATURATED, SpectrumService
from tests.conftest import make_settings
from tests.measure_synth import X0, Y0, Synth

OBJ = ResolvedObject(
    id="radec-150.00000+2.00000", name=None, ra=150.0, dec=2.0, moving=False, resolver="coords"
)


def frame(
    fid: str, wl: float, time: str, *, x: float = X0, flags: list[str] | None = None
) -> FrameRecord:
    return FrameRecord(
        frame_id=fid,
        time=time,
        wavelength_um=wl,
        bandwidth_um=wl / 40,
        x=x,
        y=0.0,
        x_fits0=x,
        y_fits0=Y0,
        width=41,
        height=33,
        ra=150.0,
        dec=2.0,
        flags=flags or ["SOURCE"],
        detector=1,
        north_angle_deg=0.0,
        mirrored=False,
        em_min_um=wl - 0.01,
        em_max_um=wl + 0.01,
        access_url="https://irsa.ipac.caltech.edu/x",
        t_min_mjd=0.0,
        t_max_mjd=0.0,
    )


class FakeFrames:
    def __init__(self, ctx: Context, frames: list[FrameRecord], missing: list[str]) -> None:
        self.ctx = ctx
        self.frames = frames
        self.missing = missing
        self.calls = 0

    def get_frames(self, obj: ResolvedObject) -> FramesResult:
        self.calls += 1
        return FramesResult(obj.id, list(self.frames), list(self.missing), None, False)


GOOD = Synth().standard().fits_bytes()
SATURATED = Synth().standard().set_flag(17, 12, "OVERFLOW").fits_bytes()


@pytest.fixture
def ctx(tmp_path: Path) -> Context:
    return make_context(make_settings(tmp_path / "cache"))


def service(
    ctx: Context,
    frames: list[FrameRecord],
    bodies: dict[str, bytes],
    missing: list[str] | None = None,
    cfg: MeasureConfig | None = None,
) -> SpectrumService:
    """Put the cutout bodies in the cache under Stage 1's keys (absent ones removed)."""
    for f in frames:
        key = spectrum_mod.cutout_key(ctx, f)
        if f.frame_id in bodies:
            live = LiveResponse(bodies[f.frame_id], "test:cutout", 200, "application/fits")
            ctx.cache.put(key, live, if_changed=True)
        else:
            ctx.cache.delete(key)
    fake = FakeFrames(ctx, frames, missing or [])
    return SpectrumService(fake, cfg or MeasureConfig())  # type: ignore[arg-type]


def mixed() -> tuple[list[FrameRecord], dict[str, bytes]]:
    frames = [
        frame("A", 2.0, "2026-01-01T00:00:00.000Z"),
        frame("B", 1.0, "2026-01-03T00:00:00.000Z"),
        frame("C", 3.0, "2026-01-02T00:00:00.000Z", x=2.0),  # aperture off the edge
        frame("D", 4.0, "2026-01-04T00:00:00.000Z"),
        frame("E", 0.9, "2026-01-05T00:00:00.000Z", flags=["SOURCE", "no_proper_motion"]),
    ]
    bodies = {"A": GOOD, "B": GOOD, "C": GOOD, "D": SATURATED, "E": GOOD}
    return frames, bodies


def test_every_frame_once_sorted_and_same_measurements(
    ctx: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    frames, bodies = mixed()
    body = service(ctx, frames, bodies, ["frames:truncated"]).get_spectrum(OBJ).body
    assert [p["frame_id"] for p in body["spectrum"]] == ["E", "B", "A"]  # by wavelength
    assert [p["frame_id"] for p in body["light_curve"]] == ["A", "B", "E"]  # by time
    assert body["missing"] == ["aperture_edge:C", "frames:truncated", "saturated:D"]
    measured = {p["frame_id"] for p in body["spectrum"]}
    refused = {m.split(":", 1)[1] for m in body["missing"] if m.count(":") == 1}
    refused -= {"truncated"}
    assert measured | refused == {f.frame_id for f in frames} and not measured & refused
    lc = {p["frame_id"]: p for p in body["light_curve"]}
    for p in body["spectrum"]:
        assert (p["flux"], p["error"]) == (lc[p["frame_id"]]["flux"], lc[p["frame_id"]]["error"])
        assert p["wavelength_um"] == lc[p["frame_id"]]["wavelength_um"]
    assert ALL_SATURATED not in body["missing"]
    assert body["tag"] == "measured" and body["flux_unit"] == "uJy"


def test_no_proper_motion_frame_is_flagged(ctx: Context, monkeypatch: pytest.MonkeyPatch) -> None:
    frames, bodies = mixed()
    body = service(ctx, frames, bodies).get_spectrum(OBJ).body
    e = next(p for p in body["spectrum"] if p["frame_id"] == "E")
    assert e["flagged"] and e["flag_reasons"] == ["no_proper_motion"] and e["dropped_flags"] == []
    a = next(p for p in body["spectrum"] if p["frame_id"] == "A")
    assert not a["flagged"] and a["flag_reasons"] == []


def test_all_saturated_adds_the_top_level_entry(
    ctx: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    frames = [
        frame("A", 1.0, "2026-01-01T00:00:00.000Z"),
        frame("B", 2.0, "2026-01-02T00:00:00.000Z"),
    ]
    body = service(ctx, frames, {"A": SATURATED, "B": SATURATED}).get_spectrum(OBJ).body
    assert body["spectrum"] == [] and body["light_curve"] == []
    assert body["missing"] == ["saturated:A", "saturated:B", ALL_SATURATED]


def test_mixed_refusals_are_not_all_saturated(
    ctx: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    frames = [frame("A", 1.0, "2026-01-01T00:00:00.000Z"), frame("C", 2.0, "t", x=2.0)]
    body = service(ctx, frames, {"A": SATURATED, "C": GOOD}).get_spectrum(OBJ).body
    assert ALL_SATURATED not in body["missing"]


def test_no_frames_is_not_saturated(ctx: Context, monkeypatch: pytest.MonkeyPatch) -> None:
    body = service(ctx, [], {}, ["frames:ephemeris"]).get_spectrum(OBJ).body
    assert body["missing"] == ["frames:ephemeris"] and body["spectrum"] == []


def test_deterministic_bytes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    frames, bodies = mixed()
    out = []
    for i in range(2):
        c = make_context(make_settings(tmp_path / f"c{i}"))
        out.append(json.dumps(service(c, frames, bodies).get_spectrum(OBJ).body))
    assert out[0] == out[1]


def test_derived_cache_hit_skips_measurement(ctx: Context, monkeypatch: pytest.MonkeyPatch) -> None:
    frames, bodies = mixed()
    svc = service(ctx, frames, bodies)
    first = svc.get_spectrum(OBJ)
    assert not first.from_cache
    calls = []
    monkeypatch.setattr(spectrum_mod, "measure_frame", lambda *a, **k: calls.append(a))
    second = svc.get_spectrum(OBJ)
    assert second.from_cache and calls == []
    assert second.body == first.body
    assert second.cached_at is not None


@pytest.mark.parametrize("missing", [["frames:truncated"], ["cutouts:deferred:2"], ["cutout:X"]])
def test_incomplete_frame_lists_are_not_stored(
    ctx: Context, monkeypatch: pytest.MonkeyPatch, missing: list[str]
) -> None:
    frames, bodies = mixed()
    svc = service(ctx, frames, bodies, missing)
    svc.get_spectrum(OBJ)
    assert not svc.get_spectrum(OBJ).from_cache
    assert not list(ReadThroughCache(ctx.cache.root, offline=True).iter_meta("derived.spectrum"))


def test_missing_cutout_is_refused_and_not_stored(
    ctx: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    frames, bodies = mixed()
    del bodies["B"]
    svc = service(ctx, frames, bodies)
    body = svc.get_spectrum(OBJ).body
    assert "cutout:B" in body["missing"]
    assert not svc.get_spectrum(OBJ).from_cache


def test_cache_key_follows_method_version_frames_and_cutouts(
    ctx: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    frames, bodies = mixed()
    service(ctx, frames, bodies).get_spectrum(OBJ)
    assert service(ctx, frames, bodies).get_spectrum(OBJ).from_cache
    other_cfg = MeasureConfig(aperture_radius_px=2.5)
    assert not service(ctx, frames, bodies, cfg=other_cfg).get_spectrum(OBJ).from_cache
    assert not service(ctx, frames[:-1], bodies).get_spectrum(OBJ).from_cache
    changed = {**bodies, "A": Synth().standard().set_flag(20, 12, "HOT").fits_bytes()}
    assert not service(ctx, frames, changed).get_spectrum(OBJ).from_cache
    monkeypatch.setattr(spectrum_mod, "MEASURE_VERSION", "measure-test")
    assert not service(ctx, frames, bodies).get_spectrum(OBJ).from_cache


def test_stage1_missing_is_part_of_the_key(ctx: Context) -> None:
    """Review fix 1: same frames, different Stage 1 ``missing`` -> no stale hit."""
    frames, bodies = mixed()
    first = service(ctx, frames, bodies).get_spectrum(OBJ)
    assert service(ctx, frames, bodies).get_spectrum(OBJ).from_cache
    other = service(ctx, frames, bodies, ["outside_cutout:Z"]).get_spectrum(OBJ)
    assert not other.from_cache
    assert "outside_cutout:Z" in other.body["missing"]
    assert "outside_cutout:Z" not in first.body["missing"]
    # An incomplete frame list is never served from the cache, and says so.
    trunc = service(ctx, frames, bodies, ["frames:truncated"]).get_spectrum(OBJ)
    assert not trunc.from_cache and "frames:truncated" in trunc.body["missing"]


def test_every_frame_field_is_part_of_the_key(ctx: Context) -> None:
    frames, bodies = mixed()
    service(ctx, frames, bodies).get_spectrum(OBJ)
    changed = [frames[0].__class__(**{**frames[0].__dict__, "bandwidth_um": 0.5}), *frames[1:]]
    res = service(ctx, changed, bodies).get_spectrum(OBJ)
    assert not res.from_cache
    a = next(p for p in res.body["spectrum"] if p["frame_id"] == "A")
    assert a["bandwidth_um"] == 0.5


def test_each_cutout_read_once_and_never_downloaded(
    ctx: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Review fix 3: one body read per cutout on a miss, none on a hit, no live call ever."""
    import app.adapters.irsa_cutout as irsa_cutout

    def no_live(*_a: Any, **_k: Any) -> Any:
        raise AssertionError("Stage 2 must not download cutouts")

    monkeypatch.setattr(irsa_cutout, "fetch_cutout", no_live)
    frames, bodies = mixed()
    svc = service(ctx, frames, bodies)
    reads: list[str] = []
    real_get = ctx.cache.get

    def counting_get(key: Any) -> Any:
        if key.source == "irsa_cutout":
            reads.append(dict(key.query)["frame_id"])
        return real_get(key)

    monkeypatch.setattr(ctx.cache, "get", counting_get)
    svc.get_spectrum(OBJ)
    assert sorted(reads) == sorted(f.frame_id for f in frames)
    reads.clear()
    assert svc.get_spectrum(OBJ).from_cache and reads == []


def test_uncached_cutout_is_refused_online_without_download(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.adapters.irsa_cutout as irsa_cutout

    def no_live(*_a: Any, **_k: Any) -> Any:
        raise AssertionError("Stage 2 must not download cutouts")

    monkeypatch.setattr(irsa_cutout, "fetch_cutout", no_live)
    online = make_context(make_settings(tmp_path / "c", offline=False))
    frames, bodies = mixed()
    del bodies["B"]
    svc = service(online, frames, bodies)
    body = svc.get_spectrum(OBJ).body
    assert "cutout:B" in body["missing"]
    assert not svc.get_spectrum(OBJ).from_cache  # incomplete: not stored


def test_absent_reject_flags_are_reported(ctx: Context) -> None:
    frames = [frame("A", 1.0, "2026-01-01T00:00:00.000Z")]
    body_bytes = Synth(mp_omit=("HOT", "COLD")).standard().fits_bytes()
    body = service(ctx, frames, {"A": body_bytes}).get_spectrum(OBJ).body
    assert body["spectrum"]
    assert body["method"]["reject_flags_absent"] == ["COLD", "HOT"]
    full = service(ctx, frames, {"A": GOOD}).get_spectrum(OBJ).body
    assert full["method"]["reject_flags_absent"] == []


def test_report_targets(ctx: Context, capsys: pytest.CaptureFixture[str]) -> None:
    good = [frame("A", 1.0, "2026-01-01T00:00:00.000Z")]
    sat = [frame("S", 1.0, "2026-01-01T00:00:00.000Z")]
    edge = [frame("C", 1.0, "2026-01-01T00:00:00.000Z", x=2.0)]
    other = ResolvedObject(
        id="radec-1", name=None, ra=1.0, dec=1.0, moving=False, resolver="coords"
    )
    assert spectrum_mod.report_targets(service(ctx, good, {"A": GOOD}), [("good", OBJ)]) == 0
    assert spectrum_mod.report_targets(service(ctx, sat, {"S": SATURATED}), [("sat", other)]) == 0
    assert spectrum_mod.report_targets(service(ctx, edge, {"C": GOOD}), [("edge", OBJ)]) == 1
    out = capsys.readouterr().out
    assert "good" in out and "points=1" in out
    assert "ALL SATURATED" in out and "aperture_edge" in out
    # Stage 1's cutout:<id> for a frame outside its list is not a Stage 2 refusal.
    stage1 = service(ctx, good, {"A": GOOD}, ["cutout:Z9", "frames:truncated"])
    assert spectrum_mod.report_targets(stage1, [("stage1", OBJ)]) == 0
    line = capsys.readouterr().out
    assert "refusals={}" in line and "points=1" in line
    # ... but a listed frame whose cutout is not cached is.
    uncached = [*good, frame("B", 2.0, "2026-01-02T00:00:00.000Z")]
    spectrum_mod.report_targets(service(ctx, uncached, {"A": GOOD}), [("uncached", OBJ)])
    assert "'cutout': 1" in capsys.readouterr().out


# --- OUTLIER on a mover's core (Q-139, Q-460) ---------------------------------------------

OUTLIER_CORE = Synth().standard().set_flag(18, 13, "OUTLIER").fits_bytes()
MOVER = ResolvedObject(
    id="sbdb-1", name=None, ra=150.0, dec=2.0, moving=True, resolver="sbdb", spkid="1"
)


def test_mover_outlier_core_is_a_flagged_point_and_fixed_is_refused(ctx: Context) -> None:
    frames = [frame("A", 2.0, "2026-01-01T00:00:00.000Z")]
    mover = service(ctx, frames, {"A": OUTLIER_CORE}).get_spectrum(MOVER).body
    (pt,) = mover["spectrum"]
    assert pt["flagged"] and pt["flag_reasons"] == ["outlier_core"] and pt["dropped_flags"] == []
    assert mover["light_curve"][0]["flagged"] and mover["missing"] == []
    assert mover["method"]["core_flag_only"] == ["OUTLIER"]
    fixed = service(ctx, frames, {"A": OUTLIER_CORE}).get_spectrum(OBJ).body
    assert fixed["spectrum"] == [] and fixed["missing"] == ["aperture_flags:A"]
    assert "core_flag_only" not in fixed["method"]  # a fixed object's method block is unchanged


def test_mover_and_fixed_results_do_not_share_a_cache_entry(ctx: Context) -> None:
    frames = [frame("A", 2.0, "2026-01-01T00:00:00.000Z")]
    svc = service(ctx, frames, {"A": GOOD})
    svc.get_spectrum(MOVER)
    assert not svc.get_spectrum(OBJ).from_cache  # different method sha, so a different key


def test_premeasured_with_another_method_is_not_reused(ctx: Context) -> None:
    from concurrent.futures import Future

    from app.core.measure.config import DEFAULT_CONFIG, method_sha
    from app.core.measure.photometry import Refusal
    from app.core.measure.spectrum import Premeasured

    frames = [frame("A", 2.0, "2026-01-01T00:00:00.000Z")]
    svc = service(ctx, frames, {"A": OUTLIER_CORE})
    sha = str(ctx.cache.get_meta(spectrum_mod.cutout_key(ctx, frames[0]))["body_sha256"])  # type: ignore[index]

    def pre(method: str) -> dict[str, Premeasured]:
        fut: Future[Any] = Future()
        fut.set_result(Refusal("measure", "sentinel"))
        return {"A": Premeasured(sha, X0, Y0, fut, method)}

    # Made with the fixed-object config but read for a mover: ignored, measured afresh.
    stale = svc.get_spectrum(MOVER, premeasured=pre(method_sha(DEFAULT_CONFIG))).body
    assert len(stale["spectrum"]) == 1 and stale["missing"] == []

"""Gemini artistic layer (issue #14; R6.6, D-07, A6.2, D-24, D-25).

Done when: the layer swaps in on success and the code path is shown on failure. Gemini is never
called for real: the painter gets a fake client, and the REST client gets an httpx MockTransport.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import logging
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient
from numpy.typing import NDArray
from PIL import Image

from app.cache.store import ReadThroughCache
from app.core.render import gemini_paint as gp
from app.core.render.bake import bake, bake_dir, encode
from app.core.render.card_to_params import GENERATOR_VERSION, seed_for
from app.core.render.gemini_paint import (
    AI_FILE,
    AI_META,
    EDGE_CORRELATION_MIN,
    GeminiError,
    GeminiImage,
    GeminiPainter,
    GeminiRestClient,
)
from app.core.render.params import params_from_card
from app.main import create_app
from app.settings import Settings
from tests.conftest import make_settings
from tests.test_api import resolve_id

CARDS = Path(__file__).parents[2] / "shared" / "fixtures" / "cards"
W, H = 128, 64
SECRET = "sk-test-DO-NOT-LEAK-1234567890"
ADMIN = "admin-test-token"
OID = "fixture:asteroid_procedural"


def card(name: str = "asteroid_procedural") -> dict[str, Any]:
    return json.loads((CARDS / f"{name}.json").read_text(encoding="utf-8"))


def png_bytes(rgb: NDArray[np.uint8]) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(rgb, "RGB").save(buf, "PNG")
    return buf.getvalue()


def faithful(reference_png: bytes, size: tuple[int, int] = (96, 96)) -> bytes:
    """A 'painting' that keeps the terrain in place: the hillshade tinted brown, at another size
    (and aspect) than the map, so resampling to 2:1 is exercised."""
    with Image.open(io.BytesIO(reference_png)) as im:
        g = np.asarray(im.convert("L").resize(size, Image.Resampling.BILINEAR), dtype=np.float64)
    rgb = np.stack([30 + 0.8 * g, 25 + 0.6 * g, 20 + 0.45 * g], axis=-1)
    return png_bytes(np.rint(rgb).astype(np.uint8))


def unrelated(_: bytes) -> bytes:
    rng = np.random.default_rng(7)
    return png_bytes(rng.integers(0, 256, size=(H, W, 3), dtype=np.uint8))


class FakeClient:
    model = "fake-image-model"
    endpoint = "https://example.invalid/models/fake-image-model:generateContent"

    def __init__(self, make: Callable[[bytes], bytes] | Exception) -> None:
        self.make = make
        self.calls: list[tuple[str, bytes]] = []

    def generate(self, prompt: str, reference_png: bytes) -> GeminiImage:
        self.calls.append((prompt, reference_png))
        if isinstance(self.make, Exception):
            raise self.make
        return GeminiImage(self.make(reference_png), "image/png")


def settings(tmp_path: Path, **kw: Any) -> Settings:
    values: dict[str, Any] = {
        "offline": False,
        "textures_dir": tmp_path / "textures",
        "gemini_api_key": SECRET,
    }
    values.update(kw)
    return make_settings(tmp_path / "cache", **values)


def painter(tmp_path: Path, client: Any, **kw: Any) -> GeminiPainter:
    s = settings(tmp_path, **kw)
    return GeminiPainter(
        s, ReadThroughCache(s.cache_dir, offline=s.offline), client, width=W, height=H
    )


def code_dir(tmp_path: Path) -> Path:
    return bake_dir(
        tmp_path / "textures", OID, GENERATOR_VERSION, seed_for(OID, GENERATOR_VERSION), W, H
    )


def assert_code_path(tmp_path: Path, outcome: gp.PaintOutcome, reason: str) -> None:
    assert not outcome.applied
    assert outcome.reason == reason
    assert outcome.missing[0] == "albedo_ai"
    assert outcome.detail.startswith("Failed, using code")
    d = code_dir(tmp_path)
    if reason not in ("not_baked_type", "bake_refused"):
        assert (d / "albedo.webp").is_file()  # the code colour is on disk and loads first
    assert not (d / AI_FILE).exists() and not (d / AI_META).exists()


# --- success --------------------------------------------------------------------------------


def test_success_swaps_in_tagged_artistic(tmp_path: Path) -> None:
    fake = FakeClient(faithful)
    p = painter(tmp_path, fake)
    out = p.repaint(OID, card())
    assert out.applied, out.detail
    assert out.edge_correlation is not None and out.edge_correlation >= EDGE_CORRELATION_MIN
    d = code_dir(tmp_path)
    params = params_from_card(card(), seed_for(OID, GENERATOR_VERSION))
    code_expected = encode(bake(params, W, H))["albedo.webp"]
    with Image.open(d / AI_FILE) as im:
        assert im.size == (W, H)  # resampled to 2:1
    meta = json.loads((d / AI_META).read_text(encoding="utf-8"))
    assert meta["tag"] == "artistic" and meta["label"] == "AI-made"
    body = out.to_json("/v1/objects/x/albedo-ai.webp")
    assert body["status"] == "applied" and body["missing"] == []
    assert body["layer"]["tag"] == "artistic" and body["layer"]["label"] == "AI-made"
    assert body["provenance"]["albedo_ai"]["tag"] == "artistic"
    assert body["provenance"]["edge_correlation"]["tag"] == "derived"
    assert body["provenance"]["edge_correlation"]["formula"]
    # The code albedo is untouched by the repaint (separate optional layer).
    assert (d / "albedo.webp").read_bytes() == code_expected
    # Prompt is R6.6 step 2 verbatim plus a palette; the reference is the greyscale hillshade.
    prompt, ref = fake.calls[0]
    assert prompt.startswith(gp.PROMPT_BASE) and "Palette: " in prompt
    with Image.open(io.BytesIO(ref)) as im:
        assert im.mode == "L" and im.size == (W, H)
    # Status lookup agrees, without calling Gemini again.
    st = p.status(OID)
    assert st.applied and len(fake.calls) == 1


def test_repaint_is_deterministic_and_served_from_cache(tmp_path: Path) -> None:
    fake = FakeClient(faithful)
    p = painter(tmp_path, fake)
    first = p.repaint(OID, card())
    a = (code_dir(tmp_path) / AI_FILE).read_bytes()
    second = p.repaint(OID, card())
    b = (code_dir(tmp_path) / AI_FILE).read_bytes()
    assert first.applied and second.applied and second.from_cache
    assert len(fake.calls) == 1  # D-25: the second call is a cache hit
    assert a == b
    # A fresh texture root and cache give byte-identical reference and output.
    other = painter(tmp_path / "again", FakeClient(faithful))
    assert other.repaint(OID, card()).applied
    again = bake_dir(
        tmp_path / "again" / "textures",
        OID,
        GENERATOR_VERSION,
        seed_for(OID, GENERATOR_VERSION),
        W,
        H,
    )
    assert (again / AI_FILE).read_bytes() == a
    assert fake.calls[0][1] == other.client.calls[0][1]  # type: ignore[union-attr]


# --- failures fall back to the code path ------------------------------------------------------


def test_low_edge_correlation_is_rejected(tmp_path: Path) -> None:
    out = painter(tmp_path, FakeClient(unrelated)).repaint(OID, card())
    assert_code_path(tmp_path, out, "low_edge_correlation")
    assert out.edge_correlation is not None and out.edge_correlation < EDGE_CORRELATION_MIN


@pytest.mark.parametrize(
    "error",
    [
        GeminiError("gemini_timeout", "no answer"),
        GeminiError("gemini_refused", "finish reason SAFETY"),
        GeminiError("gemini_http_500", "the API refused the call"),
        RuntimeError("boom"),
    ],
)
def test_call_failure_keeps_code(tmp_path: Path, error: Exception) -> None:
    out = painter(tmp_path, FakeClient(error)).repaint(OID, card())
    expected = error.reason if isinstance(error, GeminiError) else "gemini_unavailable"
    assert_code_path(tmp_path, out, expected)


def test_bad_image_keeps_code(tmp_path: Path) -> None:
    out = painter(tmp_path, FakeClient(lambda _: b"not an image")).repaint(OID, card())
    assert_code_path(tmp_path, out, "bad_image")


def test_no_key_keeps_code_and_never_calls(tmp_path: Path) -> None:
    out = painter(tmp_path, None, gemini_api_key=None).repaint(OID, card())
    assert_code_path(tmp_path, out, "gemini_key_missing")


def test_unbaked_type_and_refused_bake_are_reported(tmp_path: Path) -> None:
    star = card("star")
    out = painter(tmp_path, FakeClient(faithful)).repaint(star["id"], star)
    assert not out.applied and out.reason == "not_baked_type"
    c = card()
    c["diameter_km"]["value"] = None
    out = painter(tmp_path, FakeClient(faithful)).repaint(OID, c)
    assert out.reason == "bake_refused" and "albedo_ai" in out.missing


def test_flat_height_brown_dwarf_is_not_sent(tmp_path: Path) -> None:
    fake = FakeClient(faithful)
    bd = card("brown_dwarf")
    out = painter(tmp_path, fake).repaint(bd["id"], bd)
    assert out.reason == "flat_height" and fake.calls == []


# --- offline (D-24, D-25, Q-29) ---------------------------------------------------------------


def test_offline_default_is_off_even_with_a_cached_repaint(tmp_path: Path) -> None:
    online = painter(tmp_path, FakeClient(faithful))
    assert online.repaint(OID, card()).applied
    fake = FakeClient(faithful)
    off = painter(tmp_path, fake, offline=True)
    out = off.repaint(OID, card())
    assert out.reason == "offline" and fake.calls == []
    st = off.status(OID)
    assert not st.applied and st.reason == "offline"


def test_offline_with_cache_flag_serves_hit_and_refuses_miss(tmp_path: Path) -> None:
    online = painter(tmp_path, FakeClient(faithful))
    assert online.repaint(OID, card()).applied
    fake = FakeClient(faithful)
    off = painter(tmp_path, fake, offline=True, gemini_offline_cache=True)
    hit = off.repaint(OID, card())
    assert hit.applied and hit.from_cache and fake.calls == []
    miss = painter(tmp_path / "empty", fake, offline=True, gemini_offline_cache=True)
    out = miss.repaint(OID, card())
    assert out.reason == "offline" and fake.calls == []


def test_rest_client_refuses_network_offline(tmp_path: Path) -> None:
    from app.adapters.http import NetworkDisabled

    c = GeminiRestClient(settings(tmp_path, offline=True))
    with pytest.raises(NetworkDisabled):
        c.generate("p", b"x")


# --- image rules ----------------------------------------------------------------------------


def test_edge_correlation_identity_and_noise() -> None:
    rng = np.random.default_rng(1)
    a = rng.random((32, 64))
    assert gp.edge_correlation(a, a) == pytest.approx(1.0)
    assert gp.edge_correlation(a, np.zeros_like(a)) == 0.0
    assert abs(gp.edge_correlation(a, rng.random((32, 64)))) < EDGE_CORRELATION_MIN


def test_seam_fix_closes_the_seam_and_keeps_the_rest() -> None:
    rgb = np.zeros((8, 128, 3), dtype=np.uint8)
    rgb[:, :64] = 200  # hard step at the centre and at the wrap seam
    out = gp.seam_fix(rgb)
    seam_before = np.abs(rgb[:, 0].astype(int) - rgb[:, -1].astype(int)).max()
    seam_after = np.abs(out[:, 0].astype(int) - out[:, -1].astype(int)).max()
    assert seam_before == 200 and seam_after <= 1
    assert np.array_equal(out[:, 20:44], rgb[:, 20:44])  # outside the band: unchanged
    assert np.array_equal(gp.seam_fix(rgb), out)


def test_too_small_image_is_rejected() -> None:
    with pytest.raises(ValueError):
        gp.decode_to_grid(png_bytes(np.zeros((2, 1, 3), dtype=np.uint8)), W, H)


# --- REST client (MockTransport; [verify] request shape) -----------------------------------


def gemini_reply(image: bytes) -> dict[str, Any]:
    data = base64.b64encode(image).decode()
    return {
        "candidates": [
            {"content": {"parts": [{"inlineData": {"mimeType": "image/png", "data": data}}]}}
        ]
    }


def test_rest_client_sends_key_as_header_only(tmp_path: Path) -> None:
    seen: list[httpx.Request] = []
    img = png_bytes(np.full((4, 8, 3), 9, dtype=np.uint8))

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, json=gemini_reply(img))

    c = GeminiRestClient(settings(tmp_path), transport=httpx.MockTransport(handler))
    out = c.generate("prompt", b"\x89PNG")
    assert out.data == img and out.mime_type == "image/png"
    req = seen[0]
    assert req.method == "POST"
    assert req.headers["x-goog-api-key"] == SECRET
    assert SECRET not in str(req.url) and SECRET not in c.endpoint and SECRET not in repr(c)
    assert SECRET not in req.content.decode()


@pytest.mark.parametrize(
    ("reply", "reason"),
    [
        (httpx.Response(200, json={"promptFeedback": {"blockReason": "SAFETY"}}), "gemini_refused"),
        (httpx.Response(200, json={"candidates": [{"finishReason": "SAFETY"}]}), "gemini_refused"),
        (httpx.Response(200, json={"candidates": []}), "gemini_no_image"),
        (httpx.Response(200, content=b"<html>"), "gemini_bad_response"),
        (httpx.Response(400, json={"error": {"message": f"bad key {SECRET}"}}), "gemini_http_400"),
        (httpx.Response(503), "gemini_http_503"),
    ],
)
def test_rest_client_failures(tmp_path: Path, reply: httpx.Response, reason: str) -> None:
    c = GeminiRestClient(settings(tmp_path), transport=httpx.MockTransport(lambda _: reply))
    with pytest.raises(GeminiError) as info:
        c.generate("p", b"x")
    assert info.value.reason == reason
    assert SECRET not in str(info.value)


def test_rest_client_timeout(tmp_path: Path) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=req)

    c = GeminiRestClient(settings(tmp_path), transport=httpx.MockTransport(handler))
    with pytest.raises(GeminiError) as info:
        c.generate("p", b"x")
    assert info.value.reason == "gemini_timeout"


# --- API: admin token, key never exposed, swap in ------------------------------------------


@pytest.fixture
def api(fixture_cache: Path, tmp_path: Path) -> Iterator[TestClient]:
    s = make_settings(
        fixture_cache,
        textures_dir=tmp_path / "textures",
        admin_token=ADMIN,
        gemini_api_key=SECRET,
        gemini_offline_cache=True,  # offline fixtures; the painter below is online
    )
    with TestClient(create_app(s)) as c:
        yield c


def use_painter(client: TestClient, tmp_path: Path, fake: FakeClient | None, **kw: Any) -> None:
    app_s = client.app.state.ctx.settings  # type: ignore[attr-defined]
    s = app_s.model_copy(update={"offline": False, **kw})
    client.app.state.gemini = GeminiPainter(  # type: ignore[attr-defined]
        s, ReadThroughCache(tmp_path / "gemini-cache", offline=s.offline), fake, width=W, height=H
    )


def repaint(client: TestClient, oid: str, token: str | None = ADMIN) -> httpx.Response:
    headers = {"X-SX-Admin-Token": token} if token is not None else {}
    return client.post(f"/v1/admin/objects/{oid}/gemini-repaint", headers=headers)


def test_admin_token_gate(api: TestClient, tmp_path: Path) -> None:
    use_painter(api, tmp_path, FakeClient(faithful))
    oid = resolve_id(api, "433 Eros")
    assert repaint(api, oid, token=None).status_code == 403
    assert repaint(api, oid, token="wrong").status_code == 403
    assert repaint(api, oid, token=ADMIN + "x").status_code == 403
    assert repaint(api, oid).status_code == 200


def test_admin_endpoint_hidden_when_no_token_set(fixture_cache: Path, tmp_path: Path) -> None:
    for token in (None, "", "   "):
        s = make_settings(fixture_cache, textures_dir=tmp_path / "t", admin_token=token)
        with TestClient(create_app(s)) as c:
            r = c.post("/v1/admin/objects/x/gemini-repaint", headers={"X-SX-Admin-Token": ""})
            assert r.status_code == 404


def test_api_swaps_in_on_success_and_never_shows_the_key(
    api: TestClient, tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    use_painter(api, tmp_path, FakeClient(faithful))
    oid = resolve_id(api, "433 Eros")
    # Before: the code path only.
    st = api.get(f"/v1/objects/{oid}/albedo-ai")
    assert st.status_code == 200 and st.json()["status"] == "code"
    assert api.get(f"/v1/objects/{oid}/albedo-ai.webp").status_code == 404
    r = repaint(api, oid)
    body = r.json()
    assert body["status"] == "applied", body
    assert body["layer"] == {
        **body["layer"],
        "id": "albedo_ai",
        "tag": "artistic",
        "label": "AI-made",
    }
    img = api.get(body["albedo_url"])
    assert img.status_code == 200 and img.headers["content-type"] == "image/webp"
    with Image.open(io.BytesIO(img.content)) as im:
        assert im.size == (W, H)
    assert api.get(f"/v1/objects/{oid}/albedo-ai").json()["status"] == "applied"
    texts = [
        r.text,
        st.text,
        api.get("/v1/health").text,
        api.get("/openapi.json").text,
        caplog.text,
        repr(api.app.state.ctx.settings),
    ]  # type: ignore[attr-defined]
    assert all(SECRET not in t for t in texts)
    assert hashlib.sha256(img.content).hexdigest()


def test_api_failure_reports_code_path(api: TestClient, tmp_path: Path) -> None:
    use_painter(api, tmp_path, FakeClient(unrelated))
    oid = resolve_id(api, "433 Eros")
    body = repaint(api, oid).json()
    assert body["status"] == "code" and body["reason"] == "low_edge_correlation"
    assert body["missing"] == ["albedo_ai"] and "albedo_url" not in body
    assert body["detail"].startswith("Failed, using code")
    assert api.get(f"/v1/objects/{oid}/albedo-ai.webp").status_code == 404


def test_api_offline_default_keeps_code(api: TestClient, tmp_path: Path) -> None:
    fake = FakeClient(faithful)
    use_painter(api, tmp_path, fake, offline=True, gemini_offline_cache=False)
    oid = resolve_id(api, "433 Eros")
    body = repaint(api, oid).json()
    assert body["status"] == "code" and body["reason"] == "offline" and fake.calls == []


def test_rest_client_timeout_is_a_total_budget(tmp_path: Path) -> None:
    """A6.2 "a set time": a timeout is not retried, and backoff never runs past the budget."""
    calls: list[httpx.Request] = []

    def slow(req: httpx.Request) -> httpx.Response:
        calls.append(req)
        raise httpx.ReadTimeout("slow", request=req)

    s = settings(tmp_path, http_retries=3, gemini_timeout_s=5.0, http_backoff_s=1.0)
    c = GeminiRestClient(s, transport=httpx.MockTransport(slow), sleep=lambda _: None)
    with pytest.raises(GeminiError) as info:
        c.generate("p", b"x")
    assert info.value.reason == "gemini_timeout" and len(calls) == 1

    now = [0.0]
    sleeps: list[float] = []

    def busy(req: httpx.Request) -> httpx.Response:
        now[0] += 2.0  # each 503 takes 2 s
        return httpx.Response(503)

    def sleep(t: float) -> None:
        sleeps.append(t)
        now[0] += t

    c = GeminiRestClient(s, transport=httpx.MockTransport(busy), sleep=sleep, clock=lambda: now[0])
    with pytest.raises(GeminiError) as info:
        c.generate("p", b"x")
    assert info.value.reason == "gemini_http_503"
    assert now[0] <= 5.0 and sleeps == [1.0]  # 2 s + 1 s + 2 s; a 2 s backoff would overrun


def test_write_failure_keeps_code(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(path: Path, data: bytes) -> None:
        raise PermissionError("locked")

    monkeypatch.setattr(gp, "atomic_write", boom)
    out = painter(tmp_path, FakeClient(faithful)).repaint(OID, card())
    assert_code_path(tmp_path, out, "write_failed")


def test_admin_token_with_surrounding_whitespace(fixture_cache: Path, tmp_path: Path) -> None:
    s = make_settings(fixture_cache, textures_dir=tmp_path / "t", admin_token=f"  {ADMIN}\n")
    with TestClient(create_app(s)) as c:
        url = "/v1/admin/objects/x/gemini-repaint"
        assert c.post(url, headers={"X-SX-Admin-Token": "wrong"}).status_code == 403
        r = c.post(url, headers={"X-SX-Admin-Token": ADMIN})
        assert r.status_code == 404 and "Unknown object" in r.text  # past the gate


# --- review fixes ---------------------------------------------------------------------------


def test_repaint_uses_the_render_params_seed(tmp_path: Path) -> None:
    """A saved asset carries its own seed: the repaint must land on that bake (the one the
    viewer's texture URLs point at), not on one derived from the URL id."""
    c = card()
    p = painter(tmp_path, FakeClient(faithful))
    out = p.repaint("some-url-id", c, {"seed": 7, "generator_version": GENERATOR_VERSION})
    assert out.applied, out.detail
    d = bake_dir(tmp_path / "textures", c["id"], GENERATOR_VERSION, 7, W, H)
    assert out.code_dir == d and (d / AI_FILE).is_file()
    expected = encode(bake(params_from_card(c, 7), W, H))
    assert (d / "height.bin").read_bytes() == expected["height.bin"]
    assert p.status("some-url-id").applied


def test_failed_refresh_is_reported_not_hidden(tmp_path: Path) -> None:
    fake = FakeClient(faithful)
    p = painter(tmp_path, fake)
    assert p.repaint(OID, card()).applied
    fake.make = GeminiError("gemini_http_503", "the API refused the call")
    out = p.repaint(OID, card(), refresh=True)
    assert not out.applied and out.reason == "gemini_http_503"


def test_rejected_image_is_not_cached(tmp_path: Path) -> None:
    fake = FakeClient(unrelated)
    p = painter(tmp_path, fake)
    assert p.repaint(OID, card()).reason == "low_edge_correlation"
    fake.make = faithful
    out = p.repaint(OID, card())  # no refresh needed: nothing bad was cached
    assert out.applied and not out.from_cache and len(fake.calls) == 2


def test_gemini_call_holds_no_cache_lock(tmp_path: Path) -> None:
    p = painter(tmp_path, None)

    class Probe(FakeClient):
        def generate(self, prompt: str, reference_png: bytes) -> GeminiImage:
            for lock in p.cache._locks:
                assert lock.acquire(blocking=False), "a cache stripe is held during the call"
                lock.release()
            return super().generate(prompt, reference_png)

    p.client = Probe(faithful)
    assert p.repaint(OID, card()).applied


def test_status_is_stale_after_a_rebake(tmp_path: Path) -> None:
    p = painter(tmp_path, FakeClient(faithful))
    assert p.repaint(OID, card()).applied
    meta = code_dir(tmp_path) / "bake.json"
    meta.write_text(json.dumps({"key": "another-bake"}), encoding="utf-8")
    st = p.status(OID)
    assert not st.applied and st.reason == "stale"


def test_connect_timeout_is_retried(tmp_path: Path) -> None:
    img = png_bytes(np.full((4, 8, 3), 9, dtype=np.uint8))
    calls: list[httpx.Request] = []

    def flaky(req: httpx.Request) -> httpx.Response:
        calls.append(req)
        if len(calls) == 1:
            raise httpx.ConnectTimeout("stalled", request=req)
        return httpx.Response(200, json=gemini_reply(img))

    s = settings(tmp_path, http_retries=2, gemini_timeout_s=90.0, http_backoff_s=0.0)
    c = GeminiRestClient(s, transport=httpx.MockTransport(flaky), sleep=lambda _: None)
    assert c.generate("p", b"x").data == img and len(calls) == 2


def test_hillshade_is_none_when_flat() -> None:
    assert gp.hillshade(np.zeros((8, 16)), 1000.0) is None

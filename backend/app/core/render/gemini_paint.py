"""Optional Gemini repaint of the baked albedo (R6.6, D-07, A6.2). Stretch, behind the admin token.

Order (UML 12):

1. Bake first (``bake_to_cache``): the code colour (R6.4) is always on disk and loads first.
2. Hillshade of the baked height map (``height.bin``, the one height field).
3. Gemini, server-side only, through the D-25 read-through cache.
4. Resample to 2:1; Sobel-edge correlation with the hillshade; below 0.3 is rejected (D-07).
5. Seam fix (roll W/2, blend a 32 px band, roll back), then ``albedo_ai.webp`` + ``gemini.json``
   beside the code maps. Tag ``artistic``, label "AI-made".

Every failure (no key, offline, timeout, refusal, bad image, low correlation, refused bake) keeps
the code colour and returns the reason; nothing here raises for those. The API key is only ever
sent as a request header and is never returned, logged or written to the cache.
"""

from __future__ import annotations

import base64
import binascii
import colorsys
import hashlib
import io
import json
import math
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

import httpx
import numpy as np
from numpy.typing import NDArray
from PIL import Image

from app.adapters.http import RETRY_STATUS, USER_AGENT, NetworkDisabled
from app.cache.keys import CacheKey
from app.cache.store import CacheEntry, LiveResponse, ReadThroughCache, atomic_write
from app.core.render.bake import META, bake_key, bake_to_cache, png_image, webp_rgb
from app.core.render.card_to_params import (
    GENERATOR_VERSION,
    TEXTURE_HEIGHT,
    TEXTURE_WIDTH,
    seed_for,
)
from app.core.render.noise import F64
from app.core.render.normals import normal_vectors
from app.core.render.params import BAKED_TYPES, BakeParams, BakeRefusal, params_from_card
from app.settings import Settings, secret_text

# Bump when a rule in this module changes (prompt, hillshade, check, seam fix): it is part of the
# cache key and of gemini.json, so an old repaint is not reused under new rules.
PAINT_VERSION = "1"

LAYER_ID = "albedo_ai"
TAG = "artistic"
LABEL = "AI-made"  # D-07, A6.2
FAILED_TEXT = "Failed, using code"  # A6.2
EDGE_CORRELATION_MIN = 0.3  # D-07 / R6.6 step 4
SEAM_BAND_PX = 32  # R6.6 step 5
# ASSUMPTION: where the AI albedo is written (UML 12 marks the path [verify]): beside the code
# maps in the R6.7 size directory, so a rebake (new bake.json key) removes it with them.
AI_FILE = "albedo_ai.webp"
AI_META = "gemini.json"
# Per-object pointer to the last applied repaint, so the status and image endpoints need no card
# build: ``<texture root>/.gemini/<sha256(object id)>.json``. ASSUMPTION (Q-87).
POINTER_DIR = ".gemini"
CACHE_SOURCE = "gemini"
# Hillshade light (artistic, R6.6 gives none): from the north-west, 45 degrees up.
HILLSHADE_AZIMUTH_DEG = 315.0
HILLSHADE_ALTITUDE_DEG = 45.0
# ASSUMPTION: refuse decoded images above this many pixels (decompression-bomb guard).
MAX_IMAGE_PIXELS = 4096 * 4096

EDGE_FORMULA = (
    "Pearson correlation of Sobel gradient magnitudes (longitude wraps) of the hillshade and of "
    "the output's Rec. 709 luminance (linear), on the 2:1 grid of the baked maps"
)

# The R6.6 step 2 prompt, verbatim, with the palette appended.
PROMPT_BASE = (
    "Paint albedo only. Keep the exact equirectangular layout and every terrain feature in "
    "place. No lighting, no shadows, no stars, no text."
)

# Finish reasons that mean the model refused rather than failed. [verify] against the API docs.
_REFUSAL_FINISH = frozenset(
    {"SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "IMAGE_SAFETY", "RECITATION"}
)


# --- pure image functions (deterministic) ---------------------------------------------------


def hillshade(h: F64, radius_m: float) -> F64 | None:
    """Hillshade in [0, 1] from the R6.5 normals (no colour), min-max stretched.

    None when the map is flat (nothing to align to). Same height, same bytes.
    """
    n = normal_vectors(h, radius_m)
    az = math.radians(HILLSHADE_AZIMUTH_DEG)
    alt = math.radians(HILLSHADE_ALTITUDE_DEG)
    light = np.array([math.cos(alt) * math.sin(az), math.cos(alt) * math.cos(az), math.sin(alt)])
    shade: F64 = np.clip(n @ light, 0.0, 1.0)
    lo, hi = float(shade.min()), float(shade.max())
    if hi - lo < 1e-9:
        return None
    return (shade - lo) / (hi - lo)


def to_png_gray(x: F64) -> bytes:
    """[0, 1] -> 8-bit greyscale PNG (the baker's encoder), so equal inputs give equal bytes."""
    return png_image(np.rint(np.clip(x, 0.0, 1.0) * 255).astype(np.uint8), "L")


def sobel_magnitude(img: F64) -> F64:
    """|Sobel gradient|; columns wrap (longitude), rows are edge-padded (poles)."""
    p = np.pad(img, ((1, 1), (0, 0)), mode="edge")
    rows = img.shape[0]

    def at(dr: int, dc: int) -> F64:
        return np.roll(p[1 + dr : 1 + dr + rows], -dc, axis=1)

    gx = (at(-1, 1) + 2 * at(0, 1) + at(1, 1)) - (at(-1, -1) + 2 * at(0, -1) + at(1, -1))
    gy = (at(1, -1) + 2 * at(1, 0) + at(1, 1)) - (at(-1, -1) + 2 * at(-1, 0) + at(-1, 1))
    return np.hypot(gx, gy)


def luminance(rgb: NDArray[np.uint8]) -> F64:
    """Rec. 709 luminance of sRGB pixels, after the IEC 61966-2-1 decode."""
    s = rgb.astype(np.float64) / 255.0
    lin = np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4)
    out: F64 = lin @ np.array([0.2126, 0.7152, 0.0722])
    return out


def edge_correlation(a: F64, b: F64) -> float:
    """``EDGE_FORMULA``. 0.0 when either edge map is constant (nothing to align)."""
    ea = sobel_magnitude(a).ravel()
    eb = sobel_magnitude(b).ravel()
    sa, sb = float(ea.std()), float(eb.std())
    if sa < 1e-12 or sb < 1e-12:
        return 0.0
    r = float(np.mean((ea - ea.mean()) * (eb - eb.mean())) / (sa * sb))
    return max(-1.0, min(1.0, r))


def seam_fix(rgb: NDArray[np.uint8], band_px: int = SEAM_BAND_PX) -> NDArray[np.uint8]:
    """R6.6 step 5: roll by W/2, blend the step across a ``band_px`` band, roll back.

    The step between the two columns of the old seam is spread linearly over half the band on
    each side, so the two edges meet and the detail inside the band is kept.
    """
    w = rgb.shape[1]
    half = min(band_px // 2, w // 4)
    if half < 1:
        return rgb.copy()
    shift = w // 2
    a = np.roll(rgb.astype(np.float64), shift, axis=1)
    c = shift  # the old seam now lies between columns c - 1 and c
    step = a[:, c] - a[:, c - 1]
    for k in range(1, half + 1):
        weight = 0.5 * (half - k + 1) / half
        a[:, c - k] += step * weight
        a[:, c + k - 1] -= step * weight
    out = np.rint(np.clip(a, 0.0, 255.0)).astype(np.uint8)
    return np.roll(out, -shift, axis=1)


def decode_to_grid(data: bytes, width: int, height: int) -> NDArray[np.uint8]:
    """Decode the model's image and resample it to the 2:1 map grid (R6.6 step 3).

    Raises ``ValueError`` for anything that is not a usable image.
    """
    try:
        with Image.open(io.BytesIO(data)) as img:
            if img.width * img.height > MAX_IMAGE_PIXELS or img.width < 2 or img.height < 2:
                raise ValueError(f"image size {img.width}x{img.height} not accepted")
            rgb = img.convert("RGB")
    except (OSError, Image.DecompressionBombError, SyntaxError) as exc:
        raise ValueError(f"not a readable image: {type(exc).__name__}") from exc
    if rgb.size != (width, height):
        rgb = rgb.resize((width, height), Image.Resampling.LANCZOS)
    return np.asarray(rgb, dtype=np.uint8).copy()


# --- prompt ---------------------------------------------------------------------------------


def colour_words(linear_rgb: tuple[float, float, float]) -> str:
    """Linear RGB -> a few plain words (artistic; R6.6 "<base_rgb as words>")."""
    lin = np.clip(np.array(linear_rgb, dtype=np.float64), 0.0, 1.0)
    s = np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * lin ** (1 / 2.4) - 0.055)
    hue, sat, val = colorsys.rgb_to_hsv(float(s[0]), float(s[1]), float(s[2]))
    shade = "dark" if val < 0.35 else "light" if val > 0.7 else "medium"
    if sat < 0.12:
        return f"{shade} grey"
    deg = hue * 360.0
    if deg < 15 or deg >= 330:
        name = "red"
    elif deg < 45:
        name = "brown" if val < 0.6 else "orange"
    elif deg < 70:
        name = "ochre" if val < 0.6 else "yellow"
    elif deg < 170:
        name = "green"
    elif deg < 260:
        name = "blue"
    else:
        name = "purple"
    if sat < 0.3:
        name = f"greyish {name}"
    return f"{shade} {name}"


def build_prompt(p: BakeParams) -> str:
    """R6.6 step 2 from the generator parameters (no physical number is produced here)."""
    base = tuple(min(1.0, max(0.0, c * p.brightness)) for c in p.base_rgb)
    notes = [colour_words((base[0], base[1], base[2]))]
    if p.hydration:
        notes.append("muted, slightly darker hydrated tones")
    if p.redness > 0:
        notes.append("a slight reddish tint")
    return f"{PROMPT_BASE} Palette: {', '.join(notes)}."


# --- client ---------------------------------------------------------------------------------


class GeminiError(Exception):
    """One failed call. ``reason`` is a short code for ``missing`` / the status reply."""

    def __init__(self, reason: str, detail: str) -> None:
        super().__init__(f"{reason}: {detail}")
        self.reason = reason
        self.detail = detail


@dataclass(frozen=True)
class GeminiImage:
    data: bytes
    mime_type: str


class ImageClient(Protocol):
    """What the painter needs from Gemini. Tests inject a fake; nothing else calls Gemini."""

    @property
    def model(self) -> str: ...

    @property
    def endpoint(self) -> str:
        """The request URL without any credential (stored in the cache meta)."""
        ...

    def generate(self, prompt: str, reference_png: bytes) -> GeminiImage: ...


class GeminiRestClient:
    """REST call to the Gemini image model.

    [verify] R12 #3: the URL pattern ``{base}/models/{model}:generateContent``, the
    ``x-goog-api-key`` header, the request body (text + ``inline_data`` image part,
    ``generationConfig.responseModalities``, ``imageConfig.aspectRatio``) and the response
    shape (``candidates[].content.parts[].inlineData``) are not in the specs and have not been
    checked against the Gemini docs. Only this class depends on them.
    """

    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._settings = settings
        self._key = secret_text(settings.gemini_api_key)
        if not self._key:
            raise ValueError("SX_GEMINI_API_KEY is not set")
        self._transport = transport
        self._sleep = sleep
        self._clock = clock

    def __repr__(self) -> str:  # never show the key
        return f"GeminiRestClient(model={self.model!r})"

    @property
    def model(self) -> str:
        return self._settings.gemini_model

    @property
    def endpoint(self) -> str:
        return f"{self._settings.gemini_api_url.rstrip('/')}/models/{self.model}:generateContent"

    def _body(self, prompt: str, reference_png: bytes) -> dict[str, Any]:
        config: dict[str, Any] = {"responseModalities": ["IMAGE"]}
        if self._settings.gemini_aspect_ratio:
            config["imageConfig"] = {"aspectRatio": self._settings.gemini_aspect_ratio}
        return {
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {"text": prompt},
                        {
                            "inline_data": {
                                "mime_type": "image/png",
                                "data": base64.b64encode(reference_png).decode("ascii"),
                            }
                        },
                    ],
                }
            ],
            "generationConfig": config,
        }

    def generate(self, prompt: str, reference_png: bytes) -> GeminiImage:
        s = self._settings
        if s.offline:
            raise NetworkDisabled("SX_OFFLINE=1: refusing to call Gemini")
        headers = {
            "x-goog-api-key": self._key,
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        }
        body = self._body(prompt, reference_png)
        # A6.2 "no answer in a set time": SX_GEMINI_TIMEOUT_S bounds the whole call, retries and
        # backoff included (httpx's read timeout alone is per read, so retries would multiply it).
        budget = s.gemini_timeout_s
        deadline = self._clock() + budget
        attempts = 1 + max(0, s.http_retries)
        last = GeminiError("gemini_unreachable", "no attempt")
        timed_out = GeminiError("gemini_timeout", f"no answer in {budget:g} s")
        with httpx.Client(transport=self._transport) as client:
            for attempt in range(attempts):
                if attempt:
                    wait = s.http_backoff_s * 2 ** (attempt - 1)
                    if self._clock() + wait >= deadline:
                        break
                    self._sleep(wait)
                remaining = deadline - self._clock()
                if remaining <= 0:
                    last = timed_out
                    break
                timeout = httpx.Timeout(remaining, connect=min(s.http_connect_timeout_s, remaining))
                try:
                    resp = client.post(self.endpoint, json=body, headers=headers, timeout=timeout)
                except (httpx.ConnectTimeout, httpx.PoolTimeout) as exc:
                    # Capped at the connect timeout, so budget is usually left: retry.
                    last = GeminiError(
                        "gemini_timeout", f"could not connect ({type(exc).__name__})"
                    )
                    continue
                except httpx.TimeoutException:
                    # A read or write timeout is set to the time left, so the budget is spent.
                    last = timed_out
                    break
                except httpx.TransportError as exc:
                    # The exception text never holds the key: it is sent as a header only.
                    last = GeminiError("gemini_unreachable", type(exc).__name__)
                    continue
                if resp.status_code == 200:
                    return parse_response(resp.content)
                # Do not echo the body: an error body could quote the request.
                last = GeminiError(f"gemini_http_{resp.status_code}", "the API refused the call")
                if resp.status_code not in RETRY_STATUS:
                    break
        raise last


def parse_response(content: bytes) -> GeminiImage:
    """First inline image of the first candidate. [verify] shape, see ``GeminiRestClient``."""
    try:
        doc = json.loads(content)
    except ValueError as exc:
        raise GeminiError("gemini_bad_response", "reply is not JSON") from exc
    if not isinstance(doc, dict):
        raise GeminiError("gemini_bad_response", "reply is not an object")
    feedback = doc.get("promptFeedback")
    if isinstance(feedback, dict) and feedback.get("blockReason"):
        raise GeminiError("gemini_refused", f"prompt blocked: {feedback.get('blockReason')}")
    candidates = doc.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise GeminiError("gemini_no_image", "no candidates in the reply")
    first = candidates[0] if isinstance(candidates[0], dict) else {}
    content_obj = first.get("content")
    parts = content_obj.get("parts") if isinstance(content_obj, dict) else None
    for part in parts if isinstance(parts, list) else []:
        if not isinstance(part, dict):
            continue
        inline = part.get("inlineData") or part.get("inline_data")
        if not isinstance(inline, dict) or not isinstance(inline.get("data"), str):
            continue
        mime = inline.get("mimeType") or inline.get("mime_type") or "application/octet-stream"
        try:
            data = base64.b64decode(inline["data"], validate=True)
        except (binascii.Error, ValueError) as exc:
            raise GeminiError("gemini_bad_response", "image data is not base64") from exc
        return GeminiImage(data=data, mime_type=str(mime))
    finish = str(first.get("finishReason", ""))
    if finish in _REFUSAL_FINISH:
        raise GeminiError("gemini_refused", f"finish reason {finish}")
    raise GeminiError("gemini_no_image", f"no image part (finish reason {finish or 'none'})")


# --- painter --------------------------------------------------------------------------------


@dataclass(frozen=True)
class PaintTarget:
    """The bake the viewer shows: the card plus the RenderParams ``seed`` and
    ``generator_version`` (R3.4). A saved or pre-baked asset carries its own seed, so the
    painter must use it, not one derived from the URL id."""

    card: Mapping[str, Any]
    seed: int
    generator_version: str

    @property
    def bake_id(self) -> str:
        return str(self.card["id"])

    @classmethod
    def of(
        cls, card: Mapping[str, Any], render_params: Mapping[str, Any] | None = None
    ) -> PaintTarget:
        rp = render_params or {}
        raw_version = rp.get("generator_version")
        version = raw_version if isinstance(raw_version, str) and raw_version else GENERATOR_VERSION
        seed = rp.get("seed")
        if not isinstance(seed, int) or isinstance(seed, bool):
            seed = seed_for(str(card["id"]), version)
        return cls(card, seed, version)


@dataclass(frozen=True)
class PaintOutcome:
    """Result of a repaint or a status lookup. ``applied`` False means the code colour shows."""

    object_id: str
    applied: bool
    reason: str | None = None
    detail: str = ""
    model: str = ""
    edge_correlation: float | None = None
    fetched_at: str | None = None
    from_cache: bool = False
    ai_path: Path | None = None
    code_dir: Path | None = None
    extra_missing: tuple[str, ...] = field(default_factory=tuple)
    # The verified AI albedo bytes (status only), so the image route serves what was checked.
    ai_bytes: bytes | None = field(default=None, repr=False, compare=False)

    @property
    def missing(self) -> list[str]:
        return [] if self.applied else [LAYER_ID, *self.extra_missing]

    def to_json(self, albedo_url: str) -> dict[str, Any]:
        corr = None if self.edge_correlation is None else round(self.edge_correlation, 4)
        body: dict[str, Any] = {
            "id": self.object_id,
            "status": "applied" if self.applied else "code",
            "model": self.model,
            "edge_correlation": corr,
            "edge_correlation_min": EDGE_CORRELATION_MIN,
            "reason": self.reason,
            "detail": self.detail if not self.applied else LABEL,
            "missing": self.missing,
            "cached_at": self.fetched_at,
            "from_cache": self.from_cache,
            "provenance": {
                "edge_correlation": {"tag": "derived", "formula": EDGE_FORMULA},
            },
        }
        if self.applied:
            body["albedo_url"] = albedo_url
            body["layer"] = {
                "id": LAYER_ID,
                "tag": TAG,
                "label": LABEL,
                "description": (
                    f"Albedo repainted by {self.model} from a hillshade of the baked height map "
                    "(R6.6); relief, normals, haptics and sound still use the code height map."
                ),
                "requires": ["height"],
            }
            body["provenance"]["albedo_ai"] = {
                "tag": TAG,
                "source": f"Gemini {self.model}, artist's version, not data",
            }
        return body


@dataclass(frozen=True)
class _Reject:
    reason: str
    detail: str
    edge_correlation: float | None = None


class GeminiPainter:
    """Runs R6.6 for one object. ``client`` is None when no key is set (layer off)."""

    def __init__(
        self,
        settings: Settings,
        cache: ReadThroughCache,
        client: ImageClient | None,
        *,
        width: int = TEXTURE_WIDTH,
        height: int = TEXTURE_HEIGHT,
    ) -> None:
        self.settings = settings
        self.cache = cache
        self.client = client
        self.width = width
        self.height = height
        # One Gemini call at a time (admin only, paid, slow). This is the painter's own lock, so
        # a slow call never holds one of the cache's shared stripes.
        self._call_lock = threading.Lock()

    @property
    def model(self) -> str:
        return self.client.model if self.client is not None else self.settings.gemini_model

    def _fail(self, object_id: str, reason: str, detail: str, **kw: Any) -> PaintOutcome:
        return PaintOutcome(
            object_id, False, reason, f"{FAILED_TEXT}: {detail}", model=self.model, **kw
        )

    def _offline_blocked(self) -> bool:
        return self.settings.offline and not self.settings.gemini_offline_cache

    def _params(self, object_id: str, t: PaintTarget) -> BakeParams | PaintOutcome:
        if t.card.get("type") not in BAKED_TYPES:
            return self._fail(
                object_id, "not_baked_type", f"type {t.card.get('type')!r} has no baked albedo"
            )
        try:
            return params_from_card(t.card, t.seed)
        except BakeRefusal as exc:
            return self._fail(
                object_id, "bake_refused", exc.reason, extra_missing=tuple(exc.missing)
            )

    def _pointer(self, object_id: str) -> Path:
        name = hashlib.sha256(object_id.encode("utf-8")).hexdigest()
        return self.settings.texture_root / POINTER_DIR / f"{name}.json"

    def _check(self, data: bytes, shade: F64) -> tuple[NDArray[np.uint8], float] | _Reject:
        """R6.6 steps 3 and 4: decode to the 2:1 grid, then the D-07 edge check."""
        try:
            rgb = decode_to_grid(data, self.width, self.height)
        except ValueError as exc:
            return _Reject("bad_image", str(exc))
        corr = edge_correlation(shade, luminance(rgb))
        if not corr >= EDGE_CORRELATION_MIN:  # also rejects NaN
            return _Reject(
                "low_edge_correlation",
                f"edge correlation {corr:.3f} is below {EDGE_CORRELATION_MIN}",
                corr,
            )
        return rgb, corr

    def _reject(self, object_id: str, r: _Reject, out: Path) -> PaintOutcome:
        return self._fail(
            object_id, r.reason, r.detail, edge_correlation=r.edge_correlation, code_dir=out
        )

    def _call(
        self, object_id: str, prompt: str, reference: bytes, shade: F64, key: CacheKey, out: Path
    ) -> tuple[CacheEntry, NDArray[np.uint8], float] | PaintOutcome:
        """One live Gemini call. The image is checked first and cached only if it passes."""
        client = self.client
        assert client is not None
        try:
            img = client.generate(prompt, reference)
        except GeminiError as exc:
            return self._fail(object_id, exc.reason, exc.detail, code_dir=out)
        except NetworkDisabled:
            return self._fail(object_id, "offline", "network disabled", code_dir=out)
        except Exception as exc:  # any other failed call keeps the code colour
            return self._fail(object_id, "gemini_unavailable", type(exc).__name__, code_dir=out)
        checked = self._check(img.data, shade)
        if isinstance(checked, _Reject):  # not cached: the next call asks Gemini again
            return self._reject(object_id, checked, out)
        live = LiveResponse(
            body=img.data,
            url=client.endpoint,
            status=200,
            content_type=img.mime_type,
            extra={"model": client.model},
        )
        try:
            entry = self.cache.put(key, live)
        except OSError as exc:
            return self._fail(
                object_id,
                "write_failed",
                type(exc).__name__,
                edge_correlation=checked[1],
                code_dir=out,
            )
        return entry, checked[0], checked[1]

    def repaint(
        self,
        object_id: str,
        card: Mapping[str, Any],
        render_params: Mapping[str, Any] | None = None,
        *,
        refresh: bool = False,
    ) -> PaintOutcome:
        """Repaint the bake ``render_params`` points at (its seed and generator version).

        D-25 order, with one change: an image is stored in the cache only after it passes the
        checks, so a rejected image is never replayed. ``refresh`` skips the cache; if that
        live call fails, the failure is reported (the old entry is not served in its place).
        """
        t = PaintTarget.of(card, render_params)
        p = self._params(object_id, t)
        if isinstance(p, PaintOutcome):
            return p
        root = self.settings.texture_root
        # Code path first: the deterministic maps are on disk before Gemini is asked.
        try:
            out = bake_to_cache(p, root, t.bake_id, t.generator_version, self.width, self.height)
            raw = np.frombuffer((out / "height.bin").read_bytes(), dtype="<f2")
        except OSError as exc:
            return self._fail(object_id, "bake_failed", type(exc).__name__)
        h = raw.astype(np.float64).reshape(self.height, self.width)
        shade = hillshade(h, p.radius_m)
        if shade is None:
            return self._fail(
                object_id,
                "flat_height",
                "the height map is flat, nothing to align to",
                code_dir=out,
            )
        if self.client is None:
            return self._fail(
                object_id, "gemini_key_missing", "no Gemini key on the server", code_dir=out
            )
        if self._offline_blocked():
            return self._fail(
                object_id,
                "offline",
                "SX_OFFLINE=1, the Gemini layer is off (D-24, Q-29)",
                code_dir=out,
            )
        model = self.client.model
        reference = to_png_gray(shade)
        prompt = build_prompt(p)
        key = CacheKey.make(
            CACHE_SOURCE,
            None,
            model=model,
            aspect=self.settings.gemini_aspect_ratio,
            paint=PAINT_VERSION,
            prompt_sha256=hashlib.sha256(prompt.encode()).hexdigest(),
            reference_sha256=hashlib.sha256(reference).hexdigest(),
        )

        entry = None if refresh else self.cache.get(key)
        if entry is None and self.settings.offline:
            return self._fail(object_id, "offline", "not in the offline cache", code_dir=out)
        fresh: tuple[CacheEntry, NDArray[np.uint8], float] | None = None
        if entry is None:
            with self._call_lock:
                entry = None if refresh else self.cache.get(key)  # another call may have won
                if entry is None:
                    called = self._call(object_id, prompt, reference, shade, key, out)
                    if isinstance(called, PaintOutcome):
                        return called
                    fresh = called
        if fresh is not None:
            entry, rgb, corr = fresh
        else:
            assert entry is not None
            checked = self._check(entry.body, shade)
            if isinstance(checked, _Reject):
                self.cache.delete(key)  # never keep an entry that fails the checks
                return self._reject(object_id, checked, out)
            rgb, corr = checked
        fetched_at = str(entry.meta.get("fetched_at"))
        common: dict[str, Any] = {
            "code_dir": out,
            "fetched_at": fetched_at,
            "from_cache": fresh is None,
        }
        data = webp_rgb(seam_fix(rgb))
        current = bake_key(p, self.width, self.height)
        meta = {
            "paint_version": PAINT_VERSION,
            "bake_key": current,
            "tag": TAG,
            "label": LABEL,
            "model": model,
            "prompt": prompt,
            "edge_correlation": corr,
            "reference_sha256": hashlib.sha256(reference).hexdigest(),
            "source_sha256": entry.meta.get("body_sha256"),
            "albedo_sha256": hashlib.sha256(data).hexdigest(),
            "fetched_at": fetched_at,
        }
        pointer = {
            "paint_version": PAINT_VERSION,
            "dir": out.relative_to(root).as_posix(),
            "bake_key": current,
        }
        try:
            # Image, then meta, then the pointer (commit marker). If a later write fails, the
            # hashes or keys no longer agree, so status() reports "stale" (code colour).
            atomic_write(out / AI_FILE, data)
            atomic_write(out / AI_META, json.dumps(meta, indent=1, sort_keys=True).encode())
            atomic_write(self._pointer(object_id), json.dumps(pointer, sort_keys=True).encode())
        except OSError as exc:
            return self._fail(
                object_id, "write_failed", type(exc).__name__, edge_correlation=corr, **common
            )
        return PaintOutcome(
            object_id,
            True,
            model=model,
            edge_correlation=corr,
            ai_path=out / AI_FILE,
            **common,
        )

    def status(self, object_id: str) -> PaintOutcome:
        """What the viewer should show now: no card build, no bake, no Gemini call.

        Reads the pointer of the last applied repaint and checks it against the bake on disk:
        a rebake (new ``bake.json`` key) or a torn write makes it ``stale``.
        """
        root = self.settings.texture_root
        try:
            ptr = json.loads(self._pointer(object_id).read_text(encoding="utf-8"))
            out = root / str(ptr["dir"])
            if not out.resolve().is_relative_to(root.resolve()):
                raise ValueError("pointer leaves the texture root")
            bake_meta = json.loads((out / META).read_text(encoding="utf-8"))
            meta = json.loads((out / AI_META).read_text(encoding="utf-8"))
            data = (out / AI_FILE).read_bytes()
        except (OSError, ValueError, KeyError, TypeError):
            return self._fail(object_id, "not_painted", "no AI albedo for this bake")
        valid = (
            isinstance(bake_meta, dict)
            and isinstance(meta, dict)
            and ptr.get("paint_version") == PAINT_VERSION
            and meta.get("paint_version") == PAINT_VERSION
            and bake_meta.get("key") == ptr.get("bake_key")
            and meta.get("bake_key") == ptr.get("bake_key")
            and meta.get("albedo_sha256") == hashlib.sha256(data).hexdigest()
        )
        if not valid:
            return self._fail(object_id, "stale", "the AI albedo is from another bake")
        corr = meta.get("edge_correlation")
        corr_f = float(corr) if isinstance(corr, (int, float)) else None
        if self._offline_blocked():
            return self._fail(
                object_id,
                "offline",
                "SX_OFFLINE=1, the Gemini layer is off (D-24, Q-29)",
                edge_correlation=corr_f,
            )
        return PaintOutcome(
            object_id,
            True,
            model=str(meta.get("model", "")),
            edge_correlation=corr_f,
            fetched_at=meta.get("fetched_at"),
            from_cache=True,
            ai_path=out / AI_FILE,
            code_dir=out,
            ai_bytes=data,
        )


def make_client(
    settings: Settings, *, transport: httpx.BaseTransport | None = None
) -> ImageClient | None:
    """The REST client when a key is set, else None (layer off)."""
    if not secret_text(settings.gemini_api_key):
        return None
    return GeminiRestClient(settings, transport=transport)

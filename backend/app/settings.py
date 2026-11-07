"""Backend settings, read from ``SX_*`` environment variables (D-25, A10)."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


def secret_text(value: SecretStr | None) -> str:
    """A secret setting as plain text, surrounding whitespace removed ("" when unset or blank).

    One rule for every secret (admin token, Gemini key): a trailing newline from a .env file
    must not make a token unmatchable or a key look set.
    """
    return value.get_secret_value().strip() if value is not None else ""


def default_cache_dir() -> Path:
    """Cache location outside the repo (D-25: the cache lives outside git)."""
    local = os.environ.get("LOCALAPPDATA")
    if os.name == "nt" and local:
        return Path(local) / "ShiftSpectrum" / "cache"
    xdg = os.environ.get("XDG_CACHE_HOME")
    base = Path(xdg) if xdg else Path.home() / ".cache"
    return base / "shift-spectrum"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SX_", extra="ignore")

    offline: bool = False
    cache_dir: Path = Field(default_factory=default_cache_dir)
    data_release: str = "spherex_qr2"

    http_connect_timeout_s: float = 10.0
    http_read_timeout_s: float = 60.0
    http_retries: int = 3
    http_backoff_s: float = 1.0

    sia_url: str = "https://irsa.ipac.caltech.edu/SIA"
    sia_radius_deg: float = 0.001
    # [verify] 2000 timed out on 5 Nov 2026; 500 not yet confirmed.
    sia_maxrec: int = 500
    # Display choice (about 58 px at 6.15 arcsec/px), not a physical value.
    cutout_size_arcsec: float = 360.0
    # A web request downloads at most this many cutouts live; the rest are listed as
    # `cutouts:deferred:<n>` (one cutout is about 5 MB on the wire). The pre-fetch has no cap.
    live_cutouts_per_request: int = 24
    # A cutout whose live download failed is not retried by web requests for this long, so
    # it cannot use up the live budget on every request. The pre-fetch always retries.
    live_failure_ttl_s: float = 600.0
    # Q-20: the PSF extension (about 5 MB per cutout) is not cached by default.
    cutout_keep_psf: bool = False

    # Comma-separated, tried in order. The CDS host was unreachable from the dev machine.
    simbad_tap_urls: str = (
        "https://simbad.cds.unistra.fr/simbad/sim-tap/sync,"
        "https://simbad.harvard.edu/simbad/sim-tap/sync"
    )
    sbdb_url: str = "https://ssd-api.jpl.nasa.gov/sbdb.api"
    horizons_url: str = "https://ssd.jpl.nasa.gov/api/horizons.api"
    skybot_url: str = "https://ssp.imcce.fr/webservices/skybot/api/conesearch.php"
    # Catalogue overlays (issue #12). Gaia: "<TAP sync URL> <table>" pairs, comma-separated,
    # tried in order. Checked 6 Nov 2026: IRSA about 20 s per cone, ESA about 60 s.
    gaia_tap_mirrors: str = (
        "https://irsa.ipac.caltech.edu/TAP/sync gaia_dr3_source,"
        "https://gea.esac.esa.int/tap-server/tap/sync gaiadr3.gaia_source"
    )
    wise_tap_url: str = "https://irsa.ipac.caltech.edu/TAP/sync"
    catalog_read_timeout_s: float = 120.0
    # ASSUMPTION: how long one /overlays request waits for the Gaia and CatWISE cones (fetched in
    # parallel). Below the frontend's 90 s API timeout; a cone still running after this is
    # reported as ``overlay:<catalog>:pending`` and keeps filling the cache in the background.
    overlay_wait_s: float = 75.0
    # ASSUMPTION: a cone that failed live is not retried for this long, so repeated toggles
    # do not each start the same slow chain of mirror timeouts.
    catalog_failure_ttl_s: float = 60.0

    # ASSUMPTION: fixed epoch for a moving object's position in /v1/resolve, so the answer
    # is cacheable and works offline (ephemerides for fixed times do not change, D-25).
    ephemeris_epoch: str = "2026-11-14T00:00:00Z"
    # ASSUMPTION: epoch of the SIA search cone for proper-motion stars.
    search_epoch: str = "2026-01-01T00:00:00Z"

    cors_origins: str = ""
    # A5.4 pre-baked assets: `<assets_dir>/<type>/<id>.json`, read only (stage 4).
    # ASSUMPTION: A5.4 says "assets/<type>/<id>.json" in the repo; the backend's copy lives here.
    assets_dir: Path = BACKEND_DIR / "assets"
    targets_file: Path = BACKEND_DIR / "targets.toml"
    # R6.7 baked textures. ASSUMPTION: unset means ``<cache_dir>/textures`` (beside the D-25
    # cache's ``v1`` tree, outside git); nothing serves ``/data/textures`` yet.
    textures_dir: Path | None = None

    # Admin token for admin-only endpoints (R10: gemini_paint.py "behind the admin token").
    # ASSUMPTION: unset disables every admin endpoint (404); a wrong token gets 403.
    admin_token: SecretStr | None = None
    # Gemini artistic layer (D-07, R6.6, A6.2). The key stays server-side: SecretStr, never
    # returned or logged. Unset = the layer is off and the code colour shows.
    gemini_api_key: SecretStr | None = None
    # [verify] R12 #3: model name from R6.6, not yet confirmed against the Gemini docs.
    gemini_model: str = "gemini-nano-banana-2.1"
    # [verify] R12 #3 / A3: REST base URL and request shape are not in the specs.
    gemini_api_url: str = "https://generativelanguage.googleapis.com/v1beta"
    # [verify] R12 #3: supported aspect ratios unknown. Empty = ask for none; the output is
    # resampled to 2:1 (R6.6 step 3) whatever comes back.
    gemini_aspect_ratio: str = ""
    # ASSUMPTION: A6.2 says "a set time" but gives no number.
    gemini_timeout_s: float = 90.0
    # Q-29 (open): may a cached repaint be shown under SX_OFFLINE=1? Default follows D-24
    # ("the Gemini layer then stays off"); 1 serves cache hits offline per D-25.
    gemini_offline_cache: bool = False

    @property
    def texture_root(self) -> Path:
        return self.textures_dir if self.textures_dir is not None else self.cache_dir / "textures"

    @property
    def simbad_urls(self) -> list[str]:
        return [u.strip() for u in self.simbad_tap_urls.split(",") if u.strip()]

    @property
    def gaia_mirrors(self) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        for item in self.gaia_tap_mirrors.split(","):
            parts = item.split()
            if len(parts) == 2:
                out.append((parts[0], parts[1]))
        return out

    @property
    def cors_list(self) -> list[str]:
        return [u.strip() for u in self.cors_origins.split(",") if u.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()

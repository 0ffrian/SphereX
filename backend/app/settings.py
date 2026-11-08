"""Backend settings, read from ``SX_*`` environment variables (D-25, A10)."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


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

    # Issue #41 fan-out. Live cutout downloads run in one pool shared by every object, at most
    # this many at a time: the pre-fetch's default concurrency. [verify] the polite limit with
    # IRSA (A3.1); 1 restores one-at-a-time downloads.
    cutout_concurrency: int = 6
    # Photometry worker processes (A4.2). 0 measures in the calling thread (tests, debugging).
    # ASSUMPTION: 2 leaves cores for the API and the texture bake on the 8-core A15 (D-24).
    measure_workers: int = 2
    # Texture bake worker processes (R6.7). 0 bakes in one background thread.
    bake_workers: int = 1
    # Bake the textures a reply points at, off the request path. Off: they are baked by
    # `python -m app.core.render` only.
    bake_textures: bool = True
    # How long /card and /render-params wait for the refined answer before they return the
    # first-stage answer (catalogue data, SPHEREx layers listed as `measuring:`). Engineering
    # value, not a physical one. Offline (D-25) there is no first stage: the reply waits.
    first_answer_wait_s: float = 2.0
    # A finished object job is reused for this long, so the card and render-params requests of
    # one page load share one run. After that a new run picks up what changed meanwhile.
    job_ttl_s: float = 600.0
    # At most this many object jobs do work at once; the rest wait (stage `queued`). Object ids
    # come from user input, so this bounds the threads and downloads one client can start.
    # ASSUMPTION: 4 covers a demo with a few phones; 0 means no cap.
    max_jobs: int = 4
    # D-25 warm cache: at start-up, run the object job for every target in these groups of
    # targets.toml in the background (comma-separated). Off by default: it reaches the network.
    prefetch_on_start: bool = False
    prefetch_groups: str = "demo"

    # Comma-separated, tried in order. The CDS host was unreachable from the dev machine.
    simbad_tap_urls: str = (
        "https://simbad.cds.unistra.fr/simbad/sim-tap/sync,"
        "https://simbad.harvard.edu/simbad/sim-tap/sync"
    )
    exoplanet_tap_url: str = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"  # A3.8
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
    # A3.7 / Q-61: shape-model GLBs and `registry.toml`, written by scripts/ingest_shape.py.
    shapes_dir: Path = BACKEND_DIR / "assets" / "shapes"
    # R6.7 baked textures, served at /data/textures. Outside git, next to the D-25 cache.
    textures_dir: Path | None = None

    @property
    def textures_path(self) -> Path:
        return self.textures_dir or (self.cache_dir / "textures")

    @property
    def prefetch_group_list(self) -> list[str]:
        return [g.strip() for g in self.prefetch_groups.split(",") if g.strip()]

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

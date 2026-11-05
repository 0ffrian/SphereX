"""One place that applies ``SX_OFFLINE`` to third-party libraries (D-25)."""

from __future__ import annotations

from app.settings import Settings


def configure_libraries(settings: Settings) -> None:
    """Stop astropy from downloading IERS or leap-second tables when offline.

    Our own HTTP client refuses separately (``app.adapters.http.Http``).
    """
    from astropy.utils import data as astropy_data
    from astropy.utils import iers

    if settings.offline:
        iers.conf.auto_download = False
        astropy_data.conf.allow_internet = False

"""Stage 2: measure brightness and spectrum (architecture spec A4.2). Issue #2, owner Munazir
(D-17, provisional).

- ``config``: method settings (aperture 3 px, annulus 6-9 px, reject flags) and their hash.
- ``photometry.measure_frame(hdul, x_fits0, y_fits0)``: forced aperture photometry on one
  cutout -> ``Measurement`` (uJy) or ``Refusal`` (reason code, e.g. ``saturated``).
- ``spectrum.SpectrumService(frame_service).get_spectrum(obj)``: every frame of an object ->
  spectrum + light curve (the same measurements), refusals in ``missing``, derived cache.

Built on Stage 1 (issue #1): ``FrameService.get_frames`` gives each frame's ``x_fits0``/``y_fits0``
(0-based, FITS array orientation) and ``wavelength_um`` (``wcs.wavelength_at``, WCS-WAVE at the
object pixel); ``cutouts.cutout_bytes`` gives the cached cutout (PSF stripped, Q-20).
``GET /v1/objects/{id}/spectrum`` lives in ``app/api/spectrum.py``.
"""

from app.core.measure.config import DEFAULT_CONFIG, MEASURE_VERSION, MeasureConfig
from app.core.measure.photometry import Measurement, Refusal, measure_frame
from app.core.measure.spectrum import SpectrumService

__all__ = [
    "DEFAULT_CONFIG",
    "MEASURE_VERSION",
    "MeasureConfig",
    "Measurement",
    "Refusal",
    "SpectrumService",
    "measure_frame",
]

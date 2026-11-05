"""Forced aperture photometry on one cutout (A4.2 steps 1-3).

``F = 1e12 * Omega * sum_i w_i (I_i - B)`` in uJy and
``sigma_F = 1e12 * Omega * sqrt(sum_i w_i**2 V_i + (sum_i w_i)**2 var(B))``, with ``I`` the IMAGE
(MJy/sr), ``V`` the VARIANCE ((MJy/sr)**2), ``w`` the sub-pixel aperture weights, ``B`` the
sigma-clipped annulus mean and ``Omega`` the pixel solid angle (sr) at the object pixel.

A frame that cannot be measured returns a ``Refusal`` with a reason code; nothing is guessed.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np

from app.core.measure import aperture, flags, solid_angle
from app.core.measure.config import DEFAULT_CONFIG, MeasureConfig

# 1 MJy = 1e12 uJy, from astropy.units (not typed in by hand).
OUTPUT_UNIT = "uJy"

FLUX_FORMULA = (
    "F = 1e12 * Omega * sum_i w_i (I_i - B); I = IMAGE (MJy/sr), w = sub-pixel aperture weights, "
    "B = sigma-clipped mean of the annulus, Omega = pixel solid angle (sr) at the object pixel; "
    "forced at the Stage 1 pixel, no re-centring, no aperture correction (Q-23), no deblending"
)
ERROR_FORMULA = (
    "sigma = 1e12 * Omega * sqrt(sum_i w_i^2 V_i + (sum_i w_i)^2 var_B); V = VARIANCE "
    "((MJy/sr)^2), var_B = max(sum_k V_k / N^2, s_clipped^2 / N) over the N kept annulus pixels"
)

NONFINITE = "NONFINITE"
NONPOSITIVE_VARIANCE = "NONPOSITIVE_VARIANCE"


def _mjy_to_ujy() -> float:
    from astropy import units as u

    return float((1.0 * u.MJy).to_value(u.uJy))


@dataclass(frozen=True)
class Measurement:
    flux: float  # uJy
    error: float  # uJy
    dropped_flags: tuple[str, ...]  # why aperture pixels were dropped (sorted)
    dropped_weight_fraction: float  # sum w(dropped) / sum w(all)
    background: float  # MJy/sr
    n_annulus: int
    omega_sr: float
    reject_flags_absent: tuple[str, ...] = ()  # configured reject names the header lacks

    @property
    def flagged(self) -> bool:
        return bool(self.dropped_flags)


@dataclass(frozen=True)
class Refusal:
    reason: str  # unit | extension | flags_header | aperture_edge | saturated | aperture_flags |
    # background | pixel_area | measure
    detail: str


def _unit_ok(header: Any, expected: Any) -> bool:
    from astropy import units as u

    text = header.get("BUNIT")
    if not isinstance(text, str) or not text.strip():
        return False
    try:
        unit = u.Unit(text)
    except ValueError:
        return False
    return bool(unit == expected)


def measure_frame(
    hdul: Any, x0: float, y0: float, cfg: MeasureConfig = DEFAULT_CONFIG
) -> Measurement | Refusal:
    """Measure the source at ``(x0, y0)`` (0-based, FITS array orientation) in one cutout."""
    from astropy import units as u

    for ext in ("IMAGE", "FLAGS", "VARIANCE"):
        if ext not in hdul:
            return Refusal("extension", f"no {ext} extension")
    img_hdu, var_hdu, flag_hdu = hdul["IMAGE"], hdul["VARIANCE"], hdul["FLAGS"]
    mjy_sr = u.MJy / u.sr
    if not _unit_ok(img_hdu.header, mjy_sr):
        return Refusal("unit", f"IMAGE BUNIT {img_hdu.header.get('BUNIT')!r} is not MJy/sr")
    if not _unit_ok(var_hdu.header, mjy_sr**2):
        return Refusal("unit", f"VARIANCE BUNIT {var_hdu.header.get('BUNIT')!r} is not (MJy/sr)^2")

    image = np.asarray(img_hdu.data, dtype=np.float64)
    var = np.asarray(var_hdu.data, dtype=np.float64)
    flag_arr = np.asarray(flag_hdu.data)
    if image.ndim != 2 or image.shape != var.shape or image.shape != flag_arr.shape:
        return Refusal("extension", "IMAGE, VARIANCE and FLAGS shapes differ")
    shape: tuple[int, int] = (int(image.shape[0]), int(image.shape[1]))
    bits = flags.bits_by_name(flag_hdu.header)
    if not bits:
        return Refusal("flags_header", "FLAGS header names no bits (no MP_* keywords)")
    # Saturation detection needs these bits; without them a saturated core would pass as flux.
    needed = sorted({*cfg.saturation_flags, *cfg.saturation_context_flags} - set(bits))
    if needed:
        return Refusal("flags_header", "FLAGS header does not define " + ", ".join(needed))

    if not aperture.aperture_inside(shape, x0, y0, cfg.aperture_radius_px):
        return Refusal("aperture_edge", "the aperture does not fit inside the cutout")

    rejected, reject_absent = flags.mask_of(flag_arr, cfg.reject_flags, bits)
    nonfinite = ~np.isfinite(image) | ~np.isfinite(var)
    nonpositive = ~nonfinite & (var <= 0.0)
    bad = rejected | nonfinite | nonpositive

    w = aperture.aperture_weights(shape, x0, y0, cfg.aperture_radius_px, cfg.subpixels)
    in_ap = w > 0.0
    dist = aperture.distance(shape, x0, y0)
    core = in_ap & (dist <= cfg.core_radius_px)

    # Saturation first, so the UI can say it plainly (Q-26).
    sat, _ = flags.mask_of(flag_arr, cfg.saturation_flags, bits)
    sat_ctx, _ = flags.mask_of(flag_arr, cfg.saturation_context_flags, bits)
    if (sat & core).any() or ((~np.isfinite(image) & core).any() and (sat_ctx & in_ap).any()):
        names = flags.names_set(flag_arr[in_ap], cfg.saturation_context_flags, bits)
        return Refusal("saturated", "saturated core: " + ", ".join(names))
    if (bad & core).any():
        names = _drop_names(
            flag_arr[bad & core], nonfinite[bad & core], nonpositive[bad & core], cfg, bits
        )
        return Refusal("aperture_flags", "bad pixel in the core: " + ", ".join(names))

    ann = aperture.annulus_mask(shape, x0, y0, cfg.annulus_inner_px, cfg.annulus_outer_px) & ~bad
    bg = aperture.clipped_background(
        image[ann], var[ann], cfg.clip_sigma, cfg.clip_maxiters, cfg.min_annulus_pixels
    )
    if bg is None:
        return Refusal("background", f"fewer than {cfg.min_annulus_pixels} usable annulus pixels")

    omega = solid_angle.pixel_solid_angle_sr(img_hdu.header, x0, y0)
    if omega is None:
        return Refusal("pixel_area", "no pixel solid angle from the WCS")

    good = in_ap & ~bad
    dropped = in_ap & bad
    # np.where, never w * I over the whole array: NaN * 0 is NaN.
    s_flux = float(np.sum(np.where(good, w * (image - bg.level), 0.0)))
    s_var = float(np.sum(np.where(good, w * w * var, 0.0)))
    s_w = float(np.sum(np.where(good, w, 0.0)))
    scale = _mjy_to_ujy() * omega
    flux = scale * s_flux
    error = scale * math.sqrt(s_var + s_w * s_w * bg.variance)
    if not (math.isfinite(flux) and math.isfinite(error) and error > 0.0):
        return Refusal("measure", "the sums are not finite")

    w_all = float(np.sum(w))
    w_drop = float(np.sum(np.where(dropped, w, 0.0)))
    names = (
        _drop_names(flag_arr[dropped], nonfinite[dropped], nonpositive[dropped], cfg, bits)
        if dropped.any()
        else []
    )
    return Measurement(
        flux=flux,
        error=error,
        dropped_flags=tuple(names),
        dropped_weight_fraction=w_drop / w_all if w_all > 0 else 0.0,
        background=bg.level,
        n_annulus=bg.n,
        omega_sr=omega,
        reject_flags_absent=tuple(sorted(reject_absent)),
    )


def _drop_names(
    flag_values: Any, nonfinite: Any, nonpositive: Any, cfg: MeasureConfig, bits: dict[str, int]
) -> list[str]:
    names = set(flags.names_set(np.ravel(flag_values), cfg.reject_flags, bits))
    if np.any(nonfinite):
        names.add(NONFINITE)
    if np.any(nonpositive):
        names.add(NONPOSITIVE_VARIANCE)
    return sorted(names)

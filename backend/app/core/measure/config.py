"""Stage 2 method settings (A4.2). These are recipe choices, not physical values about an object.

They carry no provenance badge of their own: every response states them verbatim in its
``method`` block and inside the flux ``formula``, and the flux they produce is tagged
``measured`` (D-16). Changing any of them changes the derived cache key.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, replace
from typing import Any

# Bump when the measurement code changes in a way that changes results.
MEASURE_VERSION = "measure-2"  # measure-2: OUTLIER on a mover's core is a flag (Q-139, Q-459)

# V1, checked 5 Nov 2026: the IRSA tutorial "SPHEREx Source Discovery Tool demo" bad_flags list
# (https://caltech-ipac.github.io/irsa-tutorials/spherex-source-discovery-tool-demo/). Names and
# bits match the SPHEREx Explanatory Supplement (SSDC-DP-017 v2.0, Table 16) and the FLAGS headers
# of every cached QR2 cutout (pipelines 6.4 to 6.5.6). Table 16 has no PHANTOM or REFERENCE and
# adds CROSSTALK, STREAK and SATELLITE_HALO, which QR2 headers do not define (Q-31). SOURCE,
# GHOST*, BLOOM, SNOWBALL and HALO are kept. Bit numbers are always read from the FLAGS header.
REJECT_FLAGS: tuple[str, ...] = (
    "TRANSIENT",
    "OVERFLOW",
    "SUR_ERROR",
    "PHANTOM",
    "REFERENCE",
    "NONFUNC",
    "DICHROIC",
    "MISSING_DATA",
    "HOT",
    "COLD",
    "FULLSAMPLE",
    "PHANMISS",
    "NONLINEAR",
    "PERSIST",
    "OUTLIER",
)

# Saturation (D-31): a core pixel has OVERFLOW, or a core pixel is not finite while OVERFLOW or
# SUR_ERROR is set somewhere in the aperture (the pipeline writes NaN into some saturated cores).
SATURATION_FLAGS: tuple[str, ...] = ("OVERFLOW",)
SATURATION_CONTEXT_FLAGS: tuple[str, ...] = ("OVERFLOW", "SUR_ERROR")


@dataclass(frozen=True)
class MeasureConfig:
    # IRSA tutorial ap_rad = 3.0 px; about 3.6 x the median PSF FWHM (header PSF_FWHM 5.15").
    # [verify] V3: enclosed energy per band; no aperture correction is applied (Q-23).
    aperture_radius_px: float = 3.0
    annulus_inner_px: float = 6.0
    annulus_outer_px: float = 9.0
    subpixels: int = 10
    # A rejected pixel this close to the object refuses the point.
    core_radius_px: float = 1.5
    clip_sigma: float = 3.0
    clip_maxiters: int = 5
    min_annulus_pixels: int = 20
    reject_flags: tuple[str, ...] = REJECT_FLAGS
    saturation_flags: tuple[str, ...] = SATURATION_FLAGS
    saturation_context_flags: tuple[str, ...] = SATURATION_CONTEXT_FLAGS
    # Reject names that, inside the core, are kept in the sum and recorded as a flag instead of
    # refusing the frame (Q-139). Empty for fixed objects; see ``mover_config``.
    core_flag_only: tuple[str, ...] = ()


DEFAULT_CONFIG = MeasureConfig()

# A moving object's own pixels are marked OUTLIER by the SPHEREx pipeline (15 of 16 Eros frames),
# so for movers only OUTLIER within the core is a flag, not a refusal (Q-139, A19.7).
MOVER_CORE_FLAGS: tuple[str, ...] = ("OUTLIER",)


def mover_config(cfg: MeasureConfig = DEFAULT_CONFIG) -> MeasureConfig:
    """``cfg`` with the moving-object core rule on (Q-139)."""
    return replace(cfg, core_flag_only=MOVER_CORE_FLAGS)


def config_for(moving: bool, cfg: MeasureConfig = DEFAULT_CONFIG) -> MeasureConfig:
    return mover_config(cfg) if moving else cfg


def method_dict(cfg: MeasureConfig = DEFAULT_CONFIG) -> dict[str, Any]:
    """The ``method`` block of the response; its hash is part of the derived cache key."""
    out: dict[str, Any] = {
        "kind": "aperture",
        "aperture_radius_px": cfg.aperture_radius_px,
        "annulus_px": [cfg.annulus_inner_px, cfg.annulus_outer_px],
        "subpixels": cfg.subpixels,
        "core_radius_px": cfg.core_radius_px,
        "background": "sigma_clipped_mean",
        "clip_sigma": cfg.clip_sigma,
        "clip_maxiters": cfg.clip_maxiters,
        "min_annulus_pixels": cfg.min_annulus_pixels,
        "reject_flags": list(cfg.reject_flags),
        "saturation_flags": list(cfg.saturation_flags),
        "saturation_context_flags": list(cfg.saturation_context_flags),
        "aperture_correction": None,
        "recentroid": False,
        "version": MEASURE_VERSION,
    }
    if cfg.core_flag_only:  # absent for fixed objects, so their method block is unchanged
        out["core_flag_only"] = list(cfg.core_flag_only)
    return out


def method_sha(cfg: MeasureConfig = DEFAULT_CONFIG) -> str:
    text = json.dumps(method_dict(cfg), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode("ascii")).hexdigest()

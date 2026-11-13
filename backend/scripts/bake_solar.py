"""Bake the solar table of the spectrum check (A17.13 step 0, Q-475): ``assets/solar/sun.json``.

    uv run python -m scripts.bake_solar                 # download both CALSPEC files, then bake
    uv run python -m scripts.bake_solar --dir <folder>  # use files already downloaded there

Sources (STScI CALSPEC, public):

- ``sun_reference_stis_002.fits``: the observed solar spectrum (Bohlin, Dickinson and Calzetti
  2001), 0.12 to 2.70 um; beyond 2.5 um it is itself an extension (its header: "Sun with 2.5 to
  2.7 micron extension"), so only the part below ``JOIN_UM`` is used.
- ``sun_mod_001.fits``: the Kurucz solar model, 0.15 to 300 um, used from ``JOIN_UM`` on, scaled
  to the observed spectrum by the median bin ratio over ``SCALE_BAND_UM``.

Both are in FLAM (erg s^-1 cm^-2 A^-1); the table holds ``F_nu`` (proportional to F_lambda
lambda^2) averaged over bins of resolving power ``R`` from 0.70 to 5.10 um, in relative units
(1 at the bin nearest 1 um). The spectrum check reads the table only; it never fetches (A16.2).
The output is byte-stable: sorted keys, fixed rounding, no timestamp.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import urllib.request
from pathlib import Path

import numpy as np
from astropy.io import fits

from app.settings import BACKEND_DIR

BASE_URL = "https://archive.stsci.edu/hlsps/reference-atlases/cdbs/current_calspec/"
OBSERVED = "sun_reference_stis_002.fits"
MODEL = "sun_mod_001.fits"
CALSPEC_PAGE = (
    "https://www.stsci.edu/hst/instrumentation/reference-data-for-calibration-and-tools/"
    "astronomical-catalogs/calspec"
)
R = 41.0
LAMBDA_MIN_UM = 0.70
LAMBDA_MAX_UM = 5.10
JOIN_UM = 2.50
SCALE_BAND_UM = (2.00, 2.50)
NORM_UM = 1.0
SAMPLES_PER_BIN = 64
OUT = BACKEND_DIR / "assets" / "solar" / "sun.json"


def bin_edges() -> np.ndarray:
    """Edges in um: a ratio of exp(1/R) per bin, from LAMBDA_MIN_UM up to LAMBDA_MAX_UM."""
    n = math.ceil(R * math.log(LAMBDA_MAX_UM / LAMBDA_MIN_UM))
    return LAMBDA_MIN_UM * np.exp(np.arange(n + 1) / R)


def read_fnu(path: Path) -> tuple[np.ndarray, np.ndarray]:
    """Wavelength (um) and F_nu (arbitrary units, F_lambda * lambda^2) of one CALSPEC table."""
    with fits.open(path) as hdul:
        data = hdul[1].data
        wave_a = np.asarray(data["WAVELENGTH"], dtype=np.float64)
        flam = np.asarray(data["FLUX"], dtype=np.float64)
    order = np.argsort(wave_a, kind="stable")
    wave_um = wave_a[order] / 1.0e4
    return wave_um, flam[order] * wave_um**2


def bin_means(wave: np.ndarray, fnu: np.ndarray, edges: np.ndarray) -> np.ndarray:
    """Mean F_nu over each bin, sampled evenly in ln lambda (linear interpolation of the table)."""
    out = np.empty(len(edges) - 1)
    for k in range(len(edges) - 1):
        lo, hi = math.log(edges[k]), math.log(edges[k + 1])
        grid = np.exp(lo + (np.arange(SAMPLES_PER_BIN) + 0.5) * (hi - lo) / SAMPLES_PER_BIN)
        out[k] = float(np.mean(np.interp(grid, wave, fnu, left=np.nan, right=np.nan)))
    return out


def bake(folder: Path) -> dict[str, object]:
    obs_path, mod_path = folder / OBSERVED, folder / MODEL
    edges = bin_edges()
    centres = np.sqrt(edges[:-1] * edges[1:])
    obs = bin_means(*read_fnu(obs_path), edges)
    mod = bin_means(*read_fnu(mod_path), edges)
    band = (centres >= SCALE_BAND_UM[0]) & (centres < SCALE_BAND_UM[1])
    scale = float(np.median(obs[band] / mod[band]))
    fnu = np.where(centres < JOIN_UM, obs, mod * scale)
    if not np.all(np.isfinite(fnu)) or np.any(fnu <= 0):
        raise SystemExit("a bin has no solar flux: check the files' coverage")
    norm = float(fnu[int(np.argmin(np.abs(centres - NORM_UM)))])
    sha = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (obs_path, mod_path)}
    return {
        "description": (
            "Solar F_nu in relative units (1 at the bin nearest 1 um), mean over bins of "
            "resolving power R in ln lambda; observed CALSPEC spectrum below join_um, Kurucz "
            "model scaled to it from join_um on. Interpolate in ln lambda (A17.13 step 0)."
        ),
        "r": R,
        "lambda_min_um": LAMBDA_MIN_UM,
        "lambda_max_um": LAMBDA_MAX_UM,
        "join_um": JOIN_UM,
        "scale_band_um": list(SCALE_BAND_UM),
        "model_scale": round(scale / norm, 9),
        "sources": [
            {
                "file": OBSERVED,
                "url": BASE_URL + OBSERVED,
                "sha256": sha[OBSERVED],
                "use": f"lambda < {JOIN_UM} um",
                "reference": "Bohlin, Dickinson and Calzetti 2001, AJ 122, 2118",
            },
            {
                "file": MODEL,
                "url": BASE_URL + MODEL,
                "sha256": sha[MODEL],
                "use": f"lambda >= {JOIN_UM} um, scaled by model_scale",
                "reference": "Kurucz solar model (CALSPEC header: fsunallp.5000resam51)",
            },
        ],
        "catalogue": CALSPEC_PAGE,
        "lambda_um": [round(float(c), 6) for c in centres],
        "f_nu": [float(f"{v / norm:.7g}") for v in fnu],
    }


def download(folder: Path) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    for name in (OBSERVED, MODEL):
        target = folder / name
        if not target.is_file():
            with urllib.request.urlopen(BASE_URL + name, timeout=60) as resp:
                target.write_bytes(resp.read())


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dir", type=Path, help="folder holding both CALSPEC files")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args(argv)
    folder = args.dir or (BACKEND_DIR / ".cache" / "calspec")
    if args.dir is None:
        download(folder)
    table = bake(folder)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(table, indent=1, sort_keys=True) + "\n"
    args.out.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {args.out} ({len(table['lambda_um'])} bins)")  # type: ignore[arg-type]
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Dots (A17.2): detect, centroid, place and measure every point source of one area cutout.

Order per cutout (cheap tests first, so Stage 2 runs only on dots that will be kept; Q-400):

1. Hardware mask: Stage 2's reject flags **without OUTLIER**, plus non-finite pixels and
   ``VARIANCE <= 0`` (A17.2 step 2, Q-178, Q-139). OUTLIER is never masked.
2. Background mesh: boxes of ``bg_box_px``, sigma-clipped mean and std of the usable pixels; a box
   with less than ``bg_min_frac`` usable pixels takes the median of its usable neighbours (else
   of every usable box); bilinear between box centres (A17.2 step 1).
3. Peaks: usable pixels with ``D = I - B > k_detect * sqrt(V)`` that are the maximum of their
   ``peak_box_px`` box; greedy minimum separation by ``(-D, row, column)`` (A17.2 step 3).
4. Centroids: first moment over ``centroid_box_px`` (``CENTROID_FORMULA``); the separation rule
   again on the centroids (two peaks of one source can give centroids closer than it).
5. RA/Dec and wavelength for every centroid in one vectorised call per frame (the celestial WCS
   and the ``W`` table WCS built once, with ``wcs.wavelength_at``'s recipe).
6. Drop a centroid outside the box, outside its visit's coverage (the kept cell mask and the
   served polygon, with the served check's own rule), or with no wavelength, or one outside the
   frame band (a guard, expected never to fire).
7. Stage 2 (``measure_frame``, ``AREA_MEASURE_CONFIG``) on a small stamp around the centroid
   (same outcome as the whole cutout, tested); a ``Refusal`` drops the dot and is counted by
   its reason (Q-400 (6)).
8. ``flags`` = OUTLIER in the aperture, Stage 2's ``dropped_flags`` and the names at the core
   pixel (Q-400 (7)). Ids by the rounded PNG row, then column (Q-208 (14)).
"""

from __future__ import annotations

import math
import time
import warnings
from collections import Counter
from collections.abc import Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, replace
from multiprocessing import get_context
from typing import Any

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view
from numpy.typing import NDArray

from app.core.area.config import DEFAULT_AREA_CONFIG, AreaConfig
from app.core.area.geometry import AreaBox, CellGrid, radec_inside
from app.core.area.records import AreaFrame, AreaFrames, Coverage, Dot, FrameDots
from app.core.find import wcs
from app.core.measure import aperture, flags
from app.core.measure.photometry import Measurement, Refusal, measure_frame

F64 = NDArray[np.float64]

# Refusal reasons of this module (Stage 2's own reasons are counted as they come).
NO_CUTOUT = "no_cutout"
UNREADABLE = "cutout_unreadable"
NO_BACKGROUND = "background_mesh"
CENTROID = "centroid"
CENTROID_SEPARATION = "centroid_separation"
WAVELENGTH = "wavelength"
OUTSIDE_BOX = "outside_box"
OUTSIDE_COVERAGE = "coverage"
BAND = "band"


# --- arrays --------------------------------------------------------------------------------


def hardware_usable(hdul: Any, cfg: AreaConfig) -> tuple[F64, F64, NDArray[Any], NDArray[np.bool_]]:
    image = np.asarray(hdul["IMAGE"].data, dtype=np.float64)
    var = np.asarray(hdul["VARIANCE"].data, dtype=np.float64)
    flag_arr = np.asarray(hdul["FLAGS"].data)
    bits = flags.bits_by_name(hdul["FLAGS"].header)
    hw, _ = flags.mask_of(flag_arr, cfg.measure.reject_flags, bits)
    with np.errstate(invalid="ignore"):
        usable = ~hw & np.isfinite(image) & np.isfinite(var) & (var > 0.0)
    return image, var, flag_arr, np.asarray(usable, dtype=np.bool_)


def _axis(n: int, box: int) -> tuple[list[slice], F64]:
    nb = math.ceil(n / box)
    slices = [slice(j * box, min((j + 1) * box, n)) for j in range(nb)]
    centres = np.array([(s.start + s.stop - 1) / 2.0 for s in slices], dtype=np.float64)
    return slices, centres


def _lerp_index(centres: F64, n: int) -> tuple[NDArray[np.int64], NDArray[np.int64], F64]:
    p = np.arange(n, dtype=np.float64)
    if len(centres) == 1:
        z = np.zeros(n, dtype=np.int64)
        return z, z, np.zeros(n, dtype=np.float64)
    i0 = np.clip(np.searchsorted(centres, p, side="right") - 1, 0, len(centres) - 2)
    i1 = i0 + 1
    t = np.clip((p - centres[i0]) / (centres[i1] - centres[i0]), 0.0, 1.0)
    return i0.astype(np.int64), i1.astype(np.int64), t


def mesh_background(
    image: F64, usable: NDArray[np.bool_], cfg: AreaConfig
) -> tuple[F64, F64] | None:
    """(background image, std of the usable boxes) or ``None`` when no box is usable."""
    from astropy.stats import sigma_clipped_stats

    ny, nx = image.shape
    rows, cy = _axis(ny, cfg.bg_box_px)
    cols, cx = _axis(nx, cfg.bg_box_px)
    mean = np.full((len(rows), len(cols)), np.nan)
    std = np.full((len(rows), len(cols)), np.nan)
    for j, rs in enumerate(rows):
        for i, cs in enumerate(cols):
            u = usable[rs, cs]
            if u.sum() >= cfg.bg_min_frac * u.size and u.sum() >= 2:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    m, _, s = sigma_clipped_stats(
                        image[rs, cs][u], sigma=cfg.bg_sigma, maxiters=cfg.bg_iters
                    )
                mean[j, i], std[j, i] = float(m), float(s)
    good = np.isfinite(mean)
    if not good.any():
        return None
    fill = mean.copy()
    overall = float(np.median(mean[good]))
    for j, i in zip(*np.nonzero(~good), strict=True):
        nb = mean[max(j - 1, 0) : j + 2, max(i - 1, 0) : i + 2]
        nb = nb[np.isfinite(nb)]
        fill[j, i] = float(np.median(nb)) if nb.size else overall
    y0, y1, ty = _lerp_index(cy, ny)
    x0, x1, tx = _lerp_index(cx, nx)
    top = (1.0 - tx) * fill[y0][:, x0] + tx * fill[y0][:, x1]
    bottom = (1.0 - tx) * fill[y1][:, x0] + tx * fill[y1][:, x1]
    background = (1.0 - ty)[:, None] * top + ty[:, None] * bottom
    return np.asarray(background, dtype=np.float64), std[good]


# --- detection -----------------------------------------------------------------------------


def find_peaks(
    d: F64, var: F64, usable: NDArray[np.bool_], cfg: AreaConfig
) -> tuple[NDArray[np.int64], NDArray[np.int64], int]:
    """Peak rows and columns after the separation rule, in ``(-D, row, column)`` order, and the
    number of peaks before it."""
    k = cfg.peak_box_px // 2
    dm = np.where(usable, d, -np.inf)
    win = sliding_window_view(np.pad(dm, k, constant_values=-np.inf), (cfg.peak_box_px,) * 2)
    local_max = dm >= win.max(axis=(2, 3))
    with np.errstate(invalid="ignore"):
        above = dm > cfg.k_detect * np.sqrt(np.where(usable, var, np.inf))
    ys, xs = np.nonzero(usable & local_max & above)
    order = np.lexsort((xs, ys, -dm[ys, xs]))
    ys, xs = ys[order], xs[order]
    n_raw = len(ys)
    r2 = cfg.min_sep_px * cfg.min_sep_px
    reach = math.ceil(cfg.min_sep_px)
    offsets = [
        (dy, dx)
        for dy in range(-reach, reach + 1)
        for dx in range(-reach, reach + 1)
        if dx * dx + dy * dy < r2
    ]
    taken = np.zeros(dm.shape, dtype=np.bool_)
    ny, nx = dm.shape
    keep: list[int] = []
    for idx in range(n_raw):
        y, x = int(ys[idx]), int(xs[idx])
        clash = False
        for dy, dx in offsets:
            yy, xx = y + dy, x + dx
            if 0 <= yy < ny and 0 <= xx < nx and taken[yy, xx]:
                clash = True
                break
        if not clash:
            taken[y, x] = True
            keep.append(idx)
    sel = np.asarray(keep, dtype=np.int64)
    return ys[sel].astype(np.int64), xs[sel].astype(np.int64), n_raw


@dataclass(frozen=True)
class Centroids:
    x: F64  # FITS 0-based
    y: F64
    sigma_c: F64
    ok: NDArray[np.bool_]  # F > 0


def centroids(
    d: F64,
    var: F64,
    usable: NDArray[np.bool_],
    ys: NDArray[np.int64],
    xs: NDArray[np.int64],
    cfg: AreaConfig,
) -> Centroids:
    """First moment of the positive usable ``D`` over the centroid box (``CENTROID_FORMULA``)."""
    h = cfg.centroid_box_px // 2
    w = np.where(usable & (d > 0.0), d, 0.0)
    v = np.where(usable & (d > 0.0), var, 0.0)
    wp = np.pad(w, h)
    vp = np.pad(v, h)
    off = np.arange(-h, h + 1)
    rr = ys[:, None, None] + h + off[None, :, None]
    cc = xs[:, None, None] + h + off[None, None, :]
    W = wp[rr, cc]
    V = vp[rr, cc]
    X = (xs[:, None, None] + off[None, None, :]).astype(np.float64)
    Y = (ys[:, None, None] + off[None, :, None]).astype(np.float64)
    F = W.sum(axis=(1, 2))
    ok = F > 0.0
    Fs = np.where(ok, F, 1.0)
    cx = (W * X).sum(axis=(1, 2)) / Fs
    cy = (W * Y).sum(axis=(1, 2)) / Fs
    sx2 = (((X - cx[:, None, None]) ** 2) * V).sum(axis=(1, 2)) / Fs**2
    sy2 = (((Y - cy[:, None, None]) ** 2) * V).sum(axis=(1, 2)) / Fs**2
    return Centroids(cx, cy, np.sqrt((sx2 + sy2) / 2.0), np.asarray(ok, dtype=np.bool_))


def separate(x: F64, y: F64, min_sep: float) -> NDArray[np.bool_]:
    """Greedy minimum separation in the given order (the caller's priority order)."""
    keep = np.zeros(len(x), dtype=np.bool_)
    buckets: dict[tuple[int, int], list[int]] = {}
    r2 = min_sep * min_sep
    for i in range(len(x)):
        bx, by = math.floor(x[i] / min_sep), math.floor(y[i] / min_sep)
        clash = False
        for gx in (bx - 1, bx, bx + 1):
            for gy in (by - 1, by, by + 1):
                for j in buckets.get((gx, gy), ()):
                    if (x[i] - x[j]) ** 2 + (y[i] - y[j]) ** 2 < r2:
                        clash = True
                        break
                if clash:
                    break
            if clash:
                break
        if not clash:
            keep[i] = True
            buckets.setdefault((bx, by), []).append(i)
    return keep


# --- world coordinates ---------------------------------------------------------------------


def sky_many(hdul: Any, x: F64, y: F64) -> tuple[F64, F64]:
    """RA (mod 360) and Dec for FITS 0-based pixels, one WCS for the frame."""
    if len(x) == 0:
        return np.zeros(0), np.zeros(0)
    w = wcs.celestial_wcs(hdul["IMAGE"].header)
    ra, dec = w.pixel_to_world_values(x, y)
    return np.asarray(ra, dtype=np.float64) % 360.0, np.asarray(dec, dtype=np.float64)


def wavelength_many(hdul: Any, x: F64, y: F64) -> tuple[F64, F64] | None:
    """``wcs.wavelength_at`` for many pixels (the same recipe: SIP keywords dropped from a copy
    of the header, then the ``W`` table WCS); NaN where a value is unusable."""
    from astropy import units as u
    from astropy.wcs import WCS

    if len(x) == 0:
        return np.zeros(0), np.zeros(0)
    try:
        header = hdul["IMAGE"].header.copy()
        for k in [k for k in header if wcs.SIP_KEY.match(k)]:
            del header[k]
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            ww = WCS(header, fobj=hdul, key="W")
            wl, bw = ww.pixel_to_world(x, y)
        wl_um = np.asarray(u.Quantity(wl).to_value(u.um), dtype=np.float64)
        bw_um = np.asarray(u.Quantity(bw).to_value(u.um), dtype=np.float64)
    except (KeyError, ValueError, TypeError, AttributeError, MemoryError):
        return None
    bad = ~(np.isfinite(wl_um) & (wl_um > 0) & np.isfinite(bw_um))
    return np.where(bad, np.nan, wl_um), np.where(bad, np.nan, bw_um)


# --- photometry on a stamp -----------------------------------------------------------------


@dataclass
class _Hdu:
    header: Any
    data: Any


class Stamper:
    """Stage 2 on a stamp of ``stamp_half_px`` around the centroid, with ``CRPIX`` shifted so the
    WCS (and so the pixel solid angle) is unchanged. One header copy per frame, edited in place
    for each stamp (single-threaded)."""

    def __init__(self, hdul: Any, cfg: AreaConfig) -> None:
        self.cfg = cfg
        self.image = np.asarray(hdul["IMAGE"].data)
        self.var = np.asarray(hdul["VARIANCE"].data)
        self.flags = np.asarray(hdul["FLAGS"].data)
        self.img_header = hdul["IMAGE"].header.copy()
        self.crpix = (float(self.img_header["CRPIX1"]), float(self.img_header["CRPIX2"]))
        self.var_header = hdul["VARIANCE"].header
        self.flag_header = hdul["FLAGS"].header
        self.bits = flags.bits_by_name(self.flag_header)

    def window(self, x: float, y: float) -> tuple[int, int, int, int]:
        ny, nx = self.image.shape
        h = self.cfg.stamp_half_px
        ix, iy = math.floor(x + 0.5), math.floor(y + 0.5)
        return max(ix - h, 0), min(ix + h + 1, nx), max(iy - h, 0), min(iy + h + 1, ny)

    def stamp(self, x: float, y: float) -> tuple[dict[str, _Hdu], float, float]:
        xa, xb, ya, yb = self.window(x, y)
        self.img_header["CRPIX1"] = self.crpix[0] - xa
        self.img_header["CRPIX2"] = self.crpix[1] - ya
        hd = {
            "IMAGE": _Hdu(self.img_header, self.image[ya:yb, xa:xb]),
            "FLAGS": _Hdu(self.flag_header, self.flags[ya:yb, xa:xb]),
            "VARIANCE": _Hdu(self.var_header, self.var[ya:yb, xa:xb]),
        }
        return hd, x - xa, y - ya

    def measure(self, x: float, y: float) -> tuple[Measurement | Refusal, bool]:
        """Stage 2's outcome and whether an OUTLIER pixel lies in the aperture."""
        hd, sx, sy = self.stamp(x, y)
        m = measure_frame(hd, sx, sy, self.cfg.measure)
        outlier = False
        if isinstance(m, Measurement) and "OUTLIER" in self.bits:
            f = hd["FLAGS"].data
            w = aperture.aperture_weights(
                f.shape, sx, sy, self.cfg.measure.aperture_radius_px, self.cfg.measure.subpixels
            )
            outlier = bool(
                ((np.asarray(f).astype(np.int64) >> self.bits["OUTLIER"]) & 1)[w > 0].any()
            )
        return m, outlier


def full_measure(hdul: Any, x: float, y: float, cfg: AreaConfig) -> Measurement | Refusal:
    """Stage 2 on the whole cutout (the reference the stamp is tested against)."""
    return measure_frame(hdul, x, y, cfg.measure)


# --- one frame -----------------------------------------------------------------------------


def _round_xy(v: float) -> float:
    return round(v, 3) + 0.0


def find_dots(
    body: bytes,
    frame: AreaFrame,
    box: AreaBox,
    coverage: Coverage | None,
    cfg: AreaConfig = DEFAULT_AREA_CONFIG,
) -> FrameDots:
    """Every dot of one cutout (A17.2). Pure function of its inputs (spawn-pool safe)."""
    t_start = time.perf_counter()
    refused: Counter[str] = Counter()
    timings: dict[str, float] = {}

    def done(dots: Sequence[Dot], noise: dict[str, float], peaks: int) -> FrameDots:
        timings["total_s"] = time.perf_counter() - t_start
        return FrameDots(
            frame_id=frame.frame_id,
            dots=tuple(dots),
            refused=tuple(sorted((k, v) for k, v in refused.items() if v > 0)),
            noise=tuple(sorted(noise.items())),
            peaks=peaks,
            timings=timings,
        )

    try:
        hdul = wcs.open_fits(body)
    except (OSError, ValueError, TypeError):
        refused[UNREADABLE] += 1
        return done([], {}, 0)
    with hdul:
        image, var, flag_arr, usable = hardware_usable(hdul, cfg)
        ny = image.shape[0]
        t0 = time.perf_counter()
        mesh = mesh_background(image, usable, cfg)
        timings["mesh_s"] = time.perf_counter() - t0
        if mesh is None:
            refused[NO_BACKGROUND] += 1
            return done([], {}, 0)
        background, box_std = mesh
        noise = {
            "mesh_std_median": float(np.median(box_std)),
            "sqrt_var_median": float(np.median(np.sqrt(var[usable]))),
        }
        d = image - background
        t0 = time.perf_counter()
        ys, xs, n_raw = find_peaks(d, var, usable, cfg)
        cen = centroids(d, var, usable, ys, xs, cfg)
        refused[CENTROID] += int((~cen.ok).sum())
        keep = cen.ok.copy()
        idx = np.flatnonzero(keep)
        sep = separate(cen.x[idx], cen.y[idx], cfg.min_sep_px)
        refused[CENTROID_SEPARATION] += int((~sep).sum())
        idx = idx[sep]
        timings["detect_s"] = time.perf_counter() - t0
        timings["peaks_kept"] = float(len(ys))

        t0 = time.perf_counter()
        cx, cy, sc = cen.x[idx], cen.y[idx], cen.sigma_c[idx]
        ra, dec = sky_many(hdul, cx, cy)
        wave = wavelength_many(hdul, cx, cy)
        timings["wcs_s"] = time.perf_counter() - t0
        if wave is None:
            refused[WAVELENGTH] += len(idx)
            return done([], noise, n_raw)
        wl, bw = wave
        ra_r = np.round(ra, 7) % 360.0
        dec_r = np.round(dec, 7)
        xi, eta, okp = box.project_many(ra_r, dec_r)
        in_box = okp & box.inside_many(xi, eta)
        grid = CellGrid.of(box, cfg.coverage_cell_arcsec)
        row, col, valid = grid.cell_of(xi, eta)

        stamper = Stamper(hdul, cfg)
        names = wcs.flag_names(hdul["FLAGS"].header)
        t_meas = 0.0
        n_meas = 0
        pending: list[tuple[float, float, int]] = []  # (x_png, y_png, j)
        results: dict[int, Dot] = {}
        for j in range(len(idx)):
            if not math.isfinite(wl[j]):
                refused[WAVELENGTH] += 1
                continue
            if not bool(in_box[j]):
                refused[OUTSIDE_BOX] += 1
                continue
            covered = (
                coverage is not None
                and bool(coverage.polygon)
                and bool(valid[j])
                and bool(coverage.mask[row[j], col[j]])
                and radec_inside(coverage.polygon, float(ra_r[j]), float(dec_r[j]))
            )
            if not covered:
                refused[OUTSIDE_COVERAGE] += 1
                continue
            wl_r, bw_r = round(float(wl[j]), 5), round(float(bw[j]), 5)
            if not (frame.wavelength_min_um <= wl_r <= frame.wavelength_max_um) or bw_r <= 0:
                refused[BAND] += 1
                continue
            t1 = time.perf_counter()
            m, outlier = stamper.measure(float(cx[j]), float(cy[j]))
            t_meas += time.perf_counter() - t1
            n_meas += 1
            if isinstance(m, Refusal):
                refused[m.reason] += 1
                continue
            ix, iy = math.floor(float(cx[j]) + 0.5), math.floor(float(cy[j]) + 0.5)
            core = int(flag_arr[iy, ix])
            core_names = {names.get(b, f"BIT{b}") for b in range(32) if core >> b & 1}
            flag_set = {*m.dropped_flags, *core_names, *(["OUTLIER"] if outlier else [])}
            x_png, y_png = float(cx[j]), float((ny - 1) - cy[j])
            results[j] = Dot(
                dot_id="",
                frame_id=frame.frame_id,
                detector=frame.detector,
                visit=frame.visit,
                exposure=frame.exposure,
                time=frame.time,
                x=_round_xy(x_png),
                y=_round_xy(y_png),
                sigma_c_px=round(float(sc[j]), 4),
                ra=float(ra_r[j]),
                dec=float(dec_r[j]) + 0.0,
                flux_uJy=round(m.flux, 3) + 0.0,
                flux_err=round(m.error, 3),
                snr=round(m.flux / m.error, 2) + 0.0,
                wavelength_um=wl_r,
                bandwidth_um=bw_r,
                flags=tuple(sorted(flag_set)),
            )
            pending.append((results[j].x, results[j].y, j))
        timings["measure_s"] = t_meas
        timings["measure_calls"] = float(n_meas)

    order = sorted(
        pending, key=lambda p: (math.floor(p[1] + 0.5), math.floor(p[0] + 0.5), p[0], p[1])
    )
    dots = [
        replace(results[j], dot_id=f"{frame.frame_id}:{n}")
        for n, (_, _, j) in enumerate(order, start=1)
    ]
    return done(dots, noise, n_raw)


# --- every frame ---------------------------------------------------------------------------


def _one(args: tuple[bytes | None, AreaFrame, AreaBox, Coverage | None, AreaConfig]) -> FrameDots:
    body, frame, box, cov, cfg = args
    if body is None:
        return FrameDots(frame.frame_id, (), ((NO_CUTOUT, 1),), (), 0)
    return find_dots(body, frame, box, cov, cfg)


def run_dots(
    frames: AreaFrames,
    bodies: dict[str, bytes],
    cfg: AreaConfig = DEFAULT_AREA_CONFIG,
    *,
    workers: int = 0,
) -> list[FrameDots]:
    """``find_dots`` for every frame, in frame order; ``workers = 0`` runs in this thread, else
    a spawn process pool (as Stage 2's ``MeasurePool``)."""
    box = AreaBox.of(frames.spec)
    cov = {c.visit: c for c in frames.coverage}
    jobs = [(bodies.get(f.frame_id), f, box, cov.get(f.visit), cfg) for f in frames.frames]
    if workers <= 0 or len(jobs) <= 1:
        return [_one(j) for j in jobs]
    with ProcessPoolExecutor(max_workers=workers, mp_context=get_context("spawn")) as pool:
        return list(pool.map(_one, jobs))


def all_dots(per_frame: Sequence[FrameDots]) -> list[Dot]:
    return [d for fd in per_frame for d in fd.dots]

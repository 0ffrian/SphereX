"""Stage 2: measure brightness and spectrum (architecture spec A4.2).

Reserved for issue #2 (owner: Munazir, D-17 provisional). Nothing lives here yet.

Inputs available from Stage 1 (issue #1), with their real signatures:
- ``app.core.find.resolver.load_object(ctx: Context, object_id: str) -> ResolvedObject | None``:
  the object registered by ``/v1/resolve`` (coordinate ids are parsed directly).
- ``app.core.find.frames.FrameService.get_frames(obj: ResolvedObject, *, refresh=False,
  rebuild=False, use_memo=False, unlimited_live=False) -> FramesResult``: the frame list. Each
  ``FrameRecord`` has ``x_fits0``/``y_fits0`` (0-based, FITS array orientation) next to the PNG
  ``x``/``y``, plus ``ra``/``dec`` at the frame time, ``wavelength_um`` and ``flags``.
- ``app.core.find.frames.FrameService.find(obj: ResolvedObject, frame_id: str)
  -> FrameRecord | None``.
- ``app.core.find.cutouts.load_cutout_hdul(service: FrameService, object_id: str,
  frame_id: str) -> HDUList``: the cached cutout (IMAGE, FLAGS, VARIANCE, ZODI, WCS-WAVE; the PSF
  extension is not cached, Q-20). Raises ``CutoutUnavailable``. The caller closes it.
- ``app.core.find.cutouts.cutout_bytes(service: FrameService, frame: FrameRecord) -> bytes``:
  the cached FITS bytes. Raises ``CutoutUnavailable``.
- ``app.core.find.wcs.object_pixel(hdul, ra: float, dec: float) -> tuple[float, float]``: sky to
  pixel in FITS array orientation (0-based); ``wcs.wavelength_at(hdul, x_fits0, y_fits0)``.

The ``FrameService`` instance of the running app is ``request.app.state.frames``.

``GET /v1/objects/{id}/spectrum`` goes in ``app/api/spectrum.py`` plus one ``include_router``
line in ``app/main.py``.
"""

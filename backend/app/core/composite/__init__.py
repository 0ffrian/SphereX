"""SPHEREx false-colour composite of one object (beyond D-16; tag ``derived``, Q-27).

Three SPHEREx frames of the same patch, at a short, a middle and a long wavelength, from one
survey pass, resampled onto one north-up (east left) TAN grid and written as B, G, R into one
8-bit RGB PNG.

- ``config``: the band targets, pass span, stretch and grid constants (display choices).
- ``select``: band selection from Stage 1's frames and Stage 2's refusals (pure).
- ``grid``: the output TAN grid, bilinear resampling through each frame's FITS WCS, the
  per-band asinh stretch and the PNG encoder (pure numpy, astropy WCS, Pillow).
- ``service.CompositeService``: frames -> spectrum refusals -> selection -> derived cache.
"""

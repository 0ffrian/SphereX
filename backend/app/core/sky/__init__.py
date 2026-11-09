"""Sky background: a local mirror of a colour HiPS survey and its equirectangular bake.

``surveys`` holds the survey registry and the on-disk layout, ``healpix`` the NESTED HEALPix
maths (numpy only), ``bake`` the HiPS -> equirectangular resampling. The mirror and bake
scripts are ``scripts.sky_mirror`` and ``scripts.sky_bake``; ``app.api.sky`` serves the files.
"""

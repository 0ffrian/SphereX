"""Area search, Discovery backend (A17). Run offline by ``scripts/area_discovery.py``; never
imported by ``app/api`` in P3 (A17: it never runs inside a web request).

- ``config``: ``[[area]]`` loader, ``AreaConfig`` starting values, ``method.settings`` (Q-400).
- ``records``: the frozen records P4 to P7 consume (``AreaFrame``, ``Coverage``, ``Dot``, ...).
- ``geometry``: the area box on the gnomonic plane, footprint overlap, coverage cells.
- ``frames``: A17.1 (cones, selection, visits, cutouts, coverage).
- ``dots``: A17.2 (detect, centroid, place, measure).
- ``day0``: the Day 0 count (A16.6, A16.7, Q-148).
"""

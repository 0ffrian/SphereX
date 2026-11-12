"""Area search, Discovery backend (A17). Run offline by ``scripts/area_discovery.py`` (A17: it never
runs inside a web request); ``app/api/areas.py`` imports only ``config``, ``store`` and ``stamps``.

- ``config``: ``[[area]]`` loader, ``AreaConfig`` starting values, ``method.settings`` (Q-400).
- ``records``: the frozen records P4 to P7 consume (``AreaFrame``, ``Coverage``, ``Dot``, ...).
- ``geometry``: the area box on the gnomonic plane, footprint overlap, coverage cells.
- ``frames``: A17.1 (cones, selection, visits, cutouts, coverage).
- ``dots``: A17.2 (detect, centroid, place, measure).
- ``day0``: the Day 0 count (A16.6, A16.7, Q-148).
- ``clean``: A17.3 (glitch, tracklets, star, fixed); ``join``: A17.4; ``match``: A17.5.
- ``service``: runs P4 to P6, builds the replies and the ECSV, writes the entries (A17.7, A17.10).
- ``store``: reads the entries back for the API (A17.8); ``stamps``: the 15 px stamps.
"""

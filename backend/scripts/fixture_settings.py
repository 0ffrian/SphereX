"""Settings shared by the fixture recorder (``scripts.record_fixtures``) and the tests.

Kept apart from the recorder so the tests import only these constants, not the recording script.
"""

from __future__ import annotations

# Moving-object path search for the fixtures (issue #26). Not [verify] values: a deliberately
# short window (2026-03-20 to 2026-03-21, where a live search on 7 Nov 2026 found SPHEREx frames
# of 433 Eros), a tiny cone and a fixed 24 h step (min = max), so two cones and a small cache.
# The window must equal Eros's `moving_windows` in targets.toml (issue #73), which replaces it
# for Eros; test_moving.test_eros_target_window_equals_the_fixture_window keeps the two equal.
FIXTURE_MOVING: dict[str, str] = {
    "moving_window_start": "2026-03-20T00:00:00Z",
    "moving_window_end": "2026-03-21T12:00:00Z",
    "moving_ephem_step_min": "60",
    "moving_cone_radius_deg": "0.001",
    "moving_min_step_h": "24",
    "moving_max_step_h": "24",
    "moving_max_cones": "450",
    "moving_sia_maxrec": "500",
    # Recorded before the candidate margin existed (PR #53): a margin would ask Horizons for
    # TLIST times that are not in the fixtures.
    "moving_footprint_margin_arcsec": "0",
}

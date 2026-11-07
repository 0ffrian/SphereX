# 08 Sequence: search and flipbook

A user searches by name or RA/Dec and the flipbook plays the SPHEREx frames of that patch (the P0 base requirement). Drawn from architecture spec §1.1, §3.1, §3.4–3.5, §4.1, §10 (hash routing) and §11 (badges), rendering doc §4 (display level 1) and decisions D-16 (endpoints), D-19 (resolver order), D-25 (cache) and D-28 (Rainbow Trails), and A4.9 (overlays, flag mask, combine).

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant UI as UI shell
  participant FB as Flipbook
  participant API as Backend API
  participant C as Read-through cache
  participant R as Name resolver (SBDB, SIMBAD)
  participant SIA as IRSA SIA (spherex_qr2)
  participant HZ as Horizons + SkyBoT
  participant TAP as Gaia + CatWISE TAP (IRSA, ESA)
  participant FX as Fixture server (dev only)

  opt dev only: npm run dev:fixtures
    Note over UI,FX: A Vite dev-server plugin answers every /v1 call below instead of the backend. Never part of a build.
    UI->>FX: The same /v1 requests
    FX-->>UI: Synthetic replies with header X-SX-Fixture: synthetic
    UI->>UI: Page-wide "Fixture data" banner, Fixture badges instead of Measured, SYNTHETIC image label
  end
  alt user types a name or RA/Dec
    U->>UI: Enter name or RA/Dec
  else user opens a shared link or presses Back
    U->>UI: URL hash #35;ra=…&dec=…[&name=…][&frame=…]
    UI->>UI: Parse the hash. Unusable parts are ignored, never guessed, shown under the search field and announced (live region)
    alt hash has a name or valid coordinates
      UI->>UI: Search the name if present, else the coordinates (frame= reopens that frame)
    else hash is empty (Back to the page without a hash) or has neither
      UI->>UI: Reset the search to the empty start state, no request
    end
  end
  UI->>API: GET /v1/resolve?q=name or ra,dec
  alt input is a name that looks like a small body
    API->>R: SBDB first, SIMBAD on a miss (via the cache)
    R-->>API: RA, Dec
  else input is any other name
    API->>R: SIMBAD first, SBDB on a miss (via the cache)
    R-->>API: RA, Dec
  else input is RA/Dec
    API->>API: Skip name resolution
  end
  API-->>UI: id, ra, dec, moving
  UI->>UI: Write #35;ra=…&dec=…[&name=…] to the URL hash (share link). A typed search adds a history entry, a link replaces it
  UI->>API: GET /v1/objects/{id}/frames
  API->>C: Look up (source + data release + normalised query)
  alt cache hit
    C-->>API: Raw response, fetched_at, source URL
  else cache miss and SX_OFFLINE is not set
    API->>SIA: SIA?COLLECTION=spherex_qr2&POS=circle RA DEC RADIUS&MAXREC=N
    alt archive answers within the timeout and retries
      SIA-->>API: Frame list (time, detector, wavelength range)
      API->>SIA: Small cutouts only, never whole frames
      SIA-->>API: Cutouts: IMAGE, FLAGS, VARIANCE, WCS-WAVE
      API->>C: Store raw response, fetched_at, source URL
    else 504 or timeout (known IRSA problem)
      SIA-->>API: 504
      API->>C: Older cached entry?
      C-->>API: Older entry, or none
      API-->>UI: If none, refuse: archive slow, suggest a cached target
    end
  else cache miss with SX_OFFLINE=1
    API-->>UI: Refuse, never touch the network
  end
  alt star with a catalogue proper motion (Q-22: moving = false)
    API->>API: Propagate the SIMBAD position to each frame time (derived), then sky to pixel via WCS
  else moving object, asteroid or comet (moving = true)
    API->>HZ: Position at the resolve epoch, neighbours in field (SkyBoT -ep as JD), via the cache
    HZ-->>API: Positions and known objects
    API-->>UI: M1 refuses: frames empty, missing frames:moving_object_search (Q-21)
  end
  API-->>UI: frame_id, time, wavelength_um, x, y, cutout_url per frame, plus the stretch used and cached_at if from cache
  UI->>UI: Badges: wavelength and time Measured, display stretch Estimated (derived, tooltip gives its parameters)
  UI->>FB: Load frames
  loop each frame
    FB->>API: GET /v1/objects/{id}/cutouts/{frame_id}.png
    API-->>FB: Cutout stretched to PNG by the server
  end
  loop play
    FB->>FB: Show next frame, clickable rings on sources
  end
  opt user pauses or steps
    FB->>UI: Current frame
    UI->>UI: Replace the hash in place with frame=… (no new history entry)
  end
  opt P1 overlays (issue #12, A4.9, Q-50)
    U->>UI: Switch on a layer: Gaia stars, WISE sources, Flagged pixels or Field of view
    alt first switch-on, after an error, or a catalogue was pending
      UI->>API: GET /v1/objects/{id}/overlays (lazy). The previous reply stays drawn meanwhile, and if the reload fails
      API->>C: Gaia cone (G #lt; 20) and CatWISE2020 cone, in parallel
      alt cache miss and no live failure in the last catalog_failure_ttl_s
        API->>TAP: Gaia: IRSA gaia_dr3_source, then ESA gaiadr3.gaia_source. CatWISE: IRSA catwise_2020
        TAP-->>API: CSV, parsed row by row before it is cached
      end
      alt both cones answered within overlay_wait_s = 75 s
        API-->>UI: catalogs, per-frame markers, contamination, footprint, cutout box, flag groups, missing, provenance
      else a cone is still running
        API-->>UI: The reply without it, missing has overlay:{cat}:pending. The fetch keeps filling the cache
        UI->>UI: The toggle stays enabled, with a "Try again" button
        U->>UI: Try again (or switch the layer off and on)
        UI->>API: GET /v1/objects/{id}/overlays again
      end
    end
    UI->>FB: Markers in cutout pixels, contamination note, field-of-view map
    opt Flagged pixels
      FB->>API: GET /v1/objects/{id}/flags/{frame_id}.png
      API-->>FB: RGBA mask from FLAGS, or 404 flags_unavailable
    end
  end
  opt P1 combine frames (issue #12, Q-54)
    U->>UI: Choose frame A, frame B and add or subtract
    UI->>API: GET /v1/objects/{id}/combine.png?op=add|sub&a=…&b=…
    API-->>UI: PNG on A's grid, X-SX-Combine header (both wavelengths, unit, stretch, tag derived, formula)
  end
  opt P1 Rainbow Trails view mode (D-28)
    U->>FB: Switch to Rainbow Trails
    FB->>FB: One dot per band along the mover's path, from the frames and positions already loaded
    FB->>FB: Dot colour = false colour, hue = wavelength (derived, Estimated badge). Monochrome in Measured only
  end
```

## Notes

- Endpoints follow D-16. Every endpoint is keyed by the object id that `resolve` returns. There is no separate flipbook endpoint: the flipbook plays the frame list in order.
- Small-body names are numbered asteroids (`433 Eros`), provisional designations (`2024 AB`), comets (`C/…`) and interstellar objects (`3I/ATLAS`) (D-19).
- Cache order (D-25): cache, then a live call with a timeout and retries with backoff, then an older cached entry, then refuse. There is no expiry for the event. A refused layer goes in `missing`.
- All five test targets (Barnard's Star, Epsilon Indi B, WISE 0855, RW Aurigae, R Draconis) and the demo objects are pre-fetched, so the demo runs with `SX_OFFLINE=1` and always hits the cache (D-25).
- A `candidate` source gets one haptic tick per frame where it is detected (rendering doc §8.5). That path is not drawn here.
- Rainbow Trails is built after basic playback works (D-28). As built in M1 (issue #3), the dot colour is a false colour, hue = wavelength, tagged `derived` with that formula, so it wears the Estimated badge. In "Measured only" (D-21) the dots are drawn in one colour. The mode is offered only for a `moving` object whose frames share a north-up grid, so with real data it waits for Q-21. The M1 UI has no honesty toggle yet, so the monochrome state is not reachable from the page. Tagging question: Q-27.
- URL hash (architecture spec §10, hash routing): `#ra=<deg>&dec=<deg>[&name=<search text>][&frame=<frame_id>]`. `name` is kept for a name search, so a link to a moving object reopens the same object id. A link with a name searches the name, otherwise the coordinates. Going back to the page without a hash resets the search. Unusable parts (bad coordinates, or no name and no coordinates) are ignored, never guessed: they are shown under the search field and announced in the polite live region.
- Dev-only fixture path: `npm run dev:fixtures` (`vite --mode fixtures`) mounts a Vite dev-server plugin from `frontend/fixtures/` that answers `/v1` with synthetic data, and `npm run test:e2e` always uses it. Every reply carries `X-SX-Fixture: synthetic`. The UI then shows a page-wide "Fixture data" banner, "Fixture" badges instead of "Measured" (and instead of the stretch's Estimated badge) and a SYNTHETIC label on the image. `vite build` never runs the plugin, and `scripts/check-dist.js` fails the build if a fixture marker reaches `dist/` ([fixtures README](../../frontend/fixtures/README.md)). The Fixture badge is a fourth badge beside the 3 of D-02; it is a proposed dev-only exception, open as Q-32 in the decisions log.
- `moving` means a solar-system body (Q-22). High proper-motion stars are not `moving`; their positions come from the SIMBAD proper motion, propagated to each frame time. The ephemeris-driven frame search for moving objects is not built in M1 (Q-21).
- The SIA search and every cutout go through the cache. A cut-off SIA answer (`QUERY_STATUS=OVERFLOW`) adds `frames:truncated` to `missing`.
- Overlays (A4.9) load lazily on the first switch-on of any layer, not on every search, and never block the flipbook. A catalogue still being fetched after `overlay_wait_s` (75 s, below the frontend's 90 s timeout) is reported as `overlay:<cat>:pending`; its toggle stays enabled and "Try again" reloads the overlays, by which time the cone is usually cached. A cone that failed live is not retried for `catalog_failure_ttl_s`. Moving objects get `overlay:gaia` and `overlay:wise` (Q-21). The endpoints are not yet in D-16 (Q-50).
- The flipbook shows the frames reply's `missing` grouped by reason, one plain line with a count each and the frame IDs behind a disclosure; unknown codes are shown as is (A11, issue #24).

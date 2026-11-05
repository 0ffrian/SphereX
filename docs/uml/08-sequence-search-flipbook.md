# 08 Sequence: search and flipbook

A user searches by name or RA/Dec and the flipbook plays the SPHEREx frames of that patch (the P0 base requirement). Drawn from architecture spec §1.1, §3.1, §3.4–3.5, §4.1 and §9, rendering doc §4 (display level 1) and decisions D-16 (endpoints), D-19 (resolver order), D-25 (cache) and D-28 (Rainbow Trails).

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

  U->>UI: Enter name or RA/Dec
  UI->>UI: Write coordinates or id to URL hash (share link)
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
  UI->>FB: Load frames
  loop each frame
    FB->>API: GET /v1/objects/{id}/cutouts/{frame_id}.png
    API-->>FB: Cutout stretched to PNG by the server
  end
  loop play
    FB->>FB: Show next frame, clickable rings on sources
  end
  opt P1 overlays
    U->>FB: Toggle Gaia / WISE markers
  end
  opt P1 Rainbow Trails view mode (D-28)
    U->>FB: Switch to Rainbow Trails
    FB->>FB: One dot per band along the mover's path, from the frames and positions already loaded
  end
```

## Notes

- Endpoints follow D-16. Every endpoint is keyed by the object id that `resolve` returns. There is no separate flipbook endpoint: the flipbook plays the frame list in order.
- Small-body names are numbered asteroids (`433 Eros`), provisional designations (`2024 AB`), comets (`C/…`) and interstellar objects (`3I/ATLAS`) (D-19).
- Cache order (D-25): cache, then a live call with a timeout and retries with backoff, then an older cached entry, then refuse. There is no expiry for the event. A refused layer goes in `missing`.
- All five test targets (Barnard's Star, Epsilon Indi B, WISE 0855, RW Aurigae, R Draconis) and the demo objects are pre-fetched, so the demo runs with `SX_OFFLINE=1` and always hits the cache (D-25).
- A `candidate` source gets one haptic tick per frame where it is detected (rendering doc §8.5). That path is not drawn here.
- Rainbow Trails is built after basic playback works (D-28).
- `moving` means a solar-system body (Q-22). High proper-motion stars are not `moving`; their positions come from the SIMBAD proper motion, propagated to each frame time. The ephemeris-driven frame search for moving objects is not built in M1 (Q-21).
- The SIA search and every cutout go through the cache. A cut-off SIA answer (`QUERY_STATUS=OVERFLOW`) adds `frames:truncated` to `missing`.

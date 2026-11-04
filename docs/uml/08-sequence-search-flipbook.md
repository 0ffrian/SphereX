# 08 Sequence: search and flipbook

A user searches by name or RA/Dec and the flipbook plays the SPHEREx frames of that patch (the P0 base requirement). Drawn from architecture spec §1.1, §3.1, §3.4–3.5, §4.1 and §9, rendering doc §4 (display level 1) and Q-05 (resolver order).

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant UI as UI shell
  participant FB as Flipbook
  participant API as Backend API
  participant C as /data cache
  participant R as Name resolver (SIMBAD or SBDB, Q-05)
  participant SIA as IRSA SIA (spherex_qr2)
  participant HZ as Horizons + SkyBoT

  U->>UI: Enter name or RA/Dec
  UI->>UI: Write coordinates or id to URL hash (share link)
  UI->>API: Search request (endpoint not named in spec)
  alt input is a name
    API->>R: Resolve name
    R-->>API: RA, Dec
  end
  API->>C: Look up SIA result for RA, Dec, radius
  alt cache hit
    C-->>API: Frame list and cutouts
  else cache miss
    API->>SIA: SIA?COLLECTION=spherex_qr2&POS=circle RA DEC RADIUS&MAXREC=N
    alt archive answers
      SIA-->>API: Frame list (time, detector, wavelength range)
      API->>SIA: Small cutouts only, never whole frames
      SIA-->>API: Cutouts: IMAGE, FLAGS, VARIANCE, WCS-WAVE
      API->>C: Store result
    else 504 timeout (known IRSA problem)
      SIA-->>API: 504
      API-->>UI: Error: archive slow, suggest a cached target
    end
  end
  opt moving object (asteroid, comet, high proper motion)
    API->>HZ: Position at each frame time, neighbours in field (SkyBoT -ep as JD)
    HZ-->>API: Positions and known objects
    API->>API: Sky to pixel per frame via WCS
  end
  API-->>UI: Frames + cutout URLs + source positions (frame_id, x, y, time)
  UI->>FB: Load frames
  loop play
    FB->>FB: Show next frame, clickable rings on sources
  end
  opt P1 overlays
    U->>FB: Toggle Gaia / WISE markers
  end
```

## Notes

- Neither spec names the search or frames endpoint; only `/v1/objects/{id}/card` and `/render-params` are named. **[verify]** with Kevin.
- All five test targets (Barnard's Star, Epsilon Indi B, WISE 0855, RW Aurigae, R Draconis) and the demo objects are pre-fetched, so the live demo should always hit the cache.
- A `candidate` source gets one haptic tick per frame where it is detected (rendering doc §8.5). That path is not drawn here.
- Whether Rainbow Trails is a view mode of this flipbook is Q-04 open.

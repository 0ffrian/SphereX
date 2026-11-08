# 20 Sequence: SPHEREx colour composite

How the backend answers `GET /v1/objects/{id}/composite` and `/composite.png` (sky-view prototype, beyond D-16): band selection, alignment on one grid, stretch and the derived cache. The flipbook side (Raw ↔ Colour toggle, `colour=` link parameter) is in [08](08-sequence-search-flipbook.md). Drawn from architecture spec §4.1 and §4.2, the [backend README](../../backend/README.md#composite) and decisions D-25 (cache), Q-21 (moving objects), Q-27 and Q-93 (tags), Q-92 (endpoints), Q-94 (constants) and Q-97 (progressive frames).

```mermaid
sequenceDiagram
  autonumber
  participant FB as Flipbook (ColourViews, store)
  participant API as api/composite.py
  participant CS as CompositeService (core/composite/service.py)
  participant FS as Stage 1 FrameService (core/find)
  participant SS as Stage 2 SpectrumService (core/measure)
  participant SEL as select.py (bands, pass)
  participant G as grid.py (mask, grid, resample, stretch, PNG)
  participant C as Read-through cache (D-25)

  FB->>API: GET /v1/objects/{id}/composite (only once the frame list is complete or the user pressed Stop, Q-97)
  API->>API: Load the resolved object (404 not_found if resolve was never called)
  API->>CS: get(object)
  alt moving object (Q-21)
    CS-->>API: Refusal: composite:moving_object
  else fixed object
    CS->>FS: get_frames (once per request, live cap SX_LIVE_CUTOUTS_PER_REQUEST)
    FS-->>CS: Frame records, missing (frames:truncated and cutouts:deferred:n are passed through)
    CS->>SS: get_spectrum on the same frame list (cached cutouts only)
    SS-->>CS: Stage 2 verdict per frame: a point (flagged or not) or a refusal (saturated, aperture_flags, …)
    CS->>SEL: Candidates: frames Stage 2 measured, refused frames are never used
    SEL->>SEL: Per channel (blue, green, red): frames within 10 % of 1.2, 2.2, 4.5 µm (placeholders, Q-94)
    SEL->>SEL: One pass: all three within 14 days. Fewest flagged channels, then smallest summed offset, shortest span, earliest start
    alt no usable selection
      SEL-->>CS: composite:channel:no_frame / saturated / no_usable_frame, composite:too_few_bands, composite:no_common_pass
      CS-->>API: Refusal body
    else three frames chosen
      SEL-->>CS: Picks, plus skipped notes (a refused frame nearer the target)
      CS->>C: Look up derived.composite: object position and proper motion, frame records, cutout SHA-256s, cutout size, constants, COMPOSITE_VERSION
      alt cache hit
        C-->>CS: Stored body and PNG
      else cache miss
        CS->>C: Read the three cached cutouts (never downloads here)
        C-->>CS: IMAGE, FLAGS, TAN-SIP WCS
        CS->>G: Mask pixels with a Stage 2 reject flag
        CS->>G: Scale = median √(pixel solid angle) at the object pixel, 0.01″, side = odd px nearest SX_CUTOUT_SIZE_ARCSEC / scale
        CS->>G: TAN grid, north up, east left, centred on the position at the mean time of the three frames
        G->>G: Alignment: each grid pixel to RA, Dec, to the frame's own pixel (all_world2pix), bilinear, outside or masked = no data (black, nodata_px)
        G->>G: Stretch per band: black at the median, white at max(99.5th percentile, median + 10 × 1.4826 MAD), asinh
        G-->>CS: 8-bit RGB PNG (B, G, R = short, middle, long λ)
        CS->>CS: Body: image_url with ?v=12 hex of the PNG's SHA-256, x, y, bands, tag derived, formula
        opt frame list complete and every cutout cached
          CS->>C: Store derived.composite (body + PNG)
        end
      end
      CS-->>API: Body and PNG
    end
  end
  API-->>FB: 200 composite body (a refusal has image_url null and the reasons in missing)
  opt image_url set
    FB->>API: GET /v1/objects/{id}/composite.png?v=…
    API->>CS: get(object), the same path
    alt PNG built
      CS-->>API: PNG bytes
      API-->>FB: image/png, cached by the browser for a day only when v names these bytes, otherwise no-cache
    else refused
      API-->>FB: 404 not_found with the reasons
    end
  end
```

## Notes

- The composite is false colour, tagged `derived` with the reply's `formula` (Q-27, Q-93). In "Measured only" (D-21) the flipbook does not request it and shows the grey frames with a note ([08](08-sequence-search-flipbook.md)).
- The endpoints are not in D-16 yet; Q-92 proposes adding them. The band targets, pass length and stretch are placeholders (Q-94, a creative call for Atish).
- Stage 1 runs once per request, so a live backend downloads at most `SX_LIVE_CUTOUTS_PER_REQUEST` cutouts here as well (Q-97, Q-99). The composite itself reads only cutouts that are already cached.
- `scripts.prefetch` builds the composite for every non-moving target after it fills the frame list, so it is in the cache for `SX_OFFLINE=1` (D-25). A refusal is an answer, not a failure.
- Further refusals and notes (`composite:<channel>:stretch`, `composite:pixel_scale`, `cutout:<id>`, `composite:no_proper_motion`, `composite:flags_unmasked:<id>`) are listed in the [backend README](../../backend/README.md#composite).

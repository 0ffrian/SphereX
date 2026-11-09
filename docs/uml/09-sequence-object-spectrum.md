# 09 Sequence: click an object, get its spectrum and card

Opening an object (a marker click opens the object panel, Q-120; or a click on a source in the flipbook) runs pipeline stages 1–3 and type selection, builds the `ObjectCard`, and the object panel shows the spectrum, the badges and Listen. Drawn from architecture spec §4.1–4.3 and §8, rendering doc §3.2–3.3, §4 (display level 2), §5.2, §8.6, and decisions D-02, D-04, D-16 (endpoints), D-25 (cache) and D-31 (saturated targets, demo objects), and Q-111 and Q-112 (the object job of [A4.10](../architecture/jobs.md#a410-object-job-and-fan-out), issue #41: the object job, its first, partial and final answers, the headers and the worker pools).

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant FB as Flipbook
  participant P as Object panel
  participant API as Backend API
  participant J as Object job (ObjectPipeline._job)
  participant PL as Pipeline (stages 1-3)
  participant TS as Type selection
  participant CB as Card builder
  participant EXT as SBDB, SIMBAD, DAMIT, Gaia, Exoplanet Archive
  participant SRC as SpectrumSource + HapticEngine
  participant AU as Audio / Listen

  U->>FB: Click ring on a source
  FB->>P: Open panel for object id
  P->>API: GET /v1/objects/{id}/spectrum
  API->>PL: Stage 1: positions per frame (cached cutouts only#59; the rest are listed as cutouts:deferred:n and on_request starts or joins the object job, Q-111 (5))
  alt derived.spectrum cached for this frame list, method and cutouts
    API->>API: Serve the stored spectrum (no cutout read)
  else not cached
    PL->>PL: Stage 2 per cached cutout: 3 px aperture minus 6-9 px annulus background, drop flagged pixels, variance to sigma, flux in uJy (pixel solid angle from WCS), wavelength from WCS-WAVE
    PL->>PL: Refuse a frame as saturated (core OVERFLOW) or aperture_flags, edge, background..., and flag points with dropped outer pixels
    PL-->>API: Spectrum and light curve (same measurements), refusals in missing
    API->>API: Store as derived.spectrum when the frame list is complete
  end
  API-->>P: Spectrum and light curve, tagged measured, flux_unit uJy (cached_at if from cache, spectrum:saturated when every listed frame saturated)
  P->>P: Group missing by reason with counts, IDs behind a disclosure#59; no points: say why (counts flagged saturated or unusable)#59; some refused: where the points lie, large gaps, the frames' span
  P->>API: GET /v1/objects/{id}/card
  alt saved asset (stage 4, diagram 16)
    API-->>P: Saved card unchanged (X-SX-Asset-Status saved or sketch)
  else no saved asset
  API->>J: Start or join the object's job (one per id, reused for SX_JOB_TTL_S, Q-111 (1))
  Note over J,EXT: Catalogue, Horizons geometry and the frame list start together. Cutouts download in the shared pool, SX_CUTOUT_CONCURRENCY at a time, the first batch at most SX_LIVE_CUTOUTS_PER_REQUEST, and each is measured in a MeasurePool worker (spawn, SX_MEASURE_WORKERS=2) as it lands (Q-112)
  J->>PL: Stage 3: match reference types (asteroid classes, brown dwarf types, gas features 2.7, 4.25, 4.67 um)
  PL->>EXT: Gaia colours if a known asteroid
  EXT-->>PL: Reflectance spectrum
  PL-->>J: Class + confidence
  J->>TS: Select ObjectType
  TS->>EXT: SBDB kind, shape registry lookup (registry.toml, Q-61), SIMBAD otype, Exoplanet Archive PSCompPars row if otype Pl (Q-63)
  EXT-->>TS: Matches
  TS-->>J: type (comet, asteroid_*, brown_dwarf*, star*, planet kinds, or candidate)
  J->>CB: Build ObjectCard
  CB->>EXT: Horizons geometry for comets and asteroids (phase angle, Sun vector, Q-62)
  CB->>EXT: SBDB phys-par (diameter, albedo, rot_per, spec_B, spec_T)
  EXT-->>CB: Values with their sources
  CB->>CB: Wrap each value as TV with tag and source, null if unknown
  CB->>CB: spherex_rgb from own spectrum (needs 2 points per channel)
  CB-->>J: ObjectCard
  opt first batch not done when the card can be built, and online
    J->>J: Publish the first stage: card from catalogue data, spherex_rgb, flux_45um and lightcurve value null with source measuring: (Q-111 (2))
  end
  opt frames remain after the first batch
    J->>J: Publish the partial answer, measured from the first batch (measuring:frames in RenderParams.missing). The rest download (stage queued while SX_MAX_JOBS full downloads run)
  end
  J->>J: Final: complete frame list, spectrum in frame order, saved when its inputs are final. Intermediate answers are never saved
  alt final answer within SX_FIRST_ANSWER_WAIT_S (2 s), or no intermediate answer yet (offline: waits for the final)
    API-->>P: ObjectCard (JSON, object-card.schema.json), no X-SX-Measuring or X-SX-Progress
  else otherwise
    API-->>P: Newest intermediate ObjectCard, X-SX-Measuring (its measuring: items) and X-SX-Progress (frames done/total, ? before the search)
  end
  end
  P->>P: Spectrum with sigma, light curve or motion
  P->>P: Card fields with 3 badges: Measured, Estimated, Default
  alt type is candidate
    P->>P: No Build it in 3D, show "Not enough data for a 3D model"
  else any other type
    P->>P: Show the Build it in 3D button (opens the build pane, R5.8)
  end
  opt user presses Listen
    U->>P: Listen
    P->>AU: Data sweep: spectrum to pitch, stereo
    AU->>SRC: Same events as spectrum haptics
  end
  opt user drags along the spectrum plot
    U->>P: Drag
    P->>SRC: x to wavelength, tick every 8 px
    SRC->>SRC: Strength = normalised flux, quiet below 20 pct, jitter if sigma over flux above 0.3
  end
```

## Notes

- Type selection order follows rendering doc §3.3; see [18-activity-type-selection.md](18-activity-type-selection.md). Name resolution happens earlier, in `resolve` (D-19, [08-sequence-search-flipbook.md](08-sequence-search-flipbook.md)).
- The Estimated badge covers `derived`, `model_dependent` and `inferred_from_analog`; its tooltip shows the formula, assumption or analog (D-02).
- Spectra and cards are cached in the backend's read-through cache, like every external call (D-25). The spectrum entry (`derived.spectrum`) is keyed by the method, Stage 1's `missing`, every frame record and every cutout's SHA-256, and is stored only for a complete frame list. Stage 2 itself never downloads (A4.2): a `/spectrum` request measures cached cutouts only and lists the rest as `cutouts:deferred:<n>`, while `FrameService.on_request` starts or joins the object's job, which downloads them (Q-111 (5)). Inside the job each cutout is measured in a `spawn` worker process as it lands and reused only when its bytes' SHA-256 and pixel position match (Q-112). Saturated frames are refused, never measured (D-31); the demo objects SIMP 0136, TWA 27 and IRAS 04302+2247 have measured spectra. The panel groups `missing` by reason (A11, issue #24) and words the empty state from the grouped counts, not from `spectrum:saturated`, which is absent when any listed frame was refused for another reason (Barnard's Star and R Dra on the full cache, A4.2). Calls to SBDB, SIMBAD, DAMIT, Gaia and the Exoplanet Archive also go through it.
- Spectrum haptic events go through the same `HapticEngine` and drivers as touch mode ([11-sequence-touch-haptics.md](11-sequence-touch-haptics.md)).
- As built (issue #5, `backend/app/core/card/service.py`): `/card` first looks up a saved asset (stage 4, [16-state-asset-lookup.md](16-state-asset-lookup.md)) and returns its card unchanged. Otherwise stage 3 takes the class label from the catalogue only (SIMBAD `sp_type`, SBDB `spec_B` then `spec_T`) with confidence `catalogue` or `none`, which the card does not carry; spectrum matching and the Gaia call are not built (Q-55). Issue #40 added the shape registry lookup (Q-61), the Horizons phase angle and Sun vector for comet and asteroid cards (Q-62) and the Exoplanet Archive adapter for SIMBAD `Pl` (Q-63); DAMIT is not called live. The card is checked with `jsonschema` before it is sent (Q-40), and `cached_at` and the asset status travel as the `X-SX-Cached-At` and `X-SX-Asset-Status` headers (Q-39). Since issue #41 (Q-111) a card without a saved asset comes from the object's background job: the reply is the final card if it arrives within `SX_FIRST_ANSWER_WAIT_S`, else the newest intermediate one (first stage `measuring:` or partial `measuring:frames`) with `X-SX-Measuring` and `X-SX-Progress`; only the final can be saved. `GET /v1/objects/{id}/job` and `/job/events` report the job (Q-111 (4)); the panel does not read them yet.

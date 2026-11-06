# 09 Sequence: click an object, get its spectrum and card

Clicking a source in the flipbook runs pipeline stages 1–3 and type selection, builds the `ObjectCard`, and the object panel shows the spectrum, the badges and Listen. Drawn from architecture spec §4.1–4.3 and §8, rendering doc §3.2–3.3, §4 (display level 2), §5.2, §8.6, and decisions D-02, D-04, D-16 (endpoints) and D-25 (cache).

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant FB as Flipbook
  participant P as Object panel
  participant API as Backend API
  participant PL as Pipeline (stages 1-3)
  participant TS as Type selection
  participant CB as Card builder
  participant EXT as SBDB, SIMBAD, DAMIT, Gaia, Exoplanet Archive
  participant SRC as SpectrumSource + HapticEngine
  participant AU as Audio / Listen

  U->>FB: Click ring on a source
  FB->>P: Open panel for object id
  P->>API: GET /v1/objects/{id}/spectrum
  API->>PL: Stage 1: positions per frame
  alt derived.spectrum cached for this frame list, method and cutouts
    API->>API: Serve the stored spectrum (no cutout read)
  else not cached
    PL->>PL: Stage 2 per cached cutout: 3 px aperture minus 6-9 px annulus background, drop flagged pixels, variance to sigma, flux in uJy (pixel solid angle from WCS), wavelength from WCS-WAVE
    PL->>PL: Refuse a frame as saturated (core OVERFLOW) or aperture_flags, edge, background..., and flag points with dropped outer pixels
    PL-->>API: Spectrum and light curve (same measurements), refusals in missing
    API->>API: Store as derived.spectrum when the frame list is complete
  end
  API-->>P: Spectrum and light curve, tagged measured, flux_unit uJy (cached_at if from cache, spectrum:saturated when every listed frame saturated)
  P->>P: Group missing by reason with counts, IDs behind a disclosure; no points: say why (counts flagged saturated or unusable); some refused: where the points lie, large gaps, the frames' span
  P->>API: GET /v1/objects/{id}/card
  API->>PL: Stage 3: match reference types (asteroid classes, brown dwarf types, gas features 2.7, 4.25, 4.67 um)
  PL->>EXT: Gaia colours if a known asteroid
  EXT-->>PL: Reflectance spectrum
  PL-->>API: Class + confidence
  API->>TS: Select ObjectType
  TS->>EXT: SBDB kind, DAMIT model, SIMBAD otype, Exoplanet Archive match
  EXT-->>TS: Matches
  TS-->>API: type (comet, asteroid_*, brown_dwarf*, star*, planet kinds, or candidate)
  API->>CB: Build ObjectCard
  CB->>EXT: SBDB phys-par (diameter, albedo, rot_per, spec_B, spec_T)
  EXT-->>CB: Values with their sources
  CB->>CB: Wrap each value as TV with tag and source, null if unknown
  CB->>CB: spherex_rgb from own spectrum (needs 2 points per channel)
  CB-->>API: ObjectCard
  API-->>P: ObjectCard (JSON, object-card.schema.json)
  P->>P: Spectrum with sigma, light curve or motion
  P->>P: Card fields with 3 badges: Measured, Estimated, Default
  alt type is candidate
    P->>P: No View in 3D, show "Not enough data for a 3D model"
  else any other type
    P->>P: Show View in 3D button
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
- Spectra and cards are cached in the backend's read-through cache, like every external call (D-25). The spectrum entry (`derived.spectrum`) is keyed by the method, Stage 1's `missing`, every frame record and every cutout's SHA-256, and is stored only for a complete frame list. Stage 2 reads cached cutouts only and never downloads (A4.2). Saturated frames are refused, never measured (Q-26). The panel groups `missing` by reason (A11, issue #24) and words the empty state from the grouped counts, not from `spectrum:saturated`, which is absent when any listed frame was refused for another reason (Barnard's Star and R Dra on the full cache, A4.2). Calls to SBDB, SIMBAD, DAMIT, Gaia and the Exoplanet Archive also go through it.
- Spectrum haptic events go through the same `HapticEngine` and drivers as touch mode ([11-sequence-touch-haptics.md](11-sequence-touch-haptics.md)).

# 09 Sequence: click an object, get its spectrum and card

Clicking a source in the flipbook runs pipeline stages 1–3 and type selection, builds the `ObjectCard`, and the object panel shows the spectrum, the badges and Listen. Drawn from architecture spec §4.1–4.3 and §8, rendering doc §3.2–3.3, §4 (display level 2), §5.2, §8.6, and decisions D-02 and D-04.

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
  P->>API: GET /v1/objects/{id}/card
  API->>PL: Stage 1: positions per frame
  PL->>PL: Stage 2: aperture flux minus background, drop flagged pixels, variance to sigma, wavelength from WCS-WAVE
  PL->>PL: Stage 3: match reference types (asteroid classes, brown dwarf types, gas features 2.7, 4.25, 4.67 um)
  PL->>EXT: Gaia colours if a known asteroid
  EXT-->>PL: Reflectance spectrum
  PL-->>API: Spectrum, light curve, class + confidence
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

- Type selection order follows rendering doc §3.3; see [18-activity-type-selection.md](18-activity-type-selection.md). Resolver order (SIMBAD or SBDB first) is Q-05 open.
- The Estimated badge covers `derived`, `model_dependent` and `inferred_from_analog`; its tooltip shows the formula, assumption or analog (D-02).
- Where the card is cached between requests is not stated in the specs **[verify]**.
- Spectrum haptic events go through the same `HapticEngine` and drivers as touch mode ([11-sequence-touch-haptics.md](11-sequence-touch-haptics.md)).

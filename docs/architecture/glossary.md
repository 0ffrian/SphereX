# Glossary

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A15

## A15 Glossary

| Term | Meaning |
|---|---|
| RA / Dec | Sky coordinates, like longitude and latitude on the sky. |
| FITS | The standard astronomy file format. |
| WCS | World Coordinate System, maps pixels to sky positions. |
| Flux | How much light arrives. |
| SIA / TAP | Standard web services for image search and table queries. |
| DAMIT | Database of asteroid shape models built from brightness changes. |
| Triplanar mapping | Texture lookup from three axes, so it does not stretch. |
| Equirectangular | A map where columns are longitude and rows are latitude, wrapped onto a sphere. The baked maps use it (rendering doc §6.1). |
| Rhines scale | Size at which a flow turns into zonal jets on a spinning planet. |
| Sedov-Taylor | A blast wave law for the early life of a supernova remnant. |
| ObjectCard | Everything known about one object, each value with its provenance tag and source (rendering doc §3.2). |
| RenderParams | What the frontend renders: layers, textures, lighting, view modes, haptic profile, alt text, refused layers (rendering doc §3.4). |
| Provenance tag | One of `measured`, `derived`, `model_dependent`, `inferred_from_analog`, `artistic`, carried by every value and layer. Shown as 3 badges ([section 5.2](data-contract.md#a52-provenance-tags-and-badges)). |
| Haptics | Touch feedback. Here, phone vibration patterns that let a finger feel a surface or a data value, paired with sound. |
| Asset | A saved ObjectCard for one body, plus its baked textures if it has any. |
| Orphan detection | A source found in one SPHEREx frame that matches no catalogue star and does not repeat at the same position in other frames of the pass ([A17.3](linker-backend.md#a173-static-removal-staticpy)). |
| Chain | Orphan detections in different frames that the Band-Hop Linker joins into one moving object's path ([A17.4](linker-backend.md#a174-linking-linkpy)). An unmatched chain is a candidate, not a discovery. |
| Completeness | The fraction of injected fake movers the linker recovers, by magnitude. Shown as the completeness atlas ([A17.6](linker-backend.md#a176-injection-completeness-and-control-injectpy)). |
| Shuffled-time control | The linker re-run on real detections with frame times permuted. Any chain it finds is a false link. |
| ADES | The Minor Planet Center's format for reporting astrometry. |

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
| Mover-to-be | A dot in an Area search that repeats across the exposures of its visit, matches no Gaia DR3 or CatWISE star and is not at the same place in the other visit ([A17.3](moving-objects/area-backend.md#a173-glitches-and-stars-cleanpy)). |
| Tracklet | Movers-to-be inside one visit that fall on a straight line in time ([A17.4](moving-objects/area-backend.md#a174-join-across-visits-joinpy)). |
| Track (Discovery) | Tracklets in different visits joined into one moving object's path. "Found blind" when SkyBoT names it; "unexplained" when nothing matches, which is a lead, not a discovery. A tracklet with no single partner is "possible". |
| Completeness | The fraction of injected fake movers a linker recovers, by magnitude. Phase 2 of Area search, not in the event build ([A17.6](moving-objects/area-backend.md#a176-injection-completeness-and-control)). |
| ADES | The Minor Planet Center's format for reporting astrometry. |

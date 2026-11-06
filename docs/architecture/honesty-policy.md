# Honesty policy

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A11–A11.1 · **Implements:** D-21 · **Read with:** [data-contract.md](data-contract.md)

## A11 Honesty policy (user-facing)

- Show the Measured, Estimated or Default badge next to every value ([section 5.2](data-contract.md#a52-provenance-tags-and-badges)). The Estimated tooltip shows the formula, assumption or analog.
- Flipbook (M1, issue #3): frame time and wavelength wear Measured, and the cutout pixels are `measured`; the display stretch wears Estimated (`derived`, tooltip with the stretch kind and parameters); the Rainbow Trails colour wears Estimated (`derived`, "false colour: hue = wavelength") and is drawn in one colour in "Measured only". See [A4.1](pipeline.md#a41-stage-1-find-the-object), rendering doc §4, Q-27 and Q-28. Synthetic fixture data on the dev-only fixture server wears "Fixture" and a page-wide banner instead, never Measured; a production build cannot contain it ([UML 08](../uml/08-sequence-search-flipbook.md#notes)). The Fixture badge is a proposed dev-only exception to the 3 badges of D-02, still open as Q-32.
- Offer the 3-state honesty toggle, one state per badge: Measured only, + Estimated, + Artistic (D-21). It starts at + Estimated. It applies to layers and haptics alike (rendering doc §5.3): only `measured` items stay in Measured only, so the `teq_pulse` stays there only when Teq comes from Exoplanet Archive `pl_eqt`.
- Label every rendering an artist's impression. Label imagined sounds "Imagined" and AI images "AI-made".
- New objects are labelled "Sketch from SPHEREx only".
- Real spacecraft photos are used only to compare against our output, never as textures.
- State limits in plain words, for example: SPHEREx cannot resolve an asteroid, so shape detail is not in the data.

### A11.1 Blind test (optional demo)

Pick an object with real spacecraft images (for example Bennu). Give the pipeline only the data a normal object would have. Show our result, then the real photo, with a scorecard:

| Compare | Expectation |
|---|---|
| Size, rough elongation | Should match |
| Colour class and brightness | Should match for known asteroids |
| Craters, ridges, boulders | Will not match |
| Concave or unusual shapes | Will not match |

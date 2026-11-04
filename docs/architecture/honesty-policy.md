# Honesty policy

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A11–A11.1 · **Read with:** [data-contract.md](data-contract.md)

## A11 Honesty policy (user-facing)

- Show the Measured, Estimated or Default badge next to every value ([section 5.2](data-contract.md#a52-provenance-tags-and-badges)). The Estimated tooltip shows the formula, assumption or analog.
- Offer the 3-state honesty toggle (Measured only, + Derived, + Artistic). It applies to layers and haptics alike (rendering doc §5.3).
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

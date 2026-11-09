# Renderer: comet

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R7.3 · **Implements:** [D-25](../../decisions/data-sources.md), [Q-42](../../decisions/contract.md), [Q-137](../../decisions/scope-process.md), [Q-17](../../decisions/haptics-design.md), [Q-103](../../decisions/rendering-motion.md) · **Read with:** [haptics/sources.md](../haptics/sources.md) (R8.4 field source), [display-rules.md](../display-rules.md) (R5.5 volumes)

### R7.3 `comet` (3I/ATLAS)

3I/ATLAS is a stretch target; the MVP demo body is 433 Eros (Q-137).

- **Requires:** `gas_Q` per epoch and `coma_radius_km`, filled from the published papers (Lisse et al.) with citations. Never guess them. In the R3.2 card shape `gas_Q` holds one epoch's values (Q-42), so it is used only when `epochs` lists exactly that epoch; with both epochs listed the shells are refused. The viewer opens on the latest epoch that has gas data.
- **Nucleus:** a dark sphere at `nucleus_radius_km_max`, labelled "upper size limit": the scale bar, comparison and alt text all say "at most X across (upper limit)". If the value is missing or hidden by the honesty level, draw a point. The nucleus keeps one size across epochs when the coma radius is known.
- **Gas shells:** (issue #43: drawn as one emission **volume**, the coma, with one emitter per gas; the shells stay in the plan as data for the haptics) one gas emitter per gas, with density ∝ 1/r² out to the coma radius. Point count and brightness are proportional to Q for the selected epoch. Total points (three shells plus dust) stay at or under the 60k budget ([§5.5](../display-rules.md#r55-performance-budget-d-05)). Fixed false colours with a legend: CO₂ = cyan, H₂O = blue, CO = magenta. Tag `measured` (Q) + `model_dependent` (1/r² profile).
- **Dust:** a pear-shaped, Sun-pointing dust volume, **December only**.
- **Tail:** none in August. Draw a tail only if a published December result shows one: the layers `ion_tail` and `dust_tail` exist only when the backend offers them, and both need the Sun direction. The ion tail is straight along `-sun` (`derived`); the dust tail is curved (bend side is `artistic`: the card holds no orbital velocity). Lengths are not to scale. A comet whose card has a loadable `shape_source` (67P) draws its nucleus from that model as in R7.1.
- **Epoch toggle:** Aug 2025 / Dec 2025. Clicking a shell highlights its spectral line, and clicking a line highlights its shell.
- **Haptics and sound:** field source ([§8.4](../haptics/sources.md#r84-event-sources)); its single tag is open (Q-17, R12 #20). The nucleus is a plain sphere with no height, so a comet has no body tone (R8.9.1); touching the nucleus gives one firm tick.

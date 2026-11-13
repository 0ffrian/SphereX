# Renderer: candidate

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R7.6 · **Implements:** [D-04, Q-33](../../decisions/contract.md), [Q-86](../../decisions/haptics-design.md), [Q-131](../../decisions/moving-objects.md) · **Read with:** [type-selection.md](../type-selection.md) (R3.3), [haptics/profiles.md](../haptics/profiles.md) (R8.5)

### R7.6 `candidate`

- **What it is:** anything stage 3 cannot type (R3.3 rule 6), including an exoplanet the Q-63 rule cannot place (`type:exoplanet_radius`, `type:exoplanet_mass`, `type:exoplanet_envelope` and the other A4.12 codes; the rule is on since issue #68). The tool covers known objects only (Q-131): a `candidate` is a known catalogue match the tool cannot draw, never a discovery claim.
- **Requires:** nothing. No 3D body is drawn, so no layer is refused for missing data, and there is no *Build it* (R4).
- **Shown:** the motion track over the frames, the spectrum, and the message "Not enough data for a 3D model: distance and albedo unknown".
- **Honesty:** the track and the spectrum keep their own tags and badges (R4 items 1 and 2).
- **Haptics and sound:** spectrum haptics only (R8.6). The flipbook `detections` ticks are refused (`detections` in `missing`) because frames carry no detection field (Q-86).
- **Alt text:** the panel's text says the type and the reason above; there is no 3D canvas to label (R9).
- **Amended for area tracks ([Q-469](../../decisions/moving-objects.md), issue #145):** *Build it* on a Discovery track that no known object explains shows a labelled placeholder (a plain unit sphere, layer `placeholder_shape`, `artistic`, no scale bar, size not drawn) through `asteroid_procedural`, not through `candidate`. A `candidate` found by search keeps this section unchanged.

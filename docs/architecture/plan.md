# Plan to 14 Nov

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A13 · **Implements:** D-14, D-29, D-30

## A13 Plan to 14 Nov

About 10 days. Dates are targets, not promises.

The team builds from 5 Nov and has set aside the event rule against building before 14 Nov (decisions D-14). Work is tracked as milestones M1–M5 with their due dates in D-29. M1–M4 build against their own fixtures and do not depend on each other; only M5 joins them.

| Dates | Work |
|---|---|
| 5 to 6 Nov | Data adapters and cache. Find the object, measure flux, build the flipbook for the five test targets (P0). |
| 7 to 8 Nov | Spectrum on the fly. Classify and pick the `ObjectType`. Asset lookup, ObjectCard and RenderParams. |
| 9 to 10 Nov | Texture baker for the baked types. Port the browser shader generators from the mock-up into the app. Physics layer v1 (planets and gas giants first). Haptic engine with the vibrate and audio drivers (10 Nov). |
| 11 Nov | Spectrum haptics with audio pairing, and calibration. Optional overlays (Gaia, WISE, contamination flags): built on 6 Nov in PR #32 (issue #12, [A4.9](pipeline.md#a49-overlays-flag-mask-and-combine)). Sound. |
| 12 Nov | Gemini artistic layer behind a server proxy, if time. Pre-bake demo assets and textures. |
| 13 Nov | Test on the Zenbook. Test haptics, audio sync and calibration on both Android phones. Fix performance. Record backup demo. |
| 14 to 15 Nov | Event. |

**Milestone dependencies (D-29, D-30).** Solid arrows are hard dependencies; dashed arrows are soft links that can be built against fixtures first. Owners in parentheses. Node labels are GitHub issue numbers.

```mermaid
flowchart LR
  subgraph M1["M1 SPHEREx core (shared)"]
    I1["#35;1 Backend core"] --> I2["#35;2 Spectrum"]
    I3["#35;3 Flipbook UI"]
  end
  subgraph M2["M2 Sky Sculptor (Moon)"]
    I4["#35;4 Schemas + fixtures"] --> I5["#35;5 Classify, card, render-params"]
    I4 --> I7["#35;7 Baked-type viewer"]
    I4 --> I8["#35;8 Shader kinds + CPU field"]
    I6["#35;6 Texture baker"] --> I5
  end
  subgraph M3["M3 Haptics & sound (Atish)"]
    I9["#35;9 Haptic engine"] --> I10["#35;10 Spectrum haptics"]
    I9 --> I11["#35;11 Texture haptics + sound"]
  end
  subgraph M4["M4 Extras (shared)"]
    I12["#35;12 Overlays"]
    I13["#35;13 Physics + sliders"]
    I14["#35;14 Gemini layer"]
  end
  subgraph M5["M5 Demo & submission (Kevin)"]
    I15["#35;15 Integrate + host on A15"] --> I16["#35;16 Device testing"] --> I17["#35;17 Backup video + submission"]
  end
  I8 -.->|"shared field"| I11
  I6 -.->|"height map"| I14
  I7 -.->|"viewer"| I13
  M1 --> I15
  M2 --> I15
  M3 --> I15
  M4 --> I15
```

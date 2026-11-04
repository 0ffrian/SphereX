# 06 Haptics and audio (classes)

The haptics engine, its drivers, the calibration store and the event sources. Drawn from rendering doc §8.3–8.8 and §10, and decisions D-08 (web only), D-09 (quantised strength), D-10 (audio on every platform, `pitch` and `pan`), D-12 (`terrain` and `flow` sources) and B-01 (Tauri, post-event). The engine fans out every event to all active drivers.

## Diagram 1: engine, drivers and calibration

```mermaid
classDiagram
  direction LR
  class HapticKind {
    <<enumeration>>
    tick
    double
    heartbeat
    pulseTrain
    stop
  }
  class HapticEvent {
    +kind: HapticKind
    +strength: number 0 to 1
    +rateHz: number, optional
    +tag: Tag
    +pitch: number, optional, D-10
    +pan: number, optional, D-10
  }
  class HapticDriver {
    <<interface>>
    +supported: boolean, readonly
    +emit(e: HapticEvent) void
    +stop() void
  }
  class HapticEngine {
    -drivers: HapticDriver list
    -minIntervalMs: number = 25
    -last: number
    +emit(e: HapticEvent) void
  }
  class WebVibrateDriver {
    <<drivers/webVibrate.ts>>
    +supported: vibrate in navigator
    -minMs: number
    -gain: number
    -levels: 3 or 4, D-09
    -ms(s: number) number
    +emit(e: HapticEvent) void
    +stop() void
  }
  class AudioDriver {
    <<drivers/audioClick.ts>>
    +supported: boolean
    +enabled: boolean
    +volume: number
    -audioOffsetMs: number
    +emit(e: HapticEvent) void
    +stop() void
  }
  class TauriDriver {
    <<stub, B-01 post-event>>
    +supported: boolean
    +emit(e: HapticEvent) void
    +stop() void
  }
  class Calibration {
    <<calibration.ts, per device>>
    +minMs: number
    +levels: number
    +audioOffsetMs: number
    +gain: number 0.5 to 1.5
    +load() Calibration
    +save() void
  }
  class LocalStorage {
    <<browser>>
  }
  class Tag {
    <<enumeration, see 05>>
  }

  HapticEvent --> "1" HapticKind
  HapticEvent --> "1" Tag
  HapticEngine "1" o-- "0..*" HapticDriver : drivers, fan-out
  HapticEngine ..> HapticEvent : emit, drops ticks under minIntervalMs
  WebVibrateDriver ..|> HapticDriver
  AudioDriver ..|> HapticDriver
  TauriDriver ..|> HapticDriver
  WebVibrateDriver --> Calibration : minMs, levels, gain
  AudioDriver --> Calibration : audioOffsetMs, gain
  Calibration ..> LocalStorage : persists

```

## Diagram 2: event sources

```mermaid
classDiagram
  direction TB
  class HapticSource {
    <<interface>>
    #profile: HapticProfile
    #engine: HapticEngine
  }
  class HapticProfile {
    <<see 05>>
    +texture: TextureHaptic
    +texture_tag: Tag
    +data: DataHaptic
    +data_tag: Tag
    +params: name to number map
  }
  class HapticEngine {
    <<see diagram 1>>
    +emit(e: HapticEvent) void
  }
  class HeightMapSource {
    <<sources/heightMap.ts, texture height>>
    -tau: 0.15 of local relief std
    analytic ellipsoid intersect, bilinear height.bin
    tick on rise then fall, double on rim, silent floor
    hydrated: strength x0.6
  }
  class MeshNormalSource {
    <<sources/meshNormal.ts, texture mesh>>
    three-mesh-bvh raycast
    tick when normal turns over 12 deg
    firm edge tick off the limb
  }
  class FieldSource {
    <<sources/field.ts, data field>>
    -k: number
    pulse rate clamp of k Q over r, 2 to 30 Hz
    comet coma, nebula and nova point density
  }
  class SpectrumSource {
    <<sources/spectrum.ts>>
    tick every 8 px of travel
    strength = normalised flux, quiet below 20 pct
    jitter if sigma over flux above 0.3
  }
  class LightcurveSource {
    <<sources/lightcurve.ts, data heartbeat or dimming>>
    Mira heartbeat per scrub step
    T Tauri stutter by dimming depth
  }
  class TerrainSource {
    <<D-12, texture terrain, file verify>>
    height ticks, coastline firm tick
    ocean swell 1 to 2 Hz, ice fine ticks
  }
  class FlowSource {
    <<D-12, texture flow, file verify>>
    tick at band boundary
    jet pulse train, storm swirl, ring gaps
  }
  class SharedField {
    <<D-12, 512 x 256 per body>>
    height, band, ocean, ice, storm channels
  }
  class HeightBin {
    <<baked float16 W x H>>
  }

  HapticSource --> "1" HapticProfile : reads
  HapticSource --> "1" HapticEngine : emit
  HeightMapSource ..|> HapticSource
  MeshNormalSource ..|> HapticSource
  FieldSource ..|> HapticSource
  SpectrumSource ..|> HapticSource
  LightcurveSource ..|> HapticSource
  TerrainSource ..|> HapticSource
  FlowSource ..|> HapticSource
  HeightMapSource --> HeightBin : samples
  TerrainSource --> SharedField : samples
  FlowSource --> SharedField : samples
```

## Notes

- `HapticEngine` replaces the single `driver` in rendering doc §8.8 with a `drivers` list. Every event goes to every active driver (D-10); the rate limit (≥ 25 ms between ticks, ≤ 40 events/s) is applied once, before the fan-out, and extra ticks are dropped, not queued.
- `WebVibrateDriver` maps `strength` to 3–4 discrete levels (D-09). Its `supported` is false on iPhone, iPad and desktop, so it is a silent no-op there.
- `AudioDriver` timbre follows the tag: clean tone for `measured`, grainy click for `artistic` (D-10). Its on/off switch and volume are separate from the haptics switch.
- `Calibration.gain` is the strength multiplier from rendering doc §8.7. `levels` and `audioOffsetMs` come from D-09 and D-10; their exact measurement is in rendering doc §8.9 **[verify once written]**.
- The brown dwarf `bands` texture and the `flux_pulse`, `teq_pulse`, `motion` and `detections` data haptics have no source file in rendering doc §10 **[verify]**.
- Drivers never know about objects; only sources read `HapticProfile`.

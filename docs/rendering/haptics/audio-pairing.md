# Haptics: audio pairing

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R8.9 · **Implements:** D-10, D-12 ([decisions](../../decisions.md)) · **Read with:** [engine-api.md](engine-api.md)

### R8.9 Audio pairing (D-10)

The audio driver plays **alongside** the vibration on every platform. Every `HapticEvent` goes to both drivers. On iPhone, iPad and desktop it is the only output.

**Timing**

- Web Audio. Every sound is scheduled on `AudioContext.currentTime` plus a small lookahead. Lookahead value: tune in testing **[verify]**.
- The `AudioContext` is created or resumed by the **same Touch-mode tap** that unlocks vibration.
- Pulse trains are scheduled **sample-accurately** on the audio clock, not with timers.
- The calibrated `avOffsetMs` ([§8.7](calibration.md#r87-calibration-and-settings)) aligns the two channels. If vibration is felt later than sound is heard, delay the audio by the offset; otherwise delay the vibration.

**Mapping**

| Event field | Audio parameter |
|---|---|
| `strength` | Continuous gain (not quantised, unlike vibration), times the volume setting |
| `pitch` | Frequency. Spectrum uses the **same λ→pitch mapping as the Listen sweep**. Surfaces: height → pitch or filter brightness. Gas giant bands: pitch follows latitude |
| `pan` | `StereoPannerNode`, from the finger's x |
| `tag` | Timbre (below) |

**Provenance by timbre**

| Tag | Sound |
|---|---|
| `measured` | Clean tone blip |
| `derived`, `model_dependent`, `inferred_from_analog` | Softer tone |
| `artistic` | Grainy noise click: a 4 ms noise burst with a 2 ms decay |

- Every texture sound on the shader-generated kinds uses the `artistic` timbre (D-12). Ocean is filtered noise (a "surf" sound); land is clicks, as for asteroids.
- `double` and `heartbeat` use the same timings as their vibration patterns ([§8.3](platform-encoding.md#r83-encoding-web-driver-d-09)).
- **Quiet dips are silent in both channels.** If the source emits nothing, neither driver plays.

**Bluetooth latency**

- Bluetooth output adds about 150–250 ms of latency.
- Read `AudioContext.outputLatency` (support in Android Chrome **[verify]**). When it is high (threshold **[verify]**), suggest the phone speaker or wired earphones.

**Imagined drive**

- The "imagined drive" sounds ([architecture spec §8](../../architecture/README.md)) are separate. They do not go through this driver and stay labelled "Imagined".

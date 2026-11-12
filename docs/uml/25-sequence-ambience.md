# 25 Sequence: the ambience tick (planned)

The flyover soundscape's live loop as R13.8 and R13.10 specify it ([R13](../rendering/sound/overview.md)). Planned for tickets #112 to #117. Only the audio graph at the end (`getBus('ambience')`, the duck, the level) is built (issue #111). Decisions: Q-431 to Q-442 in [sound-ambience.md](../decisions/sound-ambience.md).

```mermaid
sequenceDiagram
  autonumber
  participant F as WorldFlyStage (fly view, + Artistic)
  participant H as useAmbience (10 Hz)
  participant E as WorldEngine (fly instance)
  participant P as place.ts / wind.ts
  participant W as palette.ts + bake.worker
  participant M as mixer.ts
  participant G as audioGraph (built)
  F->>H: mount (close-up open, fly entered, sound unlocked, ambienceOn)
  H->>E: cpuFields(), weatherFields(), groundKm(), flyCameraBasis()
  H->>W: bake beds the physics allows (seeded, worker)
  W-->>H: bed ready, fade in - a failed bed is captioned, never faked
  loop every 100 ms
    H->>P: placeFeatures(samples, weather, model), windAt(...)
    P-->>H: features, wind (tags kept)
    H->>M: per-bed gains, filters, pan (levels.ts)
    M->>G: setTargetAtTime on bed gains into getBus(ctx, 'ambience')
  end
  Note over G: ambience → 35 Hz HPF → duck (−9 dB under data sounds) → level (ambienceVolume × volume) → master → limiter
  F-->>H: honesty drops, mute, ambienceOn off, close, page hidden
  H->>M: fade out 0.6 s, beds stay cached for 2 min
```

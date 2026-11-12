# 25 Sequence: the ambience tick (built in #116) and the weather overlay (built in #117)

The flyover soundscape's live loop as R13.8 and R13.10 specify it ([R13](../rendering/sound/overview.md)). Built by tickets #111 to #116: `useAmbience` runs `ambienceLoop.tick()` at 10 Hz. The weather snapshot goes to `weatherBus` for #117's overlay, with or without sound; #117's `WeatherOverlay` subscribes to it directly (no `useWeather` hook, Q-449) and draws rain, snow, bolts and glows through `FlashGate`. Gate events (close, hide, honesty, mute) fade at once on the audio clock without waiting for a tick (Q-448). Decisions: Q-431 to Q-442, Q-448 and Q-449 in [sound-ambience.md](../decisions/sound-ambience.md).

```mermaid
sequenceDiagram
  autonumber
  participant F as WorldFlyStage (fly view, + Artistic)
  participant H as useAmbience (10 Hz)
  participant E as WorldEngine (fly instance)
  participant P as place.ts / wind.ts
  participant W as palette.ts + bake.worker
  participant M as mixer.ts
  participant B as weatherBus
  participant O as WeatherOverlay (#117, 2D canvas, ≤ 30 fps)
  participant Q as FlashGate (#117)
  participant G as audioGraph (built)
  F->>H: mount (fly engine)
  F->>H: gate (entered, open, + Artistic, soundOn, ambienceOn, context running) → ambienceState
  H->>E: cpuFields(), weatherFields(), groundKm(), flyCameraBasis()
  Note over H,E: AirModel rebuilt only when the world, spin-up or R12 readiness changes (then debounced physics)
  H->>W: bake beds the physics allows (seeded, worker), also before the unlock click
  W-->>H: bed ready, fade in - a failed bed is captioned by name, never faked
  loop every 100 ms while the fly view is live (rAF, 10 Hz)
    H->>P: placeFeatures(samples, weather, model), windAt(...)
    P-->>H: features, wind (tags kept)
    H->>B: publishWeather(snapshot), publishStrike(strike) 0.3 s ahead
    H->>M: setWorld(key), per-bed gains, filters, pan (levels.ts) only when sound may play
    M->>G: setTargetAtTime on bed gains into getBus(ctx, 'ambience')
    Note over H: caption pushed after the tick's mix frame on a status change; above the ceiling: Q-447 hint
  end
  B-->>O: subscribeWeather(snapshot): rain or snow below the drawn deck, seeded rng32(world seed ^ frame bucket)
  B-->>O: onStrike(strike)
  O->>Q: offer(strike, now, safe): 2 s gap on t0 and between glow starts; late (> 50 ms) gives glow only
  Q-->>O: group (2–3 strokes) or dropped
  Note over O,Q: reduced motion or Flashes off: safe glow (0.15, 1 s), no bolt; a big bolt never restrikes (WCAG 2.3.1)
  O->>O: draw at most 30 fps, clear and stop when idle; caption "Weather: artist's impression ..." bottom-left while drawn
  Note over G: ambience → 35 Hz HPF → duck (−9 dB under data sounds) → level (ambienceVolume × volume) → master → limiter
  F-->>H: honesty drops, mute, ambienceOn off, close, page hidden
  H->>M: fade out 0.6 s, beds stay cached for 2 min
  F-->>H: gate on again (or waiting → place ready)
  H->>M: fadeIn() revives a group still fading; else a new group fades in
```

As built (Q-448): the hook mounts for every fly engine, bakes before the unlock (M16) and publishes the weather with sound off or muted; the gate inputs decide what plays. A place or sampling exception skips one tick; only a mixer exception latches `error`. As built (Q-449): the overlay is `aria-hidden` and never catches input; its weather caption sits bottom-left (`.sx-wx-cap`), clear of the Sound chip.

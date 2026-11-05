# 11 Sequence: Touch mode haptics

Feeling a surface with one finger in Touch mode, from the first tap to the vibration and the paired sound. Drawn from rendering doc §5.3, §5.6, §8.1–8.5, §8.8, and decisions D-08 (web only), D-09 (quantised strength), D-10 (audio on every platform), D-12 (shared field), D-20 (`sharpness`, debug hook) and D-21 (honesty filter).

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant V as ViewerApp
  participant S as HapticSource
  participant D as height.bin or shared field
  participant E as HapticEngine
  participant VD as WebVibrateDriver
  participant AD as AudioDriver
  participant PI as Pulse indicator (debug)

  U->>V: Tap Touch mode button or press T
  Note over V,AD: This tap is the user gesture that unlocks navigator.vibrate and resumes the AudioContext
  V->>V: Orbit controls off while exactly one pointer is down
  loop pointermove with one pointer
    U->>V: pointermove
    alt real shape model
      V->>V: Raycast with three-mesh-bvh
    else sphere, ellipsoid or shader body
      V->>V: Analytic ray intersect
    end
    V->>S: Surface point as UV
    S->>D: Bilinear sample
    D-->>S: Height or field channels
    S->>S: Decide event (tick, double, pulseTrain or nothing)
    alt event tag is hidden by the honesty state (D-21)
      S->>S: Silent, no event
    else event allowed
      S->>E: emit(kind, strength, tag, rateHz, pitch, pan, sharpness)
      alt tick less than 25 ms after the last one
        E->>E: Drop it, do not queue
      else accepted
        par fan-out to every driver
          E->>VD: emit(e)
        and
          E->>AD: emit(e)
        and
          E-)PI: spherex:haptic DOM event (D-20)
        end
        alt Android Chrome (vibrate supported)
          VD->>VD: navigator.vibrate(quantised ms, 3 or 4 levels)
        else iPhone, iPad or desktop
          VD->>VD: supported is false, no-op (audio only)
        end
        AD->>AD: Sound with gain, pitch, pan, timbre by tag, shifted by audioOffsetMs
      end
    end
  end
  U->>V: Second finger down
  V->>V: Two pointers rotate and zoom, no haptics
```

## Notes

- Touch mode only exists on the 3D view. Spectrum haptics on the panel use the same engine ([09-sequence-object-spectrum.md](09-sequence-object-spectrum.md)).
- Rate limit: ≤ 40 events/s and ≥ 25 ms between ticks (rendering doc §8.3). Only `tick` events are throttled in the §8.8 code.
- Measured only plays only `measured` events (D-21): procedural relief and every texture haptic on shader kinds are silent; real meshes still tick; every data haptic not tagged `measured` is silent, so the `teq_pulse` plays only when `teq_K` is `measured` (rendering doc §8.2, §7.7).
- `sharpness` is optional and ignored by the web driver (D-20).
- The `spherex:haptic` event drives an on-screen pulse indicator, so an audience watching the laptop can see what the phone feels (D-20). Which module fires it is not stated; it is drawn from the engine.
- How `audioOffsetMs` is applied is in rendering doc §8.9 **[verify once written]**.

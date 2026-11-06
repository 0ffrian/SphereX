# 11 Sequence: Touch mode haptics

Feeling a surface with one finger in Touch mode, from the first tap to the vibration and the paired sound. Drawn from rendering doc §5.3, §5.6, §8.1–8.5, §8.8, and decisions D-08 (web only), D-09 (quantised strength), D-10 (audio on every platform), D-12 (shared field), D-20 (`sharpness`, debug hook) and D-21 (honesty filter). As built in issues #9 (engine) and #11 (probe, profiles, sources).

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant V as ViewerApp
  participant P as TouchProbe
  participant T as TouchHaptics
  participant S as Texture or data source
  participant D as height.bin or shared field
  participant E as HapticEngine
  participant VD as WebVibrateDriver
  participant AD as AudioDriver
  participant PI as Pulse indicator (debug)

  U->>V: Click "Turn on haptics and sound" (Touch mode)
  Note over V,AD: This click unlocks navigator.vibrate and creates or resumes the AudioContext (Q-61)
  V->>V: buildHaptics(engine, params, card, body, overrides) gives the texture and data sources, the rings flag and missing (R8.5)
  V->>V: Orbit controls off while exactly one pointer is down
  loop pointermove with one pointer
    U->>V: pointermove
    V->>P: fromPointer(x, y, rect, camera)
    alt real shape model
      P->>P: Raycast with three-mesh-bvh (not built yet, so mesh haptics are refused until M5)
    else sphere, ellipsoid or shader body
      P->>P: Analytic ray intersect in the body frame (worldToBody)
    end
    P-->>V: TouchSample (body id, direction, UV, normal, projected distance, ring radius, pan)
    V->>T: move(sample)
    alt a held data pulse is playing and the finger stays within the tolerance
      T->>T: Keep the held data pulse, feed no source
    else otherwise (moving more than the tolerance also stops a held pulse)
      T->>S: texture.move(sample) and data.move(sample), every sample
      opt height map, terrain or flow source
        S->>D: Bilinear sample
        D-->>S: Height, masks, band index, storm id
      end
      Note over S: Comet, cloud and binary sources use the projected distance, the ray or the body id instead
      S->>S: Decide a tick, a double, a train or nothing (quiet)
      S->>E: emit(event) or startTrain / updateTrain / stopTrain (no timers in sources, Q-59)
    end
  end
  loop frame loop while the pointer is down
    V->>T: poll(now)
    opt still for HOLD_STILL_MS (teq_pulse, flux_pulse)
      T->>S: data.hold(sample)
      S->>E: startTrain(data), replacing any texture train (one train at a time)
    end
  end
  alt tag hidden by the honesty state (D-21)
    E->>E: Drop it before any driver and before the debug event
  else tick, double or heartbeat less than 25 ms after the last, or over 40 per second
    E->>E: Drop it, do not queue
  else accepted
    par fan-out to every driver
      E->>VD: emit(e) or playTrain(window)
    and
      E->>AD: emit(e) or playTrain(window)
    and
      E-)PI: spherex:haptic DOM event (D-20)
    end
    alt Android Chrome (vibrate supported)
      VD->>VD: navigator.vibrate(quantised ms, 3 or 4 levels, trains as 250 ms patterns)
    else iPhone, iPad or desktop
      VD->>VD: supported is false, no-op (audio only)
    end
    AD->>AD: Sound on currentTime + lookahead: gain, pitch, pan, timbre by tag and voice, shifted by the audio offset
  end
  U->>V: Finger up, cancel or leave
  V->>T: release()
  T->>E: stopTrain
  U->>V: Second finger down
  V->>V: Two pointers rotate and zoom, no haptics
```

## Notes

- Touch mode only exists on the 3D view. Spectrum haptics on the panel use the same engine ([09-sequence-object-spectrum.md](09-sequence-object-spectrum.md)). The light-curve pulses (Mira heartbeat, T Tauri dimming) are driven by the scrubber through `TouchHaptics.scrub`, not by the finger on the body.
- Rate limit: ≤ 40 events/s and ≥ 25 ms between ticks, doubles and heartbeats (rendering doc §8.3); a 250 ms train window counts as one event.
- The honesty filter lives in the engine, not in the sources (D-21). Measured only plays only `measured` events: procedural relief and every texture haptic on shader kinds are silent; real meshes still tick; every data haptic not tagged `measured` is silent, so the `teq_pulse` plays only when `teq_K` is `measured` (rendering doc §8.2, §7.7). Texture events carry `texture_tag`; data events carry `data_tag`, except `teq_pulse` (`teq_K`'s tag) and the binary pulse (`spectral_class`'s tag, Q-69).
- Holding still: `pointermove` does not fire while a finger is still, so the viewer's frame loop calls `poll` (Q-71). The shader kinds' sources read `BodyRenderer.field` and `pointSets`, which include the D-27 slider overrides.
- `sharpness` is optional and ignored by the web driver (D-20).
- The `spherex:haptic` event drives an on-screen pulse indicator, so an audience watching the laptop can see what the phone feels (D-20). The engine fires it after the honesty gate.
- The audio offset follows rendering doc §8.9: a positive `avOffsetMs` (vibration felt later) delays the audio; otherwise the vibration is delayed.

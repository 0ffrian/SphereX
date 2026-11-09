# 11 Sequence: feeling a body (Feel mode at the event, Touch mode after)

Feeling a surface, from the first click to the sound (and, after the event, the vibration). **At the event (Q-132)** the A15 laptop runs desktop Feel mode: a mouse drag in the build pane feels the body, and the only output is sound: the **body tone**, one continuous tone that follows the height (Q-133, [R8.9.1](../rendering/haptics/audio-pairing.md#r891-body-tone-from-the-height-map-q-133)). **After the event**, Touch mode on phones adds `navigator.vibrate` and the per-sample height ticks. Drawn from rendering doc R5.3, R5.6, R8.1–R8.5, R8.8, R8.9.1, and decisions D-08, D-09, D-10, D-12, D-20, D-21, Q-132 and Q-133. Engine and sources as built in issues #9 and #11; Feel mode, the tone stream and the body tone are not built yet (R5.6, R8.8, R8.8.1).

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

  U->>V: Click Feel in the build pane (event, R5.6) or "Turn on haptics and sound" (Touch mode, after the event)
  Note over V,AD: This click creates or resumes the AudioContext (Q-73), and on phones unlocks navigator.vibrate (after the event)
  V->>V: buildHaptics(engine, params, card, body, overrides) gives the texture and data sources, the rings flag and missing (R8.5)
  V->>V: Orbit controls off while feeling (mouse drag in Feel mode, one finger in Touch mode)
  loop pointermove while feeling
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
      alt height map, terrain land or mesh height (the body tone, Q-133)
        S->>E: updateTone(pitch from height, gain, pan) through the tone stream (proposed, R8.8, not built yet)
      else other sources, and the height ticks (vibration, after the event)
        S->>S: Decide a tick, a double, a train or nothing (quiet)
        S->>E: emit(event) or startTrain / updateTrain / stopTrain (no timers in sources, Q-71)
      end
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
    alt Android Chrome (vibrate supported, after the event)
      VD->>VD: navigator.vibrate(quantised ms, 3 or 4 levels, trains as 250 ms patterns)
    else the A15 laptop at the event, iPhone, iPad or desktop
      VD->>VD: supported is false, no-op (audio only)
    end
    AD->>AD: Sound on currentTime + lookahead: gain, pitch, pan, timbre by tag and voice, shifted by the audio offset
    opt body tone running
      AD->>AD: One sustained tone: pitch low in grooves and higher on peaks, timbre by the height's tag (R8.9.1)
    end
  end
  U->>V: Finger up, cancel or leave
  V->>T: release()
  T->>E: stopTrain and stopTone
  U->>V: Second finger down (Touch mode) or Feel off
  V->>V: Drag or two pointers rotate and zoom, no haptics
```

## Notes

- **Q-133 supersedes the height ticks for body interaction:** at the event the height map, terrain land and mesh height drive the body tone, not ticks. The tick, double and train decisions remain for the other sources and for vibration after the event ([R8.4](../rendering/haptics/sources.md#r84-event-sources)). As built, `haptics/sources/heightMap.ts` and `terrain.ts` still emit clicks.
- Feel mode (event) and Touch mode (after the event) exist only on the 3D view. Spectrum haptics on the panel use the same engine ([09-sequence-object-spectrum.md](09-sequence-object-spectrum.md)). The light-curve pulses (Mira heartbeat, T Tauri dimming) are driven by the scrubber through `TouchHaptics.scrub`, not by the finger on the body.
- Rate limit: ≤ 40 events/s and ≥ 25 ms between ticks, doubles and heartbeats (rendering doc §8.3); a 250 ms train window counts as one event.
- The honesty filter lives in the engine, not in the sources (D-21). Measured only plays only `measured` events: procedural relief and every texture haptic on shader kinds are silent; real meshes still tick; every data haptic not tagged `measured` is silent, so the `teq_pulse` plays only when `teq_K` is `measured` (rendering doc §8.2, §7.7). Texture events carry `texture_tag`; data events carry `data_tag`, except `teq_pulse` (`teq_K`'s tag) and the binary pulse (`spectral_class`'s tag, Q-81).
- Holding still: `pointermove` does not fire while a finger is still, so the viewer's frame loop calls `poll` (Q-83). The shader kinds' sources read `BodyRenderer.field` and `pointSets`, which include the D-27 slider overrides.
- `sharpness` is optional and ignored by the web driver (D-20).
- The `spherex:haptic` event drives an on-screen pulse indicator, so an audience can see what is felt or heard (D-20). The engine fires it after the honesty gate.
- The audio offset follows rendering doc §8.9: a positive `avOffsetMs` (vibration felt later) delays the audio; otherwise the vibration is delayed.

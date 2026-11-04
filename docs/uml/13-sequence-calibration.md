# 13 Sequence: first-use haptic calibration

The first-use calibration that sets the faintest pulse, the number of strength levels a person can tell apart, and the audio offset, stored per device. Drawn from rendering doc §8.7 and decisions D-09 and D-10. The level and tap-along steps follow D-09 and D-10; their exact procedure belongs in rendering doc §8.9 **[verify once written]**.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant CU as Calibration screen
  participant VD as WebVibrateDriver
  participant AD as AudioDriver
  participant CS as Calibration store
  participant LS as localStorage

  CU->>LS: Read calibration for this device
  LS-->>CU: None saved
  CU->>U: Offer calibration
  U->>CU: Tap Start (user gesture unlocks vibrate and audio)
  opt vibrate supported (Android Chrome)
    loop pulse of 5, 10, 20 ms
      CU->>VD: Vibrate pulse
    end
    CU->>U: "Tap the faintest one you felt"
    U->>CU: Picks a pulse
    CU->>CS: minMs = chosen duration
    CU->>VD: Play soft, medium, firm (and whisper if possible)
    U->>CU: Says which ones differ
    CU->>CS: levels = 3 or 4 (D-09)
  end
  CU->>AD: Play a steady click track
  loop several clicks
    U->>CU: Tap along
  end
  CU->>CS: audioOffsetMs from tap timing [verify method]
  CU->>CS: gain = 1 (strength multiplier, 0.5 to 1.5 in settings)
  CS->>LS: Save minMs, levels, audioOffsetMs, gain
  CU->>U: Done, settings can be changed later
```

## Notes

- On iPhone, iPad and desktop the vibration steps are skipped; only the audio steps run (D-08).
- The 8 ms soft tick must be felt on both Android phones after calibration (acceptance test, rendering doc §11); the realme 14 Pro's minimum is still **[verify]**.
- Settings also hold haptics on/off and the separate audio on/off and volume (rendering doc §8.7, D-10).

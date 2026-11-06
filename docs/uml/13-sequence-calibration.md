# 13 Sequence: first-use haptic calibration

The first-use calibration that sets the faintest pulse, the number of strength levels a person can tell apart, and the audio–vibration offset, stored per device. Drawn from rendering doc §8.7 and decisions D-09 and D-10, as built in issue #10 (`frontend/src/haptics/calibration.ts`, `haptics/ui/CalibrationWizard.tsx`). The tap-along method is Q-75 **[verify on phones]**.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant W as CalibrationWizard
  participant CL as calibration.ts
  participant NV as navigator.vibrate
  participant AD as AudioDriver
  participant E as HapticEngine
  participant LS as localStorage

  Note over CL,LS: On app load, applyStoredCalibration(outputs)
  CL->>LS: Read sx.haptics.calibration
  LS-->>CL: Saved values, or none or invalid, so the defaults apply
  alt not a phone that vibrates (no vibrate, not Android, or no touch screen)
    W->>U: Calibration is for phones that vibrate, nothing to do here
  else Android phone with navigator.vibrate
    W->>CL: loadCalibration, the base a skipped step keeps
    U->>W: Tap Start (click)
    W->>E: unlock() (creates or resumes the AudioContext)
    Note over W,U: Step 1, faintest pulse (Skip or Cancel)
    W->>NV: One pattern: 5, 10, 20 ms, 700 ms apart
    U->>W: Picks the faintest felt (answers enabled once played)
    Note over W,U: None felt keeps the stored minMs
    W->>CL: minMsFromAnswer
    Note over W,U: Step 2, levels (Skip or Cancel)
    W->>NV: One pattern: whisper, soft = minMs, medium, firm
    U->>W: Was the first buzz felt, and weaker than the second?
    W->>CL: levelSetFromAnswers (3 or 4 levels, D-09)
    Note over W,U: Step 3, tap-along (Skip or Cancel)
    W->>NV: Vibration-only beat (10 firm ticks, 800 ms)
    Note over W,U: Tap area names the channel, Beat n of 10
    loop each beat
      U->>W: Tap (touch, Space or Enter)
    end
    W->>CL: tapLag (vibration), median of the matched taps
    W->>E: unlock() (sound on and volume above 0 first)
    W->>AD: stop, setOffsetMs(0), playTrain(sound-only beat)
    loop each beat
      U->>W: Tap
    end
    W->>CL: tapLag (sound), computeAvOffset
    W->>AD: setOffsetMs(previous)
    alt Cancel at any step
      W->>NV: vibrate(0) if a pattern may still play
      W->>AD: stop() if a sound beat may still play
      W->>U: Closed, nothing saved, focus back to the opener
    else Save
      W->>CL: saveCalibration, only when a step was re-measured
      CL->>LS: Write sx.haptics.calibration (validated)
      W->>CL: applyCalibration
      CL->>AD: setOffsetMs(avOffsetMs) when positive
      CL->>NV: (via WebVibrateDriver) setLevels, setDelayMs(-avOffsetMs) when negative
      W->>U: Done, with a summary. Calibrate again from the settings
    end
  end
```

## Notes

- The wizard runs only on phones that vibrate: `navigator.vibrate` and Android with a touch screen (Q-74, Q-73). On iPhone, iPad and desktop there is one output, so there is nothing to align and no level to calibrate.
- A skipped step keeps what the device already has saved, or the R8.3 default (soft 8 ms, 3 levels, offset 0); nothing is written when no step was re-measured. "I felt none" keeps 8 ms and suggests checking vibration settings and battery saver (R12 #11).
- Tick lengths stay strictly increasing; medium and firm are raised when `minMs` is close to them. The whisper is kept only when it felt weaker than soft (Q-74).
- The strength multiplier (0.5 to 1.5) is a setting, not part of the calibration. Settings also hold haptics on/off, sound on/off, volume and the texture-vs-data labels toggle (rendering doc §8.7, D-10), in their own key `sx.haptics.settings`.
- The 8 ms soft tick must be felt on both Android phones after calibration (acceptance test, rendering doc §11); the realme 14 Pro's minimum is still **[verify]**.

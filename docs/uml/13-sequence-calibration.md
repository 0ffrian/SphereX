# 13 Sequence: first-use haptic calibration

The first-use calibration that sets the faintest pulse, the number of strength levels a person can tell apart, and the audio–vibration offset, stored per device. Drawn from rendering doc §8.7 and decisions D-09 and D-10, as built in issue #10 (`frontend/src/haptics/calibration.ts`, `haptics/ui/CalibrationWizard.tsx`). The tap-along method is Q-63 **[verify on phones]**.

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
  LS-->>CL: None or invalid, so the defaults apply
  alt vibrate not supported (iPhone, iPad, desktop)
    W->>U: Nothing to calibrate, everything also plays as sound
  else vibrate supported (Android Chrome)
    U->>W: Tap Start (click)
    W->>E: unlock() (creates or resumes the AudioContext)
    Note over W,U: Step 1, faintest pulse (skippable)
    W->>NV: One pattern: 5, 10, 20 ms, 700 ms apart
    U->>W: Picks the faintest felt, or "none"
    W->>CL: minMsFromAnswer
    Note over W,U: Step 2, distinct levels (skippable)
    W->>NV: One pattern: whisper, soft = minMs, medium, firm
    U->>W: Was the whisper felt, and different from soft?
    W->>CL: levelSetFromAnswers (3 or 4 levels, D-09)
    Note over W,U: Step 3, tap-along (skippable)
    W->>NV: Vibration-only beat (10 firm ticks, 600 ms)
    loop each beat
      U->>W: Tap (touch, Space or Enter)
    end
    W->>CL: meanTapLag (vibration)
    W->>E: unlock() (this click resumes audio)
    W->>AD: setOffsetMs(0), playTrain(sound-only beat)
    loop each beat
      U->>W: Tap
    end
    W->>CL: meanTapLag (sound), computeAvOffset
    W->>AD: setOffsetMs(previous)
    U->>W: Save
    W->>CL: saveCalibration {version, minMs, levels, avOffsetMs}
    CL->>LS: Write sx.haptics.calibration (validated)
    W->>CL: applyCalibration
    CL->>AD: setOffsetMs(avOffsetMs) when positive
    CL->>NV: (via WebVibrateDriver) setLevels, setDelayMs(-avOffsetMs) when negative
    W->>U: Done, with a summary. Calibrate again from the settings
  end
```

## Notes

- The wizard runs only where `navigator.vibrate` exists (Q-62). On iPhone, iPad and desktop there is one output, so there is nothing to align and no level to calibrate.
- A skipped step keeps the R8.3 default: soft 8 ms, 3 levels, offset 0. "I felt none" keeps 8 ms and suggests checking vibration settings and battery saver (R12 #11).
- Tick lengths stay strictly increasing; medium and firm are raised when `minMs` is close to them (Q-62).
- The strength multiplier (0.5 to 1.5) is a setting, not part of the calibration. Settings also hold haptics on/off, sound on/off, volume and the texture-vs-data labels toggle (rendering doc §8.7, D-10), in their own key `sx.haptics.settings`.
- The 8 ms soft tick must be felt on both Android phones after calibration (acceptance test, rendering doc §11); the realme 14 Pro's minimum is still **[verify]**.

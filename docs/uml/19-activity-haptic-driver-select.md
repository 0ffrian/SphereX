# 19 Activity: choosing haptic drivers at start-up

How the frontend decides which drivers the `HapticEngine` fans out to, and when calibration runs. Drawn from rendering doc §8.1, §8.7–8.8 and decisions D-08 (web only, no Tauri at the event), D-09 (calibration per device), D-10 (audio alongside vibration everywhere) and B-01.

```mermaid
flowchart TD
  Start(("App start")) --> LoadS[/"Read settings and calibration from localStorage"/]
  LoadS --> Tauri{"Running inside the Tauri app?"}
  Tauri -.->|"yes (B-01, post-event)"| AddTauri["Add TauriDriver"]
  Tauri -->|"no (the event build)"| VibQ{"navigator has vibrate? (Android Chrome)"}
  VibQ -->|"no: iPhone, iPad, desktop"| NoVib["No vibration driver"]
  VibQ -->|yes| HapOn{"Haptics switched on?"}
  HapOn -->|yes| AddVib["Add WebVibrateDriver"]
  HapOn -->|no| NoVib
  AddTauri -.-> AudOn
  AddVib --> AudOn{"Audio switched on?"}
  NoVib --> AudOn
  AudOn -->|yes| AddAud["Add AudioDriver (with own volume)"]
  AudOn -->|no| NoAud["No audio driver"]
  AddAud --> Any{"Any driver in the list?"}
  NoAud --> Any
  Any -->|no| Off["Engine idle: info stays available as text (rendering doc 9)"]
  Any -->|yes| Cal{"Calibration saved for this device?"}
  Cal -->|yes| Apply["Apply minMs, levels, gain, audioOffsetMs"]
  Cal -->|no| RunCal["Run first-use calibration (diagram 13)"]
  RunCal --> Apply
  Apply --> Engine["new HapticEngine(drivers, minIntervalMs = 25)"]
  Engine --> Gesture["Wait for first user gesture (Touch mode tap) to unlock vibrate and AudioContext"]
  Gesture --> Ready(("Ready"))
  Off --> Ready

  classDef post stroke-dasharray: 5 5
  class AddTauri post
```

## Notes

- With default settings, Android Chrome gets WebVibrateDriver + AudioDriver; iPhone, iPad and desktop get AudioDriver only (D-08, D-10).
- When calibration runs (at start-up or on first entry to Touch mode) is not fixed by the spec; "first use" is all it says **[verify]**.
- Haptics never carry information that is not also available as text or sound (rendering doc §9), so "Engine idle" loses no content.

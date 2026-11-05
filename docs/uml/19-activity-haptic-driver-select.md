# 19 Activity: choosing haptic drivers at start-up

How the frontend decides which drivers the `HapticEngine` fans out to, and when calibration runs. Drawn from rendering doc §8.1, §8.7–8.8 and decisions D-08 (web only, no Tauri at the event), D-09 (calibration per device), D-10 (audio alongside vibration everywhere), D-20 (`sharpness`, no native or iOS bridges, `spherex:haptic` debug hook) and B-01.

```mermaid
flowchart TD
  Start(("App start")) --> LoadS[/"Read settings and calibration from localStorage"/]
  LoadS --> Tauri{"Running inside the Tauri app?"}
  Tauri -.->|"yes (B-01, post-event)"| AddTauri["Add TauriDriver (uses sharpness)"]
  Tauri -->|"no (the event build, no native or iOS bridge, D-20)"| VibQ{"navigator has vibrate? (Android Chrome)"}
  VibQ -->|"no: iPhone, iPad, desktop"| NoVib["No vibration driver"]
  VibQ -->|yes| HapOn{"Haptics switched on?"}
  HapOn -->|yes| AddVib["Add WebVibrateDriver (ignores sharpness)"]
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
  Engine -.-> Debug["spherex:haptic DOM event per HapticEvent: debug hook, drives the on-screen pulse indicator (D-20)"]
  Engine --> Gesture["Wait for first user gesture (Touch mode tap) to unlock vibrate and AudioContext"]
  Gesture --> Ready(("Ready"))
  Off --> Ready

  classDef post stroke-dasharray: 5 5
  class AddTauri post
  classDef debug stroke-dasharray: 2 2
  class Debug debug
```

## Notes

- With default settings, Android Chrome gets WebVibrateDriver + AudioDriver; iPhone, iPad and desktop get AudioDriver only (D-08, D-10).
- The mock-up's `window.SphereXNative.haptic` and iOS `webkit.messageHandlers.sphereXHaptic` bridges are not checked: they are dropped for the event (D-20). The optional `sharpness` is ignored by the web driver and used by a future Tauri driver (B-01).
- The `spherex:haptic` debug event and its on-screen pulse indicator are drawn from the engine, as in diagrams 06 and 11. Which module fires it, and whether it fires when no driver is active, is not stated.
- When calibration runs (at start-up or on first entry to Touch mode) is not fixed by the spec; "first use" is all it says **[verify]**.
- Haptics never carry information that is not also available as text or sound (rendering doc §9), so "Engine idle" loses no content.

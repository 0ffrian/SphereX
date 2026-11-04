# 15 State: viewer interaction

How pointer, keyboard and the Touch-mode toggle change what the 3D view does. Drawn from rendering doc §5.6, §8.4, §9 and decisions D-08 and D-10.

```mermaid
stateDiagram-v2
  [*] --> DefaultMode

  state "Default mode" as DefaultMode {
    [*] --> DefIdle
    DefIdle --> Rotating : drag, arrows, rotate buttons
    Rotating --> DefIdle : release
    DefIdle --> Zooming : pinch, wheel, + or -
    Zooming --> DefIdle : release
    DefIdle --> DefIdle : R resets
  }

  state "Touch mode" as TouchMode {
    [*] --> TouchIdle
    TouchIdle --> Feeling : one pointer down
    Feeling --> TouchIdle : pointer up
    Feeling --> RotateZoom : second pointer down
    TouchIdle --> RotateZoom : two pointers down
    RotateZoom --> Feeling : one pointer lifted [verify]
    RotateZoom --> TouchIdle : all pointers up
  }

  DefaultMode --> TouchMode : T key or Touch button
  TouchMode --> DefaultMode : T key or Touch button

  state "Idle" as DefIdle
  state "Idle" as TouchIdle
  state "Feeling (haptics + audio)" as Feeling
  state "Rotate / zoom" as RotateZoom

  note right of Feeling
    Orbit controls disabled while exactly one pointer is down.
    pointermove samples the surface and emits HapticEvents.
  end note

  note left of TouchMode
    First entry is the user gesture that unlocks
    navigator.vibrate and the AudioContext.
  end note
```

## Notes

- Rotate buttons exist on screen in both modes (WCAG 2.5.7 alternative to dragging). All controls are ≥ 24×24 CSS px and keyboard reachable (rendering doc §9).
- `prefers-reduced-motion` disables auto-spin (rendering doc §9).
- Whether a `stop` event is sent on pointer up is not stated **[verify]**.
- On iPhone, iPad and desktop, Feeling produces sound only (D-08, D-10).

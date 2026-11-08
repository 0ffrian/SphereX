# 15 State: viewer interaction

How pointer, keyboard and the Touch-mode toggle change what the 3D view does, and when the viewer's sim clock runs. Drawn from rendering doc §5.6, §8.4, §9, R5.7 and decisions D-08, D-10, D-20 and D-34.

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

## Sim clock (motion)

The `SimClock` (`frontend/src/viewer/render/clock.ts`) runs only while a process exists (the spin, and since issue #42 the star, jet, storm, cloud and pulsation processes that `motion/planMotion.ts` states; Q-103) and no pause reason is set. Each reason is added and removed on its own; the clock runs again only when the set is empty.

```mermaid
stateDiagram-v2
  [*] --> Still

  state "Still (no process): render on change only" as Still
  state "Running: continuous frames, sim time advances" as Running
  state "Paused (one or more reasons): render on change only" as Paused

  Still --> Running : a process added (spin or another), no reason set
  Still --> Paused : a process added while a reason is set
  Running --> Still : process removed
  Running --> Paused : a pause reason is added
  Paused --> Paused : another reason added, or one of several removed
  Paused --> Running : last reason removed
  Paused --> Still : process removed

  note right of Paused
    'reduced-motion' : prefers-reduced-motion (R9)
    'hidden' : tab hidden
    'offscreen' : canvas out of view
    'user' : the user's pause button (WCAG 2.2.2)
    'idle' : coarse pointer only, 60 s without interaction,
      lifted by the next pointer, key or wheel input
      or the Resume spin button (shown in the spin note)
    'test' : freezeClock, never lifted
  end note
```

## Notes

- Rotate buttons exist on screen in both modes (WCAG 2.5.7 alternative to dragging). All controls are ≥ 24×24 CSS px and keyboard reachable (rendering doc §9).
- `prefers-reduced-motion` disables auto-spin (rendering doc §9): it is the `reduced-motion` pause reason above.
- Whatever pauses the clock, a change (honesty, new plan, rotate, zoom) still renders one settle burst. How the viewer implements motion and quality levels is Q-66 in [decisions](../decisions.md).
- Whether a `stop` event is sent on pointer up is not stated **[verify]**.
- On iPhone, iPad and desktop, Feeling produces sound only (D-08, D-10).
- Feeling works on every kind: nebulae and novae get the D-12 field pulse, not a refusal (D-20). Each emitted event also fires the `spherex:haptic` debug event, which drives the on-screen pulse indicator ([11-sequence-touch-haptics.md](11-sequence-touch-haptics.md)).

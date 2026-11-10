# 15 State: viewer interaction

How pointer, keyboard and the Feel and Touch toggles change what the 3D view does, and when the viewer's sim clock runs. Drawn from rendering doc R5.6, R5.8, R8.4, R8.9.1, R9, R5.7 and decisions D-08, D-10, D-20, D-34, **Q-132** (the event is the A15 laptop: desktop Feel mode, sound only; Touch mode and vibration after the event) and **Q-133** (feeling plays the body tone). The 3D view lives in the build pane of the split pane; the shell states around it are in [24-state-shell.md](24-state-shell.md). Feel mode is specified but **not built yet** (R5.6).

```mermaid
stateDiagram-v2
  [*] --> Building

  state "Building (moulding steps, R5.8)" as Building
  Building --> DefaultMode : last step done, or at once under reduced motion

  state "Default mode" as DefaultMode {
    [*] --> DefIdle
    DefIdle --> Rotating : drag, arrows, rotate buttons
    Rotating --> DefIdle : release
    DefIdle --> Zooming : pinch, wheel, + or -
    Zooming --> DefIdle : release
    DefIdle --> DefIdle : R resets
  }

  state "Feel mode (desktop, the event)" as FeelMode {
    [*] --> FeelIdle
    FeelIdle --> FeelDrag : mouse drag on the body
    FeelDrag --> FeelIdle : release
    FeelIdle --> FeelIdle : keyboard feel, R5.6
  }

  state "Touch mode (phones, after the event)" as TouchMode {
    [*] --> TouchIdle
    TouchIdle --> Feeling : one pointer down
    Feeling --> TouchIdle : pointer up
    Feeling --> RotateZoom : second pointer down
    TouchIdle --> RotateZoom : two pointers down
    RotateZoom --> Feeling : one pointer lifted [verify]
    RotateZoom --> TouchIdle : all pointers up
  }

  Building --> Building : Feel pressed while building, takes effect when built
  DefaultMode --> FeelMode : Feel button in the build pane
  FeelMode --> DefaultMode : Feel button
  DefaultMode --> TouchMode : T key or Touch button (after the event)
  TouchMode --> DefaultMode : T key or Touch button
  DefaultMode --> Building : Replay or New seed

  state "Idle" as DefIdle
  state "Idle" as FeelIdle
  state "Idle" as TouchIdle
  state "Feeling: body tone follows the height (Q-133)" as FeelDrag
  state "Feeling (sound, and vibration after the event)" as Feeling
  state "Rotate / zoom" as RotateZoom

  note right of FeelDrag
    Orbit controls disabled while feeling.
    pointermove samples the surface; the height
    sets the pitch of one continuous tone (R8.9.1).
  end note

  note left of TouchMode
    First entry is the user gesture that unlocks
    navigator.vibrate and the AudioContext.
  end note
```

## Sim clock (motion)

The `SimClock` (`frontend/src/viewer/render/clock.ts`) runs only while a process exists (the spin, and since issue #42 the star, jet, storm, cloud and pulsation processes that `resolveMotion` in `motion/motion.ts` states; Q-104). A process is registered only when it drives a drawn layer: `finishMotion` in `motion/planMotion.ts` fills `Motion.activeProcesses` and `ViewerApp` registers only that list, so a still scene does not run the frame loop (Q-108) and no pause reason is set. Each reason is added and removed on its own; the clock runs again only when the set is empty.

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

- Rotate buttons exist on screen in every mode (WCAG 2.5.7 alternative to dragging). All controls are ≥ 24×24 CSS px and keyboard reachable (rendering doc §9).
- `prefers-reduced-motion` disables auto-spin (rendering doc §9): it is the `reduced-motion` pause reason above.
- Whatever pauses the clock, a change (honesty, new plan, rotate, zoom) still renders one settle burst. How the viewer implements motion and quality levels is Q-66 in [decisions](../decisions/README.md).
- Whether a `stop` event is sent on pointer up is not stated **[verify]**.
- On the A15 laptop at the event, and on iPhone, iPad and desktop, feeling produces sound only (Q-132, D-08, D-10). How Feel works from the keyboard and while a build runs: R5.6 and R5.8.
- Feeling works on every kind except the nebula and the nova, which have no haptics (Q-103; it amends the D-12 and D-20 field pulse, Atish's acceptance pending). The 3D view says so in plain words ("Nebulae have no touch feedback"). Each emitted event also fires the `spherex:haptic` debug event, which drives the on-screen pulse indicator ([11-sequence-touch-haptics.md](11-sequence-touch-haptics.md)).

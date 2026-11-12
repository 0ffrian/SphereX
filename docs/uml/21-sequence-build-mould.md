# 21 Sequence: select a body and Build it

A left click on a marker opens the object panel (Q-120); a right-click or long press selects it and asks for the card; *Build it* opens the split view and moulds the body through the mock-up's steps from the real plan. Drawn from issue #60, Q-113 and Q-120 (decisions), [R5.8](../rendering/build-mould.md#r58-build-split-view-and-moulding) (the rules of the build pane), the shell's split pane ([A21.8](../architecture/sky-shell-behaviour.md#a218-split-pane)), R5.3, R5.7 and R9, decisions D-16, D-21 and D-34, and the mock-up (`showInfo`, `openBuild`, `PLAN`, `loop`). Shell states: [24-state-shell.md](24-state-shell.md).

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant S as SkyPane (marker)
  participant ST as App store
  participant L as useSelectedBodyLoader (App)
  participant C as SelectedCard (object card)
  participant API as Backend API
  participant B as BuildPane + ViewerPanel
  participant M as useMould
  participant PL as planRender
  participant V as ViewerApp
  participant RG as MouldRig (BuiltScene.setMould)

  U->>S: Right-click or long press a marker (a left click opens the object panel instead)
  S->>ST: skySearch(name, origin sky) with the card asked for
  ST->>API: GET /v1/resolve, then frames (as before)
  ST-->>S: resolved: brackets and the name on the sky
  ST-->>C: selection (no flipbook panel)
  ST-->>L: card asked for (or, later, the pane opens)
  L->>API: GET /v1/objects/{id}/card and /render-params (D-16), once per object (Q-120 item 5)
  alt both arrive
    API-->>L: card, params
    L->>ST: setObject(card, params)
    C-->>U: Card: name, type, See fingerprint, Build it
  else 404 or error
    C-->>U: Card: name, and Build it says there is no 3D model (404 is final and nothing is drawn, other errors offer Try again)
  end
  opt Card hidden, or no object picked
    U->>S: Right-click, long press or ContextMenu key on the brackets or a marker
    S->>ST: cardRequested (selects the marker first if it was not selected)
    ST-->>C: card shown again, and a bare position gets a card with a disabled Build it
  end
  U->>C: Build it
  C->>B: openBuild(animate): sky to the left half, pane on the right, #...&build pushed
  B->>PL: planRender(card, params, ctx): the normal plan
  B->>M: start (seq)
  M->>V: showPlan(plan) behind "Loading the 3D view"
  M->>V: whenLoaded(): textures, meshes, generated field, compile
  opt a D-37 world engine draws the body and has not formed it (hold, Q-339)
    M->>B: phase forming: the first step shown in progress
    B-->>M: hold ends: onFormed (shaders ready, spin-up done), or the engine fails and the three.js path draws
  end
  loop every frame, 2.3 s per step, smoothstep
    M->>PL: stage s: planRender(card, params, ctx + hold = later steps' layers)
    M->>V: showPlan(stage plan) when the stage changes (framed like the normal plan)
    M->>V: setMould(pose): scale, scaffold, morph, growth, shader knobs
    V->>RG: apply(pose)
    M->>B: step strip: active, done, bar fill
  end
  M->>V: setMould(null) and showPlan(plan)
  V->>RG: restore(): the scene is exactly what the build made
  B-->>U: "Built <name>" (polite), all steps ticked, the normal render
  U->>B: Escape, ×, or Back
  B-->>U: Full sky again, focus on the marker
```

## Notes

- Reduced motion (R9): no stages; the normal plan is shown at once and every step is ticked.
- Engine hold (issue #93, Q-339): while a D-37 world engine compiles and forms the world, `useMould` is in the phase `'forming'`; the steps play from the start once the engine reports `onFormed`. The engine's own lifecycle and watchdog are in [R5.9](../rendering/engines.md#r59-prototype-engines-d-37) and diagram [10](10-sequence-view-3d.md).
- The body loads in `useSelectedBodyLoader` (`app/build/selectedBody.ts`, called from `App.tsx`) when the card is asked for or the pane opens, not on every marker click (Q-120 item 5). SelectedCard only shows it.
- Feel (R5.6) takes effect once the body is built; during the moulding a drag turns the body (R5.8). Raising the honesty level automatically while moulding (Q-113 item 7) is proposed, not built.
- The rail's 3D viewer opens the same pane with `animate` false: the normal plan at once.
- A stage never draws a layer the normal plan does not draw (`mouldSteps.test.ts`); the base mould of a type whose shape is a layer is the plain body at the size on the card.
- The body's turn while building (mock-up auto-rotation and drag) is a view state like the camera: R or Reset view returns it to the normal pose.

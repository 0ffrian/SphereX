# 21 Sequence: select a body and Build it

A marker click selects the object; *Build it* opens the split view and moulds the body through the mock-up's steps from the real plan. Drawn from issue #60 and Q-113 (decisions), rendering doc R4, R5.3, R5.7 and R9, decisions D-16, D-21 and D-34, and the mock-up (`showInfo`, `openBuild`, `PLAN`, `loop`).

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant S as SkyPane (marker)
  participant ST as App store
  participant C as SelectedCard
  participant API as Backend API
  participant B as BuildPane + ViewerPanel
  participant M as useMould
  participant PL as planRender
  participant V as ViewerApp
  participant RG as MouldRig (BuiltScene.setMould)

  U->>S: Click a marker
  S->>ST: skySearch(name, origin sky)
  ST->>API: GET /v1/resolve, then frames (as before)
  ST-->>S: resolved: brackets and the name on the sky
  ST-->>C: selection (no flipbook panel)
  C->>API: GET /v1/objects/{id}/card and /render-params (D-16)
  alt both arrive
    API-->>ST: setObject(card, params)
    C-->>U: Card: name, type, See fingerprint, Build it
  else 404 or error
    C-->>U: Card: name; Build it says there is no 3D model (nothing drawn)
  end
  opt Card hidden, or no object picked
    U->>S: Right-click, long press or ContextMenu key on the brackets or a marker
    S->>ST: cardRequested (selects the marker first if it was not selected)
    ST-->>C: card shown again; a bare position gets a card with a disabled Build it
  end
  U->>C: Build it
  C->>B: openBuild(animate): sky to the left half, pane on the right, #...&build pushed
  B->>PL: planRender(card, params, ctx): the normal plan
  B->>M: start (seq)
  M->>V: showPlan(plan) behind "Loading the 3D view"
  M->>V: whenLoaded(): textures, meshes, generated field, compile
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
- The rail's 3D viewer opens the same pane with `animate` false: the normal plan at once.
- A stage never draws a layer the normal plan does not draw (`mouldSteps.test.ts`); the base mould of a type whose shape is a layer is the plain body at the size on the card.
- The body's turn while building (mock-up auto-rotation and drag) is a view state like the camera: R or Reset view returns it to the normal pose.

# 14 State: honesty toggle

The three-state honesty toggle in the 3D view, one state per badge: which tags each state shows and which haptics stay active. Drawn from rendering doc §5.3, §7.7, §8.2, §9, §11 (honesty test) and decisions D-02, D-12 and D-21.

```mermaid
stateDiagram-v2
  direction LR
  [*] --> PlusEstimated : open 3D view (starting state, D-21)

  MeasuredOnly --> PlusEstimated : select + Estimated
  PlusEstimated --> PlusArtistic : select + Artistic
  PlusArtistic --> PlusEstimated : select + Estimated
  PlusEstimated --> MeasuredOnly : select Measured only
  MeasuredOnly --> PlusArtistic : select + Artistic
  PlusArtistic --> MeasuredOnly : select Measured only

  state "Measured only" as MeasuredOnly
  state "+ Estimated" as PlusEstimated
  state "+ Artistic" as PlusArtistic

  note right of MeasuredOnly
    Shows tags: measured.
    Real mesh, or plain sphere or ellipsoid at measured size,
    flat measured tint, measured lighting.
    Haptics: measured events only. Mesh-normal ticks on real
    shape models, measured data haptics (spectrum, light curve),
    teq_pulse only when teq_K is measured (pl_eqt).
    Silent: procedural relief, all texture haptics on shader
    kinds, every non-measured data haptic.
  end note

  note right of PlusEstimated
    Adds tags: derived, model_dependent, inferred_from_analog.
    Class palette, derived colours, brightness from Teff or flux.
    Still hides: artistic layers.
    Haptics: adds Estimated data haptics, e.g. a derived teq_pulse.
    Artistic texture haptics still silent.
  end note

  note right of PlusArtistic
    Adds tags: artistic.
    Procedural relief, AI paint, band patterns,
    orbit drawings, shader surfaces.
    Haptics: all, including height-map, bands,
    terrain and flow (audio uses the artistic timbre).
  end note
```

## Notes

- One state per badge (D-02, D-21): Measured, Estimated, Default (artistic). The toggle starts at **+ Estimated**, so everything shown on load is backed by data or a stated formula.
- Every visible layer shows a tag chip in the legend. Each state change is announced through `aria-live="polite"` (rendering doc §9).
- Acceptance test: in Measured only no layer with a tag other than `measured` is drawn, and procedural texture haptics are silent (rendering doc §11).
- Haptics use the same filter as the layers (D-21). Whether the comet field pulse, tagged `measured` + `model_dependent` (rendering doc §8.4), plays in Measured only is Q-17.

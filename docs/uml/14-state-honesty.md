# 14 State: honesty toggle

The three-state honesty toggle in the 3D view, what each state shows and which haptics stay active. Drawn from rendering doc §5.3, §7.7, §8.2, §9, §11 (honesty test) and decisions D-02 and D-12.

```mermaid
stateDiagram-v2
  direction LR
  [*] --> PlusArtistic : open 3D view (initial state not set in spec [verify])

  MeasuredOnly --> PlusDerived : select + Derived
  PlusDerived --> PlusArtistic : select + Artistic
  PlusArtistic --> PlusDerived : select + Derived
  PlusDerived --> MeasuredOnly : select Measured only
  MeasuredOnly --> PlusArtistic : select + Artistic
  PlusArtistic --> MeasuredOnly : select Measured only

  state "Measured only" as MeasuredOnly
  state "+ Derived" as PlusDerived
  state "+ Artistic" as PlusArtistic

  note right of MeasuredOnly
    Shows: real mesh, or plain sphere or ellipsoid at measured size,
    flat measured tint, measured lighting.
    Hides: every artistic and inferred_from_analog layer.
    Haptics: mesh-normal ticks on real shape models,
    data haptics (spectrum, Q, light curve, motion, teq_pulse).
    Silent: procedural relief, all texture haptics on shader kinds.
  end note

  note right of PlusDerived
    Adds: class palette, derived colours,
    brightness from Teff or flux.
    Still hides: artistic relief.
    Haptics: as Measured only (artistic relief still silent).
  end note

  note right of PlusArtistic
    Adds: procedural relief, AI paint, band patterns,
    orbit drawings, shader surfaces.
    Haptics: all, including height-map, bands,
    terrain and flow (audio uses the artistic timbre).
  end note
```

## Notes

- Every visible layer shows a tag chip in the legend. Each state change is announced through `aria-live="polite"` (rendering doc §9).
- Acceptance test: in Measured only no `artistic` or `inferred_from_analog` layer is drawn and procedural texture haptics are silent (rendering doc §11).
- D-12 keeps the `teq_pulse` (tagged `derived`) in Measured only. Whether other `derived` data haptics stay on in Measured only is not stated explicitly **[verify]**.

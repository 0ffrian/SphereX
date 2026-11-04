# Accessibility tie-ins

> **Part of:** Rendering & haptics spec ([index](README.md)) · **Sections:** R9

## R9. Accessibility tie-ins

- **Alt text** (from the card): "<name>, <type>, <size + tag>, <colour basis>, viewed at <phase angle>°. Surface relief: <measured | illustrative>." Update `aria-label` on the canvas whenever the mode changes.
- `aria-live="polite"` announces mode, epoch and honesty-state changes.
- All controls are ≥24×24 CSS px and keyboard reachable. `prefers-reduced-motion` disables auto-spin.
- Haptics never carry information that isn't also available as text or sound. The audio pairing ([§8.9](haptics/audio-pairing.md#r89-audio-pairing-d-10)) now satisfies this by design: every haptic event also plays as sound.

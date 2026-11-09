# Accessibility tie-ins

> **Part of:** Rendering & haptics spec ([index](README.md)) · **Sections:** R9 · **Implements:** [D-21](../decisions/contract-tags.md), [D-34](../decisions/rendering-motion.md), [D-10, Q-133](../decisions/haptics-sound.md), [Q-113](../decisions/shell-surfaces.md) · **Read with:** [display-rules.md](display-rules.md) (R5.6, R5.7), [build-mould.md](build-mould.md) (R5.8), [audio-pairing.md](haptics/audio-pairing.md) (R8.9)

## R9. Accessibility tie-ins

- **Alt text** (from the card): "<name>, <type>, <size + tag>, <colour basis>, viewed at <phase angle>°. Surface relief: <measured | illustrative>." Update `aria-label` on the canvas whenever the mode changes.
- `aria-live="polite"` announces mode, epoch and honesty-state changes, the build's start and end ("Building <name>", "Built <name>") and the build's honesty raise ("Showing artist's impression so the whole body can be built", R5.8).
- All controls are ≥24×24 CSS px and keyboard reachable. The 3D view has on-screen rotate buttons as an alternative to dragging (WCAG 2.5.7, R5.6). Feel mode works from the keyboard too (R5.6).
- **Reduced motion.** `prefers-reduced-motion` disables auto-spin and pauses every simulation clock: the scene starts paused, with the pause button still available ([§5.7](display-rules.md#r57-motion-and-time-lapse), D-34). The build pane shows the built body at once, with no moulding and no auto-turn (R5.8). Sound is not motion: the body tone and the Listen sweep still play.
- **Focus.** Opening the build pane moves focus to its title; closing it moves focus to the selected object's sky marker, or to the sky canvas when there is none (`app/build/focus.ts`).
- **Nothing only by touch or sound.** Haptics and sounds never carry information that is not also available as text or as a picture. At the event there is no vibration (Q-132), so every haptic event is heard through the audio driver ([§8.9](haptics/audio-pairing.md#r89-audio-pairing-d-10)). The body tone (R8.9.1) repeats the relief that is drawn; the Track path sound (R8.9.2) repeats the drawn path, and the direction of travel is also given in text, never by stereo pan alone.
- A body with no touch or sound feedback says so in plain words in the 3D view's notes (for example "Nebulae have no touch feedback", R8.5), so Feel on it is not silent without a reason.

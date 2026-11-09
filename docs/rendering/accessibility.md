# Accessibility tie-ins

> **Part of:** Rendering & haptics spec ([index](README.md)) · **Sections:** R9

## R9. Accessibility tie-ins

- **Alt text** (from the card): "<name>, <type>, <size + tag>, <colour basis>, viewed at <phase angle>°. Surface relief: <measured | illustrative>." Update `aria-label` on the canvas whenever the mode changes.
- `aria-live="polite"` announces mode, epoch and honesty-state changes.
- All controls are ≥24×24 CSS px and keyboard reachable. `prefers-reduced-motion` disables auto-spin and pauses every simulation clock: the scene starts paused, with the pause button still available ([§5.7](display-rules.md#r57-motion-and-time-lapse), D-34).
- Haptics never carry information that isn't also available as text or sound. The audio pairing ([§8.9](haptics/audio-pairing.md#r89-audio-pairing-d-10)) now satisfies this by design: every haptic event also plays as sound.
- **Search combobox (issue #68, Q-161).** The search field is an ARIA combobox: the input has `role="combobox"`, `aria-expanded`, `aria-controls` and `aria-activedescendant`; the list is `role="listbox"` and each row `role="option"` with `aria-selected`. Focus never leaves the input. The list opens on focus, click, tap or "/", and when the user types. Arrow Up and Arrow Down move the highlight, Enter picks the highlighted row (with no highlight, Enter searches the typed text), Escape closes the list and keeps the text. It closes on a pick, on submit, and when focus or a click leaves the field. Filtering ignores case, apostrophes and spaces and checks the name and every alias. Hints: "No demo object matches. Press Enter to search the catalogues." and `Try "WISE 0855" or "269.452, 4.693"`. A row shows its name and, only when the pre-built card gives one, a class label; never a physical value.
- **Search list on a phone (width ≤ 640 px).** The list opens above the pill, out of the layout flow, so opening it never moves the pill. It has its own `max-height` and scroll, and each row is at least 44 px tall. The one-line help above the pill is hidden while the list is open (it stays available to screen readers through `aria-describedby`).

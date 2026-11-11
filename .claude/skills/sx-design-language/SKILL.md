---
name: sx-design-language
description: Load before writing, changing or reviewing any Shift & Spectrum UI (frontend components, CSS, Tailwind classes, the mock-up, or an artifact page). Gives the tokens, type, radii, controls and motion rules (D-38) and the checks every UI change must pass.
---

# Shift & Spectrum design language

1. Read [docs/design-language.md](../../../docs/design-language.md). It wins over the mock-up for look and feel (D-38).
2. For layout, structure and wording (where things sit, what they are called), the mock-up `mockup/spherex-ui.html` still applies.
3. The approved reference for panels is the Accuracy and Details preview: https://claude.ai/artifact/GoA2dKYrTKJKXprmhzkTy1 (read it with the Artifact tool). Match its spacing, radii and states rather than inventing new ones.

## Rules

- Colours only through tokens (`--bg`, `--s1` to `--s3`, `--line`, `--fg`, `--muted`, `--accent`, `--ac`/`--on-ac`, `--ok`, `--warn`, `--fail`, `--p-meas`, `--p-phys`, `--p-asm`). Never a raw hex in a component.
- Panels and cards are near-black with a trace of blue (`--s1 #0f1114` on `--bg #08090b`), to sit with the sky; not grey boxes, not pure black. The sky and the 3D view stay as they are.
- Inter only, bundled (`@fontsource/inter`, pinned), never fetched at run time (D-24). Labels are Inter uppercase and tracked, not monospace. Aligned numbers use `tabular-nums`.
- Radii: 10px cards and popovers, 8px tracks and inner blocks, 6px buttons and segmented items, 4px tags. No pills except the rail and docks. Switches are round.
- Selected state is tonal: `--ac` fill, `--on-ac` text. **Never a fluorescent border with a translucent tinted fill, and never a glow.**
- Controls come from Animate UI (Tabs, Toggle Group, Accordion, Switch, Button, Tooltip, Popover, Counting Number), pinned and restyled to the tokens. Don't hand-roll one it has.
- Buttons 40px in panels, 44px under Touch mode (R9). Outline by default; press scales to 0.98.
- Explanations fold into rows that open (Accordion), edge to edge with dividers, with a count on the right where it helps. The default view shows the label, the data and the action only.
- Provenance stays visible for every value and layer (D-02): the provenance colours in a key, or a tag with a coloured dot.
- Maths is KaTeX (D-36), with a plain-text alternative for screen readers.
- Motion: Animate UI's springs (press 550/30, highlight 500/40, height 300/30, progress 300/35, number 200/20), `--ease` for fades. Every animation has a `prefers-reduced-motion` path. Nothing loops to draw the eye.
- Copy: no em dashes; every line labels, shows data, acts, or informs a decision.
- Artifact pages and previews follow these rules too.

## Checks

Run the checklist at the end of docs/design-language.md before calling a UI change done.

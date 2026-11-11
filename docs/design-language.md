# Design language

The look and feel of every Shift & Spectrum screen: the app, the mock-up and any artifact page. Decided in D-38 (11 Nov 2026). It is adapted from the Penrose design language (`~/Desktop/Projects/Penrose/docs/DESIGN_LANGUAGE.md`, same author). Components come from **Animate UI** (animate-ui.com), the library the team agreed on (A15 frontend platform).

The reference for these rules is the approved preview of the Accuracy and Details panels: https://claude.ai/artifact/GoA2dKYrTKJKXprmhzkTy1. Where this page and the old mock-up (`mockup/spherex-ui.html`) differ, **this page wins**. The mock-up still sets layout, structure and wording (where things sit, what they are called).

## Principles

- **Dark, to sit with the sky.** Panels and cards are near-black with a trace of blue (`--bg #08090b`, `--s1 #0f1114`), darker than Penrose's Graphite, so they read as part of the night sky and the black bezel rather than grey boxes on top (Moon, 11 Nov 2026). Not pure black: the `--s1` to `--s3` steps still give depth, and text stays off pure white.
- **Depth from tone, not shadow.** Surfaces step `--s1` to `--s3`. No glows, no coloured shadows, no gradients.
- **The accent is rationed.** Use it for focus, a switch that is on, and links. Never use it for a border around a selected button.
- **Colour that means something stays.** The provenance colours (measured, physics, assumed: D-02) and the status colours are data, not decoration. Nothing else is coloured.
- **Show the label, the data and the action.** Fold explanations into rows that open; don't stack paragraphs.

## Tokens

The app is dark-only for now (Q-326). The light values are defined so that artifact pages and a later light theme use them, never a dark token at low opacity.

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--bg` | `#08090b` | `#fafafa` | page and panel background |
| `--s1` | `#0f1114` | `#f4f5f5` | cards, side panels |
| `--s2` | `#16191c` | `#eff0f1` | tracks, inputs, blocks inside a card, row hover |
| `--s3` | `#1e2226` | `#e9ebec` | tags, raised chips, switch track when off |
| `--line` | `#262b30` | `#c7ced1` | borders, dividers |
| `--fg` | `#e6e9eb` | `#181a1b` | text |
| `--muted` | `#9aa4ab` | `#5c6a70` | secondary text, icons |
| `--accent` | `#89cff0` | `#1d79a5` | focus, switch on, links |
| `--ac` / `--on-ac` | `#17303c` / `#d2e9f4` | `#d7ebf4` / `#193543` | the selected item in a segmented control or tab bar |
| `--ok` | `#22c55e` | `#15803d` | yes, passed |
| `--warn` | `#f2b84b` | `#a15c00` | caution |
| `--fail` | `#ff4d4f` | `#c92a2a` | no, error |
| `--p-meas` | `#4ade80` | `#16a34a` | provenance: measured (D-02) |
| `--p-phys` | `#38bdf8` | `#0284c7` | provenance: physics / derived |
| `--p-asm` | `#5f686e` | `#9aa5ab` | provenance: assumed |

Colours only through tokens (CSS variables or the Tailwind theme). Never a raw hex in a component.

## Type

- **Inter only**, weights 400, 500, 600, 700, bundled with the app (`@fontsource/inter`, pinned), never fetched at run time: the demo runs offline (D-24). No second family, no monospace for labels or prose. Numbers that line up use `font-variant-numeric: tabular-nums`.
- Body 14 to 15px / 1.5. Card title 15.5px semibold. Page title 26 to 30px semibold.
- **Eyebrow labels** for section labels inside a panel ("Light", "View"): 12px, weight 500, uppercase through `text-transform`, letter-spacing `.1em`, `--muted`. Never for sentences.
- **Tags and badges**: 11px, weight 500, uppercase, letter-spacing `.08em`, 4px radius, `--s3` fill. A provenance badge is a tag with a 6px dot in its provenance colour, not a coloured outline.
- Maths is KaTeX (pinned, D-36), never hand-drawn fractions.
- No em dashes in UI copy.

## Shape

| Radius | For |
| --- | --- |
| 10px | cards, panels, popovers, menus, dialogs |
| 8px | segmented-control tracks, blocks inside a card (formula, chart), 48px buttons, toasts |
| 6px | 36 to 40px buttons, segmented items, icon buttons, menu rows |
| 4px | tags, badges, counts |

No pills except the rail and floating docks that already are. Switches and avatars are round. **Big soft corners (12px and up on a control, 16px and up on a card) read as generated: don't.**

## Controls

Use Animate UI's components (Radix variants) where one exists: Tabs, Toggle Group, Accordion, Switch, Button, Tooltip, Popover, Counting Number. Add them with the shadcn CLI at a pinned version and restyle them to these tokens. Don't hand-roll a control Animate UI has.

- **Buttons**: 40px high with a 6px radius in panels (44px under Touch mode, R9), outline by default (`--line` border, transparent fill, `--s2` on hover). Press scales to 0.98. A filled primary uses `--accent` with dark text. A disabled filled button is `--s3` with `--muted` text, never a faded colour.
- **Segmented control** (Toggle Group, and the panel tab bar): a 3px-padded `--s2` track with a `--line` border and an 8px radius. The chosen item is `--ac` with `--on-ac` text on a 6px radius, and the fill slides between items on the highlight spring. **No coloured border, no translucent tint, no glow on the selected item.**
- **Switch**: round, 46 by 28px, a 20px thumb. Off: `--s3` track, `--muted` thumb. On: `--accent` track, `--bg` thumb. The thumb springs across with a slight overshoot and stretches while pressed. The switch is the state: no On or Off label beside it.
- **Card**: `--s1`, `--line` border, 10px radius. A header (title 15.5px semibold, the object name in `--muted` beside it), then the content with 16 to 18px gaps. Never a card inside a card.
- **Rows that open** (Accordion): rows run edge to edge in the card with `--line` dividers, 44px tall, label left, an optional count and a `--muted` chevron right, `--s2` on hover. They open by animating `grid-template-rows` 0fr to 1fr with an opacity fade, and keep their padding on the content inside, so a closed row is 0px.
- **Icons**: lucide shapes, `--muted`, no tinted square behind them.

## Motion

Springs come from Animate UI's tokens (mass 1). Fades and slides use `--ease` `cubic-bezier(0.2, 0, 0, 1)`. Things that land use the spring curve `cubic-bezier(0.34, 1.56, 0.64, 1)`.

| Spring | Stiffness, damping | For |
| --- | --- | --- |
| press | 550, 30 | a button or item pressed (scale 0.98, icon buttons 0.94) |
| highlight | 500, 40 | the selected fill sliding in a segmented control or tab bar |
| height | 300, 30 | a panel growing to new content |
| progress | 300, 35 | a bar filling (the Accuracy bar parts, about 40ms apart) |
| number | 200, 20 | a digit rolling |

Motion must do a job: show where something went, confirm an action, or cover a change. Nothing pulses or loops to draw the eye, except a loader. Animate only transform, opacity and blur. Every animation has a `prefers-reduced-motion` path where the change is instant.

## What reads as generated

Reviewers flag these:

- a strong fluorescent border plus a translucent tinted background on a selected button
- large radii and pill shapes
- glows, gradients and coloured shadows
- an icon on a tinted square
- a badge that repeats what a control already shows
- disabled buttons in a faded version of their colour
- a second font for labels
- paragraphs of explanation that are always open, and hint text under everything

## Checks before a UI change is done

- [ ] Tokens only, Inter only, radii on the scale, no pills outside the rail and docks.
- [ ] Selected states are tonal (`--ac` / `--on-ac`), not bordered or glowing.
- [ ] Provenance is still visible for every value and layer (D-02), as a tag or a colour key.
- [ ] Keyboard: focus is a 2px `--accent` outline, every control is reachable, icon buttons have `aria-label`.
- [ ] Touch mode: targets at least 44px.
- [ ] 400px wide: no horizontal scroll.
- [ ] Reduced motion: nothing moves.
- [ ] Every line of copy labels, shows data, acts, or informs a decision.
- [ ] Rendered and looked at (a screenshot), not only tested.

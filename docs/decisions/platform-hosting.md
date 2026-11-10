# Decisions: Platform and hosting

> **Part of:** the decision log ([index](README.md)) · **Holds:** the three.js pin, hardware and frame budgets, hosting, the demo machine and the event platform · **Authority:** highest; an entry here wins over [rendering/](../rendering/README.md) and [architecture/](../architecture/README.md) (see the index for precedence)

## D-03 three.js version

- **Decision:** The app uses **three r187** through `three/webgpu` (`WebGPURenderer`, WebGL2 fallback **[verify]**). The mock-up stays on r128 and is not ported in place.
- **Why:** r187 is the pinned version in the rendering doc. Generators move from the mock-up into ES modules anyway.

## D-05 Target hardware and budgets

- **Decision:** Two targets. The **demo laptop** is an Intel Iris Xe (Zenbook 14X). The **phones** are the realme 14 Pro and a Samsung, both Android 16 with Chrome. Haptics can only be shown on the phones. Where the budgets differ, take the tighter one:

  | Item | Budget |
  |---|---|
  | Frame rate | ≥ 30 fps while rotating; render only on change (amended by D-34: also every frame while a simulation clock runs; the 60 fps targets are Q-64) |
  | Pixel ratio | `min(devicePixelRatio, 1.5)` |
  | Mesh | ≤ 50k triangles (decimate NASA GLBs offline) |
  | Points | ≤ 60k |
  | Textures | 2048×1024 desktop, 1024×512 mobile |
  | Displacement | Desktop only |

- **Amended by:** Q-132 (9 Nov 2026: the demo machine is Atish's Asus TUF A15 in desktop Chrome, sound only; the Zenbook 14X is no longer the demo screen; the phones and the 1024×512 mobile textures are after the event). Quality-level start rules: [R5.7](../rendering/display-rules.md#r57-motion-and-time-lapse) (Q-66). Budget owner: [R5.5](../rendering/display-rules.md#r55-performance-budget-d-05); targets and measurements: [A10.1](../architecture/frontend-platform.md#a101-performance-budget-d-05).
- **Status note (9 Nov 2026):** the Frame rate row's "amended by D-34" cites an entry still pending team confirmation; read it as a proposed amendment until D-34 is confirmed.

## D-24 Hosting: local on the Asus A15 (answers Q-02)

- **Decision:** The event build runs locally on the team's **Asus A15** laptop. One process serves the built frontend and the API from one origin. The phones and other laptops connect over the local network.
- **How it applies:**
  - Serve over HTTPS, because WebGPU needs a secure context. Install a local root certificate on both Android phones (e.g. `mkcert`); whether a clicked-through self-signed certificate is enough is **[verify]**.
  - Bring a router or hotspot. Venue Wi-Fi may block device-to-device traffic.
  - The demo must run with no internet (D-25). The Gemini layer then stays off and the code path shows.
  - There is no public URL after the event. A static hosted copy is a later, separate decision.
- Whether the A15 also replaces the Zenbook as the demo screen is open (Q-15).
- **Status note (9 Nov 2026):** the last line is answered by Q-132: the A15 is the demo machine and runs the browser itself; the LAN, the phone certificates and the router apply after the event. Interim serving until #15: Q-198.

## Questions

Status, owner and full text as recorded. The [index](README.md) lists every ID with its file.

| ID | Question | Owner | Status |
|---|---|---|---|
| Q-02 | Frontend hosting: the same AWS server or static hosting? | Kevin | Answered: D-24 |
| Q-15 | Does the Asus A15 (D-24) also replace the Zenbook 14X as the demo screen? If so, D-05 and architecture spec §10.1 should target the A15's GPU instead of Iris Xe. | Atish | Answered: Q-132 (the Asus TUF A15 is the demo machine) |
| Q-64 | D-05 and A15 budgets say "≥ 30 fps, render only on change"; the plan's quality levels (R5.7) target 60 fps on High and Medium and 30 fps on Low, and a governor that drops a level. D-34 amends "render only on change", but the 60 fps targets and the governor are not in D-05. Does R5.7 replace the D-05 frame-rate row (30 fps stays the floor)? **Status note (9 Nov 2026):** "A15 budgets" means [A10.1](../architecture/frontend-platform.md#a101-performance-budget-d-05) (A15 is the glossary). | Moon | Open (R5.7 written as 30 fps floor, 60 fps target) |
| Q-132 | **Event build is desktop browser only; demo machine is Atish's Asus TUF A15 (answers Q-15).** No Android build and no `navigator.vibrate` at the event; phones and vibration come after the event. To amend: D-05 (phone targets and budgets), D-08 (Android Chrome haptics), D-24 (certificates on the phones), D-34 (phone quality, auto-pause, battery), R8.1 and R8.7 (Android driver and vibration calibration), milestone M3 (rename to "Sound"), issue #16 (phone checks) and the haptics agent notes. Sound (D-10, R8.9) and the honesty filter (D-21) apply unchanged. **Status note (9 Nov 2026):** the amendments are now recorded as lines in D-05, D-08, D-09, D-10, D-12, D-20, D-24, D-29, D-30, D-34 and Q-73 to Q-77, Q-90, Q-104, Q-107. Applied in the specs: A1.1, A10, A10.1, A12, A13 (M3 "Sound"), A14 (phone risks after the event); R5.5, R5.7, R8.1, R11.3. Still open: renaming milestone M3 on GitHub and issue #16 (phone checks). | Atish | Answered (Atish, 9 Nov 2026); open: M3 rename and issue #16 on GitHub |
| Q-198 | **Interim event serving until #15.** D-24's one-process server is not built (`main.py` mounts no `dist`). Proposal: until #15 lands, the A15 runs the backend on `localhost:8000` and `npm run build && npm run preview` (port 4173, proxies `/v1` and `/data`), opened at `http://localhost:4173` in Chrome on the A15; `localhost` is a secure context, so WebGPU needs no certificate (Q-132). Spec: [A10.2](../architecture/frontend-platform.md#a102-running-the-event-build). Spec: [A10.2](../architecture/frontend-platform.md#a102-running-the-event-build); risk in [A14](../architecture/risks.md#a14-risks-and-open-questions). Amends how D-24 runs until #15 lands. | Kevin | Proposed |

# Risks and open questions

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A14 · **Implements:** D-09, D-10, D-14, D-19, D-24, D-25, D-31

## A14 Risks and open questions

| Risk or question | Why it matters | Plan |
|---|---|---|
| SPHEREx search is slow and fails | The base tool depends on it | Read-through cache for every external call, filled by the pre-fetch script; the demo runs with `SX_OFFLINE=1` (D-25). Ship pre-fetched cutouts. |
| Venue internet fails | Live calls and the Gemini layer fail | The demo runs offline from the cache (D-25). The Gemini layer stays off and the code path shows (D-24). |
| Venue Wi-Fi blocks device-to-device traffic | Phones cannot reach the A15 | Bring a router or hotspot (D-24). |
| WebGPU needs a secure context | The app may not start on the phones over plain HTTP | Serve over HTTPS. Install a local root certificate on both Android phones (e.g. `mkcert`). Whether a clicked-through self-signed certificate is enough **[verify]** (D-24). |
| Building before 14 Nov | The event rules say not to build before the event | The team's call and risk (D-14). |
| SPHEREx saturates on bright targets | Barnard's Star and R Dra get no measured point and RW Aur only 15 points at 0.74–1.09 µm; the rest are refused | Keep the saturated frames as honest refusals; the flipbook still works. Show the spectrum on demo objects fainter than the saturation limit, checked on the full pre-fetched cache (D-31, A3.1). |
| Frames on 3I/ATLAS dates unchecked | The headline comet may have no data | Check early. Keep a known asteroid as fallback. |
| NEOWISE access unconfirmed | Diameter and albedo | Use JPL values. |
| Exoplanet Archive thresholds unverified | Planet cards | Adapter tested live 2026-11-07 (Q-63). The radius, mass and Zeng 2019 cut-offs stay **[verify]** until Atish confirms (Q-56). |
| SIMBAD untested | Star and brown dwarf types | Test first. Resolver order: SBDB first for small-body names, SIMBAD first for the rest (D-19). |
| CORS to science services unknown | Browser may be blocked | Use a backend proxy. |
| Gemini model name may change | Code would break | Read it from config. Confirm before coding. |
| Gemini key exposure | Key theft | Server-side call only. |
| Sound output never heard by the author | May not play | Test on a real machine early. |
| No vibration on iPhone (or iPad, desktop) | Many users and judges cannot feel the haptics | Audio pairing on every platform (D-10). Show haptics on the Android phones. |
| `navigator.vibrate` needs a prior user gesture | The first patterns may be ignored | Start haptics from a tap, such as calibration or the touch-mode toggle. |
| 8 ms pulses may not be felt | Fine detail is lost | Calibrate `minMs` and the number of levels per phone. Let rhythm and audio carry detail (D-09). |
| Battery saver may suppress vibration **[verify]** | Haptics vanish during the demo | Check on both phones. Turn battery saver off for the demo. Audio still plays. |
| Bluetooth audio latency | Sound and touch fall out of sync | Use the phone speaker or wired audio for the demo. Measure the offset ([section 12](testing.md#a12-testing)). |
| Two specs drifting apart | Code is built to conflicting rules | `decisions/` and the precedence in [docs/README.md](../README.md). Record new cross-cutting decisions as the next D- number. |
| Time | 10 days | Follow the priority tiers. Cut supernova and gas cloud first. |
| Iris Xe and phone speed | Demo may stutter | Measure early. Lower point and triangle counts if needed. |
| Overclaiming | Scientists may reject unsupported claims | Keep badges and labels. Show formulas. |

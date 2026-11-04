# Risks and open questions

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A14 · **Implements:** D-09, D-10

## A14 Risks and open questions

| Risk or question | Why it matters | Plan |
|---|---|---|
| SPHEREx search is slow and fails | The base tool depends on it | Cache all test targets. Ship pre-fetched cutouts. |
| Frames on 3I/ATLAS dates unchecked | The headline comet may have no data | Check early. Keep a known asteroid as fallback. |
| NEOWISE access unconfirmed | Diameter and albedo | Use JPL values. |
| Exoplanet Archive untested | Planet cards | Test first. |
| SIMBAD untested | Star and brown dwarf types | Test first. Decide resolver order (Q-05). |
| CORS to science services unknown | Browser may be blocked | Use a backend proxy. |
| Gemini model name may change | Code would break | Read it from config. Confirm before coding. |
| Gemini key exposure | Key theft | Server-side call only. |
| Sound output never heard by the author | May not play | Test on a real machine early. |
| No vibration on iPhone (or iPad, desktop) | Many users and judges cannot feel the haptics | Audio pairing on every platform (D-10). Show haptics on the Android phones. |
| `navigator.vibrate` needs a prior user gesture | The first patterns may be ignored | Start haptics from a tap, such as calibration or the touch-mode toggle. |
| 8 ms pulses may not be felt | Fine detail is lost | Calibrate `minMs` and the number of levels per phone. Let rhythm and audio carry detail (D-09). |
| Battery saver may suppress vibration **[verify]** | Haptics vanish during the demo | Check on both phones. Turn battery saver off for the demo. Audio still plays. |
| Bluetooth audio latency | Sound and touch fall out of sync | Use the phone speaker or wired audio for the demo. Measure the offset ([section 12](testing.md#a12-testing)). |
| Two specs drifting apart | Code is built to conflicting rules | `decisions.md` and the precedence in [docs/README.md](../README.md). Record new cross-cutting decisions as the next D- number. |
| Time | 10 days | Follow the priority tiers. Cut supernova and gas cloud first. |
| Iris Xe and phone speed | Demo may stutter | Measure early. Lower point and triangle counts if needed. |
| Overclaiming | Scientists may reject unsupported claims | Keep badges and labels. Show formulas. |

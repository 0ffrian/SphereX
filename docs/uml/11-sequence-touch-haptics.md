# 11 Sequence: a data sound ducks the ambience

> **D-39 (12 Nov 2026):** the touch sequence this file used to hold (Feel mode, TouchProbe, the touch sources, vibration after the event) is cut with the haptics. It is in git history before issue #111. The file name is kept so links stay valid. The ambience tick has its own diagram, [25](25-sequence-ambience.md).

What happens when a data sound plays while the flyover ambience plays (R13.9, Q-441), drawn for `AppSound.listen` and the Listen sweep. The build pane's Hear it (`hearAudio.ts`) holds the duck the same way. The same holds for the audio driver's voices (Track ticks, cues) on the events bus. Every end path releases the hold: the natural end, `stop()`, sound off, a hidden page, a honesty change, AppSound unbind, the voice cap, a new context and the safety timeout.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant UI as A Listen caller (AppSound.listen)
  participant A as AppSound
  participant C as audioContext
  participant S as ListenSweep
  participant G as audioGraph
  participant Amb as ambience bus (duck gain)
  U->>UI: click Listen
  UI->>A: listen(reply)
  A->>C: unlockAudio() (inside the click, Q-73)
  C-->>A: running
  A->>S: play(plan, honesty)
  S->>G: getBus(ctx, 'spectrum'), connect its volume gain
  S->>G: holdDuck(ctx, duration + chime + 1 s)
  G->>Amb: holds 0 → 1: setTargetAtTime(−9 dB, τ = 0.05 s / 3)
  Note over S: tone and chimes play on the spectrum bus → master → limiter (−3 dB)
  alt last voice ends (onended)
    S->>G: release()
  else stop(), sound off, hidden page, honesty hides all, unbind
    S->>G: release()
  else no onended ever comes (suspended context)
    G->>G: safety timeout releases the hold
  end
  G->>Amb: holds 1 → 0: setTargetAtTime(1, τ = 0.6 s / 3)
```

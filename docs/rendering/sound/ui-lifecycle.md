# Sound: UI, captions, lifecycle and budgets

> **Part of:** Rendering & sound spec ([index](../README.md)) · **Sections:** R13.10 · **Implements:** [Q-442](../../decisions/sound-ambience.md), [D-21](../../decisions/contract-tags.md) · **Read with:** [buses-stage.md](buses-stage.md) (R13.9), [accessibility.md](../accessibility.md) (R9), [uml/25](../../uml/25-sequence-ambience.md)

## R13.10 UI, captions, lifecycle and budgets

### UI, captions and accessibility

#### 12.1 Controls
- **Close-up pane** (`sx-cu-controls`): a "Sound" chip appears when the soundscape exists:
  - **"Imagined sound"** with the Artistic badge;
  - a mute toggle (`aria-pressed`);
  - **"What you hear"** (`aria-expanded`), which opens a panel.
- **App shell:** the Sound popover (plan §6) holds the ambience on/off and volume, and the "Flashes" toggle.
- **Keyboard:** all controls are reachable by keyboard with a visible focus ring.

#### 12.2 Live caption
- **Content:** one line under the chip, updated at most every 3 s. It is in a polite live region; a "Read changes aloud" toggle (default off) keeps screen readers from being flooded.
- **Template:** `"<loudest bed phrase>" · "<second phrase>" · "<weather phrase>"` + level note. For example:
  - "Strong wind on a ridge · surf to the south · light rain · real level about 20 dB quieter than Earth";
  - "Calm eye of a hurricane";
  - "Too high: the air here is too thin to carry sound".
- **Phrases:** from `captions.ts` (a table per bed and feature band). Direction comes from the 8-point compass bearing of the bed's intensity centroid.

#### 12.3 "What you hear" panel
- **Heard now:** each bed playing, with its level relative to the loudest. Its physics inputs are shown with their tags, e.g. "Surface pressure 1.2 bar (card, measured)" and "Wind 9 m/s (engine model)".
- **Not heard here:** each refused source with its reason (§7, §8.2).
- **Air facts** (derived):
  - speed of sound;
  - density;
  - true level against Earth;
  - on `CO2` worlds: "Sound below about 240 Hz travels about 10 m/s slower than higher sounds" (scaled f_r).
- **Mapping legend:** "Imagined from the simulated world's physics. Not a recording: no microphone has been here." [SP §1, Arcand 2024].

#### 12.4 "How this works" text (in the panel)
"You hear the place under the camera as if you were hovering there. The camera flies far faster than sound, so its own motion is silent and there is no Doppler shift."

#### 12.5 Reduced motion
No lightning flash. The sound is unchanged.

### Lifecycle (state machine)

```
Idle ──(close-up open AND fly entered AND honesty '+ Artistic' AND sound unlocked AND ambienceOn)──► Baking
Baking ──(first bed ready)──► Playing(partial) ──(all selected beds ready)──► Playing
Playing ──(world or physics change, §9.6)──► Rebaking (old beds keep playing, crossfade 1 s to new)
any ──(mute | ambienceOn false | honesty drops | close-up closed | flyPaused | page hidden)──► Fading (0.6 s) ──► Idle
                                         (beds stay cached; leaving and returning in < 2 min reuses them)
any ──(engine failed / WebGL2 missing)──► Idle; caption "Sound needs the surface view."
```

### Performance budgets (A15, desktop Chrome)

| Item | Budget | How measured |
|---|---|---|
| Main-thread mixer tick | ≤ 1.0 ms at 10 Hz | `performance.now()` around the tick, dev overlay |
| `hKm` port | ≤ 0.02 ms per sample (37 per tick) | micro-benchmark test |
| Bake per bed (worker) | ≤ 1.5 s | worker timing log |
| Bed memory | ≤ 96 MB per world | sum of buffer sizes |
| Fly view frame rate | no measurable drop with ambience on (A/B, 60 s flight, median frame time within 0.5 ms) | `gpuMs()` plus the rAF log |
| Audio glitches | none in a 5-minute flight | Chrome `chrome://media-internals` underruns |

> **Appendix D R12:** fields that are not ready yet (the engine still baking its climate or hydro) mean "waiting", not a refusal. The state is re-evaluated every tick, and no "Not heard here" reason is shown while waiting.

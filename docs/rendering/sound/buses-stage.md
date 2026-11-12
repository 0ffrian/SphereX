# Sound: buses, ducking, master and stage audibility

> **Part of:** Rendering & sound spec ([index](../README.md)) · **Sections:** R13.9 · **Implements:** [D-39, Q-441, Q-442](../../decisions/sound-ambience.md), [Q-73](../../decisions/haptics-built.md), [Q-132](../../decisions/platform-hosting.md) · **Read with:** [bake-mix.md](bake-mix.md) (R13.8), [ui-lifecycle.md](ui-lifecycle.md) (R13.10), [audio-pairing.md](../haptics/audio-pairing.md) (R8.9), [uml/11](../../uml/11-sequence-touch-haptics.md)

## R13.9 Buses, ducking, master, settings and stage audibility

### Ducking and master (spec §11.5)

- **Bus:** the ambience bus feeds the master: gain → limiter (threshold −3 dB, knee 0, ratio 20, attack 3 ms, release 100 ms) [SP §6].
- **Ducking:** the ambience is ducked by `AMBIENCE_DUCK_DB = −9` while any data sound plays (spectrum sweep or chord, Track ticks). Attack 0.05 s, release 0.6 s.
- **Volume:** `ambienceVolume` (default 0.5) × master volume.

### Stage audibility (spec §11.7; decided 12 Nov: "this will be presented on stage")

**Presentation window.**
- After the §11.4 offset, every non-silent bed is held inside a window: `L_pres = L_TARGET + clamp(L_true + G_present − L_TARGET, −STAGE_WINDOW_DB, +6)`, with `STAGE_WINDOW_DB = 24`. A quiet layer stays audible on a PA instead of vanishing under room noise.
- **Physical silence is never lifted:** no air, above the ceiling, a refused source, the hurricane eye at near zero wind.
- The window changes only presentation. The "What you hear" panel shows true levels.

**Loudness targets** (master at volume 1):

| What | Target | Measured how |
|---|---|---|
| Ambience beds | −24 LUFS integrated | bake normalisation (`BED_LUFS = −24`; replaces −30) |
| Data sounds (sweep, chord, Track) | −18 LUFS short-term | sit above the ambience; the ambience ducks −9 dB under them |
| Thunder | at most −10 dBFS peak | through the limiter |

**Low end on laptops and PAs.**
- A 35 Hz high-pass on the ambience bus protects the speakers.
- Beds with energy mostly below 120 Hz (S1 rumble, S8 lava, S12 gas roar, thunder) feed a **harmonic branch**: a 40–120 Hz band-pass, then a `WaveShaperNode` (soft clip, `tanh(3x)`), then a 200–600 Hz band-pass. It is mixed at −12 dB, so the rumble is heard through its harmonics on small speakers (the missing-fundamental effect) [verify by ear on the A15 and the venue PA].

**Mono safety.**
- Bed channels are independent noise, so their mono sum gains about 3 dB and never cancels.
- Panning is equal-power, capped at ±0.8.
- A dev check sums to mono and confirms no layer drops by more than 3 dB.

**Sound check before going on stage.**
- A dev-only page `sound-check.html`, excluded from the build like `gpu-probe.html` (`scripts/check-dist.js`).
- It plays each demo world's beds at presentation level for 5 s each, then thunder, then the chord, with a level meter (RMS and peak) from an `AnalyserNode`.
- It shows the A15's `outputLatency` and warns on Bluetooth.

**Captions on stage:** at least 18 px, high contrast, readable from the back of the room.

### As built in #111

- **Graph** (`frontend/src/sound/audioGraph.ts`): one per AudioContext. `getBus(ctx, 'events' | 'spectrum' | 'ambience')`; events and spectrum are gains into the master; the ambience runs input → 35 Hz high-pass (Q 0.707) → duck gain → level gain → master; the master is gain → limiter (threshold −3 dB, knee 0, ratio 20, attack 3 ms, release 100 ms) → destination.
- **Ducking:** `holdDuck(ctx, safetyS?)` is reference-counted per context. The first hold sets the duck to −9 dB with `setTargetAtTime` (τ = attack / 3, so about 95 % at 0.05 s); the last release goes back to 1 (τ = release / 3). Each producer keeps one hold: the audio driver (Track ticks and other event voices) while any voice lives, the Listen sweep from `play` to its last voice. Every end path releases (natural end, `stop`, `stopTrain`, the voice cap, a new context, sound off, a hidden page, a honesty change, AppSound unbind), and a safety timeout releases a hold its producer forgot (the longest voice + `DUCK_SAFETY_S` = 1 s).
- **Volume:** events and spectrum keep their own per-producer volume gain (the settings `volume`); the ambience level is `soundOn && ambienceOn ? ambienceVolume × volume : 0`, set from a level source that `AppSound.bind` registers, so a bus made before or after the settings is right. The ambience mixer (#116) must not multiply the master volume into its bed gains again.
- **Harmonic branch:** `createHarmonicBranch(ctx)` builds 40–120 Hz (high-pass + low-pass) → **+18 dB** → `WaveShaperNode` tanh(3x) (1025-point curve, oversample 2x) → **−18 dB** make-up → 200–600 Hz (high-pass + low-pass) → −12 dB → ambience input. The ±18 dB drive (coordinator ruling, 12 Nov) makes beds at −24 LUFS reach the non-linear part of tanh: a 60 Hz sine at −24 dB RMS gets its 3rd (180 Hz) and 5th (300 Hz) harmonics at −30 dB or more. tanh is odd, so there is no 2nd harmonic. Nothing connects to it until #116. [verify by ear on the A15 and the venue PA]
- **Settings** (`frontend/src/sound/settings.ts`, localStorage key `sx.haptics.settings` kept; old `hapticsOn`, `strengthMultiplier`, `showChannelLabels` are ignored): `soundOn`, `volume`, `ambienceOn` (default on), `ambienceVolume` (default 0.5), `flashesOn` (default on), `readCaptions` (default off, UI in #116).
- **Shell control** (`frontend/src/sound/ui/SoundSettings.tsx`, mounted in the top bar of `App.tsx`): a "Sound" button whose click unlocks audio (Q-73) and opens a popover: Sound, Volume, Ambience (fly view), Ambience volume, Flashes. Escape is consumed (A21.10 order) and returns focus; an outside click closes it. Every sound follows Sound and Volume. That includes the build pane's "Hear it" (`app/build/hearAudio.ts`), which runs on the shared AudioContext and the `spectrum` bus (code review, 12 Nov): its output gain is 0.9 × volume, or 0 when Sound is off, and its spectrum sweep ducks the ambience. Until #116 the ambience settings have nothing audible to act on. In the build view the top bar is click-through, so the control moves to the bottom right, left of the island, and its popover opens upwards. An open popover lifts the top bar above the object panel.
- **Sound-check page:** not built here (#116).

# Sound and voice

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A8 · **Implements:** D-10

## A8 Sound and voice

| Part | Detail | Status |
|---|---|---|
| Data sweep | Spectrum to pitch with a triangle oscillator. Bell chimes at gas wavelengths. Stereo sweep. Web Audio in the browser. The same events drive the spectrum haptics, so sound and touch match (rendering doc §8.6). | Built in the app (issue #11, `frontend/src/haptics/sound/listenSweep.ts`): pitch from λ and gain from flux through the shared `spectrumMapping`, quiet dips silent, pan left to right, chimes at the A4.3 lines (H₂O 2.7, CO₂ 4.25, CO 4.67 µm) only for gases with Q in the selected epoch, panned where the sweep is. The honesty filter applies (D-21): the tone carries the spectrum's tag and each chime its Q's tag, so a `model_dependent` Q does not chime in Measured only. A one-wavelength spectrum is not played. It uses the shared AudioContext and master bus with its limiter (`audioGraph.ts`), follows the settings volume live and honours the sound switch (Q-84). Tested on a fake AudioContext; not yet heard on the phones. The mock-up's Listen tab mapped brightness to pitch (Q-70). |
| Imagined drive | Procedural noise, gravel and thuds shaped by gravity, roughness and surface type from the card. Always labelled "Imagined". | In the mock-up only, unheard. Not built in the app: deferred by issue #11 (lowest priority). When built it stays outside the haptic driver (rendering doc §8.9). |
| Audio pairing | Every haptic event also plays as sound, on every platform, with its own on/off switch and volume. Audio carries continuous strength (gain), pitch, stereo pan and provenance by timbre: clean tone for `measured`, grainy click for `artistic` (D-10, rendering doc §8.9). | Driver built (issue #9, `drivers/audio.ts`); not yet heard on the phones |
| AI sound clips | Post-event backlog (B-03). | Not built for the event |
| Voice control | Gemini Live. Post-event backlog (B-02). | Not built for the event |

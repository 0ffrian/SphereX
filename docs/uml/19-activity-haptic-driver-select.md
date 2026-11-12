# 19 Activity: sound start-up

> **D-39 (12 Nov 2026):** this file used to show how the haptic engine chose its drivers (vibrate, audio) and when calibration ran. Haptics are cut. The sound engine has one driver, the audio driver, so there is nothing to choose. The file name is kept so links stay valid.

How the app's sound comes up (R8.8, R13.9, Q-73, Q-132): nothing sounds and no AudioContext exists until a click.

```mermaid
flowchart TD
  Start(("App start")) --> Provider["SoundProvider: createAppSound() → createSoundEngine() (AudioDriver only) + ListenSweep; no AudioContext"]
  Provider --> Bind["bind(): bindEngine (sound switch, volume), honesty (D-21), page lifecycle, ambience level source"]
  Bind --> Load{"Settings saved under sx.haptics.settings?"}
  Load -->|yes| Saved["Use soundOn, volume, ambienceOn, ambienceVolume, flashesOn, readCaptions; ignore hapticsOn and the other old fields"]
  Load -->|"no or corrupt"| Defaults["Defaults: sound on, volume 0.7, ambience on at 0.5, flashes on, captions not read aloud"]
  Saved --> Wait
  Defaults --> Wait
  Wait["Wait for a click (Q-73)"] --> Click{"Which click?"}
  Click -->|"Sound button (top bar)"| Unlock["unlockAudio(): create and resume the shared AudioContext; open the popover"]
  Click -->|"Listen, Track"| Unlock2["unlockAudio() inside the click, then play"]
  Unlock --> Graph["First use of the context: graph made (events, spectrum, ambience buses; limiter −3 dB); ambience level = soundOn && ambienceOn ? ambienceVolume × volume : 0"]
  Unlock2 --> Graph
  Graph --> Ready(("Ready: data sounds duck the ambience while they play"))
```

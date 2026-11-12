# Sound: the sound of a world (overview)

> **Part of:** Rendering & sound spec ([index](../README.md)) · **Sections:** R13, R13.1 · **Implements:** [D-39, Q-430 to Q-444](../../decisions/sound-ambience.md), [Q-132](../../decisions/platform-hosting.md), [D-21](../../decisions/contract-tags.md), [Q-287](../../decisions/rendering-engines.md) · **Read with:** [buses-stage.md](buses-stage.md) (R13.9), [files-tests.md](files-tests.md) (R13.11), [engines.md](../engines.md) (R5.9), [sound-voice.md](../../architecture/sound-voice.md) (A8)

## R13 Sound of a world (flyover soundscape and weather)

Transcribed from the approved spec "the sound of a world" (Atish, 12 Nov 2026; plan file `flyover-soundscape-spec.md`), with the coordinator rulings of its Appendix D ([R13.11](files-tests.md#r1311-files-tests-constants-and-the-module-contract)). Citations in brackets ([PA], [SS], [SP]) name the three research notes listed in [R13.1](overview.md#r131-summary-terms-and-rules). **[verify]** items are rows in [R12](../open-items.md).

Status of the approved spec (header table, as approved):

| | |
|---|---|
| Status | **Approved by Atish, 12 Nov 2026.** Build everything in one day, in parallel tickets (Appendix C). It lands as rendering section **R13** plus decision entries (§20) in the restructure PR, which also deletes the haptics code. |
| Decisions | Every recommendation is accepted (see the §20 IDs). Port Moon's bake engine (credit Moon). Stage-audible presentation (§11.7). Planetary wind model (§6.5). Weather drawn as well as heard (§8.5). #93 lands first: engine-side tickets branch from `fix/93-engines`. |
| Owner | Atish (creative control, D-13). Moon authored the bake prototype (`Ambience Loop Lab.html`); this spec ports its DSP with corrections. |
| Scope | The ambient sound heard in the planet close-up's fly view (`WorldFlyStage`, D-37 world engine, "+ Artistic" only, Q-287), including weather. Appendix A revises the spectrum chord from the research. |
| Research | Three cited notes files in the session scratchpad: `research-planetary-acoustics.md` (cited below as **[PA]**), `research-sound-sources.md` (**[SS]**) and `research-sonification-spatial.md` (**[SP]**). **[verify]** marks a value that must be checked against its primary source before it ships (§19). |


**Spec section numbers.** Text below keeps the approved spec's own cross-references ("§11.4", "Appendix A"). They map to R13 like this: §0–§2 → R13.1; §3 → R13.2; §4 → R13.3; §5–§6 → R13.4; §7 → R13.5; §8 → R13.6; §9 → R13.7; §10, §11.1–§11.4, §11.6 → R13.8; §11.5, §11.7 → R13.9; §12–§14 → R13.10; §15–§19, Appendix B, Appendix D → R13.11; Appendix A → R13.12; §20 → the decisions in [sound-ambience.md](../../decisions/sound-ambience.md). Appendix C (tickets and waves) is planning, not spec, and is not copied.

**Built so far:** [R13.9](buses-stage.md#r139-buses-ducking-master-settings-and-stage-audibility) buses, ducking, the stage hooks and the settings, and [R13.12](chord-pitch.md#r1312-spectrum-chord-and-pitch-polarity) pitch polarity (Q-430), in issue #111. Everything else in R13 is specified, not built (tickets #112 to #117).

### R13.1 Summary, terms and rules

#### Summary

**What the listener is.** A listener hovers at the fly camera's position and hears the world as if standing still there at that moment. The camera's own motion makes no sound (§5).

**What the sound is.** Every sound comes from the world's physics, and the D-37 engine already computes those physics:
- air temperature, pressure, molecular weight, gravity and wind;
- liquid seas, rivers and lava;
- rain, snow, cyclones and convective storms;
- gas giant jets and storms.

**How it is built.** Two parts:
- **Baked once per world.** A worker bakes seamless noise loops ("beds") for the place types the physics allows, using Moon's inverse-FFT method with corrected physics.
- **Mixed live.** Ten times a second, a mixer weights each bed by what lies around the camera. It applies distance loss, absorption by air, the effect of altitude and the weather.

**What is refused.** Sound is refused where physics says it cannot exist. Each refusal is captioned, never faked. Examples:
- no air means no sound;
- no liquid means no surf;
- no observed lightning means no thunder.

**Labelling.** Everything heard is labelled "Imagined sound". It carries the Artistic badge, a caption of what is heard, and the true loudness against Earth.

#### Terms

| Term | Meaning |
|---|---|
| Listener | The virtual ear at the fly camera position: lon, lat, and height z above the drawn ground. |
| Bed | A baked, seamless stereo noise loop of one sound source for one world (§9). |
| Event | A one-shot sound: thunder, a lava vent burst (§8, §10). |
| Place sample | One point of the sampling pattern around the listener (§6). |
| Class | What a place sample is: `land`, `sea`, `ice`, `river`, `lake`, `lava`, `crust` (§6.3). |
| True level | The modelled sound pressure level in dB re 20 µPa at the listener. |
| Presented level | What the speakers play after the presentation offset (§11.4). |
| Earth reference | The same place type on the engine's `earth` calibration preset with a 7 m/s wind. |

#### Rules (from the project's decisions)

1. **Data first.** Every sound parameter comes from an engine value, a card value or a cited constant, by deterministic arithmetic. No LLM and no recordings.
2. **Provenance.**
   - **Whole ambience:** tagged `artistic`, because the terrain, seas, rivers and clouds are procedural.
   - **Physics inputs:** each keeps its own tag in the "What you hear" list (§12.3).
   - **Badge:** the Artistic badge shows as "Default" (`badgeForTag`).
3. **Honesty filter.**
   - **Audible only at "+ Artistic".** The fly view is already gated to it (`ViewerPanel.tsx` L632-656).
   - **Lower levels:** at "Measured only" and "+ Estimated" the soundscape does not exist.
   - **Dropping the level while it plays:** the soundscape fades out over 0.6 s.
4. **Refuse rather than invent.**
   - A source whose physics gate fails (§7) is not baked. It is listed in the "Not heard here" list with its reason.
   - Pressure, liquid, gravity and temperature are never guessed. The engine's own values are used, and each carries the tag from `cardToWorld`.
5. **Determinism.**
   - **Same inputs, same output.** The same `AirModel` (§4), seed and bed type give byte-identical Float32 loops.
   - **Mixer:** the same listener state and weather fields give the same gains.
   - **Thunder:** the schedule is a seeded sequence (§8.4).
6. **Never blank.**
   - The fly view never waits for sound.
   - Beds fade in as they finish baking.
   - A failed bake drops only that bed; the caption says "Sound for <bed> unavailable".
7. **No vibration.** Haptics are cut ([D-39](../../decisions/sound-ambience.md)).
8. **Sound only after a click.** Audio is unlocked by a click (`unlockAudio`), never on load.

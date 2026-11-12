# Haptics: audio pairing

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R8.9, R8.9.1, R8.9.2 · **Implements:** [D-10, Q-70, Q-72, Q-133, Q-134](../../decisions/haptics-sound.md), [D-12, D-13](../../decisions/haptics-design.md), [Q-73, Q-84](../../decisions/haptics-built.md), [Q-132](../../decisions/platform-hosting.md), [D-21](../../decisions/contract-tags.md) · **Read with:** [engine-api.md](engine-api.md) (R8.8 tone stream), [sources.md](sources.md) (R8.4), [sound-voice.md](../../architecture/sound-voice.md) (A8)

> **D-39 (12 Nov 2026), haptics cut:** there is no vibration to pair with. R8.9 stays live as the rules of the audio driver (timing, mapping, timbre by tag, latency) and R8.9.2 (Track path sound) stays live. The code is in `frontend/src/sound/` (`voices.ts`, `pitch.ts`). **Q-430:** long wavelength = low pitch everywhere ([R13.12](../sound/chord-pitch.md#r1312-spectrum-chord-and-pitch-polarity)). The voices play into the events bus and duck the ambience ([R13.9](../sound/buses-stage.md#r139-buses-ducking-master-settings-and-stage-audibility)). R8.9.1 (body tone) is deferred (Q-133, D-39). See [D-39](../../decisions/sound-ambience.md).

### R8.9 Audio pairing (D-10)

> **Changed by [Q-416](../../decisions/shell-surfaces.md) (PR #104):** the build pane's Hear it panel (`build/HearPanel.tsx`) plays **Atmosphere** (brown noise filtered by surface pressure, gusts by the wind level, a faint howl tied to the sound speed; tagged `artistic`) and a **spectrum sweep** (the measured spectrum as pitch, loudness from the flux; since #115 on the shared `pitch.ts` law, 1158 Hz at the short end to 220 Hz at the long end, Q-446; before that 880 to 110 Hz). Gaps against this section until Atish wires it after merge: `build/hearAudio.ts` makes its own `AudioContext` with a 0.9 master gain and no limiter, not the shared bus and limiter. Feel it is gone from the panel (haptics dropped).

At the event the audio driver is the only output (Q-132). After the event it plays **alongside** the vibration wherever there is vibration. Every `HapticEvent` goes to every driver in the engine. On iPhone, iPad and desktop it is always the only output.

**Timing**

- Web Audio. Every sound is scheduled on `AudioContext.currentTime` plus a small lookahead: `AUDIO_LOOKAHEAD_S` = 0.03 s, a placeholder in `tuning.ts`, tuned by ear on the A15 **[verify]** (R12 #35).
- The `AudioContext` is created or resumed by a click that is a user activation: the "Turn on sound" button, the Feel toggle, the Listen button (Q-73) or Track's **Sound** toggle ([A20.9](../../architecture/moving-objects/track-ui.md#a209-sound)). After the event, the same Touch-mode tap also unlocks vibration.
- Pulse trains are scheduled **sample-accurately** on the audio clock, not with timers.
- *After the event:* the calibrated `avOffsetMs` ([§8.7](calibration.md#r87-calibration-and-settings)) aligns sound and vibration. If vibration is felt later than sound is heard, delay the audio by the offset; otherwise delay the vibration. At the event there is no vibration to align, so the offset is 0.

**Mapping**

| Event field | Audio parameter |
|---|---|
| `strength` | Continuous gain (not quantised, unlike vibration), times the volume setting. An audible floor (`AUDIO_FLOOR_STRENGTH`) keeps strength 0 heard (Q-72) |
| `pitch` | Frequency = 220 Hz × 2^(2.4 · pitch) (`pitch.ts`, placeholders, Q-70). **Spectrum, Listen sweep and Track:** pitch from λ over 0.75–5.0 µm (Q-70, Q-134). **Body interaction:** pitch = the normalised height under the pointer, continuous (R8.9.1, Q-133). **Gas giant bands:** pitch follows latitude |
| `pan` | `StereoPannerNode`, from the pointer's x (Track: the marker's x in the detail view, R8.9.2) |
| `tag` | Timbre (below) |
| `voice` | Refines the timbre within the tag's family: `tone`, `click`, `surf`, `chime` (Q-72) |

**Provenance by timbre**

| Tag | Short sound | Sustained tone (body tone, path voice). **Proposed (Q-190)** |
|---|---|---|
| `measured` | Clean sine blip (2 ms attack, 40 ms) | Clean sine |
| `derived`, `model_dependent`, `inferred_from_analog` | Softer tone (sine, 12 ms attack, gain × 0.6) | Softer sine: gain × 0.6, through a low-pass filter |
| `artistic` | Grainy noise click: a 4 ms noise burst with a 2 ms decay, band-passed at the pitch when there is one (Q-72) | Noise band-passed at the pitch (`GRAIN_BANDPASS_Q` = 4), so a grainy tone that still rises and falls with the height |

- Every texture sound on the shader-generated kinds uses the `artistic` timbre (D-12). Ocean is filtered noise (a "surf" sound); land is the body tone (Q-133).
- `double` and `heartbeat` use the same timings as their vibration patterns ([§8.3](platform-encoding.md#r83-encoding-web-driver-d-09)).
- **Quiet dips are silent in every channel.** If the source emits nothing, no driver plays.
- All timbre values are `CREATIVE placeholder` constants in `tuning.ts` (D-13).

**Bluetooth latency**

- Bluetooth output adds about 150–250 ms of latency.
- Read `AudioContext.outputLatency`. When it is above `HIGH_OUTPUT_LATENCY_S` (0.1 s, a placeholder), suggest the laptop speaker or wired earphones. The threshold is **[verify]** in desktop Chrome on the A15; `outputLatency` support in Android Chrome is after the event (R12 #10).

**Imagined drive**

- The "imagined drive" sounds ([A8](../../architecture/sound-voice.md)) are separate. They do not go through this driver and stay labelled "Imagined".

**As built (issue #9, `drivers/audio.ts`).** The short sounds, the voices, the floor and the master bus are built. **Not built yet:** "height → pitch": the height-map and terrain sources emit clicks with no pitch (`sources/heightMap.ts:135`), so bodies sound as clicks today. R8.9.1 replaces that rule. The sustained timbres and the tone stream (R8.8) are not built.

#### R8.9.1 Body tone from the height map (Q-133)

While the user interacts with a body, one continuous tone follows the height under the pointer: low in grooves, higher on the surface and on peaks. This overrides the R8.4 height ticks and the Q-70 pitch for body interaction. Q-70 still holds for the spectrum, the Listen sweep and Track. Status: **not built yet**.

- **Which bodies.** Every body with a height: `asteroid_procedural` (`height.bin`), `planet_rocky` and `planet_water` (the shared field's height, R7.7) and `asteroid_shape` (mesh height, R8.4, **Proposed (Q-188)**). Bodies with no height have no tone: gas giants keep the flow cues, comets the field pulse, brown dwarfs and stars their data pulses, nebulae and novae nothing (**Proposed (Q-191)**).
- **Height sample.** The source's own sample (R8.4): the same height that draws the normals and the displacement (R1 principle 6). On a water world the ocean is flat at sea level, so the tone holds there.
- **Pitch.** pitch = (h − h_min) / (h_max − h_min), where h_min and h_max are the lowest and highest heights of the whole body, computed once when the height loads. Frequency uses the R8.9 mapping. A flat body (h_max = h_min) has no tone.
- **Gain.** strength = `BODY_TONE_STRENGTH` (a placeholder, proposed 0.6), times the user multiplier and volume; ×0.6 for hydrated asteroids (R8.4). Proposed with Q-190.
- **Pan.** From the pointer's x on screen.
- **Tag and timbre.** The height layer's tag: `artistic` for procedural relief and shader surfaces, `measured` for a real mesh. The timbre is the sustained column above.
- **Honesty (D-21).** The engine filter applies (R8.2). An `artistic` tone is heard only from + Artistic; the build pane's raise makes it audible after *Build it* (R5.8). A mesh tone plays in every state.
- **Life.** It starts when a Feel drag (or, after the event, a Touch-mode finger) lands on the body, and updates on every pointer move and on every rendered frame while the body turns under a still pointer. It stops on release, when the pointer leaves the body, when Feel is turned off, when the page hides, or when the honesty level hides its tag. It uses the `body` tone of the stream (R8.8, **Proposed (Q-189)**).
- **Cues on top.** Coastline, ice and lava cues and the limb edge tick stay as short sounds over the tone; they mark edges, not height (R8.4).
- **Test (R11).** The tone's pitch is monotone in the sampled height.

#### R8.9.2 Track path sound (Q-134)

"Hear the Shift": the Track tool's sound ([A19](../../architecture/moving-objects/track.md), [A20](../../architecture/moving-objects/track-ui.md)). It is sound only, at the event and after. It plays while Track replays a known object's exposures. A **frame** is one detector's image; an **exposure** is the frames taken at one midpoint (2 on Eros, D1 and D4 at once; [A20.3](../../architecture/moving-objects/track-ui.md#a203-time)). Status: **not built yet**.

- **Exposure tick.** One tick per exposure, when the replay reaches that exposure. The tick sounds one note per frame of the exposure at the same time (a two-note tick on Eros), each pitched by its own frame's wavelength through the Q-70 mapping, the same mapping as the spectrum and the Listen sweep, and tagged as its frame (**Proposed (Q-194)**, reading Q-134's "per exposure" for 2 frames). A SPHEREx cutout is `measured`, so the ticks are heard in Measured only. Pan = the marker's x in the Track pane's **detail view** ([A20.5](../../architecture/moving-objects/track-ui.md#a205-detail-view-and-imagery); −1 left edge, +1 right edge; **Proposed (Q-194)**). Voice `tone`, channel `data`.
- **Path voice.** A soft continuous voice while the replay runs, in the Estimated timbre (the sustained column above). The path comes from JPL Horizons and is `model_dependent`, so the voice is silent in Measured only. Pan follows the path's x in the detail view at the replay time. It uses the `path` tone of the stream (R8.8). Pitch and gain are fixed: **Proposed (Q-194)**, at pitch 0.5 and a strength well below the ticks.
- **Reference click.** A quiet, regular click that gives the replay a steady tempo, with a visible mute button next to the replay controls. **Proposed (Q-194):** one click per hour of observation time on the replay's time axis, voice `click`, tagged `measured` (the exposure times are measured), so it plays in every state unless muted.
- **Never the SPHEREx-centred rate.** Pitch and pan are never driven by the object's apparent rate of motion. Seen from SPHEREx that rate mostly carries the spacecraft's orbital parallax (about 100″ per hour swing for Eros on 20 Mar 2026). Pan follows the drawn position only.
- **Direction never by pan alone.** A venue PA may be mono. The direction of travel is also given in text (the Track pane's direction caption, [A20.4](../../architecture/moving-objects/track-ui.md#a204-path-on-the-sky), and its polite announcement on a visit change, [A20.12](../../architecture/moving-objects/track-ui.md#a2012-accessibility-r9)) and drawn on screen (R9).
- **Honesty (D-21).** The engine filter applies (R8.2): in Measured only the exposure ticks (and the reference click) remain and the path voice is silent.
- **Wiring:** R8.8.1 item 11.

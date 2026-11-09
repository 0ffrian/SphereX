# UML diagrams

Architecture diagrams for **Shift & Spectrum**, written in Mermaid. They illustrate [decisions/](../decisions/README.md), the [architecture spec](../architecture/README.md) (sections A…) and the [rendering & haptics spec](../rendering/README.md) (sections R…) as of 5 Nov 2026.

> **The specs win.** If a diagram differs from a spec, the spec is right and the diagram is out of date. Precedence: `decisions/`, then the rendering doc for its scope, then the architecture spec. Update the matching diagram in the same commit as any spec change.

Mermaid renders natively on GitHub, and in VS Code with a Mermaid extension (for example "Markdown Preview Mermaid Support"). Items marked **[verify]** or pointing to an open Q- question are not settled in the specs.

## Index

| File | UML type | What it shows |
|---|---|---|
| [01-use-case.md](01-use-case.md) | Use case (as flowchart) | Actors (public user, blind or low-vision user, judge, team admin, external archives) and what they can do |
| [02-component.md](02-component.md) | Component (2 diagrams) | Backend components, pipeline, render core, external services and endpoints, the prototype `/v1/sky` router (with `/v1/sky/cached`), sky mirror store and colour composite, object jobs (`/job`, `/job/events`), the shared cutout pool, measure and bake worker pools, the warm cache and the `/data/textures` mount (Q-111, Q-112); frontend UI, shell and sky view (with cached markers), flipbook colour views and progressive frames, viewer, haptics, drivers, sources, storage |
| [03-deployment.md](03-deployment.md) | Deployment | Phones, iPhone/iPad, demo laptop, the Asus A15 local server (one origin, HTTPS, read-through cache, offline mode, measure and bake worker processes), team laptop offline jobs, external archives, post-event Tauri |
| [04-package.md](04-package.md) | Package | Repo and code layout with dependencies and owners (Atish, Kevin, Moon; D-17), including the sky-view prototype packages (provisional, Q-89) and the colour composite (Q-92), and the issue #41 modules (`core/jobs.py`, `core/warm.py`, `measure/pool.py`, `render/background.py`) |
| [05-class-data-contract.md](05-class-data-contract.md) | Class (2 diagrams) | `Tag`, `TV<T>`, `ObjectType`, `ObjectCard`, `RenderParams`, `Layer`, textures, lighting, view modes, `HapticProfile`, `overrides` and the slider registry |
| [06-class-haptics-audio.md](06-class-haptics-audio.md) | Class (2 diagrams) | `HapticEvent`, `HapticDriver` and its drivers, `HapticEngine` (gate, rate cap, fan-out, pulse trains), the shared AudioContext, settings, calibration, the pulse indicator and unlock button, the event sources behind `HapticSource` |
| [07-class-viewer.md](07-class-viewer.md) | Class | `ViewerApp`, the renderer interface and per-type renderers, `ShaderBody`, field worker, lighting, modes, honesty, scale bar, alt text; render core (`RenderChain`, `SimClock`, `FrameGovernor`, `WorkerPool`); motion plan, star model and storms (issue #42) |
| [08-sequence-search-flipbook.md](08-sequence-search-flipbook.md) | Sequence | Search, name resolve, frames through the read-through cache, cutouts, flipbook playback through the shared session and the transport bar, Rainbow Trails, URL hash links (with `colour=`), the dev-only fixture path, the prototype sky pick and cached markers, progressive frames with Stop (cutouts downloaded by the object job, Q-111), the colour views |
| [09-sequence-object-spectrum.md](09-sequence-object-spectrum.md) | Sequence | Click a source, photometry and spectrum, classify, type selection, `ObjectCard` from the object job (first, partial and final answers, `X-SX-Measuring` and `X-SX-Progress`, Q-111), panel with badges and Listen |
| [10-sequence-view-3d.md](10-sequence-view-3d.md) | Sequence | View in 3D: render-params, asset lookup, background bake (texture URL 404 until done, Q-112), renderer by type, compile-then-swap and settle burst, `missing` layers |
| [11-sequence-touch-haptics.md](11-sequence-touch-haptics.md) | Sequence | Touch mode: unlock, pointermove, intersect, sample, source, rate limit, fan-out to vibrate and audio |
| [12-sequence-bake-gemini.md](12-sequence-bake-gemini.md) | Sequence | Backend texture bake in a worker process off the request path (Q-112), then the optional Gemini repaint through the read-through cache, with the alignment check |
| [13-sequence-calibration.md](13-sequence-calibration.md) | Sequence | First-use calibration: `minMs`, levels, audio offset, saved to localStorage |
| [14-state-honesty.md](14-state-honesty.md) | State | The 3-state honesty toggle (one state per badge) and which layers and haptics each state allows |
| [15-state-interaction.md](15-state-interaction.md) | State | Default mode and Touch mode, with Feeling and Rotate/zoom substates; sim clock running and pause reasons |
| [16-state-asset-lookup.md](16-state-asset-lookup.md) | State (2 diagrams) | Asset status (saved, generated, sketch, intermediate answers never stored) and the texture cache entry (queued, baking) |
| [17-activity-pipeline.md](17-activity-pipeline.md) | Activity | Pipeline stages 1–6 to `ObjectCard` and `RenderParams`, with refuse-rather-than-invent branches |
| [18-activity-type-selection.md](18-activity-type-selection.md) | Activity | Type selection: SBDB, SIMBAD, Exoplanet Archive, sliders, candidate |
| [19-activity-haptic-driver-select.md](19-activity-haptic-driver-select.md) | Activity | Choosing drivers at start-up (settings, platform defaults), calibration, the click that unlocks output, the `spherex:haptic` debug hook |
| [20-sequence-composite.md](20-sequence-composite.md) | Sequence | The SPHEREx colour composite on the backend (prototype, Q-92): Stage 1 and 2, band and pass selection, alignment on one TAN grid, stretch, `derived.composite` cache, the PNG route |
| [21-sequence-build-mould.md](21-sequence-build-mould.md) | Sequence | Select a body on the sky and Build it (issue #60, Q-113): the card, `/card` and `/render-params`, load first, stage plans with held layers, the pose (MouldRig), restore to the normal render |
| [22-area-search.md](22-area-search.md) | Component, Sequence (2) | Area search (agreed plan, Q-146; A16 to A18): the offline Discovery pipeline in `core/area/` and its reused adapters, the cached results and `/v1/areas` routes, the precompute run, and the sky interaction (draw a square, Known objects or Discovery, hand-off to Track) |

## Conventions

- Dashed nodes or edges are post-event backlog items (B-01 to B-04) or stretch goals (P3). Class diagrams mark them with a stereotype such as `<<stub, B-01 post-event>>` instead, because Mermaid class diagrams cannot dash a single class.
- Diagrams apply `decisions/` where the specs still show older text: ObjectCard and RenderParams replace the settings file (D-02), three r187 (D-03), the union `ObjectType` (D-04), web-only haptics with quantised strength (D-08, D-09), audio paired on every platform (D-10) and the shared field for shader kinds (D-12).
- Each file has been checked with `@mermaid-js/mermaid-cli@11.4.2`.

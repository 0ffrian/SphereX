# UML diagrams

Architecture diagrams for **Shift & Spectrum**, written in Mermaid. They illustrate [decisions.md](../decisions.md), the [architecture spec](../architecture/README.md) (sections A…) and the [rendering & haptics spec](../rendering/README.md) (sections R…) as of 5 Nov 2026.

> **The specs win.** If a diagram differs from a spec, the spec is right and the diagram is out of date. Precedence: `decisions.md`, then the rendering doc for its scope, then the architecture spec. Update the matching diagram in the same commit as any spec change.

Mermaid renders natively on GitHub, and in VS Code with a Mermaid extension (for example "Markdown Preview Mermaid Support"). Items marked **[verify]** or pointing to an open Q- question are not settled in the specs.

## Index

| File | UML type | What it shows |
|---|---|---|
| [01-use-case.md](01-use-case.md) | Use case (as flowchart) | Actors (public user, blind or low-vision user, judge, team admin, external archives) and what they can do |
| [02-component.md](02-component.md) | Component (2 diagrams) | Backend components, pipeline, render core, external services and endpoints; frontend UI, viewer, haptics, drivers, sources, storage |
| [03-deployment.md](03-deployment.md) | Deployment | Phones, iPhone/iPad, demo laptop, the Asus A15 local server (one origin, HTTPS, read-through cache, offline mode), team laptop offline jobs, external archives, post-event Tauri |
| [04-package.md](04-package.md) | Package | Repo and code layout with dependencies and owners (Atish, Kevin, Moon, Munazir; D-17) |
| [05-class-data-contract.md](05-class-data-contract.md) | Class (2 diagrams) | `Tag`, `TV<T>`, `ObjectType`, `ObjectCard`, `RenderParams`, `Layer`, textures, lighting, view modes, `HapticProfile`, `overrides` and the slider registry |
| [06-class-haptics-audio.md](06-class-haptics-audio.md) | Class (2 diagrams) | `HapticEvent`, `HapticDriver` and its drivers, `HapticEngine` fan-out, calibration, the debug pulse indicator, the event sources behind `HapticSource` |
| [07-class-viewer.md](07-class-viewer.md) | Class | `ViewerApp`, the renderer interface and per-type renderers, `ShaderBody`, field worker, lighting, modes, honesty, scale bar, alt text |
| [08-sequence-search-flipbook.md](08-sequence-search-flipbook.md) | Sequence | Search, name resolve, frames through the read-through cache, cutouts, flipbook playback, Rainbow Trails, URL hash links, the dev-only fixture path |
| [09-sequence-object-spectrum.md](09-sequence-object-spectrum.md) | Sequence | Click a source, photometry and spectrum, classify, type selection, `ObjectCard`, panel with badges and Listen |
| [10-sequence-view-3d.md](10-sequence-view-3d.md) | Sequence | View in 3D: render-params, asset lookup, bake if not cached, renderer by type, `missing` layers |
| [11-sequence-touch-haptics.md](11-sequence-touch-haptics.md) | Sequence | Touch mode: unlock, pointermove, intersect, sample, source, rate limit, fan-out to vibrate and audio |
| [12-sequence-bake-gemini.md](12-sequence-bake-gemini.md) | Sequence | Backend texture bake, then the optional Gemini repaint through the read-through cache, with the alignment check |
| [13-sequence-calibration.md](13-sequence-calibration.md) | Sequence | First-use calibration: `minMs`, levels, audio offset, saved to localStorage |
| [14-state-honesty.md](14-state-honesty.md) | State | The 3-state honesty toggle (one state per badge) and which layers and haptics each state allows |
| [15-state-interaction.md](15-state-interaction.md) | State | Default mode and Touch mode, with Feeling and Rotate/zoom substates |
| [16-state-asset-lookup.md](16-state-asset-lookup.md) | State (2 diagrams) | Asset status (saved, generated, sketch) and the texture cache entry |
| [17-activity-pipeline.md](17-activity-pipeline.md) | Activity | Pipeline stages 1–6 to `ObjectCard` and `RenderParams`, with refuse-rather-than-invent branches |
| [18-activity-type-selection.md](18-activity-type-selection.md) | Activity | Type selection: SBDB, SIMBAD, Exoplanet Archive, sliders, candidate |
| [19-activity-haptic-driver-select.md](19-activity-haptic-driver-select.md) | Activity | Choosing drivers at start-up, the `spherex:haptic` debug hook, and when calibration runs |

## Conventions

- Dashed nodes or edges are post-event backlog items (B-01 to B-04) or stretch goals (P3). Class diagrams mark them with a stereotype such as `<<stub, B-01 post-event>>` instead, because Mermaid class diagrams cannot dash a single class.
- Diagrams apply `decisions.md` where the specs still show older text: ObjectCard and RenderParams replace the settings file (D-02), three r187 (D-03), the union `ObjectType` (D-04), web-only haptics with quantised strength (D-08, D-09), audio paired on every platform (D-10) and the shared field for shader kinds (D-12).
- Each file has been checked with `@mermaid-js/mermaid-cli@11.4.2`.

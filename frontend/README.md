# frontend

Vite + TypeScript + React web app. three.js **r187** (`three/webgpu`). Empty until the event (14 Nov 2026).

Planned layout (from [rendering doc R10](../docs/rendering/layout-tests-open-items.md)):

```
src/viewer/     (Moon)  ViewerApp, lighting, modes, honesty, scaleBar, altText,
                        renderers/{AsteroidMesh, AsteroidProcedural, Comet, BrownDwarf, Star}
src/haptics/    (Moon, Atish for sources)
                        haptics, calibration,
                        drivers/{webVibrate, audioClick, tauri (stub)},
                        sources/{heightMap, meshNormal, field, spectrum, lightcurve}
```

Versions are pinned in `package.json` and the lockfile.

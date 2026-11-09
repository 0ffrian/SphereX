# Testing

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A12 · **Implements:** D-18, D-25, D-29

## A12 Testing

| Layer | Method |
|---|---|
| Physics functions | Unit tests with known values (Jupiter band count, Sedov radius, spin limit) |
| Schema | Validate every ObjectCard and RenderParams against the JSON schemas in `shared/schemas/`. CI fails if the generated Pydantic models or `frontend/src/contract/` types differ from a fresh regeneration (D-18) |
| Rendering acceptance | The tests in rendering doc §11: determinism (same SHA-256 per texture), seam, normals, honesty, refusal, performance, spectrum haptics, comet epochs |
| Browser shaders | Same card and seed must give the same image. Reference screenshots of the five shader kinds, plus two extra views (a gas giant turned so its lit storms face the camera, and a cloudless water world tilted toward the pole), are committed in `frontend/e2e/__snapshots__/shaderKinds.spec.ts/` and compared by Playwright (`toHaveScreenshot`, status overlay masked, tolerance 0.2% of pixels, per-pixel threshold 0.05, and 0.01 for the gas-giant storm view). Changing the storm count, band turbulence, seed, sea level or ice extent is detected (checked by mutating each). They are drawn on the WebGL2 fallback (SwiftShader), not a real GPU; they were stable over repeated runs here, and are re-recorded with `--update-snapshots` after a deliberate look change. A unit test pins the GPU's field lookup to `FieldSampler` |
| Golden frames | `frontend/e2e/golden.spec.ts` draws every fixture with a 3D view (not `candidate`) at Measured only, + Estimated and + Artistic (all at the low quality tier; `asteroid_procedural` also has `asteroid_procedural.artistic.medium.png`, the only golden that shows the displacement, Q-117) and compares with `frontend/e2e/__goldens__/` by SSIM (`e2e/ssim.ts`, threshold `GOLDEN_MIN_SSIM` in `e2e/golden.ts`); `e2e/ssim.spec.ts` is the negative control. `SX_UPDATE_GOLDENS=1` rewrites them. Visual review and device frame times: [rendering/reference/](../rendering/reference/README.md) |
| Haptics | No more than 40 events per second under fast drags. Silent no-op on iPhone, where the audio driver takes over. The calibration value persists. Both Android phones feel the faintest calibrated tick |
| Audio pairing | Measure the offset between the sound and the vibration of the same event on both phones |
| UI | Playwright with headless Chromium. Already used for the mock-up, checks console errors and clicks |
| Data adapters | Recorded responses so tests do not hit IRSA. The cached responses of the read-through cache double as these fixtures (D-25). Never hand-edit them; re-record them with the pre-fetch script |
| Milestones | M1–M4 each build against their own fixtures (recorded responses, sample cards and spectra), so they do not depend on each other (D-29) |
| Hardware | Run the real app on the Zenbook and both phones and record frame rate |

# Testing

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A12 · **Implements:** D-18, D-25, D-29

## A12 Testing

| Layer | Method |
|---|---|
| Physics functions | Unit tests with known values (Jupiter band count, Sedov radius, spin limit) |
| Schema | Validate every ObjectCard and RenderParams against the JSON schemas in `shared/schemas/`. CI fails if the generated Pydantic models or `frontend/src/contract/` types differ from a fresh regeneration (D-18) |
| Rendering acceptance | The tests in rendering doc §11: determinism (same SHA-256 per texture), seam, normals, honesty, refusal, performance, spectrum haptics, comet epochs |
| Browser shaders | Same card and seed must give the same image. Keep reference screenshots and compare |
| Haptics | No more than 40 events per second under fast drags. Silent no-op on iPhone, where the audio driver takes over. The calibration value persists. Both Android phones feel the faintest calibrated tick |
| Audio pairing | Measure the offset between the sound and the vibration of the same event on both phones |
| UI | Playwright with headless Chromium. Already used for the mock-up, checks console errors and clicks |
| Data adapters | Recorded responses so tests do not hit IRSA. The cached responses of the read-through cache double as these fixtures (D-25). Never hand-edit them; re-record them with the pre-fetch script |
| Milestones | M1–M4 each build against their own fixtures (recorded responses, sample cards and spectra), so they do not depend on each other (D-29) |
| Hardware | Run the real app on the Zenbook and both phones and record frame rate |

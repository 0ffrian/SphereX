// R13.9 sound check (#116): dev-only page. Every soundCheck module imports this, so an accidental import into the app
// puts the marker into dist/ and scripts/check-dist.js fails the build.
export const SOUND_CHECK_MARKER = 'SX_DEV_ONLY_SOUND_CHECK';
(globalThis as Record<string, unknown>).__sxSoundCheck = SOUND_CHECK_MARKER;

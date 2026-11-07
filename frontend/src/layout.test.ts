// R10 file layout: every module listed for frontend/src/viewer and frontend/src/haptics exists
// and exports something (a real API or a named placeholder).
import { describe, expect, it } from 'vitest';
import { MAX_AMBIENT_INTENSITY } from '@/viewer/lighting';
import { MAX_PIXEL_RATIO, viewerPixelRatio } from '@/viewer/ViewerApp';

const R10_MODULES = [
  // src/viewer (Moon)
  './viewer/ViewerApp.ts',
  './viewer/lighting.ts',
  './viewer/modes.ts',
  './viewer/honesty.ts',
  './viewer/scaleBar.ts',
  './viewer/altText.ts',
  './viewer/renderers/AsteroidMesh.ts',
  './viewer/renderers/AsteroidProcedural.ts',
  './viewer/renderers/Comet.ts',
  './viewer/renderers/BrownDwarf.ts',
  './viewer/renderers/Star.ts',
  './viewer/renderers/ShaderBody.ts',
  './viewer/fields/fieldWorker.ts',
  // src/haptics (Atish, D-17)
  './haptics/haptics.ts',
  './haptics/calibration.ts',
  './haptics/audioContext.ts',
  './haptics/audioGraph.ts',
  './haptics/settings.ts',
  './haptics/platform.ts',
  './haptics/pitch.ts',
  './haptics/spectrumMapping.ts',
  './haptics/tuning.ts',
  './haptics/drivers/webVibrate.ts',
  './haptics/drivers/audio.ts',
  './haptics/drivers/tauri.ts',
  './haptics/sources/heightMap.ts',
  './haptics/sources/meshNormal.ts',
  './haptics/sources/field.ts',
  './haptics/sources/terrain.ts',
  './haptics/sources/flow.ts',
  './haptics/sources/spectrum.ts',
  './haptics/sources/lightcurve.ts',
  // extra folders (frontend README): contract, state
  './contract/index.ts',
  './state/store.ts',
] as const;

const modules = import.meta.glob<Record<string, unknown>>([
  './viewer/**/*.ts',
  './haptics/**/*.ts',
  './contract/index.ts',
  './state/store.ts',
  '!./**/*.test.ts',
]);

describe('R10 layout', () => {
  it.each(R10_MODULES)('%s exists and exports something', async (path) => {
    const load = modules[path];
    expect(load, `${path} is missing`).toBeTypeOf('function');
    const mod = await load!();
    expect(Object.keys(mod).length, `${path} has no exports`).toBeGreaterThan(0);
  });

  it('placeholders say which spec section they stand for', async () => {
    for (const [path, load] of Object.entries(modules)) {
      const mod = await load();
      for (const [name, value] of Object.entries(mod)) {
        if (!name.endsWith('_PLACEHOLDER')) continue;
        expect(value, `${path}:${name}`).toMatchObject({ implemented: false });
        expect((value as { spec: string }).spec, `${path}:${name}`).toMatch(/\b[RAD]-?\d/);
      }
    }
  });
});

describe('viewer budgets', () => {
  it('caps pixel ratio at 1.5 (R5.5, D-05)', () => {
    expect(MAX_PIXEL_RATIO).toBe(1.5);
    expect(viewerPixelRatio(1)).toBe(1);
    expect(viewerPixelRatio(3)).toBe(1.5);
  });

  it('keeps ambient light at or below 0.03 (R5.1)', () => {
    expect(MAX_AMBIENT_INTENSITY).toBeLessThanOrEqual(0.03);
  });
});

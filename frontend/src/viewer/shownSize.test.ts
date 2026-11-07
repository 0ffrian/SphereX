// Q-87: the scale bar uses the shape model's own size only for a glTF in metres (Q-61), with its
// own tag; otherwise it keeps the card's size and the card's tag. The two are never mixed.
import { describe, expect, it } from 'vitest';
import { isGltfUrl, MODEL_SIZE_TAG, shownSize } from './scaleBar';

const plan = (meshUrl: string | null, over: Record<string, unknown> = {}) => ({
  scaleM: 8000,
  sizeTag: 'measured' as const,
  sizeWhy: 'card why',
  sizeQualifier: null,
  bodies: [{ meshUrl }],
  ...over,
});

describe('isGltfUrl', () => {
  it('accepts glb and gltf (with a query), refuses obj and empty', () => {
    expect(isGltfUrl('/data/shapes/eros.glb')).toBe(true);
    expect(isGltfUrl('/data/shapes/eros.GLTF?v=2')).toBe(true);
    expect(isGltfUrl('/data/shapes/eros.obj')).toBe(false);
    expect(isGltfUrl(null)).toBe(false);
  });
});

describe('shownSize', () => {
  it('uses the model size and its own tag for a glTF', () => {
    const s = shownSize(plan('/m/eros.glb'), 8500, 'derived');
    expect(s).toMatchObject({ radiusM: 8500, tag: MODEL_SIZE_TAG, fromModel: true });
    expect(s.tag).not.toBe('measured');
    expect(s.why).toMatch(/shape model/);
  });

  it('falls back to the card size and tag for an OBJ model', () => {
    const s = shownSize(plan('/m/eros.obj'), 8500, 'artistic');
    expect(s).toMatchObject({ radiusM: 8000, tag: 'measured', why: 'card why', fromModel: false });
  });

  it('falls back to the card when the model tag is hidden (Measured only)', () => {
    const s = shownSize(plan('/m/eros.glb'), 8500, 'measured');
    expect(s).toMatchObject({ radiusM: 8000, tag: 'measured', fromModel: false });
  });

  it('shows no model size when the card size is hidden, or when nothing was measured', () => {
    const hidden = plan('/m/eros.glb', { scaleM: null, sizeTag: null });
    expect(shownSize(hidden, 8500, 'derived')).toMatchObject({
      radiusM: null,
      tag: null,
      fromModel: false,
    });
    expect(shownSize(plan('/m/eros.glb'), null, 'derived').fromModel).toBe(false);
    expect(shownSize(plan('/m/eros.glb'), NaN, 'derived').fromModel).toBe(false);
  });

  it('drops the card upper-limit qualifier only when the model size is used', () => {
    const limit = { sizeQualifier: 'upper_limit' as const };
    expect(shownSize(plan('/m/a.glb', limit), 100, 'derived').qualifier).toBeNull();
    expect(shownSize(plan('/m/a.obj', limit), 100, 'derived').qualifier).toBe('upper_limit');
  });
});

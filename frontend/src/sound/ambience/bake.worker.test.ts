// @vitest-environment node
// §9.5: the worker bakes one bed per message and transfers both channel buffers; a refusal is a message, not a throw.
import { describe, expect, it } from 'vitest';
import { bakeTransferables, handleBakeRequest } from './bake.worker';
import { EARTH_AIR, spec } from './bakeFixtures.testutil';

describe('bake worker', () => {
  it('returns the result with both buffers in the transfer list', () => {
    const res = handleBakeRequest({ id: 3, key: 'k', spec: spec('S2', 1 << 12), air: EARTH_AIR });
    expect('result' in res).toBe(true);
    if (!('result' in res)) return;
    expect(res.id).toBe(3);
    expect(res.key).toBe('k');
    expect(res.result.L.length).toBe(1 << 12);
    expect(bakeTransferables(res)).toEqual([res.result.L.buffer, res.result.R.buffer]);
    expect(res.ffts).toBe(1);
  });
  it('turns a refusal into an error message', () => {
    const res = handleBakeRequest({
      id: 4,
      key: 'k',
      spec: spec('S2', 1 << 12, { params: { Iu: 0.2 } }),
      air: EARTH_AIR,
    });
    expect(res).toMatchObject({ id: 4, refused: true });
    expect('error' in res && res.error).toMatch(/fHiss_Hz/);
    expect(bakeTransferables(res)).toEqual([]);
  });
});

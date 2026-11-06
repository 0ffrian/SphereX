import { describe, expect, it, vi } from 'vitest';
import type { ObjectCard, RenderParams } from '../../contract/generated';
import { assetUrls, loadBody, meshUrls, prefetchAssets, prefetchMesh } from './fanout';

const card = { id: 'c' } as ObjectCard;
const params = {
  id: 'c',
  textures: {
    albedo: '/a.png',
    height: '/h.png',
    normal: '/n.png',
    roughness: '/r.png',
    height_bin: '/h.bin',
  },
} as unknown as RenderParams;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
}

describe('assetUrls', () => {
  it('lists texture urls, skips height_bin, handles none', () => {
    expect(assetUrls(params).textures).toEqual(['/a.png', '/h.png', '/n.png', '/r.png']);
    expect(assetUrls({ id: 'x' } as unknown as RenderParams)).toEqual({ textures: [], meshes: [] });
  });
});

describe('prefetchAssets', () => {
  it('never rejects when a load fails', async () => {
    const cache = {
      texture: vi.fn((u: string) =>
        u === '/h.png' ? Promise.reject(new Error('x')) : Promise.resolve({}),
      ),
      mesh: vi.fn(),
    };
    await expect(prefetchAssets(params, cache as never)).resolves.toBeUndefined();
    expect(cache.texture).toHaveBeenCalledTimes(4);
  });
});

describe('loadBody', () => {
  it('delivers params first, prefetch starts before card resolves', async () => {
    const c = deferred<ObjectCard>();
    const p = deferred<RenderParams>();
    const order: string[] = [];
    const done = loadBody({
      card: () => c.promise,
      params: () => p.promise,
      prefetch: async () => void order.push('prefetch'),
      onCard: () => order.push('card'),
      onParams: () => order.push('params'),
    });
    p.resolve(params);
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(['params', 'prefetch']);
    c.resolve(card);
    await expect(done).resolves.toEqual({ card, params });
    expect(order).toEqual(['params', 'prefetch', 'card']);
  });

  it('a failing prefetch does not reject', async () => {
    await expect(
      loadBody({
        card: async () => card,
        params: async () => params,
        prefetch: () => Promise.reject(new Error('x')),
      }),
    ).resolves.toBeTruthy();
  });

  it('a failing fetch rejects', async () => {
    await expect(
      loadBody({ card: () => Promise.reject(new Error('no card')), params: async () => params }),
    ).rejects.toThrow('no card');
  });

  it('abort rejects and suppresses later callbacks', async () => {
    const c = deferred<ObjectCard>();
    const ac = new AbortController();
    const onCard = vi.fn();
    const done = loadBody({
      card: () => c.promise,
      params: async () => params,
      onCard,
      signal: ac.signal,
    });
    ac.abort();
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    c.resolve(card);
    await new Promise((r) => setTimeout(r, 0));
    expect(onCard).not.toHaveBeenCalled();
    await expect(
      loadBody({ card: async () => card, params: async () => params, signal: ac.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('meshUrls / prefetchMesh', () => {
  const card = (value: string | null) =>
    ({ shape_source: value === null ? undefined : { value } }) as unknown as ObjectCard;
  it('takes a same-origin shape model from the card and ignores remote or missing ones', () => {
    expect(meshUrls(card('/data/meshes/eros.glb'))).toEqual(['/data/meshes/eros.glb']);
    expect(meshUrls(card('https://example.org/eros.glb'))).toEqual([]);
    expect(meshUrls(card(null))).toEqual([]);
  });
  it('never rejects when the mesh fails', async () => {
    const cache = { texture: vi.fn(), mesh: vi.fn(() => Promise.reject(new Error('404'))) };
    await expect(prefetchMesh(card('/m.glb'), cache as never)).resolves.toBeUndefined();
    expect(cache.mesh).toHaveBeenCalledWith('/m.glb');
  });
});

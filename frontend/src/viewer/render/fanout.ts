/**
 * Browser fan-out (issue #39, WP3): card and render-params requests start together, each is
 * delivered as it lands, and asset prefetch starts the moment params arrive (not after the card).
 * Built on injected fetchers; no API client exists on main yet.
 */
import type { ObjectCard, RenderParams } from '../../contract/generated';
import type { AssetCache } from '../renderers/build';
import { isLoadableMeshUrl } from '../renderers/AsteroidMesh';

export type AssetCacheLike = Pick<AssetCache, 'texture' | 'mesh'>;

export interface AssetUrls {
  textures: string[];
  meshes: string[];
}

/**
 * Every texture and mesh URL in a RenderParams. The contract has texture URLs only
 * (albedo/height/normal/roughness); height_bin is a raw buffer, not an image, so it is skipped.
 * RenderParams has no mesh URL; a shape model comes from the card (`shape_source`, Q-44), see
 * `meshUrls`.
 */
export function assetUrls(params: RenderParams): AssetUrls {
  const t = params.textures;
  const textures = t
    ? [t.albedo, t.height, t.normal, t.roughness].filter((u): u is string => !!u)
    : [];
  return { textures: [...new Set(textures)], meshes: [] };
}

/** The card's shape-model mesh, only when the renderer would load it (same rule as AsteroidMesh). */
export function meshUrls(card: ObjectCard): string[] {
  const url = card.shape_source?.value ?? null;
  return isLoadableMeshUrl(url) ? [url] : [];
}

/** Warm the mesh cache as soon as the card lands. Never rejects. */
export async function prefetchMesh(card: ObjectCard, cache: AssetCacheLike): Promise<void> {
  await Promise.allSettled(meshUrls(card).map((u) => cache.mesh(u)));
}

/** Warm the cache. Never rejects: the build step refuses layers whose load fails. */
export async function prefetchAssets(params: RenderParams, cache: AssetCacheLike): Promise<void> {
  const { textures, meshes } = assetUrls(params);
  await Promise.allSettled([
    ...textures.map((u) => cache.texture(u)),
    ...meshes.map((u) => cache.mesh(u)),
  ]);
}

export interface LoadBodyArgs {
  card: () => Promise<ObjectCard>;
  params: () => Promise<RenderParams>;
  /** Called on params landing; its promise is awaited before loadBody resolves. */
  prefetch?: (params: RenderParams) => Promise<void>;
  onCard?: (card: ObjectCard) => void;
  onParams?: (params: RenderParams) => void;
  signal?: AbortSignal;
}

export interface LoadedBody {
  card: ObjectCard;
  params: RenderParams;
}

function abortError(): Error {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

/** Resolves when card, params and prefetch are all done. Rejects if either fetch fails or on abort. */
export async function loadBody(args: LoadBodyArgs): Promise<LoadedBody> {
  const { signal } = args;
  if (signal?.aborted) throw abortError();
  let onAbort: (() => void) | null = null;
  const aborted = new Promise<never>((_, rej) => {
    onAbort = () => rej(abortError());
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  aborted.catch(() => undefined);
  const live = () => !signal?.aborted;

  const cardP = args.card().then((c) => {
    if (live()) args.onCard?.(c);
    return c;
  });
  let prefetchP: Promise<void> = Promise.resolve();
  const paramsP = args.params().then((p) => {
    if (live()) {
      args.onParams?.(p);
      // Prefetch must never fail the load.
      prefetchP = Promise.resolve(args.prefetch?.(p)).catch(() => undefined);
    }
    return p;
  });
  // Avoid unhandled rejections on the loser when aborted/one fails.
  cardP.catch(() => undefined);
  paramsP.catch(() => undefined);

  try {
    const [card, params] = await Promise.race([Promise.all([cardP, paramsP]), aborted]);
    await Promise.race([prefetchP, aborted]);
    return { card, params };
  } finally {
    // A reused AbortController must not collect one listener per load.
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

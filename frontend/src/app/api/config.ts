// API client settings. Engineering values, not physical ones.

/** Path prefix of every M1 endpoint (D-16). The Vite dev server proxies it to the backend. */
export const API_BASE = '/v1';

/**
 * ASSUMPTION: how long to wait for one API reply. IRSA is slow and sometimes times out
 * (A3.1); the backend has its own timeouts and retries (D-25), so this only stops a hung tab.
 */
export const API_TIMEOUT_MS = 90_000;

/**
 * ASSUMPTION (issue #102, Q-451): a shorter wait for `resolve` only, the first request of a
 * search: a hung one shows its error after this, not after API_TIMEOUT_MS. `card` and
 * `render-params` keep API_TIMEOUT_MS, because offline `/card` waits for the object's job with no
 * limit of its own (Q-111 (2), A4.10). The frames poll and the other requests keep it too.
 */
export const API_QUICK_TIMEOUT_MS = 25_000;

/** Response header the dev fixture server sets on every synthetic reply. */
export const FIXTURE_HEADER = 'x-sx-fixture';

/** Response header with the asset status (A4.4, Q-39): "saved", "generated" or "sketch". */
export const ASSET_STATUS_HEADER = 'x-sx-asset-status';

/** Response header of `combine.png` (issue #12): JSON describing the combination. */
export const COMBINE_HEADER = 'x-sx-combine';

// API client settings. Engineering values, not physical ones.

/** Path prefix of every M1 endpoint (D-16). The Vite dev server proxies it to the backend. */
export const API_BASE = '/v1';

/**
 * ASSUMPTION: how long to wait for one API reply. IRSA is slow and sometimes times out
 * (A3.1); the backend has its own timeouts and retries (D-25), so this only stops a hung tab.
 */
export const API_TIMEOUT_MS = 90_000;

/** Response header the dev fixture server sets on every synthetic reply. */
export const FIXTURE_HEADER = 'x-sx-fixture';

/** Response header of `combine.png` (issue #12): JSON describing the combination. */
export const COMBINE_HEADER = 'x-sx-combine';

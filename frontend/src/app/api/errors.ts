// Typed API errors for the M1 client (D-16). The UI picks its wording from `kind`.

export type ApiErrorKind =
  | 'not_found' // 404
  | 'bad_request' // other 4xx
  | 'server' // 5xx, including 504 when the archive is slow (A3.1)
  | 'timeout' // no answer within API_TIMEOUT_MS
  | 'network' // the request never reached a server
  | 'bad_response' // the reply does not match the contract; nothing is filled in
  | 'aborted'; // a newer request replaced this one

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  /** The backend's `error` code, when it sent one. */
  readonly code: string | null;
  /** The backend's `detail` sentence, or our own description. */
  readonly detail: string | null;

  constructor(
    kind: ApiErrorKind,
    detail: string | null,
    status: number | null = null,
    code: string | null = null,
  ) {
    super(detail ?? kind);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

// The scan API's errors, in their own module so the opt-in mock (scanMock.ts) and the HTTP client
// (scanApi.ts) both use them without importing each other at runtime.

/** The server no longer knows the run (404 `run_not_found`). */
export class RunGone extends Error {
  constructor(runId: string) {
    super(`No run '${runId}'.`);
    this.name = 'RunGone';
  }
}

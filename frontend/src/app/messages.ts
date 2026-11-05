// User-facing wording for API errors and refused (`missing`) items. Plain sentences, no codes in
// the main line; the backend's own `detail` is shown underneath.
import type { SkyError } from '@/state/store';
import { API_TIMEOUT_MS } from './api/config';

export function searchErrorMessage(err: SkyError, query: string): string {
  switch (err.kind) {
    case 'not_found':
      return `No object found for “${query}”. Check the spelling, or try RA, Dec in degrees.`;
    case 'bad_request':
      return 'The server could not use this search. Try a name, or RA, Dec in degrees.';
    case 'server':
      return err.status === 504
        ? 'The archive is slow or not answering right now. Try again, or pick one of the test targets.'
        : 'The server had a problem or is not answering. Try again in a moment.';
    case 'timeout':
      return `No answer after ${Math.round(API_TIMEOUT_MS / 1000)} seconds. The archive may be slow; try again, or pick one of the test targets.`;
    case 'network':
      return 'Can’t reach the server. Check that the backend is running.';
    case 'bad_response':
      return 'The server sent data this page can’t read, so nothing is shown.';
    case 'aborted':
      return 'The request was cancelled.';
  }
}

export function spectrumErrorMessage(err: SkyError): string {
  if (err.kind === 'not_found') return 'There is no spectrum for this object.';
  return searchErrorMessage(err, '');
}

/** Known refusal codes from the backend's `missing` lists. Unknown codes are shown as is. */
const MISSING_TEXT: Readonly<Record<string, string>> = {
  'frames:moving_object_search':
    'Frames for moving Solar System objects are not searched yet, so there are no frames to show.',
  'spectrum:moving_object_search': 'Spectra for moving Solar System objects are not measured yet.',
};

export function describeMissing(code: string): string {
  return MISSING_TEXT[code] ?? `Not available: ${code}`;
}

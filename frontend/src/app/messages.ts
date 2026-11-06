// User-facing wording for API errors and refused (`missing`) items. Plain sentences, no codes in
// the main line; the backend's own `detail` is shown underneath.
import type { SkyError } from '@/state/store';
import { API_TIMEOUT_MS } from './api/config';
import { formatWavelength } from './format';
import type { FrameReason, RefusalGroup, SpectrumOutcome } from './refusals';

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

// ---- Refused items (`missing`), grouped by refusals.ts ----------------------------------------

/** "1 frame", "24 frames" */
export function pluralFrames(n: number): string {
  return n === 1 ? '1 frame' : `${n} frames`;
}

function pluralPoints(n: number): string {
  return n === 1 ? '1 point' : `${n} points`;
}

/** Each frame reason: the list line (after the count) and a short label for the ID list. */
const FRAME_TEXT: Readonly<Record<FrameReason, { line: string; short: string }>> = {
  saturated: {
    line: 'saturated: the object’s centre is too bright for the detector.',
    short: 'saturated',
  },
  aperture_flags: {
    line: 'with an unusable pixel at the object’s centre (flagged, blank or missing its uncertainty).',
    short: 'unusable pixel at the centre',
  },
  aperture_edge: {
    line: 'where the object is too close to the image edge to measure.',
    short: 'too close to the edge',
  },
  background: {
    line: 'with too little clean sky around the object to measure the background.',
    short: 'too little clean sky',
  },
  unit: { line: 'stored in units this tool can’t convert.', short: 'unknown units' },
  extension: { line: 'missing the image, flag or uncertainty layer.', short: 'missing layer' },
  flags_header: {
    line: 'whose quality flags can’t be read, so saturation can’t be checked.',
    short: 'unreadable quality flags',
  },
  pixel_area: {
    line: 'whose pixel size on the sky can’t be worked out.',
    short: 'unknown pixel size',
  },
  measure: { line: 'where the measurement gave no usable number.', short: 'no usable number' },
  cutout_unreadable: { line: 'whose image file can’t be read.', short: 'unreadable image file' },
  cutout: {
    line: 'whose image could not be loaded from the archive or the cache.',
    short: 'image not loaded',
  },
  outside_cutout: {
    line: 'where the object’s position falls outside the image.',
    short: 'outside the image',
  },
  wavelength: { line: 'with no wavelength at the object’s position.', short: 'no wavelength' },
  cutout_stretch: {
    line: 'whose image is blank or flat and can’t be shown.',
    short: 'blank image',
  },
};

/**
 * Whole-result codes. `cutouts:deferred:<n>` is worded in describeRefusalGroup.
 * `spectrum:saturated` is listed only when no frame group is saturated (refusals.ts), which the
 * backend does not send; the line exists so that the code is never hidden.
 */
const NOTE_TEXT: Readonly<Record<string, string>> = {
  'frames:truncated': 'The archive sent a shortened list, so some frames may be missing.',
  'frames:moving_object_search':
    'Frames for moving Solar System objects are not searched yet, so there are no frames to show.',
  'spectrum:saturated':
    'SPHEREx saturates on this object in every frame, so this tool can’t measure a spectrum.',
  'spectrum:moving_object_search': 'Spectra for moving Solar System objects are not measured yet.',
};

function frameText(reason: string): { line: string; short: string } | undefined {
  return Object.hasOwn(FRAME_TEXT, reason) ? FRAME_TEXT[reason as FrameReason] : undefined;
}

/** One line per group. Unknown codes are shown as is, never hidden. */
export function describeRefusalGroup(g: RefusalGroup): string {
  if (g.kind === 'frames') {
    const text = frameText(g.reason);
    return text
      ? `${pluralFrames(g.count)} ${text.line}`
      : `${pluralFrames(g.count)} not used (reason code “${g.reason}”).`;
  }
  if (g.known && g.reason.startsWith('cutouts:deferred:')) {
    return g.count === 1
      ? '1 more frame is not downloaded yet. Search again in a moment to load it.'
      : `${g.count} more frames are not downloaded yet. Search again in a moment to load them.`;
  }
  return NOTE_TEXT[g.reason] ?? `Not available: ${g.reason}`;
}

/** Short label for a frame group's ID list, e.g. "saturated". */
export function refusalShortLabel(reason: string): string {
  return frameText(reason)?.short ?? `reason code “${reason}”`;
}

const NOT_CHECKED = ' More frames have not been checked yet.';
const TOO_BRIGHT = 'the object’s centre is too bright for SPHEREx’s detector (saturated)';

/**
 * The spectrum panel's empty state: why there is no spectrum. No object name: the heading names
 * it already, and resolver names such as "V* R Dra" read badly mid-sentence.
 */
export function spectrumEmptyMessage(o: SpectrumOutcome): string {
  const t = o.total;
  const head = 'There is no spectrum:';
  if (t === 0) return `${head} no frames of this object were available to measure.`;
  const found = o.incomplete ? 'checked so far' : 'found';
  const tail = o.incomplete ? NOT_CHECKED : '';
  const which = t === 1 ? `the only frame ${found}` : `any of the ${t} frames ${found}`;
  if (o.saturated === t) {
    const why = t === 1 ? `because ${TOO_BRIGHT}` : `because in every one ${TOO_BRIGHT}`;
    return `${head} this tool could not measure ${which}, ${why}.${tail}`;
  }
  if (o.saturated > 0 && o.largestReason === 'saturated') {
    const rest = t - o.saturated;
    const others =
      rest === 1
        ? 'the reason for the other frame is below'
        : `the reasons for the other ${rest} frames are below`;
    return `${head} this tool could not measure ${which}. In ${o.saturated} of them, ${TOO_BRIGHT}; ${others}.${tail}`;
  }
  const reasons = t === 1 ? 'The reason is below.' : 'The reasons are below.';
  return `${head} this tool could not measure ${which}. ${reasons}${tail}`;
}

/** Share of the frames' wavelength span the points may miss before that span is named. */
const SPAN_DIFFERENCE = 0.05;

/**
 * Shown when some frames were measured and some refused: what the points cover, and the span of
 * the frames found when it is clearly wider (RW Aur: points only below about 1.1 µm).
 */
export function spectrumCoverageMessage(o: SpectrumOutcome): string {
  const fmt = (r: readonly [number, number]) =>
    `${formatWavelength(r[0])} to ${formatWavelength(r[1])}`;
  const found = o.incomplete ? 'checked so far' : 'found';
  const head = `This tool could measure ${o.points} of the ${o.total} frames ${found}`;
  const tail = o.incomplete ? NOT_CHECKED : '';
  const m = o.measuredRange;
  if (!m) return `${head}.${tail}`;
  const f = o.framesRange;
  const fw = f ? f[1] - f[0] : 0;
  if (f && fw > 0 && (fw - (m[1] - m[0])) / fw > SPAN_DIFFERENCE) {
    return `${head}. They cover only ${fmt(m)}; the frames ${found} cover ${fmt(f)}.${tail}`;
  }
  return `${head}, covering ${fmt(m)}.${tail}`;
}

/** Text for the polite live region once the spectrum reply is in (R9). Keeps the name. */
export function spectrumAnnouncement(o: SpectrumOutcome, name: string): string {
  const t = o.total;
  const tail = o.incomplete ? NOT_CHECKED : '';
  if (o.points === 0) {
    if (t === 0) return `No spectrum for ${name}: no frames were available to measure.${tail}`;
    // Saturation is named as the reason only when it covers most frames (no overclaim).
    if (o.saturated * 2 > t) {
      const bright = `No spectrum for ${name}: the object is too bright for the detector (saturated) in`;
      if (o.saturated < t) return `${bright} ${o.saturated} of ${t} frames.${tail}`;
      if (o.incomplete)
        return `${bright} ${t === 1 ? 'its only frame' : `all ${t} frames`} checked so far.${tail}`;
      return `${bright} ${t === 1 ? 'its only frame' : `all ${t} frames`}.`;
    }
    const none = t === 1 ? 'its only frame could not' : `none of the ${t} frames could`;
    return `No spectrum for ${name}: ${none} be measured.${tail}`;
  }
  const head = `Spectrum loaded: ${pluralPoints(o.points)}, ${o.flagged} flagged`;
  if (o.refused === 0 || !o.measuredRange) return `${head}.${tail}`;
  const [lo, hi] = o.measuredRange;
  return `${head}, ${formatWavelength(lo)} to ${formatWavelength(hi)}. ${pluralFrames(o.refused)} not measured.${tail}`;
}

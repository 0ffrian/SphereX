// User-facing wording for API errors and refused (`missing`) items. Plain sentences, no codes in
// the main line; the backend's own `detail` is shown underneath.
import type { SkyError } from '@/state/store';
import { badgeForTag, HONESTY_LABEL, stateThatShows } from '@/viewer/honesty';
import type { MissingItem } from '@/viewer/planTypes';
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
    line: 'where the detector flagged the object’s centre as saturated or unusable.',
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
  extension: {
    line: 'missing the image, flag or uncertainty layer, or with layers that don’t match.',
    short: 'missing or mismatched layer',
  },
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
    'The detector flagged the object’s centre as saturated or unusable in every frame found, so this tool can’t measure a spectrum.',
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
  return Object.hasOwn(NOTE_TEXT, g.reason) ? NOTE_TEXT[g.reason]! : `Not available: ${g.reason}`;
}

/** Short label for a frame group's ID list, e.g. "saturated". */
export function refusalShortLabel(reason: string): string {
  return frameText(reason)?.short ?? `reason code “${reason}”`;
}

const NOT_CHECKED = ' More frames have not been checked yet.';
/**
 * Cause-neutral on purpose: the backend's `saturated` also covers a blank (NaN) centre pixel with a
 * saturation flag nearby (photometry.py), which a dead pixel on a faint object can produce. So the
 * text never says the object is too bright.
 */
const FLAGGED = 'the detector flagged the object’s centre as saturated or unusable';

/**
 * The spectrum panel's empty state: why there is no spectrum. No object name: the heading names
 * it already, and resolver names such as "V* R Dra" read badly mid-sentence.
 */
export function spectrumEmptyMessage(o: SpectrumOutcome): string {
  const t = o.total;
  const head = 'There is no spectrum:';
  const tail = o.incomplete ? NOT_CHECKED : '';
  if (t === 0) return `${head} no frames of this object were available to measure.${tail}`;
  const found = o.incomplete ? 'checked so far' : 'found';
  const which = t === 1 ? `the only frame ${found}` : `any of the ${t} frames ${found}`;
  if (o.saturated === t) {
    const why = t === 1 ? `because ${FLAGGED}` : `because in every one ${FLAGGED}`;
    return `${head} this tool could not measure ${which}, ${why}.${tail}`;
  }
  if (o.saturated > 0 && o.largestReason === 'saturated') {
    const rest = t - o.saturated;
    const others =
      rest === 1
        ? 'the reason for the other frame is below'
        : `the reasons for the other ${rest} frames are below`;
    return `${head} this tool could not measure ${which}. In ${o.saturated} of them, ${FLAGGED}; ${others}.${tail}`;
  }
  const reasons = t === 1 ? 'The reason is below.' : 'The reasons are below.';
  return `${head} this tool could not measure ${which}. ${reasons}${tail}`;
}

/**
 * Share of the reference wavelength span (the frames', else the measured one) above which a wider
 * frames span, or a gap between measured points, is named. A display threshold, not a physical one.
 */
const SPAN_DIFFERENCE = 0.05;

/** "1.000 µm to 2.000 µm", or "1.000 µm" when both ends print the same. */
function formatRange(r: readonly [number, number]): string {
  const lo = formatWavelength(r[0]);
  const hi = formatWavelength(r[1]);
  return lo === hi ? lo : `${lo} to ${hi}`;
}

/**
 * Shown when some frames were measured and some refused: where the measured points lie (never
 * claiming they cover that range evenly), the widest gap between them when it is large, and the
 * frames' span when it is clearly wider (RW Aur: points only below about 1.1 µm).
 */
export function spectrumCoverageMessage(o: SpectrumOutcome): string {
  const found = o.incomplete ? 'checked so far' : 'found';
  const head = `This tool could measure ${o.points} of the ${o.total} frames ${found}`;
  const tail = o.incomplete ? NOT_CHECKED : '';
  const m = o.measuredRange;
  if (!m) return `${head}.${tail}`;
  const f = o.framesRange;
  const mw = m[1] - m[0];
  const fw = f ? f[1] - f[0] : 0;
  const ref = fw > 0 ? fw : mw;
  const single = formatWavelength(m[0]) === formatWavelength(m[1]);
  let text = single
    ? `${head}, ${o.points === 1 ? 'at' : 'all at'} ${formatWavelength(m[0])}`
    : `${head}. The measured points lie between ${formatWavelength(m[0])} and ${formatWavelength(m[1])}`;
  const g = o.largestGap;
  if (!single && g && ref > 0 && (g[1] - g[0]) / ref > SPAN_DIFFERENCE) {
    text += `, with none from ${formatWavelength(g[0])} to ${formatWavelength(g[1])}`;
  }
  if (f && fw > 0 && (fw - mw) / fw > SPAN_DIFFERENCE) {
    text += `; the frames ${found} span ${formatRange(f)}`;
  }
  return `${text}.${tail}`;
}

/** Text for the polite live region once the spectrum reply is in (R9). Keeps the name. */
export function spectrumAnnouncement(o: SpectrumOutcome, name: string): string {
  const t = o.total;
  const tail = o.incomplete ? NOT_CHECKED : '';
  if (o.points === 0) {
    if (t === 0) return `No spectrum for ${name}: no frames were available to measure.${tail}`;
    // Saturation is named as the reason only when it covers most frames (no overclaim).
    if (o.saturated * 2 > t) {
      const flagged = `No spectrum for ${name}: ${FLAGGED} in`;
      if (o.saturated < t) return `${flagged} ${o.saturated} of ${t} frames.${tail}`;
      const where = t === 1 ? 'its only frame' : `all ${t} frames`;
      return o.incomplete ? `${flagged} ${where} checked so far.${tail}` : `${flagged} ${where}.`;
    }
    const none = t === 1 ? 'its only frame could not' : `none of the ${t} frames could`;
    return `No spectrum for ${name}: ${none} be measured.${tail}`;
  }
  const head = `Spectrum loaded: ${pluralPoints(o.points)}, ${o.flagged} flagged`;
  if (o.refused === 0 || !o.measuredRange) return `${head}.${tail}`;
  const range = formatRange(o.measuredRange);
  const at = range.includes(' to ') ? range : `at ${range}`;
  return `${head}, ${at}. ${pluralFrames(o.refused)} not measured.${tail}`;
}

// ---- 3D viewer: refused layers in plain words --------------------------------------------------

const LAYER_NAME: Readonly<Record<string, string>> = {
  body: 'Body',
  mesh: 'Shape model',
  spin: 'Spin',
  material: 'Surface colour',
  ellipsoid: 'Ellipsoid shape',
  albedo_map: 'Surface brightness map',
  relief: 'Surface relief',
  emissive: 'Glow',
  bands: 'Band pattern',
  orbit: 'Orbit drawing',
  nucleus: 'Nucleus',
  gas_shells: 'Gas shells',
  dust: 'Dust cloud',
  tail: 'Tail',
  colour: 'Star colour',
  limb_darkening: 'Limb darkening',
  motion_trail: 'Motion trail',
  brightness_curve: 'Brightness from the light curve',
  radius_pulsation: 'Size pulsation',
  disc: 'Disc',
  dust_screen: 'Dust screen',
  lighting: 'Sun direction',
  tint: 'Body colour',
  size: 'Size and scale bar',
  visible: 'Visible-colour view',
  spherex_ir: 'SPHEREx infrared view',
  teq_pulse: 'Temperature pulse',
};

export function layerName(id: string): string {
  return LAYER_NAME[id] ?? `Layer “${id.replace(/_/g, ' ')}”`;
}

const FIELD_NAME: Readonly<Record<string, string>> = {
  diameter_km: 'the diameter',
  shape_source: 'the shape model address',
  rot_period_h: 'the rotation period',
  lightcurve: 'the light curve',
  gas_Q: 'the gas production rates',
  coma_radius_km: 'the coma radius',
  nucleus_radius_km_max: 'the nucleus size limit',
  radius_rjup: 'the radius',
  radius_rsun: 'the radius',
  teff_K: 'the temperature',
  flux_45um: 'the 4.5 µm flux',
  ch4_depth_33: 'the methane band depth',
  spectral_class: 'the spectral class',
  pm_mas_yr: 'the proper motion',
  period_var_d: 'the variability period',
  phase_angle_deg: 'the phase angle',
};

function fieldList(fields: readonly string[]): string {
  const names = fields.map((f) => FIELD_NAME[f] ?? f.replace(/_/g, ' '));
  return names.length <= 2
    ? names.join(' and ')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** One short line for a layer or view mode that is not drawn, with what would change it. */
export function describeRefusal(item: MissingItem): string {
  const name = layerName(item.id);
  // Not drawn from data, but a display default is shown instead (the panel adds a Default chip).
  if (item.defaultShown) return `${name}: shown as a default. ${item.defaultShown}`;
  switch (item.reason) {
    case 'honesty': {
      const badge = item.tag ? badgeForTag(item.tag) : 'Estimated';
      const needs = item.tag ? HONESTY_LABEL[stateThatShows(item.tag)] : HONESTY_LABEL.derived;
      return `${name}: hidden at this level. This layer is marked “${badge}”. Switch to “${needs}” to show it.`;
    }
    case 'data':
      return item.fields && item.fields.length > 0
        ? `${name}: not drawn. Missing data: ${fieldList(item.fields)}.`
        : `${name}: not drawn. ${item.detail ?? 'The data it needs is missing.'}`;
    case 'backend':
      return `${name}: not drawn. The data pipeline left it out.`;
    case 'load':
      return `${name}: not drawn. ${item.detail ?? 'Its file could not be loaded.'}`;
    case 'epoch': {
      const when = item.detail === '2025-08' ? 'August 2025' : 'December 2025';
      return `${name}: not drawn for ${when}. ${item.note ?? ''}`.trim();
    }
    case 'mode':
      return `${name}: not shown in this view. ${item.detail ?? ''}`.trim();
    case 'unverified':
      return `${name}: not drawn yet. ${item.detail ?? 'A value it needs is still being checked.'}`;
  }
}

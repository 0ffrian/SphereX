// User-facing wording for API errors and refused (`missing`) items. Plain sentences, no codes in
// the main line; the backend's own `detail` is shown underneath.
import type { SkyError } from '@/state/store';
import { badgeForTag, HONESTY_LABEL, stateThatShows } from '@/viewer/honesty';
import type { MissingItem } from '@/viewer/planTypes';
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
    case 'epoch':
      return `${name}: not shown for ${item.detail === '2025-08' ? 'August 2025' : 'December 2025'}.`;
    case 'unverified':
      return `${name}: not drawn yet. ${item.detail ?? 'A value it needs is still being checked.'}`;
  }
}

// Export ECSV of a scan's combined results (issue #157, mock-up state 11): one row per object or
// track of the merged results, with the square(s), visit dates and area ids it came from. Written
// from the results reply as it is (#156); a value the reply does not carry is left empty. Pure.
import type { RunResults, ScanBox } from './scanApi';

const csv = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\s]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const COLUMNS: { name: string; datatype: string; description: string }[] = [
  { name: 'kind', datatype: 'string', description: 'known (on file), or track (found by Discovery)' },
  { name: 'designation', datatype: 'string', description: 'SkyBoT designation; empty for an unexplained track' },
  { name: 'track_id', datatype: 'string', description: 'Discovery track id in its square' },
  { name: 'status', datatype: 'string', description: 'detected or predicted (known); the track verdict' },
  { name: 'v_mag', datatype: 'float64', description: 'SkyBoT V magnitude' },
  { name: 'rate_deg_day', datatype: 'float64', description: 'motion of the track, deg/day' },
  { name: 'squares', datatype: 'string', description: 'scan squares, space separated' },
  { name: 'dates', datatype: 'string', description: 'visit dates (UTC), space separated' },
  { name: 'area_id', datatype: 'string', description: 'stored area of the track' },
];

export function scanEcsv(res: RunResults, region: ScanBox): string {
  const head = [
    '# %ECSV 1.0',
    '# ---',
    '# datatype:',
    ...COLUMNS.map((c) => `# - {name: ${c.name}, datatype: ${c.datatype}, description: '${c.description}'}`),
    '# meta:',
    `#   run_id: ${res.run_id}`,
    `#   data_release: ${res.release}`,
    `#   region: {ra: ${region.ra}, dec: ${region.dec}, width_deg: ${region.width_deg}, height_deg: ${region.height_deg}}`,
    `#   squares_done: ${res.squares_done}`,
    `#   squares_total: ${res.squares_total}`,
    `#   squares_skipped: [${res.skipped.map((s) => s.index).join(', ')}]`,
    '# schema: astropy-2.0',
    COLUMNS.map((c) => c.name).join(','),
  ];
  const rows = [
    ...res.known.map((k) =>
      ['known', k.designation, '', k.detected ? 'detected' : 'predicted', k.v_mag, null, k.squares.join(' '), k.dates.join(' '), ''].map(csv).join(','),
    ),
    ...res.tracks.map((t) =>
      ['track', t.designation, t.track_id, t.verdict, null, t.rate_deg_day, t.squares.join(' '), t.dates.join(' '), t.area_id].map(csv).join(','),
    ),
  ];
  return [...head, ...rows].join('\n') + '\n';
}

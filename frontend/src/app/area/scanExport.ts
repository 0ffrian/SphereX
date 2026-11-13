// Export ECSV of a scan's combined results (issue #157, mock-up state 11): one row per object or
// track of the merged results, with the square(s), visit dates and area ids it came from. Written
// from the results reply as it is (#156); a value the reply does not carry is left empty. Pure.
import type { RunResults, ScanBox } from './scanApi';
import { rateOf } from './scanObjects';

const csv = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\s]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const COLUMNS: { name: string; datatype: string; description: string }[] = [
  {
    name: 'kind',
    datatype: 'string',
    description: 'known (on file), or track (found by Discovery)',
  },
  {
    name: 'designation',
    datatype: 'string',
    description: 'SkyBoT designation; empty for an unexplained track',
  },
  {
    name: 'track_id',
    datatype: 'string',
    description: 'Discovery track id(s), one per square, space separated',
  },
  {
    name: 'status',
    datatype: 'string',
    description: 'detected or predicted (known); found or unexplained (track)',
  },
  { name: 'v_mag', datatype: 'float64', description: 'SkyBoT V magnitude' },
  {
    name: 'rate_deg_day',
    datatype: 'float64',
    description: 'motion over the merged dots, deg/day (derived)',
  },
  { name: 'squares', datatype: 'string', description: 'scan squares, space separated' },
  { name: 'dates', datatype: 'string', description: 'visit start times (UTC), space separated' },
  {
    name: 'area_id',
    datatype: 'string',
    description: 'stored area(s) of the track, space separated',
  },
];

export function scanEcsv(res: RunResults, region: ScanBox): string {
  const head = [
    '# %ECSV 1.0',
    '# ---',
    '# datatype:',
    ...COLUMNS.map(
      (c) => `# - {name: ${c.name}, datatype: ${c.datatype}, description: '${c.description}'}`,
    ),
    '# meta:',
    `#   run_id: ${res.run_id}`,
    `#   data_release: ${res.release}`,
    `#   region: {ra: ${region.ra}, dec: ${region.dec}, width_deg: ${region.width_deg}, height_deg: ${region.height_deg}}`,
    `#   squares_done: ${res.squares.filter((s) => s.state === 'done').length}`,
    `#   squares_total: ${res.squares.length}`,
    `#   squares_skipped: [${res.squares
      .filter((s) => s.state === 'skipped' || s.state === 'failed')
      .map((s) => s.index)
      .join(', ')}]`,
    '# schema: astropy-2.0',
    COLUMNS.map((c) => c.name).join(','),
  ];
  const rows = [
    ...res.known.map((k) =>
      [
        'known',
        k.designation,
        '',
        k.detected ? 'detected' : 'predicted',
        k.v_mag,
        null,
        k.squares.join(' '),
        k.visits.join(' '),
        '',
      ]
        .map(csv)
        .join(','),
    ),
    ...res.tracks.map((t) =>
      [
        'track',
        t.designation,
        t.tracks.map((r) => r.track_id).join(' '),
        t.kind,
        null,
        rateOf(t.positions.slice().sort((a, b) => Date.parse(a.time) - Date.parse(b.time))),
        t.squares.join(' '),
        t.visits.join(' '),
        t.tracks.map((r) => r.area_id).join(' '),
      ]
        .map(csv)
        .join(','),
    ),
  ];
  return [...head, ...rows].join('\n') + '\n';
}

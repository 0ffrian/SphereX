// What a stored area's answer carries in the cards (Q-205, Q-467, A17.8; mock-up states 6 and 8):
// the provenance lines (how and when it was computed and on which release, the two visits and the
// frames, and any line the card adds, such as when SkyBoT last answered), a "Test data" tag for
// synthetic fixtures, and the list of what is missing (refuse rather than invent: a part that is not
// there is named, never drawn as if it were).
import type { ReactNode } from 'react';
import type { AreaSummary } from '@/contract';
import { releaseName } from './liveJobStore';
import { isLiveArea, missingText, visitStarts } from './realArea';

export const TEST_DATA_NOTE =
  'Test data: a synthetic fixture area made to test the tool, not SPHEREx measurements.';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
const hm = (d: Date) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;

/** "13 Nov 2026 07:28 UTC" (an unreadable time is given as it is). */
export function whenUtc(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${day(d)} ${hm(d)} UTC`;
}

/** "Visits 27 Jun 2026, 04:48 and 06:29 UTC · 14 frames" from the summary's frames. Pure. */
export function visitsLine(summary: Pick<AreaSummary, 'frames' | 'n_frames'>): string {
  const starts = visitStarts(summary).map((t) => new Date(t));
  const frames = `${summary.n_frames} frame${summary.n_frames === 1 ? '' : 's'}`;
  if (starts.length === 0) return frames;
  if (starts.length === 1) return `Visit ${day(starts[0]!)}, ${hm(starts[0]!)} UTC · ${frames}`;
  if (starts.length === 2) {
    const [a, b] = starts as [Date, Date];
    const times = day(a) === day(b) ? `${day(a)}, ${hm(a)} and ${hm(b)} UTC` : `${day(a)}, ${hm(a)} and ${day(b)}, ${hm(b)} UTC`;
    return `Visits ${times} · ${frames}`;
  }
  return `${starts.length} visits, ${day(starts[0]!)} to ${day(starts[starts.length - 1]!)} · ${frames}`;
}

export function RealAreaNotes({
  areaId,
  release,
  computedAt,
  summary,
  synthetic,
  missing,
  children,
}: {
  areaId: string;
  release: string;
  computedAt: string;
  /** The area's summary, for the visits line (null: not loaded, the line is left out). */
  summary: Pick<AreaSummary, 'frames' | 'n_frames'> | null;
  synthetic: boolean;
  missing: readonly string[];
  /** More provenance lines (the Known card's SkyBoT date). */
  children?: ReactNode;
}) {
  const live = isLiveArea(areaId);
  return (
    <>
      <div className="sx-area-prov" data-testid="area-prov">
        <span data-testid="area-precomputed" data-live={live || undefined}>
          <b>{live ? 'Computed live' : 'Precomputed'}</b> · {whenUtc(computedAt)} · {releaseName(release)}
          {synthetic && (
            <span
              className="sx-tagbadge"
              style={{ ['--dot' as string]: 'var(--p-asm)', marginLeft: 8 }}
              title={TEST_DATA_NOTE}
              data-testid="area-test-data"
            >
              Test data
            </span>
          )}
        </span>
        {summary && <span data-testid="area-visits">{visitsLine(summary)}</span>}
        {children}
      </div>
      {missing.length > 0 && (
        <details className="fb-muted" data-testid="area-missing">
          <summary>Not shown ({missing.length})</summary>
          <ul>
            {missing.map((code) => (
              <li key={code} data-code={code}>
                {missingText(code)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

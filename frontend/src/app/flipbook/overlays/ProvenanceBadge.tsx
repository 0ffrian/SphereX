// D-02 badge for one overlay provenance entry: Measured, Estimated (tooltip and screen-reader text
// give the formula, assumption or source) or Default. Fixture data wears "Fixture" instead, like
// the flipbook's stretch badge (Q-32, dev only).
import type { ProvenanceEntry } from '@/app/api/types';
import { DataBadge, EstimatedBadge } from '@/app/Badge';

export function ProvenanceBadge({ entry, fixture }: { entry: ProvenanceEntry; fixture: boolean }) {
  if (fixture) return <DataBadge fixture />;
  if (entry.tag === 'measured') return <DataBadge fixture={false} />;
  if (entry.tag === 'artistic') {
    return (
      <span
        className="rounded border border-neutral-400 px-1.5 py-0.5 text-xs font-medium text-neutral-200"
        title="Default (artist’s choice)"
        data-testid="badge-default"
      >
        Default
      </span>
    );
  }
  const tooltip =
    entry.formula ?? entry.assumption ?? entry.source ?? 'Estimated (no formula given)';
  return <EstimatedBadge tooltip={tooltip} />;
}

// The card of one track of a prepared area (A18.2): its verdict, visits, motion and match, as the
// stored reply has them, with the reply's own D-02 tags. A value the reply does not carry is
// written "not given", never estimated here.
import { ProvenanceBadge } from '@/app/Badge';
import { PanelCard } from '@/app/shell/PanelCard';
import { useAreaStore } from '@/app/shell/areaStore';
import { useShellStore } from '@/app/shell/shellStore';
import type { AreaProvenanceEntry, AreaTrack } from '@/contract';
import { areaTrackLabel, matchName } from './realArea';

const VERDICT: Record<AreaTrack['verdict'], string> = {
  found_blind: 'Found without looking it up, then matched to a known object',
  unexplained: 'Moves across visits and matches nothing on file',
  unchecked: 'Not checked against the known objects',
  possible: 'Possible: not enough to call it a track',
};

const tip = (p: AreaProvenanceEntry) => p.formula ?? p.assumption ?? p.source ?? '';

export function RealTrackCard({
  track,
  provenance,
  synthetic,
  back,
}: {
  track: AreaTrack;
  provenance: { tracks: AreaProvenanceEntry; match: AreaProvenanceEntry };
  synthetic: boolean;
  back: () => void;
}) {
  const closePanel = useShellStore((s) => s.closePanel);
  const t = track;
  return (
    <PanelCard
      title={areaTrackLabel(t)}
      subtitle="Track"
      icon="area"
      onClose={closePanel}
      onMinimise={() => useAreaStore.getState().setMinimised(true)}
      returnFocusTo='[data-testid="tool-area"]'
      testId="area-card"
    >
      <div data-testid="real-track-card">
        <p className="fb-muted">{VERDICT[t.verdict]}</p>
        <dl className="fb-dl">
          <dt>Visits</dt>
          <dd>{t.visits.join(', ')}</dd>
          <dt>Rate</dt>
          <dd>{t.rate_deg_day !== null ? `${t.rate_deg_day.toFixed(3)}°/day` : 'not given'}</dd>
          <dt>Direction</dt>
          <dd>{t.pa_deg !== null ? `${t.pa_deg.toFixed(0)}° east of north` : 'not given'}</dd>
          {t.match && (
            <>
              <dt>Match</dt>
              <dd>{matchName(t.match)}</dd>
            </>
          )}
          {t.unchecked_by.length > 0 && (
            <>
              <dt>Not checked by</dt>
              <dd>{t.unchecked_by.join(', ')}</dd>
            </>
          )}
        </dl>
        <div className="flex flex-wrap items-center gap-2">
          <span className="fb-muted">Track</span>
          <ProvenanceBadge
            tag={provenance.tracks.tag}
            tooltip={tip(provenance.tracks)}
            fixture={synthetic}
          />
          {t.match && (
            <>
              <span className="fb-muted">Match</span>
              <ProvenanceBadge
                tag={provenance.match.tag}
                tooltip={tip(provenance.match)}
                fixture={synthetic}
              />
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="sx-btn sx-btn-ghost"
            onClick={back}
            data-testid="area-back"
          >
            Back to the results
          </button>
        </div>
      </div>
    </PanelCard>
  );
}

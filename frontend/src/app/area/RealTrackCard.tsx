// The card of one track of a stored area (A18.2; mock-up state 9, issue #145): its verdict, visits,
// dots, motion and match, as the stored reply has them, with the reply's own D-02 tags. A value the
// reply does not carry is written "not given", never estimated here.
//
// Track it and Build it (Q-469): a track matched to a known object is that object, so Track it
// follows its Horizons path (at once when the cache holds its Track, else computed on demand) and
// Build it builds it from its catalogue data. A track no known object explains has no orbit: Track
// it says so and is off; Build it builds a placeholder from what was measured (buildFrom.ts).
import { ProvenanceBadge } from '@/app/Badge';
import { Row, Rows } from '@/app/PanelControls';
import { PanelCard } from '@/app/shell/PanelCard';
import { DEMO_OBJECT_ID, useAreaStore } from '@/app/shell/areaStore';
import { useShellStore } from '@/app/shell/shellStore';
import type { AreaProvenanceEntry, AreaSummary, AreaTrack } from '@/contract';
import { splitDesignation, type KnownObject } from './areaService';
import { Alert, BoxIcon, RouteIcon } from './areaBits';
import { buildKnown, buildPlaceholder } from './buildFrom';
import { areaTrackLabel, matchName } from './realArea';
import type { AreaBack } from './areaBack';
import { middleTime } from './trackJobStore';
import type { AreaSpectra, TrackSpectrum } from './spectraApi';
import { SpectrumFacts, SpectrumHow, SpectrumSection, SpectrumVerdictLine } from './SpectrumCard';

const VERDICT: Record<AreaTrack['verdict'], string> = {
  found_blind: 'Found without looking it up, then matched to a known object',
  unexplained: 'Moves across visits and matches nothing on file',
  unchecked: 'Not checked against the known objects',
  possible: 'Possible: not enough to call it a track',
};

export const NO_ORBIT_NOTE = 'Orbit not known: a Track follows a known object’s path.';

const tip = (p: AreaProvenanceEntry) => p.formula ?? p.assumption ?? p.source ?? '';

/** The track's dots' frame times (dot ids are `<frame_id>:<n>`), from the summary's frames. Pure. */
export function trackTimes(
  t: Pick<AreaTrack, 'tracklets'>,
  summary: Pick<AreaSummary, 'frames'> | null,
): string[] {
  if (!summary) return [];
  const byFrame = new Map(summary.frames.map((f) => [f.frame_id, f.time]));
  const out: string[] = [];
  for (const tl of t.tracklets)
    for (const id of tl.dot_ids) {
      const time = byFrame.get(id.slice(0, id.lastIndexOf(':')));
      if (time) out.push(time);
    }
  return out;
}

/** The known object a matched track is (for Track it and Build it), null when it matched none. */
export function matchedObject(t: AreaTrack): KnownObject | null {
  const m = t.match;
  if (!m) return null;
  const name = matchName(m);
  return {
    ...splitDesignation(name, m.number),
    kind: 'asteroid',
    frames: t.tracklets.reduce((n, tl) => n + tl.dot_ids.length, 0),
    visits: t.visits.length,
    designation: name,
    objectId: m.object_id,
    number: m.number,
    vMag: m.v_mag,
    detection: { trackId: t.track_id, sepPx: m.median_sep_px },
  };
}

export function RealTrackCard({
  track,
  provenance,
  synthetic,
  summary,
  areaId,
  release,
  back,
  spectrum = null,
}: {
  track: AreaTrack;
  provenance: { tracks: AreaProvenanceEntry; match: AreaProvenanceEntry };
  synthetic: boolean;
  /** The area's summary (frame times, for Track it's window); null when it is not loaded. */
  summary: Pick<AreaSummary, 'frames'> | null;
  areaId: string;
  release: string;
  /** The card's ← (#173): back to the list it was opened from. */
  back: AreaBack | null;
  /**
   * The track's spectrum check (A18.7, issue #162) with the area's reply and a dot lookup; null when
   * the area has none (not run, not loaded, or the demo).
   */
  spectrum?: {
    track: TrackSpectrum;
    spectra: Pick<AreaSpectra, 'calibration' | 'method' | 'provenance'>;
    flags: (dotId: string) => readonly string[];
    measuredOnly: boolean;
  } | null;
}) {
  const closePanel = useShellStore((s) => s.closePanel);
  const t = track;
  const obj = matchedObject(t);
  const around = middleTime(trackTimes(t, summary));
  const nDots = t.tracklets.reduce((n, tl) => n + tl.dot_ids.length, 0);
  const track_ =
    obj?.objectId === DEMO_OBJECT_ID
      ? () => useAreaStore.getState().openEros(obj)
      : obj?.objectId && around
        ? () => useAreaStore.getState().openTrack(obj, around, release)
        : null;
  return (
    <PanelCard
      title={areaTrackLabel(t)}
      // The verdict line says what it is; without one (no spectrum, or Measured only) a short line does.
      subtitle={spectrum && !spectrum.measuredOnly ? undefined : VERDICT[t.verdict]}
      wrapSubtitle
      onClose={closePanel}
      back={back}
      onMinimise={() => useAreaStore.getState().setMinimised(true)}
      returnFocusTo='[data-testid="tool-area"]'
      testId="area-card"
    >
      <div className="sx-live" data-testid="real-track-card">
        {spectrum && !spectrum.measuredOnly && (
          <SpectrumVerdictLine spectrum={spectrum.track} matched={obj !== null} />
        )}
        {spectrum && (
          <SpectrumSection
            spectrum={spectrum.track}
            spectra={spectrum.spectra}
            measuredOnly={spectrum.measuredOnly}
            fixture={synthetic}
          />
        )}
        {/* #173: three facts up top (colour, visits, steadiness); the rest folds away. */}
        <dl className="sx-tr">
          {spectrum && (
            <SpectrumFacts
              spectrum={spectrum.track}
              spectra={spectrum.spectra}
              measuredOnly={spectrum.measuredOnly}
            />
          )}
          <dt>Visits</dt>
          <dd>
            {t.visits.join(' and ')} · {nDots} dot{nDots === 1 ? '' : 's'}
          </dd>
        </dl>
        <div className="sx-tags">
          <ProvenanceBadge
            tag={provenance.tracks.tag}
            tooltip={tip(provenance.tracks)}
            fixture={synthetic}
          />
          {t.match ? (
            <ProvenanceBadge
              tag={provenance.match.tag}
              tooltip={tip(provenance.match)}
              fixture={synthetic}
            />
          ) : (
            <span
              className="sx-chip sx-chip-dot"
              style={{ ['--dot' as string]: 'var(--p-asm)' }}
              data-testid="track-no-orbit"
            >
              Orbit not known
            </span>
          )}
        </div>
        {obj && !obj.objectId && (
          <Alert tone="warn" title="No JPL id" line="Its Track cannot be computed here." />
        )}
        <div className="sx-live-btns">
          <button
            type="button"
            className="sx-btn-outline sx-live-primary"
            disabled={!track_}
            onClick={track_ ?? undefined}
            title={
              track_ ? undefined : obj ? 'No JPL id or visit time for this object' : NO_ORBIT_NOTE
            }
            data-testid="track-track"
          >
            <RouteIcon />
            Track it
          </button>
          <button
            type="button"
            className="sx-btn-outline"
            onClick={() => (obj ? buildKnown(obj) : buildPlaceholder(areaId, t, areaTrackLabel(t)))}
            data-testid="track-build"
          >
            <BoxIcon />
            Build it
          </button>
        </div>
        <div className="sx-sp-acc">
          <Rows>
            <Row title="Motion and match" testId="track-details">
              <dl className="sx-tr">
                <dt>Rate</dt>
                <dd>
                  {t.rate_deg_day !== null ? `${t.rate_deg_day.toFixed(3)}°/day` : 'not given'}
                  {t.pa_deg !== null ? `, ${t.pa_deg.toFixed(0)}° east of north` : ''}
                </dd>
                <dt>Known</dt>
                <dd data-testid="track-known">
                  {t.match
                    ? `${matchName(t.match)}${t.match.median_sep_px !== null ? ` · ${t.match.median_sep_px.toFixed(2)} px from predicted` : ''}`
                    : t.verdict === 'unchecked'
                      ? 'not checked'
                      : 'none on file (SkyBoT)'}
                </dd>
                {t.unchecked_by.length > 0 && (
                  <>
                    <dt>Not checked by</dt>
                    <dd>{t.unchecked_by.join(', ')}</dd>
                  </>
                )}
              </dl>
              {!obj && <p className="sx-live-m">{NO_ORBIT_NOTE}</p>}
            </Row>
          </Rows>
        </div>
        {spectrum && (
          <SpectrumHow
            spectrum={spectrum.track}
            spectra={spectrum.spectra}
            flags={spectrum.flags}
          />
        )}
      </div>
    </PanelCard>
  );
}

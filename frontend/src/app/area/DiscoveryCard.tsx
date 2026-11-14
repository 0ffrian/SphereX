// Discovery (mock-up `openDiscoveryCard`, `arRenderSteps`, `arRenderList`): a compact step list
// that runs on its own (a loader on the current step, a tick on the done ones), then the movers it
// found. The dots and movers draw on the sky (AreaTrackLayer). The steps, counts and movers come
// from areaService.discoverIn: a prepared area's precomputed replies (Q-205), else DEMO DATA that
// is not a search of the square. Issue #145: the provenance lines, "Detection rates not measured
// yet" until the checks D4 to D7 exist, Export ECSV, and a track's card with Track it and Build it.
import GridLoader from '@/app/island/GridLoader';
import { FETCHING_LOOK, SEARCHING_LOOK } from '@/app/island/loaderLooks';
import { PanelCard } from '@/app/shell/PanelCard';
import { formatAreaDims, useAreaStore } from '@/app/shell/areaStore';
import { useShellStore } from '@/app/shell/shellStore';
import { DemoTag } from './DemoTag';
import { ErosCard, MoverDemoCard } from './ErosCard';
import { RealAreaNotes } from './RealAreaNotes';
import { RealTrackCard } from './RealTrackCard';
import { useAreaBack } from './areaBack';
import { Alert, AreaAlert } from './areaBits';
import { API_BASE } from '@/app/api/config';
import { visitNumbers } from '@/app/sky/area/blink';
import { SPECTRUM_STEP, type DiscoveryMover } from './areaService';
import { SpectrumRowWord } from './SpectrumCard';
import { flagsFrom } from './spectrumWords';
import { ToggleGroup } from '@/app/PanelControls';
import { useAppStore } from '@/state/store';
import { useEffect, useMemo, useState } from 'react';
import type { RealDiscovery } from './realArea';

/** The result chip of a mover row: the stored verdict for a prepared area, the demo's kind else. */
function MoverChip({ m, step }: { m: DiscoveryMover; step: number }) {
  if (step < 4) return m.known || m.track ? <span className="sx-chip">checking</span> : <span className="sx-chip">{m.visits < 2 ? 'Seen once' : 'Unexplained'}</span>;
  const v = m.track?.verdict;
  if (v === 'possible') return <span className="sx-chip">Possible</span>;
  if (v === 'unchecked') return <span className="sx-chip">Not checked</span>;
  if (v === 'found_blind' && !m.known) return <span className="sx-chip" data-tone="ok">Matched on file</span>;
  if (m.known) return <span className="sx-chip" data-tone="ok">{`Known: ${m.known}`}</span>;
  if (m.visits < 2) return <span className="sx-chip">Seen once</span>;
  return (
    <span className="sx-chip" data-tone="warn">
      Unexplained
    </span>
  );
}

type MoverFilter = 'all' | 'rock' | 'known';
/** A single-visit or ambiguous possible: hidden on the sky and in the list until asked (#173). */
export const isPossible = (m: DiscoveryMover) => m.track?.verdict === 'possible';
/** The results filter (mock-up state A): all, the Rock-like spectrum verdicts, or the known objects. */
const keep = (m: DiscoveryMover, f: MoverFilter) =>
  f === 'all' || (f === 'rock' ? m.spectrum?.verdict === 'rock' : m.known !== null);

/** A dot's flags from the area's `/dots` (Points used). */
function useDotFlags(real: RealDiscovery | null) {
  return useMemo(
    () => flagsFrom(new Map((real?.dots?.visits ?? []).flatMap((v) => v.dots.map((d) => [d.dot_id, d.flags] as const)))),
    [real],
  );
}

/** smoothui's demo looks (loaderLooks.ts) at the row's size; the current step shows one of them. */
const ROW_SIZE = 19;
const SEARCH_ROW = { ...SEARCHING_LOOK, size: ROW_SIZE };
const THINK_ROW = { ...FETCHING_LOOK, size: ROW_SIZE };
const stepLook = (label: string) =>
  label.startsWith('Drop') ? THINK_ROW : SEARCH_ROW;

export function DiscoveryCard() {
  const disc = useAreaStore((s) => s.disc);
  const step = useAreaStore((s) => s.step);
  const running = useAreaStore((s) => s.running);
  const box = useAreaStore((s) => s.box);
  const refusal = useAreaStore((s) => s.refusal);
  const closePanel = useShellStore((s) => s.closePanel);
  const back = useAreaBack();
  const visit = useAreaStore((s) => s.visit);
  // Back from a track (#173): the list opens on the row it came from.
  const cameFrom = useAreaStore((s) => (s.sel >= 0 ? (s.disc?.movers[s.sel]?.id ?? null) : null));
  useEffect(() => {
    if (!cameFrom) return;
    const row = document.querySelector<HTMLElement>(`[data-testid="disc-mover-${CSS.escape(cameFrom)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
    row?.focus({ preventScroll: true });
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const real = disc?.real ?? null;
  const visits = real ? visitNumbers(real.summary, real.dots) : [];
  // The spectrum check (A18.7, issue #162): the row verdicts show once its step is done, and never
  // under Measured only, where the verdict (model_dependent) is hidden as on the Result card (D-21).
  const measuredOnly = useAppStore((s) => s.honesty === 'measured');
  const [filter, setFilter] = useState<MoverFilter>('all');
  const steps = disc?.steps ?? [];
  const total = steps.length;
  const nowStep = running ? step + 1 : -1;
  const done = total > 0 && !running && step >= total - 1;
  const spectrumAt = steps.findIndex((s) => s.label === SPECTRUM_STEP);
  const showVerdicts = !measuredOnly && spectrumAt >= 0 && step >= spectrumAt;
  const showPossible = useAreaStore((s) => s.showPossible);
  const all = disc?.movers ?? [];
  const nPossible = all.filter(isPossible).length;
  const movers = showPossible ? all : all.filter((m) => !isPossible(m));
  const active: MoverFilter = showVerdicts ? filter : 'all';
  // Indexes stay those of disc.movers (openMover takes them).
  const shown = all
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => (showPossible || !isPossible(m)) && keep(m, active));
  const announce =
    total === 0
      ? ''
      : running && steps[nowStep]
        ? `Step ${nowStep + 1} of ${total}: ${steps[nowStep]!.label}`
        : step >= total - 1
          ? real && !real.tracks
            ? 'The tracks could not be loaded'
            : `${movers.length} movers found${nPossible > 0 && !showPossible ? `, ${nPossible} possible hidden` : ''}`
          : '';
  return (
    <PanelCard
      title="Discovery"
      subtitle={box ? `Area · ${formatAreaDims(box)}` : 'Area'}
      onClose={closePanel}
      onMinimise={() => useAreaStore.getState().setMinimised(true)}
      returnFocusTo='[data-testid="tool-area"]'
      testId="area-card"
      back={back}
    >
      <div className="sx-live sx-results" data-testid="disc-card">
      {refusal ? (
        <AreaAlert refusal={refusal} />
      ) : real ? (
        <RealAreaNotes
          areaId={real.entry.area_id}
          release={real.summary.data_release}
          computedAt={real.summary.computed_at}
          summary={real.summary}
          synthetic={real.synthetic}
          missing={real.missing}
        />
      ) : disc?.demo ? (
        <div className="sx-kn-foot">
          <DemoTag />
        </div>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      {total === 0 && !refusal && (
        <div className="fb-muted sx-ar-wait">
          <GridLoader {...SEARCH_ROW} />
          Loading the area…
        </div>
      )}
      <ol className="sx-ar-steps" data-testid="disc-steps">
        {steps.map((s, k) => {
          const on = k <= step;
          const now = k === nowStep;
          return (
            <li key={s.label} data-state={on ? 'on' : now ? 'now' : undefined}>
              <i aria-hidden="true">
                {now ? (
                  <GridLoader {...stepLook(s.label)} />
                ) : (
                  <svg viewBox="0 0 24 24">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                )}
              </i>
              <span>{s.label}</span>
              <small>{on ? (measuredOnly && s.measuredResult !== undefined ? s.measuredResult : s.result) : ''}</small>
            </li>
          );
        })}
      </ol>
      {real && visits.length > 1 && step >= 0 && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Visit shown on the sky">
          <span className="fb-muted">Visit</span>
          {visits.map((v) => {
            const on = (visit ?? visits[0]) === v;
            return (
              <button
                key={v}
                type="button"
                className="sx-btn sx-btn-ghost"
                aria-pressed={on}
                data-on={on || undefined}
                onClick={() => useAreaStore.getState().setVisit(v)}
                data-testid={`area-visit-${v}`}
              >
                {on ? `${v} (shown)` : v}
              </button>
            );
          })}
        </div>
      )}
      {step >= 3 && showVerdicts && movers.length > 0 && (
        <ToggleGroup<MoverFilter>
          label="Show"
          hideLabel
          options={[
            { value: 'all', label: `All ${movers.length}`, testId: 'disc-filter-all' },
            { value: 'rock', label: `Rock-like ${movers.filter((m) => keep(m, 'rock')).length}`, testId: 'disc-filter-rock' },
            { value: 'known', label: `Known ${movers.filter((m) => keep(m, 'known')).length}`, testId: 'disc-filter-known' },
          ]}
          value={active}
          onChange={setFilter}
          testId="disc-filter"
        />
      )}
      {step >= 3 && active !== 'all' && shown.length === 0 && (
        <p className="fb-muted" data-testid="disc-filter-none">
          {active === 'rock' ? 'No rock-like tracks here.' : 'No known objects here.'}
        </p>
      )}
      {step >= 3 && (
        <div className="sx-lk-list" data-testid="disc-list">
          {shown.map(({ m, i }) => (
            <button
              key={m.id}
              type="button"
              className="sx-lk-row"
              onClick={() => useAreaStore.getState().openMover(i)}
              data-testid={`disc-mover-${m.id}`}
            >
              <b>{m.id}</b>
              <span>
                {m.visits < 2
                  ? 'Seen in 1 visit'
                  : m.track
                    ? `Moves across ${m.visits} visits`
                    : 'Moves across both visits'}
              </span>
              <span className="sx-lk-end">
                <MoverChip m={m} step={step} />
                {showVerdicts && m.spectrum && <SpectrumRowWord spectrum={m.spectrum} />}
              </span>
            </button>
          ))}
        </div>
      )}
      {done && real && (
        // Until the completeness and false-alarm checks (D4 to D7) exist (plan answer 4).
        <Alert tone="warn" title="Detection rates not measured yet" line="Treat possible tracks as leads." testId="disc-rates" />
      )}
      {(done || refusal) && (
        <div className="sx-live-btns">
          {done && nPossible > 0 && (
            <button
              type="button"
              className="sx-btn-outline"
              aria-pressed={showPossible}
              onClick={() => useAreaStore.getState().setShowPossible(!showPossible)}
              data-testid="disc-show-possible"
            >
              {`Show possible (${nPossible.toLocaleString('en-GB')})`}
            </button>
          )}
          {done && real && (
            <a
              className="sx-btn-outline"
              href={`${API_BASE}/areas/${encodeURIComponent(real.entry.area_id)}/export.ecsv`}
              download
              data-testid="disc-export"
            >
              Export ECSV
            </a>
          )}
          <button
            type="button"
            className="sx-btn-outline"
            data-testid="area-redraw"
            onClick={() => useAreaStore.getState().redraw()}
          >
            Choose another region
          </button>
        </div>
      )}
      </div>
    </PanelCard>
  );
}

/** The card of the mover chosen in the results: T1 is Eros (real demo frames), the rest are made up. */
export function MoverCard() {
  const sel = useAreaStore((s) => s.sel);
  const disc = useAreaStore((s) => s.disc);
  const back = useAreaBack();
  const measuredOnly = useAppStore((s) => s.honesty === 'measured');
  const flags = useDotFlags(disc?.real ?? null);
  const m = disc?.movers[sel];
  if (!m) return null;
  if (m.track && disc?.real?.tracks) {
    const spectra = disc.real.spectra;
    return (
      <RealTrackCard
        spectrum={spectra && m.spectrum ? { track: m.spectrum, spectra, flags, measuredOnly } : null}
        track={m.track}
        provenance={disc.real.tracks.provenance}
        synthetic={disc.real.synthetic}
        summary={disc.real.summary}
        areaId={disc.real.entry.area_id}
        release={disc.real.summary.data_release}
        back={back}
      />
    );
  }
  const title = m.known ? `${m.id} · ${m.known}` : m.id;
  if (m.kind === 'known') return <ErosCard title={title} back={back} />;
  return (
    <MoverDemoCard
      title={title}
      kind={m.visits < 2 ? 'Seen once' : 'Unexplained'}
      frames={m.visits < 2 ? 4 : 8}
      back={back}
    />
  );
}

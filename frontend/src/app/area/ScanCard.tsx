// The scan card (issue #157; mock-up states 2, 10 and 11), for a region of more than one square:
//   offer    the region fills the screen, gridded: Data, Squares, Time, Order; Start scan or Select again;
//   scanning a mini grid of the squares' states, "Square 7 of 15 · <step and count>", time left,
//            running totals, skipped squares as status-dot messages; Pause, Stop, Minimise;
//   done     where the data came from, the totals, a Found / Known / Possible filter and rows that
//            name their square(s) and date, with Track it and Build it; Export ECSV and Scan again.
// Closing the card while the scan runs does not stop it (the dock button brings the card back).
import { useEffect, useMemo, useRef, useState } from 'react';
import { PanelCard } from '@/app/shell/PanelCard';
import { useAreaStore } from '@/app/shell/areaStore';
import { useShellStore } from '@/app/shell/shellStore';
import { Alert, BoxIcon, RouteIcon } from './areaBits';
import type { KnownObject } from './areaService';
import { buildKnown, buildPlaceholder } from './buildFrom';
import { NO_ID_NOTE } from './KnownList';
import { failureText, releaseName, stepCount } from './liveJobStore';
import { NO_ORBIT_NOTE } from './RealTrackCard';
import type { RunKnownRow, RunRecord, RunResults, RunTrackRow, ScanBox, ScanPlan } from './scanApi';
import { scanEcsv } from './scanExport';
import { aboutTime, SQUARE_ESTIMATE_S, splitCount } from './scanGrid';
import { objectsFromEvents, squaresText } from './scanObjects';
import { isFinished, scanFailureText, skippedText, useScanStore, type ScanView } from './scanStore';
import { middleTime } from './trackJobStore';

const flowTitle = (flow: 'known' | 'discovery') =>
  flow === 'known' ? 'Known objects' : 'Discovery';
const dims = (r: ScanBox) => `${r.width_deg.toFixed(1)}° × ${r.height_deg.toFixed(1)}°`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "27 Jun" (UTC); with the year: "2 Jul 2026". */
export function dayOf(iso: string, year = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ''}`;
}

export function ScanCard() {
  const view = useScanStore((s) => s.view);
  const closePanel = useShellStore((s) => s.closePanel);
  const bodyRef = useRef<HTMLDivElement>(null);
  const record = view?.kind === 'run' ? view.record : null;
  const done = record !== null && isFinished(record.state);
  const stateKey = view
    ? `${view.kind}:${record?.state ?? ''}:${view.kind === 'offer' ? !!view.plan : ''}`
    : '';
  // The card changes under the button just pressed (Start scan, Stop): focus goes to its title.
  useEffect(() => {
    const a = document.activeElement;
    if (a && a !== document.body) return;
    bodyRef.current
      ?.closest('section')
      ?.querySelector<HTMLElement>('h2')
      ?.focus({ preventScroll: true });
  }, [stateKey]);
  if (!view) return null;
  const release = record
    ? releaseName(record.release)
    : view.kind === 'offer' && view.plan
      ? releaseName(view.plan.release)
      : '';
  const region = view.kind === 'run' ? (record?.region ?? view.region) : view.region;
  const subtitle =
    view.kind === 'run' && !done
      ? [
          record?.state === 'paused'
            ? 'Paused'
            : record?.state === 'queued'
              ? 'Waiting'
              : 'Scanning',
          release,
        ]
          .filter(Boolean)
          .join(' · ')
      : `Scan · ${dims(region)}`;
  const running = view.kind === 'run' && !done;
  const close = () => {
    // A finished, refused or offered scan is forgotten; a running one keeps running.
    if (!running) useScanStore.getState().clear();
    closePanel();
  };
  return (
    <PanelCard
      title={flowTitle(view.flow)}
      subtitle={subtitle}
      onClose={close}
      onMinimise={() => useAreaStore.getState().setMinimised(true)}
      returnFocusTo={
        view.flow === 'known' ? '[data-testid="tool-known"]' : '[data-testid="tool-area"]'
      }
      testId="area-card"
    >
      <div
        ref={bodyRef}
        className={`sx-live sx-scan-card${done ? ' sx-scan-done' : ''}`}
        data-testid="scan-card"
        data-state={view.kind === 'run' ? (record?.state ?? 'starting') : view.kind}
      >
        {view.kind === 'offer' && <Offer view={view} />}
        {view.kind === 'failed' && <Failed view={view} />}
        {view.kind === 'run' && !done && <Scanning view={view} record={record} />}
        {view.kind === 'run' && done && record && (
          <Done record={record} results={view.results} stale={view.stale} />
        )}
      </div>
    </PanelCard>
  );
}

function selectAgain(flow: 'known' | 'discovery') {
  useScanStore.getState().clear();
  useAreaStore.getState().startFlow(flow);
}

function Offer({ view }: { view: Extract<ScanView, { kind: 'offer' }> }) {
  const busy = useScanStore((s) => s.busy);
  const plan: ScanPlan | null = view.plan;
  const cols = plan?.cols ?? splitCount(view.region.width_deg);
  const rows = plan?.rows ?? splitCount(view.region.height_deg);
  const n = cols * rows;
  const stored = plan?.squares.filter((s) => s.area_id !== null).length ?? 0;
  return (
    <>
      <p className="sx-live-p">
        The {n} squares on screen are analysed one after another, left to right.
      </p>
      <dl className="sx-live-facts" data-testid="scan-facts">
        <dt>Data</dt>
        <dd>{plan ? releaseName(plan.release) : 'Checking…'}</dd>
        <dt>Squares</dt>
        <dd>
          {n} ({cols} × {rows}) of up to 2°{stored > 0 ? `, ${stored} already done` : ''}
        </dd>
        <dt>Time</dt>
        <dd>{plan ? aboutTime(plan.estimate_s, plan.estimate_s >= 3 * 3600) : 'Checking…'}</dd>
        <dt>Order</dt>
        <dd>left to right, row by row, from the top</dd>
      </dl>
      <p className="sx-live-m">
        Each square&rsquo;s result is saved as soon as it finishes. You can keep using the app.
      </p>
      <div className="sx-live-btns">
        <button
          type="button"
          className="sx-btn-outline sx-live-primary"
          disabled={!plan || busy}
          onClick={() => void useScanStore.getState().start()}
          data-testid="scan-start"
        >
          Start scan
        </button>
        <button
          type="button"
          className="sx-btn-outline"
          onClick={() => selectAgain(view.flow)}
          data-testid="scan-select-again"
        >
          Select again
        </button>
      </div>
    </>
  );
}

function Failed({ view }: { view: Extract<ScanView, { kind: 'failed' }> }) {
  const t = scanFailureText(view.code);
  return (
    <>
      <Alert title={t.title} line={t.line} testId="scan-failed" code={view.code} />
      <div className="sx-live-btns">
        <button
          type="button"
          className="sx-btn-outline"
          onClick={() => selectAgain(view.flow)}
          data-testid="scan-select-again"
        >
          Select again
        </button>
      </div>
    </>
  );
}

/** The squares' states as a small grid; a done square is a button that opens its results. */
function MiniGrid({ record, flowCols }: { record: RunRecord; flowCols: number }) {
  const c = { done: 0, skipped: 0, running: 0, todo: 0 };
  for (const s of record.squares) {
    if (s.state === 'done') c.done++;
    else if (s.state === 'skipped' || s.state === 'failed') c.skipped++;
    else if (s.state === 'running') c.running++;
    else c.todo++;
  }
  const label = `Squares: ${c.done} done, ${c.skipped} skipped, ${c.running} analysing, ${c.todo} to do`;
  const flow = record.kind;
  return (
    <div
      className="sx-scan-mini"
      role="group"
      aria-label={label}
      style={{ gridTemplateColumns: `repeat(${flowCols}, 1fr)` }}
      data-testid="scan-mini"
    >
      {record.squares.map((s) =>
        s.state === 'done' ? (
          <button
            key={s.index}
            type="button"
            data-state="done"
            aria-label={`Square ${s.index}, done. Open its results`}
            onClick={() => {
              const { a, b } = boxOf(s.box);
              useAreaStore
                .getState()
                .openSquare({ a, b, widthDeg: s.box.width_deg, heightDeg: s.box.height_deg }, flow);
            }}
          />
        ) : (
          <span key={s.index} data-state={s.state} />
        ),
      )}
    </div>
  );
}

/** A square box's top-left and bottom-right corners (small boxes: a flat-sky offset is enough). */
function boxOf(b: ScanBox) {
  const k = Math.cos((b.dec * Math.PI) / 180) || 1;
  return {
    a: { ra: b.ra + b.width_deg / 2 / k, dec: b.dec + b.height_deg / 2 },
    b: { ra: b.ra - b.width_deg / 2 / k, dec: b.dec - b.height_deg / 2 },
  };
}

function Totals({ record }: { record: RunRecord }) {
  return (
    <div className="sx-scan-totals" data-testid="scan-totals">
      <div>
        <b>{record.totals.known}</b>
        <span>known objects</span>
      </div>
      <div>
        <b>{record.totals.found}</b>
        <span>found by Discovery</span>
      </div>
      <div>
        <b>{record.totals.unexplained}</b>
        <span>unexplained</span>
      </div>
    </div>
  );
}

/** Predicted-only known objects are hidden on the sky by default; this shows them. */
function PredictedToggle({ record }: { record: RunRecord }) {
  const on = useScanStore((s) => s.showPredicted);
  const n = useMemo(
    () => objectsFromEvents(record.events).filter((o) => o.kind === 'predicted').length,
    [record.events],
  );
  if (n === 0) return null;
  return (
    <button
      type="button"
      className="sx-btn sx-btn-ghost sx-scan-pred"
      aria-pressed={on}
      data-on={on || undefined}
      onClick={() => useScanStore.getState().togglePredicted()}
      data-testid="scan-predicted"
    >
      {on ? `Predicted shown (${n})` : `Show predicted (${n})`}
    </button>
  );
}

function Skipped({ record }: { record: RunRecord }) {
  const off = record.squares.filter((s) => s.state === 'skipped' || s.state === 'failed');
  return (
    <>
      {off.map((s) => {
        const t = skippedText(s.index, s.error?.code, s.state === 'failed');
        return (
          <Alert
            key={s.index}
            title={t.title}
            line={t.line}
            testId="scan-skipped"
            code={s.error?.code}
          />
        );
      })}
    </>
  );
}

function Scanning({
  view,
  record,
}: {
  view: Extract<ScanView, { kind: 'run' }>;
  record: RunRecord | null;
}) {
  const busy = useScanStore((s) => s.busy);
  if (!record) return <p className="sx-live-m">Reading the scan…</p>;
  const n = record.squares.length;
  const cur = record.squares.find((s) => s.state === 'running');
  const step = view.square?.steps.find((s) => s.state === 'running');
  const left =
    record.squares.filter((s) => s.state === 'todo').length * SQUARE_ESTIMATE_S +
    (cur ? (view.square?.eta_s ?? SQUARE_ESTIMATE_S / 2) : 0);
  const lastDone = Math.max(
    0,
    ...record.squares
      .filter((s) => s.state !== 'todo' && s.state !== 'running')
      .map((s) => s.index),
  );
  const where =
    record.state === 'queued'
      ? `Waiting · square 1 of ${n} starts next`
      : record.state === 'paused'
        ? `Paused after square ${lastDone} of ${n}`
        : cur
          ? [`Square ${cur.index} of ${n}`, step ? `${step.label} ${stepCount(step)}`.trim() : null]
              .filter(Boolean)
              .join(' · ')
          : `Square ${Math.min(n, lastDone + 1)} of ${n}`;
  const cols = splitCount(record.region.width_deg);
  return (
    <>
      <MiniGrid record={record} flowCols={cols} />
      <div className="sx-live-time" data-testid="scan-time">
        <span>{where}</span>
        <span>{aboutTime(left)} left</span>
      </div>
      <Totals record={record} />
      <Skipped record={record} />
      {view.stale && (
        <Alert
          tone="warn"
          title="Lost touch with the scan"
          line="Trying again."
          testId="scan-stale"
        />
      )}
      <PredictedToggle record={record} />
      <div className="sx-live-btns">
        {record.state === 'paused' ? (
          <button
            type="button"
            className="sx-btn-outline"
            disabled={busy}
            onClick={() => void useScanStore.getState().resume()}
            data-testid="scan-resume"
          >
            Resume
          </button>
        ) : (
          <button
            type="button"
            className="sx-btn-outline"
            disabled={busy}
            title="Finishes the current square, then waits"
            onClick={() => void useScanStore.getState().pause()}
            data-testid="scan-pause"
          >
            Pause
          </button>
        )}
        <button
          type="button"
          className="sx-btn-outline"
          disabled={busy}
          title="Every finished square is kept"
          onClick={() => void useScanStore.getState().stop()}
          data-testid="scan-stop"
        >
          Stop
        </button>
        <button
          type="button"
          className="sx-btn-outline"
          onClick={() => useAreaStore.getState().setMinimised(true)}
          data-testid="scan-minimise"
        >
          Minimise
        </button>
      </div>
    </>
  );
}

type Filter = 'found' | 'known' | 'possible';
interface Row {
  key: string;
  num: string;
  name: string;
  line: string;
  where: string;
  known: RunKnownRow | null;
  track: RunTrackRow | null;
}

const whereOf = (squares: number[], dates: string[]) =>
  [squaresText(squares), dates[0] ? dayOf(dates[0]) : ''].filter(Boolean).join(' · ');
const vOf = (v: number | null) => (v === null ? null : `V ${v.toFixed(1)}`);

function knownRow(k: RunKnownRow, how: string): Row {
  return {
    key: `k:${k.designation}`,
    num: k.number !== null ? String(k.number) : '',
    name: k.name ?? k.designation,
    line: [k.kind, vOf(k.v_mag), how].filter(Boolean).join(' · '),
    where: whereOf(k.squares, k.dates),
    known: k,
    track: null,
  };
}

/** The rows of a filter, from the merged results (#156). Pure, so the card is tested by its rows. */
export function scanRows(res: RunResults, f: Filter): Row[] {
  const byName = new Map(res.known.map((k) => [k.designation, k]));
  if (f === 'known')
    return res.known.map((k) => knownRow(k, k.detected ? 'detected' : 'predicted'));
  const tracks = res.tracks.filter((t) =>
    f === 'found'
      ? t.verdict === 'found_blind' || t.verdict === 'unexplained'
      : t.verdict === 'possible' || t.verdict === 'unchecked',
  );
  return tracks.map((t) => {
    const k = t.designation ? byName.get(t.designation) : undefined;
    if (k)
      return {
        ...knownRow(k, 'detected'),
        key: `t:${t.track_id}:${t.area_id}`,
        where: whereOf(t.squares, t.dates),
        track: t,
      };
    const rate = t.rate_deg_day !== null ? `${t.rate_deg_day.toFixed(2)}°/day` : null;
    return {
      key: `t:${t.track_id}:${t.area_id}`,
      num: t.track_id,
      name: t.verdict === 'unexplained' ? 'Unexplained track' : 'Possible track',
      line: [rate, t.verdict === 'unexplained' ? 'not in SkyBoT' : null]
        .filter(Boolean)
        .join(' · '),
      where: whereOf(t.squares, t.dates),
      known: null,
      track: t,
    };
  });
}

function asKnownObject(k: RunKnownRow): KnownObject {
  return {
    id: k.number !== null ? String(k.number) : k.designation,
    name: k.name ?? '',
    kind: k.kind,
    frames: 0,
    visits: 0,
    designation: k.designation,
    objectId: k.object_id,
    trackAvailable: k.track_available,
    vMag: k.v_mag,
    positions: k.positions.map((p) => ({
      time: p.time,
      ra: p.ra,
      dec: p.dec,
    })) as KnownObject['positions'],
  };
}

function ResultRow({ row, release }: { row: Row; release: string }) {
  const k = row.known;
  const o = k ? asKnownObject(k) : null;
  const around = k ? (middleTime(k.positions.map((p) => p.time)) ?? k.dates[0] ?? null) : null;
  const track = o
    ? o.trackAvailable
      ? () => useAreaStore.getState().openEros(o)
      : o.objectId && around
        ? () => useAreaStore.getState().openTrack(o, around, release)
        : null
    : null;
  const label = [row.num, row.name].filter(Boolean).join(' ');
  const build = o
    ? () => buildKnown(o)
    : row.track
      ? () => buildPlaceholder(row.track!.area_id, row.track!, row.track!.track_id)
      : null;
  return (
    <div
      className="sx-kr sx-scan-row"
      data-testid="scan-row"
      data-object={k?.designation ?? row.track?.track_id}
    >
      <b className="sx-kr-num">{row.num}</b>
      <span className="sx-kr-nm">
        <span>{row.name}</span>
        <small>{row.line}</small>
      </span>
      <span className="sx-scan-where">{row.where}</span>
      <span className="sx-kr-acts">
        <button
          type="button"
          className="sx-btn-outline sx-btn-sm"
          disabled={!track}
          onClick={track ?? undefined}
          aria-label={`Track it: ${label}`}
          title={track ? undefined : o ? NO_ID_NOTE : NO_ORBIT_NOTE}
          data-testid="scan-track"
        >
          <RouteIcon />
          Track it
        </button>
        <button
          type="button"
          className="sx-btn-outline sx-btn-sm"
          disabled={!build}
          onClick={build ?? undefined}
          aria-label={`Build it: ${label}`}
          data-testid="scan-build"
        >
          <BoxIcon />
          Build it
        </button>
      </span>
    </div>
  );
}

function skippedShort(code: string | undefined): string {
  if (code === 'area:no_visit_pair') return 'no two visits close in time';
  return code ? failureText(code).title.toLowerCase() : 'not computed';
}

function Done({
  record,
  results,
  stale,
}: {
  record: RunRecord;
  results: RunResults | null;
  stale: boolean;
}) {
  const [filter, setFilter] = useState<Filter>('found');
  const n = record.squares.length;
  const doneN = record.totals.squares_done;
  const release = releaseName(record.release);
  const how =
    record.state === 'done' ? 'Computed live' : record.state === 'stopped' ? 'Stopped' : 'Failed';
  const off = record.squares.filter((s) => s.state === 'skipped' || s.state === 'failed');
  const counts = results
    ? {
        found: scanRows(results, 'found').length,
        known: results.known.length,
        possible: scanRows(results, 'possible').length,
      }
    : null;
  const rows = results ? scanRows(results, filter) : [];
  const download = () => {
    if (!results) return;
    const url = URL.createObjectURL(
      new Blob([scanEcsv(results, record.region)], { type: 'text/plain' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${record.run_id}.ecsv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <>
      <div className="sx-area-prov" data-testid="scan-prov">
        <span>
          <b>{how}</b> · {release} · {doneN} of {n} squares
        </span>
        {results?.visits && (
          <span>
            Visits {dayOf(results.visits.start)} to {dayOf(results.visits.end, true)}, each square
            its own pair · {results.n_frames} frames
          </span>
        )}
        {off.map((s) => (
          <span key={s.index}>
            Square {s.index} {s.state === 'failed' ? 'failed' : 'skipped'}:{' '}
            {skippedShort(s.error?.code)}
          </span>
        ))}
      </div>
      <Totals record={record} />
      {counts ? (
        <div className="sx-seg" role="group" aria-label="Show" data-testid="scan-filter">
          {(['found', 'known', 'possible'] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              data-testid={`scan-filter-${f}`}
            >
              {f === 'found' ? 'Found' : f === 'known' ? 'Known' : 'Possible'} {counts[f]}
            </button>
          ))}
        </div>
      ) : (
        <p className="sx-live-m">
          {stale
            ? 'The results could not be read. Close and reopen the scan to try again.'
            : 'Reading the results…'}
        </p>
      )}
      {results && (
        <div className="sx-scan-rows" data-testid="scan-rows">
          {rows.length === 0 ? (
            <p className="sx-live-m">None in this scan.</p>
          ) : (
            rows.map((r) => <ResultRow key={r.key} row={r} release={record.release} />)
          )}
        </div>
      )}
      <PredictedToggle record={record} />
      <Alert
        tone="warn"
        title="Detection rates not measured yet"
        line="Treat possible tracks as leads."
        testId="scan-rates"
      />
      <div className="sx-live-btns">
        <button
          type="button"
          className="sx-btn-outline"
          disabled={!results}
          onClick={download}
          data-testid="scan-export"
        >
          Export ECSV
        </button>
        <button
          type="button"
          className="sx-btn-outline"
          onClick={() => selectAgain(record.kind)}
          data-testid="scan-again"
        >
          Scan again
        </button>
      </div>
    </>
  );
}

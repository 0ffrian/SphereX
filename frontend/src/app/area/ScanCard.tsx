// The scan card (issue #157; mock-up states 2, 10 and 11), for a region of more than one square:
//   offer    the region fills the screen, gridded: Data, Squares, Time, Order; Start scan or Select again;
//   scanning a mini grid of the squares' states, "Square 7 of 15 · <step and count>", time left,
//            running totals, skipped squares as status-dot messages; Pause or Resume (icons) and Stop
//            (the header's − and × minimise and close, so the card has no Minimise button);
//   done     where the data came from, the totals, a Found / Known filter (no Possible: the results
//            carry no possible tracks, Q-472) and rows that
//            name their square(s) and date, with Track it and Build it; Export ECSV and Scan again.
// Closing the card while the scan runs does not stop it (the dock button brings the card back).
// Issue #170 (approved mock-up, 14 Nov): under Measured only (D-21) the card shows tracks only (the
// number of tracks, rows named "Track" with their visits and dots; no verdict word, rate, known name
// or Known filter); the Done card carries the provenance of its positions (D-02); tracks the
// known-object check could not judge (#169) are a fourth total, one status-dot message and a filter;
// a square starting and the end of the scan are announced to screen readers, nothing else.
import { useEffect, useMemo, useRef, useState } from 'react';
import { PanelCard } from '@/app/shell/PanelCard';
import { useAreaStore } from '@/app/shell/areaStore';
import { useShellStore } from '@/app/shell/shellStore';
import { ProvenanceBadge } from '@/app/Badge';
import { Alert, BoxIcon, RouteIcon } from './areaBits';
import { splitDesignation, type KnownObject } from './areaService';
import { buildKnown, buildPlaceholder } from './buildFrom';
import { NO_ID_NOTE } from './KnownList';
import { releaseName, stepCount } from './liveJobStore';
import { NO_ORBIT_NOTE } from './RealTrackCard';
import { useMeasuredOnly } from './measuredOnly';
import {
  scanIsMock,
  trackRowsOf,
  tracksOf,
  uncheckedOf,
  type RunKnownRow,
  type RunRecord,
  type RunResults,
  type ScanBox,
  type ScanPlan,
  type ScanTrackRow,
} from './scanApi';
import { scanEcsv } from './scanExport';
import { aboutTime, gridShape, squareEstimateS, splitCount } from './scanGrid';
import { objectsFromEvents, rateOf, squaresText } from './scanObjects';
import {
  isFinished,
  scanFailureText,
  skippedText,
  squareReason,
  useScanStore,
  type ScanView,
} from './scanStore';
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
  const measured = useMeasuredOnly();
  // The live region speaks when the scan moves on (a square starts, the scan ends), not when the
  // honesty toggle rewords the same moment.
  const [said, setSaid] = useState({ key: '', text: '' });
  const momentKey =
    view?.kind === 'run' && view.record
      ? `${view.runId}:${view.record.state}:${view.record.squares.find((s) => s.state === 'running')?.index ?? ''}`
      : '';
  // Derived state (React's "adjust state while rendering"): only a new moment changes the text.
  if (momentKey !== said.key) setSaid({ key: momentKey, text: scanAnnounce(view, measured) });
  const announced = momentKey === said.key ? said.text : scanAnnounce(view, measured);
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
        <p className="sr-only" role="status" aria-live="polite" data-testid="scan-announce">
          {announced}
        </p>
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
  const shape = gridShape(view.region);
  const cols = plan?.cols ?? shape?.cols ?? splitCount(view.region.width_deg);
  const rows = plan?.rows ?? shape?.rows ?? splitCount(view.region.height_deg);
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
  const measured = useMeasuredOnly();
  const t = record.totals;
  if (measured)
    return (
      <div className="sx-scan-totals" data-testid="scan-totals" data-measured="">
        <div>
          <b>{tracksOf(t)}</b>
          <span>{tracksOf(t) === 1 ? 'track' : 'tracks'}</span>
        </div>
      </div>
    );
  const unchecked = uncheckedOf(t);
  return (
    <div className="sx-scan-totals" data-testid="scan-totals">
      <div>
        <b>{t.known}</b>
        <span>known objects</span>
      </div>
      <div>
        <b>{t.found}</b>
        <span>found</span>
      </div>
      <div>
        <b>{t.unexplained}</b>
        <span>unexplained</span>
      </div>
      {unchecked ? (
        <div data-tone="warn" data-testid="scan-total-unchecked">
          <b>{unchecked}</b>
          <span>not checked</span>
        </div>
      ) : null}
    </div>
  );
}

/** #169: tracks the known-object check could not judge. A fact about the run, so it stays at Measured only. */
function UncheckedNote({ record }: { record: RunRecord }) {
  const n = uncheckedOf(record.totals);
  if (!n) return null;
  return (
    <Alert
      tone="warn"
      title="Known-object check did not answer"
      line={`${n} ${n === 1 ? 'track' : 'tracks'} could not be checked against known objects.`}
      testId="scan-unchecked"
    />
  );
}

/**
 * What a screen reader hears (#170): the square that starts, then once the end of the scan.
 * Nothing on a poll that changes nothing. Pure.
 */
export function scanAnnounce(v: ScanView | null, measured: boolean): string {
  if (v?.kind !== 'run' || !v.record) return '';
  const r = v.record;
  if (isFinished(r.state)) {
    const t = r.totals;
    const u = uncheckedOf(t);
    const what = measured
      ? `${tracksOf(t)} ${tracksOf(t) === 1 ? 'track' : 'tracks'}`
      : [`${t.found} found`, `${t.unexplained} unexplained`, u ? `${u} not checked` : null]
          .filter(Boolean)
          .join(', ');
    if (r.state === 'failed') return 'Scan failed.';
    return `Scan ${r.state === 'stopped' ? 'stopped' : 'done'}: ${what}.`;
  }
  const cur = r.squares.find((s) => s.state === 'running');
  return cur ? `Square ${cur.index} of ${r.squares.length}.` : '';
}

/** Predicted-only known objects are hidden on the sky by default; this shows them. */
function PredictedToggle({ record }: { record: RunRecord }) {
  const on = useScanStore((s) => s.showPredicted);
  const measured = useMeasuredOnly();
  const n = useMemo(
    () => objectsFromEvents(record.events).filter((o) => o.kind === 'predicted').length,
    [record.events],
  );
  // Predicted paths are Horizons positions (model_dependent): not drawn at Measured only.
  if (n === 0 || measured) return null;
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
  if (!record)
    return (
      <>
        <p className="sx-live-m">Reading the scan…</p>
        {/* A run opened from the list or after a reload while the server does not answer. */}
        {view.stale && (
          <Alert
            tone="warn"
            title="Lost touch with the scan"
            line="Trying again."
            testId="scan-stale"
          />
        )}
      </>
    );
  const n = record.squares.length;
  const cur = record.squares.find((s) => s.state === 'running');
  const step = view.square?.steps.find((s) => s.state === 'running');
  // Rough: each square still to do by its box (the backend's estimate), half of the running one.
  const left = record.squares.reduce(
    (t, s) =>
      t +
      (s.state === 'todo'
        ? squareEstimateS(s.box.width_deg, s.box.height_deg)
        : s.state === 'running'
          ? squareEstimateS(s.box.width_deg, s.box.height_deg) / 2
          : 0),
    0,
  );
  const lastDone = Math.max(
    0,
    ...record.squares
      .filter((s) => s.state !== 'todo' && s.state !== 'running')
      .map((s) => s.index),
  );
  const where = view.stopping
    ? `Stopping after the current step · square ${cur?.index ?? lastDone} of ${n}`
    : record.state === 'queued'
      ? `Waiting · square 1 of ${n} starts next`
      : record.state === 'paused'
        ? `Paused after square ${lastDone} of ${n}`
        : cur
          ? [`Square ${cur.index} of ${n}`, step ? `${step.label} ${stepCount(step)}`.trim() : null]
              .filter(Boolean)
              .join(' · ')
          : `Square ${Math.min(n, lastDone + 1)} of ${n}`;
  // The run's squares in the backend's split (the record carries no cols).
  const cols = gridShape(record.region)?.cols ?? splitCount(record.region.width_deg);
  return (
    <>
      <MiniGrid record={record} flowCols={cols} />
      <div className="sx-live-time" data-testid="scan-time">
        <span>{where}</span>
        <span>{aboutTime(left)} left</span>
      </div>
      <Totals record={record} />
      <UncheckedNote record={record} />
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
            className="sx-btn-outline sx-scan-ib"
            disabled={busy || view.stopping}
            aria-label="Resume the scan"
            title="Resume"
            onClick={() => void useScanStore.getState().resume()}
            data-testid="scan-resume"
          >
            <PlayIcon />
          </button>
        ) : (
          <button
            type="button"
            className="sx-btn-outline sx-scan-ib"
            disabled={busy || view.stopping}
            aria-label="Pause the scan"
            title="Pause: finishes the current square, then waits"
            onClick={() => void useScanStore.getState().pause()}
            data-testid="scan-pause"
          >
            <PauseIcon />
          </button>
        )}
        <button
          type="button"
          className="sx-btn-outline"
          disabled={busy || view.stopping}
          title="Every finished square is kept"
          onClick={() => void useScanStore.getState().stop()}
          data-testid="scan-stop"
        >
          Stop
        </button>
      </div>
    </>
  );
}

const ico = { viewBox: '0 0 24 24', 'aria-hidden': true, className: 'sx-btn-ico' } as const;
/** Lucide `play` (Resume). */
function PlayIcon() {
  return (
    <svg {...ico}>
      <path d="M6 4.5v15l13-7.5z" />
    </svg>
  );
}
/** Lucide `pause` (Pause). */
function PauseIcon() {
  return (
    <svg {...ico}>
      <rect x="6" y="4.5" width="4" height="15" rx="1" />
      <rect x="14" y="4.5" width="4" height="15" rx="1" />
    </svg>
  );
}

/**
 * found: matched and unexplained tracks; unchecked: tracks the known-object check could not judge
 * (#169); known: every known object; tracks: every track as measured, the only filter at Measured only.
 */
export type Filter = 'found' | 'unchecked' | 'known' | 'tracks';
interface Row {
  key: string;
  num: string;
  name: string;
  line: string;
  where: string;
  known: RunKnownRow | null;
  track: ScanTrackRow | null;
}

/** "squares 2–3 · 27 Jun": the row's squares and the first visit it comes from. */
const whereOf = (squares: number[], visits: string[]) => {
  const first = visits.slice().sort()[0];
  return [squaresText(squares), first ? dayOf(first) : ''].filter(Boolean).join(' · ');
};
const vOf = (v: number | null) => (v === null ? null : `V ${v.toFixed(1)}`);

function knownRow(k: RunKnownRow, how: string): Row {
  const { id, name } = splitDesignation(k.designation, k.number);
  return {
    key: `k:${k.designation}`,
    num: name ? id : '',
    name: name || id,
    line: [k.kind, vOf(k.v_mag), how].filter(Boolean).join(' · '),
    where: whereOf(k.squares, k.visits),
    known: k,
    track: null,
  };
}

/** A track at Measured only (#170): its id, "Track", its visits and dots; no verdict, rate or name. */
function measuredRow(t: ScanTrackRow): Row {
  const first = t.tracks[0];
  const visits = new Set(t.visits).size;
  const dots = t.positions.length;
  return {
    key: `t:${first.area_id}:${first.track_id}`,
    num: first.track_id,
    name: 'Track',
    line: [
      `${visits} ${visits === 1 ? 'visit' : 'visits'}`,
      dots > 0 ? `${dots} ${dots === 1 ? 'dot' : 'dots'}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    where: whereOf(t.squares, t.visits),
    known: null,
    track: t,
  };
}

/**
 * The rows of a filter, from the merged results (#156, Q-471). Found: the merged tracks (matched
 * to a known object, or unexplained); Not checked: the tracks #169 marks `unchecked`; Known:
 * every known object, detected or predicted; Tracks: every track as measured (Measured only). The
 * results carry no "possible" tracks, so there is no Possible filter. Pure, tested by its rows.
 */
export function scanRows(res: RunResults, f: Filter): Row[] {
  const byName = new Map(res.known.map((k) => [k.designation, k]));
  const rows = trackRowsOf(res);
  if (f === 'known')
    return res.known.map((k) => knownRow(k, k.detected ? 'detected' : 'predicted'));
  if (f === 'tracks') return rows.map(measuredRow);
  return rows
    .filter((t) => (f === 'unchecked') === (t.kind === 'unchecked'))
    .map((t) => {
      const first = t.tracks[0];
      const key = `t:${first.area_id}:${first.track_id}`;
      const k = t.designation ? byName.get(t.designation) : undefined;
      if (k)
        return { ...knownRow(k, 'detected'), key, where: whereOf(t.squares, t.visits), track: t };
      // The motion over its merged dots (derived from the measured positions).
      const r = rateOf(t.positions.slice().sort((a, b) => Date.parse(a.time) - Date.parse(b.time)));
      return {
        key,
        num: first.track_id,
        name:
          t.kind === 'unexplained'
            ? 'Unexplained track'
            : t.kind === 'unchecked'
              ? 'Track not checked'
              : (t.designation ?? 'Found track'),
        line: [
          r !== null ? `${r.toFixed(2)}°/day` : null,
          t.kind === 'unexplained' ? 'not in SkyBoT' : null,
          t.kind === 'unchecked' ? 'known-object check did not answer' : null,
        ]
          .filter(Boolean)
          .join(' · '),
        where: whereOf(t.squares, t.visits),
        known: null,
        track: t,
      };
    });
}

function asKnownObject(k: RunKnownRow): KnownObject {
  const { id, name } = splitDesignation(k.designation, k.number);
  return {
    id,
    name,
    kind: k.kind,
    frames: 0,
    visits: 0,
    designation: k.designation,
    objectId: k.object_id,
    number: k.number,
    trackAvailable: k.track_available,
    vMag: k.v_mag,
    positions: k.positions.map((p) => ({
      time: p.time,
      ra: p.ra,
      dec: p.dec,
    })) as KnownObject['positions'],
  };
}

function ResultRow({ row, release, measured }: { row: Row; release: string; measured: boolean }) {
  const k = row.known;
  const o = k ? asKnownObject(k) : null;
  const around = k ? (middleTime(k.positions.map((p) => p.time)) ?? middleTime(k.visits)) : null;
  const track = o
    ? o.trackAvailable
      ? () => useAreaStore.getState().openEros(o)
      : o.objectId && around
        ? () => useAreaStore.getState().openTrack(o, around, release)
        : null
    : null;
  const label = [row.num, row.name].filter(Boolean).join(' ');
  const whyId = `scan-why-${row.key.replace(/[^\w-]/g, '_')}`;
  const build = o
    ? () => buildKnown(o)
    : row.track
      ? () => {
          const ref = row.track!.tracks[0];
          buildPlaceholder(ref.area_id, { track_id: ref.track_id }, ref.track_id);
        }
      : null;
  return (
    <div
      className="sx-kr sx-scan-row"
      data-testid="scan-row"
      data-object={k?.designation ?? row.track?.tracks[0].track_id}
    >
      <b className="sx-kr-num">{row.num}</b>
      <span className="sx-kr-nm">
        <span>{row.name}</span>
        <small>{row.line}</small>
        {/* Why Track it is off, in words a touch or screen-reader user also gets (#170). */}
        {/* A known row says it; a track row already reads "not in SkyBoT", so only a screen reader hears it. */}
        {!measured && !track && (
          <small className={o ? 'sx-scan-why' : 'sr-only'} id={whyId} data-testid="scan-track-why">
            {o ? NO_ID_NOTE : NO_ORBIT_NOTE}
          </small>
        )}
      </span>
      <span className="sx-scan-where">{row.where}</span>
      <span className="sx-kr-acts">
        {/* Track it opens the Horizons path (model_dependent): not offered at Measured only. */}
        {!measured && (
          <button
            type="button"
            className="sx-btn-outline sx-btn-sm"
            disabled={!track}
            onClick={track ?? undefined}
            aria-label={`Track it: ${label}`}
            aria-describedby={track ? undefined : whyId}
            data-testid="scan-track"
          >
            <RouteIcon />
            Track it
          </button>
        )}
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

const FILTER_NAME: Record<Filter, string> = {
  found: 'Found',
  unchecked: 'Not checked',
  known: 'Known',
  tracks: 'Tracks',
};

/**
 * Where the positions come from (D-02): the tracks' measured dots, and the known objects'
 * Horizons positions (not shown at Measured only, as the known objects are not). Its source is in
 * the tag's tooltip.
 */
function ScanProvenance({ record, measured }: { record: RunRecord; measured: boolean }) {
  const p = record.provenance;
  const tip = (e: { formula?: string; assumption?: string; source?: string }) =>
    e.source ?? e.formula ?? e.assumption ?? '';
  return (
    <div className="sx-scan-provtags" data-testid="scan-prov-tags">
      <span>
        <ProvenanceBadge
          tag={p.track_positions.tag}
          tooltip={tip(p.track_positions)}
        />
        Track positions
      </span>
      {!measured && (
        <span>
          <ProvenanceBadge
            tag={p.known_positions.tag}
            tooltip={tip(p.known_positions)}
          />
          Known positions
        </span>
      )}
    </div>
  );
}

function skippedShort(code: string | undefined): string {
  const r = squareReason(code);
  return r.charAt(0).toLowerCase() + r.slice(1);
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
  const measured = useMeasuredOnly();
  // The dev-server mock's runs are invented: say so (the production build has no mock).
  const mock = useMemo(() => scanIsMock(), []);
  const n = record.squares.length;
  const doneN = record.totals.squares_done;
  const release = releaseName(record.release);
  const how =
    record.state === 'done' ? 'Computed live' : record.state === 'stopped' ? 'Stopped' : 'Failed';
  const off = record.squares.filter((s) => s.state === 'skipped' || s.state === 'failed');
  const counts: Record<Filter, number> | null = results
    ? {
        found: scanRows(results, 'found').length,
        unchecked: scanRows(results, 'unchecked').length,
        known: results.known.length,
        tracks: trackRowsOf(results).length,
      }
    : null;
  // Measured only shows Tracks alone; Not checked shows only when there are some.
  const filters: Filter[] = measured
    ? ['tracks']
    : (['found', 'unchecked', 'known'] as const).filter(
        (f) => f !== 'unchecked' || !!counts?.unchecked,
      );
  const shownFilter: Filter = filters.includes(filter) ? filter : filters[0]!;
  const rows = results ? scanRows(results, shownFilter) : [];
  // First and last visit start over every row (the results carry each row's visits, not a frame count).
  const visits = results
    ? [...results.known, ...results.tracks].flatMap((r) => r.visits).sort()
    : [];
  const span = visits.length > 0 ? ([visits[0]!, visits[visits.length - 1]!] as const) : null;
  const download = () => {
    if (!results) return;
    const url = URL.createObjectURL(
      new Blob([scanEcsv(results, record.region, measured)], { type: 'text/plain' }),
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
          {mock && (
            <span
              className="sx-tagbadge"
              style={{ ['--dot' as string]: 'var(--p-asm)', marginLeft: 8 }}
              title="Test data: an invented scan from the dev-server mock, not SPHEREx measurements."
              data-testid="scan-test-data"
            >
              Test data
            </span>
          )}
        </span>
        {span && (
          <span>
            Visits {dayOf(span[0])} to {dayOf(span[1], true)}, each square its own pair
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
      <UncheckedNote record={record} />
      <ScanProvenance record={record} measured={measured} />
      {counts ? (
        <div className="sx-seg" role="group" aria-label="Show" data-testid="scan-filter">
          {filters.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={shownFilter === f}
              onClick={() => setFilter(f)}
              data-testid={`scan-filter-${f}`}
            >
              {FILTER_NAME[f]} {counts[f]}
            </button>
          ))}
        </div>
      ) : (
        <p className="sx-live-m">
          {stale
            ? 'The results could not be read. Open this run again from Runs to try again.'
            : 'Reading the results…'}
        </p>
      )}
      {results && (
        <div className="sx-scan-rows" data-testid="scan-rows">
          {rows.length === 0 ? (
            <p className="sx-live-m">None in this scan.</p>
          ) : (
            rows.map((r) => (
              <ResultRow key={r.key} row={r} release={record.release} measured={measured} />
            ))
          )}
        </div>
      )}
      <PredictedToggle record={record} />
      <Alert
        tone="warn"
        title="Detection rates not measured yet"
        line="How many movers a scan misses is not known."
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

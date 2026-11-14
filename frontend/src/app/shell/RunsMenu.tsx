// The runs menu (issue #158; mock-up state 12): a square glass button with Hugeicons `menu-01`
// right after the RA/Dec readout, the same height. It opens the list of every run the server
// recorded (#156 `GET /v1/runs`), newest first, with an All / Discovery / Known filter. A row names
// the tool by its icon (an eye for Discovery, the orbit for Known objects, as in the dock), what was
// searched and where, when, its size and what it found, and its state in words where it is not
// finished (Running, Paused, Waiting, Stopped, Failed). A click on the row opens its results (or the
// live progress of a run still going); the play button replays it on the sky. While a replay plays,
// the button ends it. Escape closes the list and gives focus back to the button.
// Issue #170: a row says "n not checked" (amber) and "n of N squares failed" (red) when #169 reports
// them, and under Measured only (D-21) "n tracks" in place of the verdict counts.
import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Menu01Icon } from '@/components/animate-ui/icons/hugeicons/menu-01';
import { OrbitIcon } from '@/components/animate-ui/icons/hugeicons/orbit';
import { ViewIcon } from '@/components/animate-ui/icons/hugeicons/view';
import { EXPLORE_SPRING } from '@/app/build/exploreMotion';
import { squaresFailedOf, tracksOf, uncheckedOf, type RunSummary } from '@/app/area/scanApi';
import { useMeasuredOnly } from '@/app/area/measuredOnly';
import { lengthText, regionText, whenText } from '@/app/area/replay';
import { filteredRuns, useRunsStore, type RunsFilter } from '@/app/area/runsStore';

const FILTERS: { id: RunsFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'discovery', label: 'Discovery' },
  { id: 'known', label: 'Known' },
];
const TOOL_NAME = { discovery: 'Discovery', known: 'Known objects' } as const;

/**
 * What a run found, in the list's words (Discovery: found and unexplained; Known: known and
 * detected). At Measured only, the number of tracks: the verdicts are not measured (#170).
 */
export function foundText(r: RunSummary, soFar = false, measured = false): string {
  const t = r.totals;
  const n = tracksOf(t);
  const text = measured
    ? `${n} ${n === 1 ? 'track' : 'tracks'}`
    : r.kind === 'known'
      ? `${t.known} known, ${t.found} detected`
      : `${t.found} found, ${t.unexplained} unexplained`;
  return soFar ? `${text} so far` : text;
}

export interface RunFlag {
  text: string;
  tone: 'warn' | 'fail';
}

/**
 * What #169 says went wrong in a run, each only when above 0: tracks not checked (amber; folded
 * into "n tracks" at Measured only) and failed squares (red; a failed run already says Failed).
 */
export function runFlags(r: RunSummary, measured = false): RunFlag[] {
  const out: RunFlag[] = [];
  const u = uncheckedOf(r.totals);
  if (u && !measured) out.push({ text: `${u} not checked`, tone: 'warn' });
  const f = squaresFailedOf(r.totals);
  if (f > 0 && r.state !== 'failed')
    out.push({ text: `${f} of ${r.squares_total} squares failed`, tone: 'fail' });
  return out;
}

/** The row's second line, and its state word (null for a finished run: it needs no label). */
export function runLine(
  r: RunSummary,
  measured = false,
): {
  before: string | null;
  state: { word: string; tone: 'accent' | 'fail' | 'muted' } | null;
  line: string;
  /** #169's flags, after the line; absent when there are none. */
  flags?: RunFlag[];
  /** After the flags: the run's length (a finished run), as the approved mock-up orders them. */
  tail?: string;
} {
  const flags = runFlags(r, measured);
  const withFlags = <T extends object>(o: T) => (flags.length ? { ...o, flags } : o);
  const when = whenText(r.created_at);
  const squares = `${r.squares_total} square${r.squares_total === 1 ? '' : 's'}`;
  const length = r.duration_s !== null ? lengthText(r.duration_s) : null;
  switch (r.state) {
    case 'running':
    case 'paused': {
      const at = Math.min(r.squares_total, r.squares_done + (r.state === 'running' ? 1 : 0));
      return withFlags({
        before: null,
        state: { word: r.state === 'running' ? 'Running' : 'Paused', tone: 'accent' as const },
        line: [`square ${at} of ${r.squares_total}`, foundText(r, true, measured)].join(' · '),
      });
    }
    case 'queued':
      return { before: when, state: { word: 'Waiting', tone: 'muted' }, line: squares };
    case 'stopped':
      return withFlags({
        before: when,
        state: { word: 'Stopped', tone: 'fail' as const },
        line: `after ${r.squares_done} of ${r.squares_total} squares`,
      });
    case 'failed':
      return { before: when, state: { word: 'Failed', tone: 'fail' }, line: squares };
    default:
      if (!flags.length)
        return {
          before: null,
          state: null,
          line: [when, squares, foundText(r, false, measured), length].filter(Boolean).join(' · '),
        };
      return {
        before: null,
        state: null,
        line: [when, squares, foundText(r, false, measured)].join(' · '),
        flags,
        ...(length ? { tail: length } : {}),
      };
  }
}

export function RunsMenu() {
  const open = useRunsStore((s) => s.open);
  const replaying = useRunsStore((s) => s.replay !== null);
  const reduced = useReducedMotion();
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const titleId = useId();

  // A click anywhere else closes the list.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t))
        useRunsStore.getState().closeMenu();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);
  // The list opens with focus on its first control.
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }, [open]);

  const close = (refocus: boolean) => {
    useRunsStore.getState().closeMenu();
    if (refocus) btnRef.current?.focus();
  };
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // An Escape already taken by a handler inside the list closes only that (A21.10).
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    close(true);
  };

  return (
    // Escape closes the list from anywhere in it, the runs button included (Q-473 (2)).
    <div className="sx-runs" data-testid="runs" onKeyDown={open ? onMenuKey : undefined}>
      <button
        ref={btnRef}
        type="button"
        className="sx-runs-btn"
        aria-label={replaying ? 'End the replay' : 'Runs'}
        title={replaying ? 'End the replay' : 'Runs'}
        aria-expanded={replaying ? undefined : open}
        aria-controls={open ? menuId : undefined}
        data-on={open || replaying || undefined}
        onClick={() => useRunsStore.getState().toggleMenu()}
        data-testid="runs-button"
      >
        <Menu01Icon
          size={20}
          strokeWidth={2}
          animateOnHover={!reduced}
          className="sx-ico size-5"
          aria-hidden="true"
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            id={menuId}
            role="dialog"
            aria-modal="false"
            aria-labelledby={titleId}
            className="sx-runs-menu"
            initial={reduced ? false : { opacity: 0, y: -6, scale: 0.96, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={
              reduced
                ? { opacity: 0, transition: { duration: 0 } }
                : {
                    opacity: 0,
                    y: -4,
                    scale: 0.97,
                    filter: 'blur(4px)',
                    transition: { duration: 0.15 },
                  }
            }
            transition={EXPLORE_SPRING}
            data-testid="runs-menu"
          >
            <RunsList titleId={titleId} onClose={() => close(true)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RunsList({ titleId, onClose }: { titleId: string; onClose(): void }) {
  const status = useRunsStore((s) => s.status);
  const runs = useRunsStore((s) => s.runs);
  const filter = useRunsStore((s) => s.filter);
  const note = useRunsStore((s) => s.note);
  const shown = filteredRuns(runs, filter);
  const count = (f: RunsFilter) => filteredRuns(runs, f).length;
  return (
    <>
      <div className="sx-runs-head">
        <div>
          <h2 id={titleId}>Runs</h2>
          <p>Discovery and Known objects, newest first</p>
        </div>
        <button
          type="button"
          className="sx-runs-x"
          aria-label="Close runs"
          onClick={onClose}
          data-testid="runs-close"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
      {status === 'error' ? (
        <div className="sx-runs-status" data-testid="runs-error">
          <p className="sx-runs-msg" data-tone="fail">
            <b>Runs could not be read</b>
            <span>The server did not answer.</span>
          </p>
          <button
            type="button"
            className="sx-btn"
            onClick={() => void useRunsStore.getState().load()}
          >
            Try again
          </button>
        </div>
      ) : status !== 'ready' ? (
        <p className="sx-runs-m" data-testid="runs-loading">
          Reading runs…
        </p>
      ) : runs.length === 0 ? (
        <p className="sx-runs-m" data-testid="runs-empty">
          No runs yet. A scan or an area you compute is kept here.
        </p>
      ) : (
        <>
          <div className="sx-seg" role="group" aria-label="Show" data-testid="runs-filter">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => useRunsStore.getState().setFilter(f.id)}
                data-testid={`runs-filter-${f.id}`}
              >
                {f.label} {count(f.id)}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            // A filter with nothing under it says so (an empty list read as a list still loading).
            <p className="sx-runs-m" data-testid="runs-none">
              No {filter === 'known' ? 'Known objects' : 'Discovery'} runs yet.
            </p>
          ) : (
            <ul className="sx-runs-rows" data-testid="runs-rows">
              {shown.map((r) => (
                <RunRow key={r.run_id} run={r} />
              ))}
            </ul>
          )}
          {note && (
            <p className="sx-runs-msg" data-tone="fail" role="status">
              <b>Replay not started</b>
              <span>{note}</span>
            </p>
          )}
          <p className="sx-runs-m">
            Press play to watch a run again on the sky. Click a run to open its results.
          </p>
        </>
      )}
    </>
  );
}

function RunRow({ run }: { run: RunSummary }) {
  const loading = useRunsStore((s) => s.loadingReplay === run.run_id);
  const measured = useMeasuredOnly();
  const what = regionText(run.region);
  const { before, state, line, flags = [], tail } = runLine(run, measured);
  const sep = run.state === 'stopped' ? ' ' : ' · ';
  const started = run.duration_s !== null;
  const tool = TOOL_NAME[run.kind];
  return (
    <li className="sx-runs-row" data-testid="runs-row" data-run={run.run_id} data-state={run.state}>
      <button
        type="button"
        className="sx-runs-open"
        onClick={() => useRunsStore.getState().openRun(run)}
        aria-label={`${tool}: ${what}. ${[before, state ? `${state.word}${sep}${line}` : line, ...flags.map((f) => f.text), tail].filter(Boolean).join(', ')}. ${run.state === 'running' || run.state === 'paused' || run.state === 'queued' ? 'Show its progress' : 'Open its results'}`}
        data-testid="runs-open"
      >
        <span className="sx-runs-kind" title={tool} aria-hidden="true">
          {run.kind === 'known' ? (
            <OrbitIcon
              size={18}
              strokeWidth={1.8}
              className="sx-ico size-[18px]"
              aria-hidden="true"
            />
          ) : (
            <ViewIcon
              size={18}
              strokeWidth={1.8}
              className="sx-ico size-[18px]"
              aria-hidden="true"
            />
          )}
        </span>
        <span className="sx-runs-t">{what}</span>
        <span className="sx-runs-s">
          {before && `${before} · `}
          {state && (
            <>
              <span data-tone={state.tone}>{state.word}</span>
              {sep}
            </>
          )}
          {line}
          {flags.map((f) => (
            <span key={f.text}>
              {' · '}
              <span data-tone={f.tone} data-testid="runs-flag">
                {f.text}
              </span>
            </span>
          ))}
          {tail && ` · ${tail}`}
        </span>
      </button>
      <button
        type="button"
        className="sx-runs-play"
        aria-label={`Replay ${what}`}
        title={started ? 'Replay' : 'Not started yet'}
        disabled={!started}
        // While its record loads the button stays enabled, so it keeps focus; a press does nothing.
        aria-disabled={loading || undefined}
        aria-busy={loading || undefined}
        onClick={() => {
          if (loading) return;
          void useRunsStore.getState().startReplay(run.run_id, { stepped: prefersStill() });
        }}
        data-testid="runs-play"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 4v16l13-8z" />
        </svg>
      </button>
    </li>
  );
}

const prefersStill = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

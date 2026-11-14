// The replay of a run on the sky (issue #158; mock-up state 13). The squares and circles are
// #157's ScanOverlay, fed the run as it was at the replay time (replay.ts). This draws the tag at
// the top ("Replay · Discovery · 13 Nov 07:28 UTC") and the bar above the dock: play or pause, the
// timeline (a slider; ticks mark finds, green known and amber unexplained, and skipped squares in
// red; click a tick or the rail to jump, drag the knob), the time and the square count, and the
// speeds 1×, 10×, 60×, 600×. Escape, the runs button or another tool ends the replay.
// Keyboard on the timeline: arrows step 1 % of the run, Page Up and Page Down jump to the previous
// or next tick, Home and End to the start and the end. Screen readers hear the position from the
// slider's value text when they move it; nothing is announced while it plays (it would never stop).
// Issue #170: the marks differ by shape as well as colour (a tall mark for a known object found, a
// short one for an unexplained track, a diamond for a skipped or failed square); under Measured only
// every find is the same neutral mark named by its track.
import { useEffect, useMemo, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { isEditableTarget } from '@/app/shell/shortcuts';
import { useShellStore } from '@/app/shell/shellStore';
import { clock, REPLAY_SPEEDS, squareAt, ticksOf, whenText } from '@/app/area/replay';
import { useRunsStore } from '@/app/area/runsStore';
import { useMeasuredOnly } from '@/app/area/measuredOnly';

const TOOL = { discovery: 'Discovery', known: 'Known objects' } as const;

export function ReplayBar() {
  const replay = useRunsStore((s) => s.replay);
  const tool = useShellStore((s) => s.tool);
  const playRef = useRef<HTMLButtonElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const active = replay !== null;
  const run = replay?.run ?? null;
  const measured = useMeasuredOnly();
  const ticks = useMemo(() => (run ? ticksOf(run, measured) : []), [run, measured]);

  // Another tool ends the replay (the replay keeps the sky to itself).
  useEffect(() => {
    if (active && tool !== 'sky') useRunsStore.getState().endReplay();
  }, [active, tool]);
  // Escape ends it, from anywhere that does not use Escape itself; a text field keeps it (as
  // BuildPane and SelectedCard). The sky credit popover (on `document`) takes Escape first, A21.10.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isEditableTarget(e.target)) return;
      e.preventDefault();
      useRunsStore.getState().endReplay();
      document.querySelector<HTMLElement>('[data-testid="runs-button"]')?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
  // The replay starts with focus on its play button.
  useEffect(() => {
    if (active) playRef.current?.focus({ preventScroll: true });
  }, [active, run]);

  if (!replay || !run) return null;
  const { t, end, speed, playing } = replay;
  const frac = end > 0 ? t / end : 0;
  const pct = (v: number) => `${(Math.min(1, Math.max(0, v)) * 100).toFixed(3)}%`;
  const s = useRunsStore.getState();
  const at = squareAt(run, t);
  const n = run.squares.length;

  const tAtX = (clientX: number) => {
    const r = railRef.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return t;
    return ((clientX - r.left) / r.width) * end;
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const tick = (e.target as HTMLElement).closest<HTMLElement>('[data-tick-t]');
    s.seek(tick ? Number(tick.dataset.tickT) : tAtX(e.clientX));
    if (tick) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) s.seek(tAtX(e.clientX));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = Math.max(1, end / 100);
    const prev = [...ticks].reverse().find((k) => k.t < t - 0.5);
    const next = ticks.find((k) => k.t > t + 0.5);
    const to: Record<string, number | undefined> = {
      ArrowLeft: t - step,
      ArrowDown: t - step,
      ArrowRight: t + step,
      ArrowUp: t + step,
      PageUp: prev?.t ?? 0,
      PageDown: next?.t ?? end,
      Home: 0,
      End: end,
    };
    const v = to[e.key];
    if (v === undefined) return;
    e.preventDefault();
    s.seek(v);
  };

  return (
    <>
      <div className="sx-replay-tag" role="status" data-testid="replay-tag">
        <span className="sx-replay-dot" aria-hidden="true" />
        Replay · {TOOL[run.kind]} · {whenText(run.started_at ?? run.created_at)}
      </div>
      <div className="sx-replay" role="group" aria-label="Replay" data-testid="replay-bar">
        <button
          ref={playRef}
          type="button"
          className="sx-replay-pb"
          aria-label={playing ? 'Pause' : t >= end ? 'Play again' : 'Play'}
          onClick={() => (playing ? s.pause() : s.play())}
          disabled={end <= 0}
          data-testid="replay-play"
          data-playing={playing || undefined}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 4v16l13-8z" />
            </svg>
          )}
        </button>
        <div
          ref={railRef}
          className="sx-replay-tl"
          role="slider"
          tabIndex={0}
          aria-label="Run timeline"
          aria-valuemin={0}
          aria-valuemax={Math.round(end)}
          aria-valuenow={Math.round(t)}
          aria-valuetext={`${clock(t)} of ${clock(end)}, square ${at} of ${n}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onKeyDown={onKey}
          data-testid="replay-timeline"
        >
          <span className="sx-replay-rail" aria-hidden="true" />
          <span className="sx-replay-fill" style={{ width: pct(frac) }} aria-hidden="true" />
          {ticks.map((k, i) => (
            <span
              key={`${k.t}:${i}`}
              className="sx-replay-tick"
              data-kind={k.kind}
              data-tick-t={k.t}
              style={{ left: pct(end > 0 ? k.t / end : 0) }}
              title={`${clock(k.t)} · ${k.label}`}
              aria-hidden="true"
              data-testid="replay-tick"
            />
          ))}
          <span className="sx-replay-knob" style={{ left: pct(frac) }} aria-hidden="true" />
        </div>
        <span className="sx-replay-time" data-testid="replay-time">
          <b>{clock(t)}</b> / {clock(end)} · square {at} of {n}
        </span>
        <span
          className="sx-seg sx-replay-speed"
          role="group"
          aria-label="Speed"
          data-testid="replay-speed"
        >
          {REPLAY_SPEEDS.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={speed === v}
              onClick={() => s.setSpeed(v)}
              data-testid={`replay-speed-${v}`}
            >
              {v}×
            </button>
          ))}
        </span>
      </div>
    </>
  );
}

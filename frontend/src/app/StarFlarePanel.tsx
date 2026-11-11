// Issue #71 stream G: the star's flare controls. "Field lines" toggle, "Fire a big flare", the
// "Latest flare" card in plain words. The close-up is `StarCloseUp`, mounted by the split-pane host. The card is a
// polite live region and only changes when a new flare starts (at most once per 1.4 s).
import { useEffect, useMemo, useState } from 'react';
import { lightCurves, STAGES, STAGE_TEXT, stageIndex } from '@/physics/flares';
import type { ViewerApp } from '@/viewer/ViewerApp';
import { buttonClass, pressedClass } from './ui';
import { ProvenanceBadge } from './Badge';

export function StarFlarePanel({
  viewer,
  paused,
  fixture,
}: {
  viewer: ViewerApp | null;
  /** Reduced motion or a user pause: the card is read once, not polled. */
  paused: boolean;
  fixture?: boolean;
}) {
  const [lines, setLines] = useState(true);
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [t, setT] = useState(0.5);
  const curves = useMemo(() => lightCurves(open), [open]);

  useEffect(() => {
    if (!viewer) return;
    const read = () => setText(viewer.latestFlareText());
    read();
    if (paused) return;
    const id = window.setInterval(read, 700);
    return () => window.clearInterval(id);
  }, [viewer, paused]);

  return (
    <div className="flex flex-col gap-2" data-testid="star-flares">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`${buttonClass} ${pressedClass}`}
          aria-pressed={lines}
          onClick={() => {
            const next = !lines;
            setLines(next);
            viewer?.setFieldLines(next);
          }}
        >
          Field lines
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            viewer?.fireFlare();
            setText(viewer?.latestFlareText() ?? null);
          }}
        >
          Fire a big flare
        </button>
      </div>
      <p className="text-sm text-neutral-200" data-testid="latest-flare" aria-live="polite">
        <span className="font-medium text-neutral-100">Latest flare: </span>
        {text ?? 'None yet. A flare starts at a spot group on a seeded schedule.'}{' '}
        <ProvenanceBadge tag="inferred_from_analog" fixture={fixture} />
      </p>
      <div className="flex flex-col gap-2" data-testid="flare-chart">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-neutral-200">One flare, 60 minutes:</span>
          {[false, true].map((o) => (
            <button
              key={String(o)}
              type="button"
              className={`${buttonClass} ${pressedClass}`}
              aria-pressed={open === o}
              onClick={() => setOpen(o)}
            >
              {o ? 'Open (eruption)' : 'Closed'}
            </button>
          ))}
        </div>
        <svg
          viewBox="0 0 240 70"
          role="img"
          aria-label="Flare brightness: soft X-rays rise and fall slowly, hard X-rays peak during the burst"
          className="w-full rounded border border-neutral-700 bg-neutral-950"
          onPointerDown={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setT(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
          }}
        >
          <polyline
            fill="none"
            stroke="#f59e0b"
            strokeWidth="1.5"
            points={curves.soft.map((v, i) => `${i},${66 - v * 60}`).join(' ')}
          />
          <polyline
            fill="none"
            stroke="#38bdf8"
            strokeWidth="1"
            points={curves.hard.map((v, i) => `${i},${66 - v * 60}`).join(' ')}
          />
          <line x1={t * 240} x2={t * 240} y1="0" y2="70" stroke="#e5e5e5" strokeWidth="1" />
        </svg>
        <label className="flex items-center gap-2 text-sm text-neutral-200">
          Time since the start
          <input
            type="range"
            min={0}
            max={1}
            step={0.005}
            value={t}
            onChange={(e) => setT(Number(e.target.value))}
            aria-valuetext={`${Math.round(t * 60)} minutes`}
            className="min-h-[44px] flex-1"
          />
        </label>
        <p className="text-sm text-neutral-200" aria-live="polite">
          <span className="font-medium text-neutral-100">
            {Math.round(t * 60)} min, {STAGES[stageIndex(t)]!.label}:{' '}
          </span>
          {STAGE_TEXT[STAGES[stageIndex(t)]!.id][open ? 'open' : 'closed']}
        </p>
        <p className="text-xs text-neutral-400">
          Amber: soft X-rays from hot loops. Blue: hard X-rays from fast electrons. Hard X-rays follow the rate of change of the
          soft ones (the Neupert effect). The curve shapes are typical, not measured for this star.{' '}
          <ProvenanceBadge tag="inferred_from_analog" fixture={fixture} />
        </p>
      </div>
    </div>
  );
}

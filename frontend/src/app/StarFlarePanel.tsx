// Issue #71 stream G: the star's flare controls. "Field lines" toggle, "Fire a big flare", the
// "Latest flare" card in plain words. The close-up is `StarCloseUp`, mounted by the split-pane host. The card is a
// polite live region and only changes when a new flare starts (at most once per 1.4 s).
import { useEffect, useMemo, useState } from 'react';
import { lightCurves, STAGES, STAGE_TEXT, stageIndex } from '@/physics/flares';
import type { ViewerApp } from '@/viewer/ViewerApp';
import { Row, Rows, SwitchRow, ToggleGroup } from './PanelControls';
import { ProvenanceBadge } from './Badge';
import { useStarChart } from './starChartStore';

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

  const cls = text?.match(/Class (\w+\.?\d*)/)?.[1] ?? null;
  const outcome = text ? (/stays closed/.test(text) ? 'stayed closed' : /erupt/.test(text) ? 'erupted' : null) : null;

  return (
    <div className="flex flex-col gap-3" data-testid="star-flares">
      <SwitchRow
        label="Field lines"
        checked={lines}
        onChange={(next) => {
          setLines(next);
          viewer?.setFieldLines(next);
        }}
      />
      <button
        type="button"
        className="sx-btn-outline"
        onClick={() => {
          viewer?.fireFlare();
          setText(viewer?.latestFlareText() ?? null);
        }}
      >
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
        </svg>
        Fire a big flare
      </button>
      <div className="sx-flare" data-testid="latest-flare" aria-live="polite">
        {text && cls ? (
          <span>
            Latest flare: <b>{cls}{outcome ? `, ${outcome}` : ''}</b>
          </span>
        ) : (
          <span>{text ?? 'None yet. A flare starts at a spot group on a seeded schedule.'}</span>
        )}
        <ProvenanceBadge tag="inferred_from_analog" fixture={fixture} variant="tag" />
      </div>
      <Rows>
        <Row title="About this flare">
      {text && <p>{text}</p>}
      <div className="flex flex-col gap-2" data-testid="flare-chart">
        <ToggleGroup
          label="One flare, 60 minutes"
          value={open ? 'open' : 'closed'}
          options={[
            { value: 'closed', label: 'Closed' },
            { value: 'open', label: 'Open (eruption)' },
          ]}
          onChange={(v) => setOpen(v === 'open')}
        />
        <svg
          viewBox="0 0 240 70"
          role="img"
          aria-label="Flare brightness: soft X-rays rise and fall slowly, hard X-rays peak during the burst"
          className="sx-chart"
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
          Amber: soft X-rays from hot loops. Blue: hard X-rays from fast electrons. Hard X-rays
          follow the rate of change of the soft ones (the Neupert effect). The curve shapes are
          typical, not measured for this star.{' '}
          <ProvenanceBadge tag="inferred_from_analog" fixture={fixture} />
        </p>
      </div>
        </Row>
      </Rows>
    </div>
  );
}

// The engine's flare light curve (moved here from over the close-up): soft and hard X-rays over 60
// minutes with the time marker. Drawn from `useStarChart`, which the flare close-up publishes.
const CH = { x0: 8, x1: 312, y0: 98, y1: 8, w: 320, h: 120 };
const cx = (t: number) => CH.x0 + (CH.x1 - CH.x0) * t;
const cy = (v: number) => CH.y0 + (CH.y1 - CH.y0) * v;
const pathOf = (a: number[]) => a.map((v, i) => `${i ? 'L' : 'M'}${cx(i / 240).toFixed(1)} ${cy(v).toFixed(1)}`).join('');
const SOFT = '#c98a08';
const HARD = '#2f9bd4';
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** The compact flare chart and player, at the top of the star's Details pane. The controls row lives in BuildControls. */
export function StarEngineDetails() {
  const chart = useStarChart((s) => s.chart);
  const scrub = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!chart) return;
    const b = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - b.left) / b.width) * CH.w;
    chart.setTime((px - CH.x0) / (CH.x1 - CH.x0));
  };
  if (!chart) return null;
  const minutes = Math.round(chart.t * 60);
  const toggle = () => {
    if (chart.playing) {
      chart.setPlaying(false);
    } else if (reducedMotion()) {
      // No smooth animation: jump to the end.
      chart.setTime(1);
    } else {
      if (chart.t >= 0.995) chart.setTime(0);
      chart.setPlaying(true);
    }
  };
  return (
    <div className="sx-flare-chart" data-testid="flare-chart">
      <div className="sx-flare-legend">
        <span><i style={{ background: SOFT }} aria-hidden="true" />Soft X-rays</span>
        <span><i style={{ background: HARD }} aria-hidden="true" />Hard X-rays</span>
      </div>
      <svg
        viewBox={`0 0 ${CH.w} ${CH.h}`}
        role="img"
        aria-label="Example flare light curve. Hard X-rays peak in short bursts during the rise of the soft X-rays, which then fade slowly. Tap or drag to move the time."
        className="sx-chart block touch-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          scrub(e);
        }}
        onPointerMove={(e) => e.buttons && scrub(e)}
      >
        <line x1={CH.x0} x2={CH.x1} y1={cy(0)} y2={cy(0)} stroke="var(--line)" />
        {[0, 30, 60].map((m) => (
          <text
            key={m}
            x={cx(m / 60)}
            y={CH.y0 + 16}
            textAnchor={m === 0 ? 'start' : m === 60 ? 'end' : 'middle'}
            fill="var(--muted)"
            fontSize="10"
          >
            {m === 60 ? '60 min' : m}
          </text>
        ))}
        <path d={pathOf(chart.hard)} fill="none" stroke={HARD} strokeWidth="1.25" strokeLinejoin="round" />
        <path d={pathOf(chart.soft)} fill="none" stroke={SOFT} strokeWidth="1.25" strokeLinejoin="round" />
        <line x1={cx(chart.t)} x2={cx(chart.t)} y1={CH.y1} y2={CH.y0} stroke="var(--on-ac)" strokeWidth="1" />
      </svg>
      <div className="sx-flare-player">
        <button
          type="button"
          className="sx-play"
          aria-label={chart.playing ? 'Pause flare' : 'Play flare'}
          onClick={toggle}
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
            {chart.playing ? (
              <>
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </>
            ) : (
              <polygon points="6 3 20 12 6 21 6 3" />
            )}
          </svg>
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.005}
          value={chart.t}
          onChange={(e) => chart.setTime(Number(e.target.value))}
          aria-label="Time since the flare started"
          aria-valuetext={`${minutes} minutes`}
          className="sx-flare-range"
        />
        <output className="sx-flare-time">{minutes} min</output>
      </div>
    </div>
  );
}

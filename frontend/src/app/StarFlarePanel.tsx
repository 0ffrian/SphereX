// Issue #71 stream G: the star's flare controls. "Field lines" toggle, "Fire a big flare", the
// "Latest flare" card in plain words. The close-up is `StarCloseUp`, mounted by the split-pane host. The card is a
// polite live region and only changes when a new flare starts (at most once per 1.4 s).
import { useEffect, useMemo, useState } from 'react';
import { lightCurves, STAGES, STAGE_TEXT, stageIndex } from '@/physics/flares';
import type { ViewerApp } from '@/viewer/ViewerApp';
import { Row, Rows, SwitchRow, ToggleGroup } from './PanelControls';
import { ProvenanceBadge } from './Badge';
import { useStarTarget } from './starTargetStore';
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
          Amber: soft X-rays from hot loops. Blue: hard X-rays from fast electrons. Hard X-rays follow the rate of change of the
          soft ones (the Neupert effect). The curve shapes are typical, not measured for this star.{' '}
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
const CH = { x0: 44, x1: 512, y0: 124, y1: 12 };
const cx = (t: number) => CH.x0 + (CH.x1 - CH.x0) * t;
const cy = (v: number) => CH.y0 + (CH.y1 - CH.y0) * v;
const pathOf = (a: number[]) => a.map((v, i) => `${i ? 'L' : 'M'}${cx(i / 240).toFixed(1)} ${cy(v).toFixed(1)}`).join('');
const SOFT = '#c98a08';
const HARD = '#2f9bd4';

/** Details for a star the engine draws: the close-up choice, and the flare chart inside "About this flare". */
export function StarEngineDetails({ fixture, flareView = true }: { fixture?: boolean; flareView?: boolean }) {
  const left = useStarTarget((s) => s.left);
  const chart = useStarChart((s) => s.chart);
  const scrub = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!chart) return;
    const b = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - b.left) / b.width) * 524;
    chart.setTime((px - CH.x0) / (CH.x1 - CH.x0));
  };
  return (
    <div className="flex flex-col gap-3" data-testid="star-engine-details">
      <ToggleGroup
        label="Close-up"
        value={left}
        options={[
          { value: 'flare', label: 'Flare' },
          { value: 'surface', label: 'Surface' },
        ]}
        onChange={(v) => useStarTarget.getState().show(v)}
        testId="star-closeup-toggle"
      />
      {left === 'surface' && (
        <button type="button" className="sx-btn-outline" onClick={() => useStarTarget.getState().home()} disabled={useStarTarget.getState().target === null}>
          Back to the active region
        </button>
      )}
      {flareView && chart && (
        <Rows>
          <Row title="About this flare" defaultOpen>
            <div className="flex flex-col gap-2" data-testid="flare-chart">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--muted)' }}>
                <span>Flare brightness over 60 minutes</span>
                <span style={{ color: SOFT }}>Soft X-rays (hot loops)</span>
                <span style={{ color: HARD }}>Hard X-rays (fast electrons)</span>
              </div>
              <svg
                viewBox="0 0 524 164"
                role="img"
                aria-label="Example flare light curve. Hard X-rays peak in short bursts during the rise of the soft X-rays, which then fade slowly. Tap or drag to move the time."
                className="sx-chart block touch-none"
                style={{ border: '1px solid var(--line)' }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  scrub(e);
                }}
                onPointerMove={(e) => e.buttons && scrub(e)}
              >
                <title>Example flare brightness over 60 minutes</title>
                {[0, 0.5, 1].map((v) => (
                  <g key={v}>
                    <line x1={CH.x0} x2={CH.x1} y1={cy(v)} y2={cy(v)} stroke="var(--line)" />
                    <text x={CH.x0 - 8} y={cy(v) + 4} textAnchor="end" fill="var(--muted)" fontSize="11">
                      {v}
                    </text>
                  </g>
                ))}
                {[0, 15, 30, 45, 60].map((m) => (
                  <text key={m} x={cx(m / 60)} y={CH.y0 + 18} textAnchor="middle" fill="var(--muted)" fontSize="11">
                    {m}
                  </text>
                ))}
                <text x={CH.x1} y={CH.y0 + 34} textAnchor="end" fill="var(--muted)" fontSize="11">
                  minutes
                </text>
                <path d={pathOf(chart.hard)} fill="none" stroke={HARD} strokeWidth="2" strokeLinejoin="round" />
                <path d={pathOf(chart.soft)} fill="none" stroke={SOFT} strokeWidth="2" strokeLinejoin="round" />
                <line x1={cx(chart.t)} x2={cx(chart.t)} y1={CH.y1} y2={CH.y0} stroke="var(--on-ac)" strokeWidth="1.5" />
                <circle cx={cx(chart.t)} cy={cy(chart.soft[Math.round(chart.t * 240)] ?? 0)} r="4.5" fill={SOFT} stroke="var(--s2)" strokeWidth="2" />
              </svg>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                Example curve. Hard X-rays follow the rate of change of soft X-rays (the Neupert effect).{' '}
                <ProvenanceBadge tag="inferred_from_analog" fixture={fixture} />
              </p>
            </div>
          </Row>
        </Rows>
      )}
    </div>
  );
}

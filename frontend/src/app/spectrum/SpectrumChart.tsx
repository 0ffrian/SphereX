// A1.1 P0 spectrum chart: flux per frame against wavelength, with 1σ error bars; points the
// pipeline flagged are drawn as hollow diamonds in a second colour and named in the legend, so
// colour is never the only cue. Hand-rolled SVG (no chart library). The data table in
// SpectrumPanel is the text equivalent (R9). Colours: dataviz reference palette, dark column,
// slots 1 (blue) and 2 (orange).
import { useState } from 'react';
import type { SpectrumPoint } from '@/app/api/types';
import { formatFlux, formatNumber, formatWavelength } from '@/app/format';
import { extentWithErrors, linearScale, niceTicks, paddedExtent } from './scale';

const W = 640;
const H = 360;
const M = { left: 72, right: 20, top: 16, bottom: 52 } as const;
const COLOR_POINT = '#3987e5';
const COLOR_FLAGGED = '#d95926';
const COLOR_GRID = '#2e2e2e';
const COLOR_AXIS_TEXT = '#c3c2b7';
const MARKER_R = 4.5; // 9 px marker (≥ 8 px)
const HIT_R = 12; // hit target larger than the mark
const CAP = 4;

interface SpectrumChartProps {
  points: readonly SpectrumPoint[];
  fluxUnit: string;
  objectName: string;
  selectedFrameId?: string | null;
  onSelectFrame?: (frameId: string) => void;
}

export function chartSummary(points: readonly SpectrumPoint[], objectName: string): string {
  if (points.length === 0) return `Spectrum of ${objectName}: no points.`;
  const wl = points.map((p) => p.wavelength_um);
  const flagged = points.filter((p) => p.flagged).length;
  return (
    `Spectrum of ${objectName}: ${points.length} points from ` +
    `${formatWavelength(Math.min(...wl))} to ${formatWavelength(Math.max(...wl))}, ` +
    `${flagged} flagged. The data table below lists every point.`
  );
}

export function SpectrumChart({
  points,
  fluxUnit,
  objectName,
  selectedFrameId = null,
  onSelectFrame,
}: SpectrumChartProps) {
  const [active, setActive] = useState<number | null>(null);

  const xDomain = paddedExtent(
    points.map((p) => p.wavelength_um),
    0.03,
  );
  const yDomain = extentWithErrors(points.map((p) => ({ value: p.flux, error: p.error })));
  const x = linearScale(xDomain, [M.left, W - M.right]);
  const y = linearScale(yDomain, [H - M.bottom, M.top]);
  const xTicks = niceTicks(xDomain, 6);
  const yTicks = niceTicks(yDomain, 5);
  const activePoint = active === null ? null : (points[active] ?? null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-4 text-sm text-neutral-300" data-testid="chart-legend">
        <span className="flex items-center gap-1.5">
          <svg width="14" height="14" aria-hidden="true">
            <circle cx="7" cy="7" r={MARKER_R} fill={COLOR_POINT} />
          </svg>
          Flux with 1σ error bar
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="14" height="14" aria-hidden="true">
            <path d={diamond(7, 7, 5.5)} fill="none" stroke={COLOR_FLAGGED} strokeWidth="2" />
          </svg>
          Flagged by the pipeline
        </span>
      </div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full max-w-2xl min-w-[20rem] rounded-md bg-neutral-900"
          role="img"
          aria-label={chartSummary(points, objectName)}
          data-testid="spectrum-chart"
          onPointerLeave={() => setActive(null)}
        >
          {yTicks.map((t) => (
            <g key={`y${t}`}>
              <line
                x1={M.left}
                x2={W - M.right}
                y1={y(t)}
                y2={y(t)}
                stroke={COLOR_GRID}
                strokeWidth="1"
              />
              <text
                x={M.left - 8}
                y={y(t)}
                dy="0.32em"
                textAnchor="end"
                fontSize="12"
                fill={COLOR_AXIS_TEXT}
              >
                {formatNumber(t)}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text
              key={`x${t}`}
              x={x(t)}
              y={H - M.bottom + 18}
              textAnchor="middle"
              fontSize="12"
              fill={COLOR_AXIS_TEXT}
            >
              {formatNumber(t)}
            </text>
          ))}
          <line
            x1={M.left}
            x2={W - M.right}
            y1={H - M.bottom}
            y2={H - M.bottom}
            stroke="#6b6b6b"
            strokeWidth="1"
          />
          <text
            x={(M.left + W - M.right) / 2}
            y={H - 10}
            textAnchor="middle"
            fontSize="13"
            fill={COLOR_AXIS_TEXT}
          >
            Wavelength (µm)
          </text>
          <text
            transform={`translate(16 ${(M.top + H - M.bottom) / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize="13"
            fill={COLOR_AXIS_TEXT}
          >
            {`Flux (${fluxUnit})`}
          </text>

          {points.map((p, i) => {
            if (!(p.error > 0)) return null;
            const cx = x(p.wavelength_um);
            const color = p.flagged ? COLOR_FLAGGED : COLOR_POINT;
            const top = y(p.flux + p.error);
            const bottom = y(p.flux - p.error);
            return (
              <g
                key={`e${i}`}
                stroke={color}
                strokeWidth="1.5"
                data-testid="error-bar"
                opacity={p.flagged ? 0.8 : 1}
              >
                <line x1={cx} x2={cx} y1={top} y2={bottom} />
                <line x1={cx - CAP} x2={cx + CAP} y1={top} y2={top} />
                <line x1={cx - CAP} x2={cx + CAP} y1={bottom} y2={bottom} />
              </g>
            );
          })}

          {points.map((p, i) => {
            const cx = x(p.wavelength_um);
            const cy = y(p.flux);
            const selected = selectedFrameId !== null && p.frame_id === selectedFrameId;
            return (
              <g key={`p${i}`}>
                {selected && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={MARKER_R + 4}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="2"
                  />
                )}
                {p.flagged ? (
                  <path
                    d={diamond(cx, cy, MARKER_R + 1.5)}
                    fill="#171717"
                    stroke={COLOR_FLAGGED}
                    strokeWidth="2"
                    data-testid="flagged-point"
                  />
                ) : (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={MARKER_R}
                    fill={COLOR_POINT}
                    stroke="#171717"
                    strokeWidth="2"
                    data-testid="point"
                  />
                )}
                <circle
                  cx={cx}
                  cy={cy}
                  r={HIT_R}
                  fill="transparent"
                  className={onSelectFrame ? 'cursor-pointer' : undefined}
                  onPointerEnter={() => setActive(i)}
                  onClick={onSelectFrame ? () => onSelectFrame(p.frame_id) : undefined}
                >
                  <title>{pointText(p, fluxUnit)}</title>
                </circle>
              </g>
            );
          })}
        </svg>
      </div>
      <p
        className="min-h-5 text-sm text-neutral-300"
        aria-hidden="true"
        data-testid="chart-readout"
      >
        {activePoint
          ? `${pointText(activePoint, fluxUnit)}${onSelectFrame ? ' · click to show this frame' : ''}`
          : 'Point at a marker for its values.'}
      </p>
    </div>
  );
}

export function pointText(p: SpectrumPoint, unit: string): string {
  const flag = !p.flagged
    ? ''
    : p.flag_reasons && p.flag_reasons.length > 0
      ? `, flagged (${p.flag_reasons.join(', ')})`
      : ', flagged';
  return `${formatWavelength(p.wavelength_um)}: ${formatFlux(p.flux, p.error, unit)}${flag}`;
}

function diamond(cx: number, cy: number, r: number): string {
  return `M${cx} ${cy - r} L${cx + r} ${cy} L${cx} ${cy + r} L${cx - r} ${cy} Z`;
}

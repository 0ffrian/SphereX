// R8.6 spectrum haptics pad: drag along it (or use the arrow keys) to feel and hear the spectrum.
// x maps to λ; a tick every 8 px; absorption dips below 20% of the peak are quiet in both
// channels. It is a slider for assistive tech: the value is λ and the value text says the flux
// as a share of the peak, so nothing is carried by touch alone (R9). M5 lays it over the
// SpectrumChart (passing the chart's λ domain); here it draws its own normalised-flux line.
import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { SpectrumResponse } from '@/app/api/types';
import type { HapticOutputs } from '../haptics';
import { SpectrumHapticSource, spectrumXToLambda, type SpectrumStep } from '../sources/spectrum';
import { SPECTRUM_QUIET_THRESHOLD } from '../tuning';
import { UnlockButton } from './UnlockButton';

export interface SpectrumHapticsPadProps {
  haptics: HapticOutputs;
  spectrum: Pick<SpectrumResponse, 'spectrum' | 'tag'>;
  /** What the spectrum is of, for the label ("WISE 0855-0714"). */
  objectName: string;
  /** λ (µm) at the pad's left and right edges. Default: the usable points' range. */
  lambdaDomain?: readonly [number, number];
  /** Seed of the R8.3 jitter (M5 passes the card's seed). */
  seed?: number;
  className?: string;
}

const VIEW_W = 1000;
const VIEW_H = 100;
const LINE_SAMPLES = 200;
const COLOR_LINE = '#3987e5';
const COLOR_QUIET = '#c3c2b7';

interface Readout {
  lambdaUm: number;
  text: string;
}

function describeStep(s: Readonly<SpectrumStep>): string {
  const wl = `${s.lambdaUm.toFixed(2)} µm`;
  if (!s.inRange) return `${wl}: no data`;
  const pct = `${Math.round(s.strength * 100)}% of peak flux`;
  const parts = [wl, s.quiet ? `quiet, ${pct}` : pct];
  if (s.noisy) parts.push('noisy');
  return parts.join(', ');
}

export function SpectrumHapticsPad({
  haptics,
  spectrum,
  objectName,
  lambdaDomain,
  seed,
  className,
}: SpectrumHapticsPadProps) {
  const id = useId();
  const padRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<DOMRect | null>(null);
  const cursorRef = useRef<SVGLineElement>(null);
  const dragging = useRef(false);
  const [readout, setReadout] = useState<Readout | null>(null);

  const source = useMemo(
    () =>
      new SpectrumHapticSource(haptics.engine, {
        points: spectrum.spectrum,
        tag: spectrum.tag,
        xToLambda: spectrumXToLambda(0, 1, [0, 1]), // replaced from the pad's box per gesture
        ...(seed === undefined ? {} : { seed }),
      }),
    [haptics.engine, spectrum.spectrum, spectrum.tag, seed],
  );
  const { mapping } = source;
  const l0 = lambdaDomain?.[0] ?? mapping.lambdaMinUm;
  const l1 = lambdaDomain?.[1] ?? mapping.lambdaMaxUm;

  // The normalised-flux line and the quiet threshold, in view-box units.
  const line = useMemo(() => {
    if (mapping.empty) return '';
    const pts: string[] = [];
    for (let i = 0; i <= LINE_SAMPLES; i++) {
      const lambda = l0 + ((l1 - l0) * i) / LINE_SAMPLES;
      const s = mapping.sampleAt(lambda);
      if (!s) continue;
      const x = (VIEW_W * i) / LINE_SAMPLES;
      pts.push(`${x.toFixed(1)},${(VIEW_H * (1 - s.strength)).toFixed(1)}`);
    }
    return pts.join(' ');
  }, [mapping, l0, l1]);

  if (mapping.empty) {
    return (
      <p className={className}>
        No usable spectrum points for {objectName}, so there is nothing to feel or hear.
      </p>
    );
  }

  /** Read the pad's box once per gesture (not per move) and map its x range onto λ. */
  const syncScale = () => {
    const el = padRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    boxRef.current = r;
    source.setScale(spectrumXToLambda(r.left, r.right, [l0, l1]));
  };

  const moveCursor = (x: number | null) => {
    const r = boxRef.current;
    const c = cursorRef.current;
    if (!r || !c) return;
    if (x === null) {
      c.setAttribute('visibility', 'hidden');
      return;
    }
    const vx = r.width > 0 ? ((x - r.left) / r.width) * VIEW_W : 0;
    c.setAttribute('x1', String(vx));
    c.setAttribute('x2', String(vx));
    c.setAttribute('visibility', 'visible');
  };

  const showStep = () => {
    const s = source.lastStep;
    if (s) setReadout({ lambdaUm: s.lambdaUm, text: describeStep(s) });
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.isPrimary === false) return; // one finger drives the pad
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragging.current = true;
    syncScale();
    source.begin(e.clientX);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    if (source.move(e.clientX) > 0) moveCursor(source.cursorX);
  };
  const onPointerEnd = () => {
    if (!dragging.current) return;
    dragging.current = false;
    source.end();
    showStep();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let dir: -1 | 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') dir = 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') dir = -1;
    else return;
    e.preventDefault();
    syncScale();
    if (source.stepBy(dir)) {
      moveCursor(source.cursorX);
      showStep();
    }
  };

  const quietY = VIEW_H * (1 - SPECTRUM_QUIET_THRESHOLD);

  return (
    <div className={className ?? 'flex flex-col gap-2'}>
      <div className="flex flex-wrap items-center gap-3">
        <UnlockButton engine={haptics.engine} canVibrate={haptics.vibrate.supported} />
      </div>
      <p id={`${id}-help`} className="text-sm text-neutral-400">
        Drag along the spectrum, or focus it and use the arrow keys. Each step ticks with the flux;
        absorption dips (below {Math.round(SPECTRUM_QUIET_THRESHOLD * 100)}% of the peak) are quiet.
        Pitch rises with wavelength.
      </p>
      <div
        ref={padRef}
        role="slider"
        tabIndex={0}
        aria-label={`Feel the spectrum of ${objectName}`}
        aria-describedby={`${id}-help`}
        aria-orientation="horizontal"
        aria-valuemin={Number(l0.toFixed(2))}
        aria-valuemax={Number(l1.toFixed(2))}
        aria-valuenow={readout ? Number(readout.lambdaUm.toFixed(2)) : Number(l0.toFixed(2))}
        aria-valuetext={readout?.text ?? 'No step yet'}
        className={
          'relative h-28 w-full cursor-crosshair touch-none rounded-md border border-neutral-500 ' +
          'bg-neutral-900 select-none focus-visible:outline-2 focus-visible:outline-offset-2 ' +
          'focus-visible:outline-sky-400'
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onKeyDown={onKeyDown}
      >
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <line
            x1={0}
            x2={VIEW_W}
            y1={quietY}
            y2={quietY}
            stroke={COLOR_QUIET}
            strokeDasharray="6 6"
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={line}
            fill="none"
            stroke={COLOR_LINE}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          <line
            ref={cursorRef}
            x1={0}
            x2={0}
            y1={0}
            y2={VIEW_H}
            stroke="#f5f5f5"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            visibility="hidden"
          />
        </svg>
      </div>
      <div className="flex justify-between text-sm text-neutral-400" aria-hidden="true">
        <span>{l0.toFixed(2)} µm</span>
        <span>dashed line: quiet below this</span>
        <span>{l1.toFixed(2)} µm</span>
      </div>
      <p className="text-sm">{readout ? readout.text : 'No step yet.'}</p>
    </div>
  );
}

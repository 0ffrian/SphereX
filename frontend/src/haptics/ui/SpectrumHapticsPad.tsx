// R8.6 spectrum haptics pad: drag along it (or use the keyboard) to feel and hear the spectrum.
// x maps to λ; a tick every 8 px; absorption dips below 20% of the peak are quiet in both
// channels. It is a slider for assistive tech: the value is λ and the value text says the flux
// as a share of the peak, so nothing is carried by touch alone (R9). M5 lays it over the
// SpectrumChart (passing the chart's λ domain); here it draws its own normalised-flux line.
// R8.2 / D-02: it is labelled as a data haptic with its provenance badge. The host page owns the
// unlock button (one per page), not the pad.
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import type { SpectrumResponse } from '@/app/api/types';
import { ProvenanceBadge } from '@/app/Badge';
import type { Tag } from '@/contract';
import { HONESTY_LABEL, badgeForTag, isTagShown, type HonestyState } from '@/viewer/honesty';
import type { HapticOutputs } from '../haptics';
import { SpectrumHapticSource, spectrumXToLambda, type SpectrumStep } from '../sources/spectrum';
import { PITCH_RISES_WITH_WAVELENGTH, SPECTRUM_QUIET_THRESHOLD } from '../tuning';

export interface SpectrumHapticsPadProps {
  haptics: HapticOutputs;
  /** The spectrum response's points and tag (`measured` today; any tag is gated by honesty). */
  spectrum: Pick<SpectrumResponse, 'spectrum'> & { tag: SpectrumResponse['tag'] | Tag };
  /** What the spectrum is of, for the label ("WISE 0855-0714"). */
  objectName: string;
  /** λ (µm) at the pad's left and right edges. Default: the usable points' range. */
  lambdaDomain?: readonly [number, number];
  /** Seed of the R8.3 jitter (M5 passes the card's seed). */
  seed?: number;
  /** Synthetic fixture data: badged "Fixture (synthetic)", never "Measured" (app/Badge, Q-32). */
  fixture?: boolean;
  className?: string;
}

const VIEW_W = 1000;
const VIEW_H = 100;
const LINE_SAMPLES = 200;
const COLOR_LINE = '#3987e5';
const COLOR_QUIET = '#c3c2b7';
/** PageUp / PageDown move this many steps. */
const PAGE_STEPS = 10;

interface Readout {
  lambdaUm: number;
  text: string;
}

/**
 * The readout and slider value text: λ, the flux as a share of the peak, "quiet" and
 * "uncertain" (σ/flux > 0.3). A tick the honesty state hid says so; a quiet dip is just quiet.
 */
export function describeStep(s: Readonly<SpectrumStep>, honesty: HonestyState, tag: Tag): string {
  const wl = `${s.lambdaUm.toFixed(2)} µm`;
  if (!s.inRange) return `${wl}: no data`;
  const pct = `${Math.round(s.strength * 100)}% of peak flux`;
  const parts = [wl, s.quiet ? `quiet, ${pct}` : pct];
  if (s.noisy) parts.push('uncertain');
  const text = parts.join(', ');
  if (s.emitted && !s.played && !isTagShown(honesty, tag)) {
    return `${text} (hidden by ${HONESTY_LABEL[honesty]})`;
  }
  return text;
}

export function SpectrumHapticsPad({
  haptics,
  spectrum,
  objectName,
  lambdaDomain,
  seed,
  fixture = false,
  className,
}: SpectrumHapticsPadProps) {
  const id = useId();
  const padRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<DOMRect | null>(null);
  const cursorRef = useRef<SVGLineElement>(null);
  /** The pointer driving the drag (one finger, or the main mouse button); null when none. */
  const dragPointer = useRef<number | null>(null);
  // The visible readout follows the finger (once per frame); the slider's ARIA value changes only
  // when a drag ends or a key moves it, so a screen reader is not flooded during a drag.
  const [readout, setReadout] = useState<Readout | null>(null);
  const [ariaReadout, setAriaReadout] = useState<Readout | null>(null);
  /** One readout update per animation frame while dragging. */
  const frame = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (frame.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frame.current);
      }
    },
    [],
  );

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
  // One wavelength (or a zero-width range) is a value, not a spectrum: refuse to stretch it.
  if (mapping.count < 2 || !(l1 > l0)) {
    return (
      <p className={className}>
        {objectName} has usable flux at only one wavelength, so there is no spectrum to drag along.
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

  /** Show the latest step; `aria` also moves the slider's value (drag end, keys). */
  const showStep = (aria: boolean) => {
    const s = source.lastStep;
    if (!s) return;
    const r = { lambdaUm: s.lambdaUm, text: describeStep(s, haptics.engine.honesty, spectrum.tag) };
    setReadout(r);
    if (aria) setAriaReadout(r);
  };

  /** During a drag: at most one readout update per frame (no React work per pointermove). */
  const showStepSoon = () => {
    if (typeof requestAnimationFrame !== 'function') {
      showStep(false);
      return;
    }
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      showStep(false);
    });
  };

  /** jsdom and old engines may lack pointerId; one id stands for "the" pointer there. */
  const pointerOf = (e: PointerEvent<HTMLDivElement>) => e.pointerId ?? 0;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (dragPointer.current !== null) return; // a second finger does not take over
    if (e.isPrimary === false) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return; // main button only
    dragPointer.current = pointerOf(e);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    syncScale();
    source.begin(e.clientX);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragPointer.current === null || pointerOf(e) !== dragPointer.current) return;
    if (source.move(e.clientX) > 0) {
      moveCursor(source.cursorX);
      showStepSoon();
    }
  };
  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    if (dragPointer.current === null || pointerOf(e) !== dragPointer.current) return;
    dragPointer.current = null;
    source.end();
    showStep(true);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    let move: (() => boolean) | null = null;
    if (k === 'ArrowRight' || k === 'ArrowUp') move = () => source.stepBy(1);
    else if (k === 'ArrowLeft' || k === 'ArrowDown') move = () => source.stepBy(-1);
    else if (k === 'PageUp') move = () => source.stepBy(1, PAGE_STEPS);
    else if (k === 'PageDown') move = () => source.stepBy(-1, PAGE_STEPS);
    else if (k === 'Home') move = () => source.jumpTo('start');
    else if (k === 'End') move = () => source.jumpTo('end');
    if (!move) return;
    e.preventDefault();
    syncScale();
    if (move()) {
      moveCursor(source.cursorX);
      showStep(true);
    }
  };

  const quietY = VIEW_H * (1 - SPECTRUM_QUIET_THRESHOLD);
  const badge = badgeForTag(spectrum.tag);
  const startText = `Start of the spectrum, ${l0.toFixed(2)} µm; no step yet`;

  return (
    <div className={className ?? 'flex flex-col gap-2'}>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="flex items-center gap-1.5" data-testid="pad-badge">
          <span>Data ·</span> <ProvenanceBadge tag={spectrum.tag} fixture={fixture} />
          {fixture && <span> (synthetic)</span>}
          {!fixture && badge === 'Default' && <span> (artist&rsquo;s choice)</span>}
        </span>
        <span className="text-neutral-400">Spectrum: vibration and sound follow the flux</span>
      </p>
      <p id={`${id}-help`} className="text-sm text-neutral-400">
        Drag along the spectrum, or focus it and use the arrow keys (Page Up, Page Down, Home and
        End jump further). Each step ticks with the flux; absorption dips (below{' '}
        {Math.round(SPECTRUM_QUIET_THRESHOLD * 100)}% of the peak) are quiet. Pitch{' '}
        {PITCH_RISES_WITH_WAVELENGTH ? 'rises' : 'falls'} with wavelength. With TalkBack, double-tap
        and hold, then drag; or swipe up or down to step.
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
        aria-valuenow={Number((ariaReadout ? ariaReadout.lambdaUm : l0).toFixed(2))}
        aria-valuetext={ariaReadout?.text ?? startText}
        className={
          'relative h-28 w-full cursor-crosshair touch-none rounded-md border border-neutral-500 ' +
          'bg-neutral-900 select-none focus-visible:outline-2 focus-visible:outline-offset-2 ' +
          'focus-visible:outline-sky-400'
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
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
      <p className="text-sm" aria-hidden="true">
        {readout ? readout.text : `${startText}.`}
      </p>
    </div>
  );
}

// D-38 panel controls (docs/design-language.md): ToggleGroup, SwitchRow and an accordion Row, built by
// hand. Animate UI's components need its React package and the shadcn setup, which this app does not
// have, so these copy their look and motion instead (the approved preview, panels-preview.html).
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const SPRING_K = 500;
const SPRING_C = 40; // damping 40, mass 1

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
}

export interface ToggleOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  title?: string;
  testId?: string;
}

/** Eyebrow label over a segmented group; the selected item is --ac / --on-ac and the fill springs to it. */
export function ToggleGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  testId,
  hideLabel = false,
}: {
  label: string;
  options: readonly ToggleOption<T>[];
  value: T | null;
  onChange(value: T): void;
  testId?: string;
  /** Keep the name for screen readers but do not draw the eyebrow. */
  hideLabel?: boolean;
}) {
  const labelId = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);
  const sim = useRef({ x: 0, w: 0, vx: 0, vw: 0, tx: 0, tw: 0, raf: 0, init: false });

  useLayoutEffect(() => {
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!track || !thumb) return;
    const s = sim.current;
    const paint = () => {
      thumb.style.transform = `translateX(${s.x}px)`;
      thumb.style.width = `${s.w}px`;
    };
    const step = () => {
      const dt = 1 / 60;
      let done = true;
      for (const p of ['x', 'w'] as const) {
        const v = p === 'x' ? 'vx' : 'vw';
        const t = p === 'x' ? 'tx' : 'tw';
        const a = -SPRING_K * (s[p] - s[t]) - SPRING_C * s[v];
        s[v] += a * dt;
        s[p] += s[v] * dt;
        if (Math.abs(s[v]) > 0.01 || Math.abs(s[p] - s[t]) > 0.1) done = false;
      }
      if (done) {
        s.x = s.tx;
        s.w = s.tw;
      }
      paint();
      s.raf = done ? 0 : requestAnimationFrame(step);
    };
    const sync = (jump: boolean) => {
      const on = track.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!on) {
        setReady(false);
        return;
      }
      setReady(true);
      s.tx = on.offsetLeft;
      s.tw = on.offsetWidth;
      if (!s.init || jump || reducedMotion()) {
        s.init = true;
        s.x = s.tx;
        s.w = s.tw;
        s.vx = s.vw = 0;
        paint();
        return;
      }
      if (!s.raf) s.raf = requestAnimationFrame(step);
    };
    sync(false);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => sync(true)) : null;
    ro?.observe(track);
    return () => {
      ro?.disconnect();
      if (s.raf) cancelAnimationFrame(s.raf);
      s.raf = 0;
    };
  }, [value, options]);

  return (
    <div className="sx-pc-grp">
      <span id={labelId} className={hideLabel ? 'sr-only' : 'sx-eyebrow'}>
        {label}
      </span>
      <div ref={trackRef} role="group" aria-labelledby={labelId} className="sx-seg" data-testid={testId}>
        <span ref={thumbRef} className="sx-seg-thumb" aria-hidden="true" style={{ opacity: ready ? 1 : 0 }} />
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            data-testid={o.testId}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Label left, round switch right. The thumb springs across and stretches while pressed. */
export function SwitchRow({
  label,
  checked,
  onChange,
  disabled,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange(next: boolean): void;
  disabled?: boolean;
  testId?: string;
}) {
  const id = useId();
  return (
    <div className="sx-sw-row">
      <span id={id}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        disabled={disabled}
        className="sx-switch"
        onClick={() => onChange(!checked)}
        data-testid={testId}
      >
        <i aria-hidden="true" />
      </button>
    </div>
  );
}

/** Accordion row: 44px trigger, optional count and chevron on the right, opens by animating grid rows. */
export function Row({
  title,
  count,
  children,
  defaultOpen = false,
  testId,
}: {
  title: string;
  count?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="sx-row" data-testid={testId}>
      <button
        type="button"
        className="sx-row-t"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{title}</span>
        <span className="sx-row-r">
          {count !== undefined && count !== null && <span>{count}</span>}
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      <div id={id} className={`sx-reveal${open ? ' open' : ''}`} inert={!open}>
        <div>
          <div className="sx-reveal-in">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Wrapper that makes the rows run edge to edge in the card, with dividers. */
export function Rows({ children }: { children: ReactNode }) {
  return <div className="sx-rows">{children}</div>;
}

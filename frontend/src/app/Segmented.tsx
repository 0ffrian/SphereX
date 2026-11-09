// Segmented control with radio-group semantics (WAI-ARIA radio group pattern, R9): one Tab stop,
// arrow keys (and Home/End) move the choice and the focus, Space and Enter pick the focused
// option. Visible focus ring; 32 px tall on a mouse, 44 px on a coarse pointer (touch).
import { useId, useRef, type KeyboardEvent } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  testId?: string;
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  testId,
}: {
  /** Visible label of the group (also its accessible name). */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange(value: T): void;
  testId?: string;
}) {
  const labelId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const pick = (i: number) => {
    const n = options.length;
    const k = ((i % n) + n) % n;
    const option = options[k];
    if (!option) return;
    onChange(option.value);
    refs.current[k]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') pick(i + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') pick(i - 1);
    else if (e.key === 'Home') pick(0);
    else if (e.key === 'End') pick(options.length - 1);
    else return;
    // Keep the flipbook's own arrow and Home/End keys from stepping frames.
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span id={labelId} className="text-sm text-neutral-400">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="inline-flex flex-wrap gap-0.5 rounded-md border border-neutral-500 bg-neutral-900 p-0.5"
        data-testid={testId}
      >
        {options.map((o, i) => {
          const checked = o.value === value;
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={
                'min-h-8 touch-manipulation rounded px-3 text-sm text-neutral-200 ' +
                'pointer-coarse:min-h-11 enabled:hover:bg-neutral-800 ' +
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 ' +
                'aria-checked:bg-sky-950 aria-checked:text-neutral-50 aria-checked:ring-1 ' +
                'aria-checked:ring-sky-400'
              }
              data-testid={o.testId}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

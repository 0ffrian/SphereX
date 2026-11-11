// Issue #71 stream U (Q-298): the `BuildControls` slot. The build pane's Details panel has one region
// where a body's sliders, toggles, choices and "how it is worked out" notes go, so the rendering
// streams add controls without touching the pane. The mock-up's own sliders live in its preview page;
// here they sit under Details with the same look as the other controls.
//
// How a renderer's side adds controls (any component that is mounted while the body is shown, for
// example the one that already owns the plan or the viewer handle):
//
//   useBuildControls('rocky', {                       // owner id; the spec goes when it unmounts
//     title: 'Surface',
//     controls: [
//       { kind: 'slider', id: 'age', label: 'Surface age', min: 0, max: 100, step: 1, value: age,
//         valueText: `${age} Myr`, tag: 'artistic', onChange: setAge },
//       { kind: 'toggle', id: 'pause', label: 'Pause', pressed: paused, onChange: setPaused },
//       { kind: 'choice', id: 'fluid', label: 'Surface fluid', value: 'water',
//         options: [{ value: 'water', label: 'Water' }, { value: 'lava', label: 'Lava' }],
//         onChange: setFluid },
//       { kind: 'button', id: 'flare', label: 'Fire a big flare', onClick: fire },
//       { kind: 'readout', id: 'period', label: 'Rotation period', value: '25.4 days', tag: 'measured' },
//     ],
//     notes: [{ title: 'How the surface is worked out', lines: ['…'], placeholder: 'Weights are placeholders.' }],
//   });
//
// Pass `null` (or let the component unmount) to remove it. Every control has a plain-words label, a
// keyboard path, a 44 px target on touch, and an optional provenance `tag` shown as its badge (D-02).
// A control that cannot work yet is passed with `disabled: true` and a `why` sentence: it is shown, off,
// with the reason in its name, never hidden and never faked.
import { useEffect, useId } from 'react';
import { create } from 'zustand';
import type { Tag } from '@/contract';
import { ProvenanceBadge } from '@/app/Badge';

interface Base {
  id: string;
  /** Plain words. */
  label: string;
  /** D-02 tag, drawn as the control's badge. */
  tag?: Tag;
  disabled?: boolean;
  /** Said (title and accessible description) when `disabled`, or as a hint otherwise. */
  why?: string;
}
export interface SliderControl extends Base {
  kind: 'slider';
  min: number;
  max: number;
  step?: number;
  value: number;
  /** Read by screen readers and shown beside the label (default: the number). */
  valueText?: string;
  onChange(value: number): void;
}
export interface ToggleControl extends Base {
  kind: 'toggle';
  pressed: boolean;
  onChange(pressed: boolean): void;
}
export interface ChoiceControl extends Base {
  kind: 'choice';
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
  onChange(value: string): void;
}
export interface ButtonControl extends Base {
  kind: 'button';
  onClick(): void;
}
export interface ReadoutControl extends Base {
  kind: 'readout';
  value: string;
}
export type BuildControl =
  SliderControl | ToggleControl | ChoiceControl | ButtonControl | ReadoutControl;

/** A "How each part is worked out" block: formulas in words, and the honesty line that goes with them. */
export interface BuildNote {
  title: string;
  lines: string[];
  /** e.g. "Still placeholders until the sensitivity sweep." */
  placeholder?: string;
}

export interface BuildControlsSpec {
  /** Group heading ("Surface", "Flares"). */
  title: string;
  controls: BuildControl[];
  notes?: BuildNote[];
}

interface Store {
  specs: Record<string, BuildControlsSpec>;
  set(owner: string, spec: BuildControlsSpec | null): void;
}
export const useBuildControlsStore = create<Store>((set) => ({
  specs: {},
  set: (owner, spec) =>
    set((s) => {
      const specs = { ...s.specs };
      if (spec) specs[owner] = spec;
      else delete specs[owner];
      return { specs };
    }),
}));

/** Registers `spec` under `owner` while the calling component is mounted; `null` removes it. */
export function useBuildControls(owner: string, spec: BuildControlsSpec | null): void {
  const set = useBuildControlsStore((s) => s.set);
  useEffect(() => {
    set(owner, spec);
  }, [owner, spec, set]);
  useEffect(() => () => set(owner, null), [owner, set]);
}

function Control({ c }: { c: BuildControl }) {
  const id = useId();
  const hintId = `${id}-why`;
  const name = c.disabled && c.why ? `${c.label}. ${c.why}` : c.label;
  const badge = c.tag ? <ProvenanceBadge tag={c.tag} /> : null;
  const hint = c.why ? (
    <span id={hintId} className="sx-ctl-why">
      {c.why}
    </span>
  ) : null;
  switch (c.kind) {
    case 'slider':
      return (
        <div className="sx-ctl">
          <label htmlFor={id} className="sx-ctl-row">
            <span>{c.label}</span>
            <output className="sx-ctl-val">{c.valueText ?? String(c.value)}</output>
            {badge}
          </label>
          <input
            id={id}
            type="range"
            min={c.min}
            max={c.max}
            step={c.step ?? 1}
            value={c.value}
            disabled={c.disabled}
            aria-valuetext={c.valueText}
            aria-describedby={c.why ? hintId : undefined}
            className="sx-ctl-range"
            onChange={(e) => c.onChange(Number(e.target.value))}
          />
          {hint}
        </div>
      );
    case 'toggle':
      return (
        <div className="sx-ctl sx-ctl-inline">
          <button
            type="button"
            className="sx-btn-sm sx-ctl-btn"
            aria-pressed={c.pressed}
            aria-label={name}
            disabled={c.disabled}
            title={c.why}
            onClick={() => c.onChange(!c.pressed)}
          >
            {c.label}
          </button>
          {badge}
        </div>
      );
    case 'choice':
      return (
        <div className="sx-ctl" role="group" aria-label={c.label}>
          <span className="sx-ctl-row">
            <span>{c.label}</span>
            {badge}
          </span>
          <span className="sx-ctl-opts">
            {c.options.map((o) => (
              <button
                key={o.value}
                type="button"
                className="sx-btn-sm sx-ctl-btn"
                aria-pressed={c.value === o.value}
                disabled={c.disabled || o.disabled}
                onClick={() => c.onChange(o.value)}
              >
                {o.label}
              </button>
            ))}
          </span>
          {hint}
        </div>
      );
    case 'button':
      return (
        <div className="sx-ctl sx-ctl-inline">
          <button
            type="button"
            className="sx-btn-sm sx-ctl-btn"
            aria-label={name}
            disabled={c.disabled}
            title={c.why}
            onClick={c.onClick}
          >
            {c.label}
          </button>
          {badge}
        </div>
      );
    case 'readout':
      return (
        <div className="sx-ctl sx-ctl-row" title={c.why}>
          <span>{c.label}</span>
          <output className="sx-ctl-val">{c.value}</output>
          {badge}
        </div>
      );
  }
}

/** The region itself: rendered by the build pane's Details panel; nothing shows until something registers. */
export function BuildControls() {
  const specs = useBuildControlsStore((s) => s.specs);
  const owners = Object.keys(specs);
  if (owners.length === 0) return null;
  return (
    <div className="sx-bctl" data-testid="build-controls">
      {owners.map((o) => {
        const spec = specs[o]!;
        return (
          <section key={o} className="sx-bctl-group" aria-label={spec.title} data-owner={o}>
            <h3>{spec.title}</h3>
            {spec.controls.map((c) => (
              <Control key={c.id} c={c} />
            ))}
            {spec.notes?.map((n) => (
              <details key={n.title} className="sx-bctl-note">
                <summary>{n.title}</summary>
                {n.lines.map((l) => (
                  <p key={l}>{l}</p>
                ))}
                {n.placeholder && <p className="sx-acc-rules">{n.placeholder}</p>}
              </details>
            ))}
          </section>
        );
      })}
    </div>
  );
}

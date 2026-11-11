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
import { useEffect, useId, type ReactNode } from 'react';
import { create } from 'zustand';
import type { Tag } from '@/contract';
import { ProvenanceBadge } from '@/app/Badge';
import { Row, ToggleGroup } from '@/app/PanelControls';

interface Base {
  id: string;
  /** Plain words. */
  label: string;
  /** D-02 tag, drawn as the control's badge. */
  tag?: Tag;
  disabled?: boolean;
  /** Controls that share a `group` and sit next to each other are drawn as one compact horizontal row. */
  group?: string;
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
  /** 'about': not drawn with the controls; shown inside the closed "About this flare" row. */
  slot?: 'about';
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
  /**
   * Where the Details pane shows it. 'key': the always-visible grid of key numbers. 'latest': the
   * one-line "Latest flare" summary (its value is the long sentence, shown under "About this flare").
   * 'assumed': a bullet in "Assumed values". 'where': the one short muted line under the flare chart. 'about': a
   * line inside "About this flare". Default: a row in "All numbers".
   */
  slot?: 'key' | 'latest' | 'assumed' | 'where' | 'about';
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
  const badge = c.tag ? <ProvenanceBadge tag={c.tag} variant="tag" /> : null;
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
        <div className="sx-ctl">
          <ToggleGroup
            label={c.label}
            value={c.value}
            options={c.options.map((o) => ({ value: o.value, label: o.label, disabled: c.disabled || o.disabled }))}
            onChange={c.onChange}
          />
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
        <div className="sx-ctl sx-ctl-row">
          <span>{c.label}</span>
          <output className="sx-ctl-val">{c.value}</output>
          {badge}
        </div>
      );
  }
}

/** One control drawn compactly, for a `group` row: segmented choice, pressed chip, or action chip. No badges, no eyebrows. */
function CompactControl({ c }: { c: BuildControl }) {
  const name = c.disabled && c.why ? `${c.label}. ${c.why}` : c.label;
  switch (c.kind) {
    case 'choice':
      return (
        <ToggleGroup
          label={c.label}
          hideLabel
          value={c.value}
          options={c.options.map((o) => ({ value: o.value, label: o.label, disabled: c.disabled || o.disabled }))}
          onChange={c.onChange}
        />
      );
    case 'toggle':
      return (
        <button
          type="button"
          className="sx-act"
          aria-pressed={c.pressed}
          aria-label={name}
          disabled={c.disabled}
          title={c.why}
          onClick={() => c.onChange(!c.pressed)}
        >
          {c.label}
        </button>
      );
    case 'button':
      return (
        <button type="button" className="sx-act" aria-label={name} disabled={c.disabled} title={c.why} onClick={c.onClick}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
          </svg>
          {c.label}
        </button>
      );
    default:
      return <Control c={c} />;
  }
}

/** Consecutive controls that share a `group` become one wrapping row; the rest are drawn as before. */
function renderControls(controls: BuildControl[]): ReactNode[] {
  const out: ReactNode[] = [];
  for (let i = 0; i < controls.length; i++) {
    const c = controls[i]!;
    if (!c.group) {
      out.push(<Control key={c.id} c={c} />);
      continue;
    }
    const run: BuildControl[] = [c];
    while (i + 1 < controls.length && controls[i + 1]!.group === c.group) run.push(controls[++i]!);
    out.push(
      <div key={`g-${c.group}-${c.id}`} className="sx-flare-row" data-testid={`ctl-group-${c.group}`}>
        {run.map((r) => (
          <CompactControl key={r.id} c={r} />
        ))}
      </div>,
    );
  }
  return out;
}

/** The region itself: the interactive controls, rendered by the build pane's Details panel; nothing shows until something registers. */
export function BuildControls() {
  const specs = useBuildControlsStore((s) => s.specs);
  const drawn = (o: string) => specs[o]!.controls.filter((c) => c.kind !== 'readout' && !(c.kind === 'choice' && c.slot === 'about'));
  const owners = Object.keys(specs).filter((o) => drawn(o).length > 0);
  if (owners.length === 0) return null;
  return (
    <div className="sx-bctl" data-testid="build-controls">
      {owners.map((o) => {
        const spec = specs[o]!;
        return (
          <section key={o} className="sx-bctl-group" aria-label={spec.title} data-owner={o}>
            {renderControls(drawn(o))}
          </section>
        );
      })}
    </div>
  );
}

function readoutsOf(specs: Record<string, BuildControlsSpec>): ReadoutControl[] {
  return Object.values(specs).flatMap((s) => s.controls.filter((c): c is ReadoutControl => c.kind === 'readout'));
}

/** Notes that are explanations of method are not shown; the rest become "Assumed values" lines. */
const isMethodNote = (title: string): boolean => /^How /.test(title);

/** The "Latest flare" line and the compact key-number grid: a few numbers, no prose. */
export function BuildKeyNumbers({ fixture }: { fixture?: boolean }) {
  const specs = useBuildControlsStore((s) => s.specs);
  const all = readoutsOf(specs);
  const latest = all.find((r) => r.slot === 'latest');
  const keys = all.filter((r) => r.slot === 'key');
  if (!latest && keys.length === 0) return null;
  const text = latest?.value ?? null;
  const cls = text?.match(/Class (\w+\.?\d*)/)?.[1] ?? null;
  const outcome = text ? (/stays closed/.test(text) ? 'stayed closed' : /erupt/.test(text) ? 'erupted' : null) : null;
  return (
    <>
      {latest && (
        <div className="sx-flare" data-testid="latest-flare" aria-live="polite">
          {cls ? (
            <span>
              Latest flare: <b>{cls}{outcome ? `, ${outcome}` : ''}</b>
            </span>
          ) : (
            <span>{text}</span>
          )}
          {latest.tag && <ProvenanceBadge tag={latest.tag} fixture={fixture} variant="tag" />}
        </div>
      )}
      {keys.length > 0 && (
        <dl
          className="m-0 grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 text-[13px]"
          data-testid="key-numbers"
        >
          {keys.map((r) => (
            <div key={r.id} className="contents">
              <dt style={{ color: 'var(--muted)' }}>{r.label}</dt>
              <dd className="m-0 flex items-center justify-end gap-2 tabular-nums">
                {r.value}
                {r.tag && <ProvenanceBadge tag={r.tag} fixture={fixture} variant="tag" />}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}

/**
 * The closed rows under the key numbers, to sit inside the pane's `<Rows>`: "About this flare" (the sentence, then
 * `flareChart`), "All numbers" and "Assumed values" (the build notes and `extraAssumed`, as short lines).
 */
export function BuildSummaryRows({
  extraAssumed = [],
  flareChart,
  fixture,
}: {
  extraAssumed?: string[];
  flareChart?: ReactNode;
  fixture?: boolean;
}) {
  const specs = useBuildControlsStore((s) => s.specs);
  const all = readoutsOf(specs);
  const latest = all.find((r) => r.slot === 'latest');
  const rest = all.filter((r) => !r.slot);
  const aboutReadouts = all.filter((r) => r.slot === 'about');
  const aboutChoices = Object.values(specs).flatMap((sp) =>
    sp.controls.filter((c): c is ChoiceControl => c.kind === 'choice' && c.slot === 'about'),
  );
  const lines = [
    ...all.filter((r) => r.slot === 'assumed').map((r) => `${r.label}: ${r.value}`),
    ...Object.values(specs).flatMap((s) =>
      (s.notes ?? []).filter((n) => !isMethodNote(n.title)).flatMap((n) => n.lines),
    ),
    ...extraAssumed,
  ];
  return (
    <>
      {(latest || flareChart || aboutReadouts.length > 0 || aboutChoices.length > 0) && (
        <Row title="About this flare" testId="about-flare-row">
          {latest && <p className="text-sm">{latest.value}</p>}
          {aboutReadouts.map((r) => (
            <p key={r.id} className="text-sm" style={{ color: 'var(--muted)' }}>
              {r.value}
            </p>
          ))}
          {aboutChoices.map((c) => (
            <ToggleGroup
              key={c.id}
              label={c.label}
              value={c.value}
              options={c.options.map((o) => ({ value: o.value, label: o.label, disabled: c.disabled || o.disabled }))}
              onChange={c.onChange}
            />
          ))}
          {flareChart}
        </Row>
      )}
      {rest.length > 0 && (
        <Row title="All numbers" count={rest.length} testId="all-numbers-row">
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-[13px]">
            {rest.map((r) => (
              <div key={r.id} className="contents">
                <dt style={{ color: 'var(--muted)' }}>{r.label}</dt>
                <dd className="m-0 flex items-center justify-end gap-2 text-right tabular-nums">
                  {r.value}
                  {r.tag && <ProvenanceBadge tag={r.tag} fixture={fixture} variant="tag" />}
                </dd>
              </div>
            ))}
          </dl>
        </Row>
      )}
      {lines.length > 0 && (
        <Row title="Assumed values" count={lines.length} testId="assumed-row">
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13px]" style={{ color: 'var(--muted)' }}>
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Row>
      )}
    </>
  );
}

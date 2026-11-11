// D-36, Q-266, Q-267: the Accuracy popover the data-confidence chip opens. It mirrors the mock-up's
// #popAcc (mockup/spherex-ui.html): header, big score and band, three-part bar with key, KaTeX
// equations with this object's numbers, gate checklist, rules line, per-row table. Anchored to the
// chip; a bottom sheet on Touch (CSS `pointer: coarse`). The score shown is the backend's.
import { useEffect, useId, useRef } from 'react';
import type { RenderParams } from '@/contract';
import { BAND_WORDS, percent } from '@/viewer/confidenceGate';
import {
  C_TABLE_LATEX,
  C_TABLE_LINES,
  GENERAL_LATEX,
  PART_INFO,
  formulaTerms,
  gateLatex,
  gatePlain,
  generalPlain,
  num,
  partShares,
  rowPoints,
  substitutionLatex,
  substitutionPlain,
  tagChip,
  type ConfidenceInput,
  type Part,
} from '@/viewer/confidenceFormula';
import { FormulaMath } from './FormulaMath';
import { ERROR_BARS_NOTE } from './worldNotes.generated';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const PART_COLOUR: Record<Part, string> = { d: '#4ade80', p: '#38bdf8', a: '#52525b' };
const PARTS: Part[] = ['d', 'p', 'a'];

function Yes({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li>
      <span className={`sx-acc-gv ${ok ? 'ok' : 'no'}`}>{ok ? 'Yes' : 'No'}</span> {children}
    </li>
  );
}

export function ConfidencePopover({
  params,
  name,
  keyLabels,
  inline = false,
  isShown,
  onClose,
}: {
  params: RenderParams;
  /** The object's name, for the header (the mock-up's right-hand note). */
  name?: string;
  /** Plain words for the key measurements, from the backend's `needed` text when it has one. */
  keyLabels?: string;
  /**
   * Issue #71 stream U: the mock-up's `#popAcc` lives inside the build pane's popover (one sense at
   * a time, `.bp-pop`), not in a modal dialog: no backdrop, no focus trap, no Close button (the
   * Accuracy button, Escape and the pane's own popover close it).
   */
  inline?: boolean;
  /**
   * The Show level (D-21): rows whose tag it hides are dimmed and said so. The score and the points
   * never change with it; they come from the backend (PARITY_CHECKLIST section 8).
   */
  isShown?: (tag: ConfidenceInput['tag']) => boolean;
  onClose: () => void;
}) {
  const c = params.confidence;
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (inline) return;
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => opener?.focus?.();
  }, [inline]);

  useEffect(() => {
    if (!c) return;
    const t = formulaTerms(c);
    if (!t.agrees && import.meta.env?.DEV) {
      console.warn(
        `[confidence] the rows add up to ${t.fromRows} but the backend sent ${t.shown}; showing the backend value`,
      );
    }
  }, [c]);

  if (!c) return null;
  const share = partShares(c);
  const pct = (k: Part) => percent(share[k]);
  const score = percent(c.score);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const body = (
    <>
      <div className="sx-pop-h">
        <b id={titleId}>Accuracy</b>
        <span>{name ?? ''}</span>
        {!inline && (
          <button type="button" className="sx-acc-close" onClick={onClose}>
            Close
          </button>
        )}
      </div>

      <div className="sx-acc-top">
        <span className="n" data-testid="formula-result">
          {score}%
        </span>
        <span>{BAND_WORDS[c.band]}</span>
      </div>
      <div
        className="sx-acc-bar"
        role="img"
        aria-label={`Satellite data ${pct('d')} percent, physics ${pct('p')} percent, assumed ${pct('a')} percent`}
      >
        {PARTS.map((k) => (
          <i key={k} style={{ flex: `${share[k]} 1 0`, background: PART_COLOUR[k] }} />
        ))}
      </div>
      <div className="sx-acc-key">
        {PARTS.map((k) => (
          <KeyRow key={k} part={k} pct={pct(k)} />
        ))}
      </div>

      <FormulaMath latex={GENERAL_LATEX} plain={generalPlain()} testId="formula-general" />
      <p className="sx-acc-rules">
        w is how much a quantity changes the picture. c is how far the data narrows the range of
        this kind of object.
      </p>
      <FormulaMath latex={C_TABLE_LATEX} plain={C_TABLE_LINES} testId="formula-ctable" />
      <FormulaMath
        latex={substitutionLatex(c)}
        plain={substitutionPlain(c)}
        testId="formula-substituted"
      />
      <p className="sx-acc-rules">
        Terms with c = 0 add nothing, so they are folded into the final + 0.
      </p>
      <FormulaMath
        latex={gateLatex(c.threshold)}
        plain={gatePlain(c.threshold)}
        testId="formula-gate"
      />
      <ul className="sx-acc-gate">
        <Yes ok={c.gate.class_known}>The kind of object is known.</Yes>
        <Yes ok={c.gate.key_measurement}>
          At least one key measurement{keyLabels ? `: ${keyLabels}` : ''}.
        </Yes>
        <Yes ok={c.gate.score_ok}>
          Score of at least {percent(c.threshold)}% (now {score}%).
        </Yes>
      </ul>
      <p className="sx-acc-rules">
        <b>{c.gate.passed ? 'The 3D body is drawn.' : 'The 3D body is not drawn.'}</b> {c.note}
      </p>

      <table className="sx-acc-tbl">
        <caption className="sr-only">This object&apos;s terms</caption>
        <thead>
          <tr>
            <th scope="col">Quantity</th>
            <th scope="col">Source</th>
            <th scope="col">Points</th>
          </tr>
        </thead>
        <tbody>
          {c.inputs.map((i) => {
            const chip = tagChip(i);
            const dim = isShown ? !isShown(i.tag) : false;
            return (
              <tr key={i.id} className={dim ? 'sx-acc-dim' : undefined} data-dim={dim || undefined}>
                <td>
                  {i.label}
                  {dim && (
                    <span className="sr-only"> (hidden at this Show level; still counted)</span>
                  )}
                </td>
                <td>
                  <span className={`sx-acc-tag ${chip.part}`}>{chip.text}</span>
                </td>
                <td title={`weight ${num(i.weight)}, c ${num(i.c)}`}>{rowPoints(i)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {isShown && c.inputs.some((i) => !isShown(i.tag)) && (
        <p className="sx-acc-rules">
          Dimmed rows are hidden by the Show level. They still count: the score does not move with
          it.
        </p>
      )}
      {!c.gate.passed && (
        <p className="sx-acc-rules" data-testid="formula-below">
          <b>Why there is no 3D model.</b> Found: {c.found} Needed: {c.needed}
        </p>
      )}
      <p className="sx-acc-rules" data-testid="formula-error-bars">
        {ERROR_BARS_NOTE}
      </p>
      <p className="sx-acc-rules sx-acc-last">{c.weights_note}</p>
    </>
  );
  if (inline) {
    return (
      <div
        ref={ref}
        role="group"
        aria-labelledby={titleId}
        className="sx-acc-inline"
        data-testid="confidence-formula"
      >
        {body}
      </div>
    );
  }
  return (
    <>
      <div
        className="sx-acc-backdrop"
        onClick={onClose}
        data-testid="confidence-formula-backdrop"
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="sx-acc-pop"
        data-testid="confidence-formula"
      >
        {body}
      </div>
    </>
  );
}

function KeyRow({ part, pct }: { part: Part; pct: number }) {
  const info = PART_INFO[part];
  return (
    <>
      <span className="sx-acc-sw" style={{ background: PART_COLOUR[part] }} />
      <span>
        {info.label}
        <small>{info.note}</small>
      </span>
      <b>{pct}%</b>
    </>
  );
}

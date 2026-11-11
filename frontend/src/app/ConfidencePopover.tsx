// D-36, Q-266, Q-267: the Accuracy popover the data-confidence chip opens. It mirrors the mock-up's
// #popAcc (mockup/spherex-ui.html): header, three-part bar with key, KaTeX
// equations with this object's numbers, gate checklist, rules line, per-row table. Anchored to the
// chip; a bottom sheet on Touch (CSS `pointer: coarse`). The score shown is the backend's.
import { useEffect, useId, useRef } from 'react';
import type { RenderParams } from '@/contract';
import { percent } from '@/viewer/confidenceGate';
import {
  C_TABLE_LATEX,
  C_TABLE_LINES,
  GENERAL_LATEX,
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
import { Row, Rows } from './PanelControls';
import { ERROR_BARS_NOTE } from './worldNotes.generated';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const PART_COLOUR: Record<Part, string> = { d: 'var(--p-meas)', p: 'var(--p-phys)', a: 'var(--p-asm)' };
const PARTS: Part[] = ['d', 'p', 'a'];
const PART_COPY: Record<Part, { label: string; note: string }> = {
  d: { label: 'Measured', note: 'SPHEREx, Gaia and other archives' },
  p: { label: 'Physics', note: 'worked out from the data' },
  a: { label: 'Assumed', note: 'typical values or drawn detail' },
};

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

  const gateYes = [c.gate.class_known, c.gate.key_measurement, c.gate.score_ok].filter(Boolean).length;
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

      <div>
        <div
          className="sx-acc-bar"
          role="img"
          aria-label={`Measured ${pct('d')} percent, physics ${pct('p')} percent, assumed ${pct('a')} percent`}
        >
          {PARTS.map((k) => (
            <i key={k} style={{ flex: `${share[k]} 1 0`, background: PART_COLOUR[k] }} />
          ))}
        </div>
        <div className="sx-acc-leg">
          {PARTS.map((k) => (
            <KeyRow key={k} part={k} pct={pct(k)} />
          ))}
        </div>
      </div>

      <div className="sx-acc-formula">
        <FormulaMath latex={GENERAL_LATEX} plain={generalPlain()} testId="formula-general" />
        <dl className="sx-acc-vars">
          <dt>
            <FormulaMath latex="C" plain="C" />
          </dt>
          <dd data-testid="formula-result">the accuracy score, {score}% for this object</dd>
          <dt>
            <FormulaMath latex="i" plain="i" />
          </dt>
          <dd>each quantity behind the picture (size, temperature, …)</dd>
          <dt>
            <FormulaMath latex="w_i" plain="w sub i" />
          </dt>
          <dd>how much that quantity changes the picture</dd>
          <dt>
            <FormulaMath latex="c_i" plain="c sub i" />
          </dt>
          <dd>how far the data pins it down, from 0 to 1</dd>
        </dl>
      </div>

      <Rows>
        <Row title="Values of c and this object's sum">
          <FormulaMath latex={C_TABLE_LATEX} plain={C_TABLE_LINES} testId="formula-ctable" />
          <FormulaMath
            latex={substitutionLatex(c)}
            plain={substitutionPlain(c)}
            testId="formula-substituted"
          />
          <p>Terms with c = 0 add nothing, so they are folded into the final + 0.</p>
        </Row>
        <Row title="When it is shown in 3D" count={`${gateYes} of 3`}>
          <FormulaMath latex={gateLatex(c.threshold)} plain={gatePlain(c.threshold)} testId="formula-gate" />
          <ul className="sx-acc-gate2">
            <Yes ok={c.gate.class_known}>The kind of object is known.</Yes>
            <Yes ok={c.gate.key_measurement}>
              At least one key measurement{keyLabels ? `: ${keyLabels}` : ''}.
            </Yes>
            <Yes ok={c.gate.score_ok}>
              Score of at least {percent(c.threshold)}% (now {score}%).
            </Yes>
          </ul>
          <p>
            <b>{c.gate.passed ? 'The 3D body is drawn.' : 'The 3D body is not drawn.'}</b> {c.note}
          </p>
        </Row>
        <Row title="Every quantity" count={c.inputs.length}>
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
                      {dim && <span className="sr-only"> (hidden at this Show level; still counted)</span>}
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
              Dimmed rows are hidden by the Show level. They still count: the score does not move with it.
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
          <p className="sx-acc-rules">{c.weights_note}</p>
        </Row>
      </Rows>
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
  const info = PART_COPY[part];
  return (
    <div>
      <span>
        <i style={{ background: PART_COLOUR[part] }} />
        {info.label}
      </span>
      <strong>{pct}%</strong>
      <small>{info.note}</small>
    </div>
  );
}

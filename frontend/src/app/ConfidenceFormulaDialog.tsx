// D-36, Q-266: the dialog the data-confidence chip opens. It shows the formula in LaTeX (KaTeX),
// the c table, the gate rule with the real threshold, and this object's terms. The value shown is
// the backend's score; if the rows add up to something else a dev warning is logged (Q-266).
import { useEffect, useId, useRef } from 'react';
import type { RenderParams } from '@/contract';
import { inputBadge, percent } from '@/viewer/confidenceGate';
import {
  C_TABLE,
  GENERAL_LATEX,
  formulaTerms,
  gateLatex,
  gatePlain,
  generalPlain,
  num,
  substitutionLatex,
  substitutionPlain,
} from '@/viewer/confidenceFormula';
import { FormulaMath } from './FormulaMath';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function ConfidenceFormulaDialog({
  params,
  onClose,
}: {
  params: RenderParams;
  onClose: () => void;
}) {
  const c = params.confidence;
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => opener?.focus?.();
  }, []);

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-2 sm:items-center"
      onClick={onClose}
      data-testid="confidence-formula-backdrop"
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-3 overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 p-4 text-sm text-neutral-300"
        data-testid="confidence-formula"
      >
        <div className="flex items-start justify-between gap-2">
          <h2 id={titleId} className="text-base font-semibold text-neutral-100">
            How data confidence is worked out
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 min-w-11 rounded bg-neutral-800 px-3 text-neutral-100 focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            Close
          </button>
        </div>

        <section aria-labelledby={`${titleId}-g`} className="flex flex-col gap-1">
          <h3 id={`${titleId}-g`} className="font-semibold text-neutral-100">
            The formula
          </h3>
          <FormulaMath latex={GENERAL_LATEX} plain={generalPlain()} testId="formula-general" />
          <p>
            Each quantity that shapes the picture has a weight <i>w</i> (how much it changes the
            picture) and a data value <i>c</i> (how much real data backs it, from 0 to 1).
          </p>
        </section>

        <section aria-labelledby={`${titleId}-t`} className="flex flex-col gap-1">
          <h3 id={`${titleId}-t`} className="font-semibold text-neutral-100">
            What c is for each kind of source
          </h3>
          <table className="w-full text-left">
            <caption className="sr-only">The data value c for each source</caption>
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">c</th>
                <th scope="col">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {C_TABLE.map((r) => (
                <tr key={r.source}>
                  <td>{r.source}</td>
                  <td>{r.c}</td>
                  <td>{r.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>A value with error bars counts for less when the error is large.</p>
        </section>

        <section aria-labelledby={`${titleId}-r`} className="flex flex-col gap-1">
          <h3 id={`${titleId}-r`} className="font-semibold text-neutral-100">
            The 3D rule
          </h3>
          <p>A 3D body needs all three:</p>
          <ul className="list-disc pl-5">
            <li>we know what kind of object it is;</li>
            <li>it has a key measurement for its kind;</li>
            <li>
              data confidence of at least {percent(c.threshold)}%:
            </li>
          </ul>
          <FormulaMath latex={gateLatex(c.threshold)} plain={gatePlain(c.threshold)} testId="formula-gate" />
        </section>

        <section aria-labelledby={`${titleId}-o`} className="flex flex-col gap-1">
          <h3 id={`${titleId}-o`} className="font-semibold text-neutral-100">
            This object
          </h3>
          <table className="w-full text-left">
            <caption className="sr-only">This object&apos;s terms</caption>
            <thead>
              <tr>
                <th scope="col">Quantity</th>
                <th scope="col">Source</th>
                <th scope="col">Weight (w)</th>
                <th scope="col">Data value (c)</th>
              </tr>
            </thead>
            <tbody>
              {c.inputs.map((i) => (
                <tr key={i.id}>
                  <td>{i.label}</td>
                  <td>{inputBadge(i.tag)}</td>
                  <td>{num(i.weight)}</td>
                  <td>{num(i.c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <FormulaMath
            latex={substitutionLatex(c)}
            plain={substitutionPlain(c)}
            testId="formula-substituted"
          />
          <p className="text-neutral-100" data-testid="formula-result">
            Data confidence: <b>{percent(c.score)}%</b> (C = {num(c.score)})
          </p>
        </section>

        <p className="text-neutral-400">{c.weights_note}</p>
        <p className="text-neutral-400">{c.note}</p>
      </div>
    </div>
  );
}

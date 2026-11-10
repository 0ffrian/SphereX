// D-36, Q-266: the formula formatter, the KaTeX fallback and the dialog.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { RenderParams } from '@/contract';
import { ConfidenceFormulaDialog } from '@/app/ConfidenceFormulaDialog';
import { renderLatex } from '@/app/FormulaMath';
import {
  GENERAL_LATEX,
  formulaTerms,
  gateLatex,
  num,
  substitutionLatex,
  substitutionPlain,
} from './confidenceFormula';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

type C = NonNullable<RenderParams['confidence']>;
function conf(over: Partial<C> = {}): C {
  return {
    score: 0.3,
    measured_share: 0.15,
    estimated_share: 0.15,
    assumed_share: 0.7,
    threshold: 0.25,
    band: 'mostly_assumed',
    gate: { class_known: true, key_measurement: true, score_ok: true, passed: true },
    found: 'Data for: Radius.',
    needed: '',
    raise: null,
    inputs: [
      { id: 'radius', label: 'Radius', weight: 40, c: 0.5, tag: 'model_dependent', points: 20, fields: [] },
      { id: 'mass', label: 'Mass', weight: 10, c: 1, tag: 'measured', points: 10, fields: [] },
      { id: 'storms', label: 'Storms', weight: 50, c: 0, tag: 'artistic', points: 0, fields: [] },
    ],
    tag: 'derived',
    formula: 'C',
    weights_note: 'Placeholder weights: they come from the approved prototype.',
    note: 'It is not the probability that the picture is correct.',
    ...over,
  };
}

describe('formula strings', () => {
  it('general formula is the D-36 one', () => {
    expect(GENERAL_LATEX).toBe('C = \\frac{\\sum_i w_i c_i}{\\sum_i w_i}');
  });
  it('substitutes the rows', () => {
    expect(substitutionLatex(conf())).toBe(
      'C = \\frac{40 \\cdot 0.5 + 10 \\cdot 1 + 50 \\cdot 0}{40 + 10 + 50} = \\frac{30}{100} \\approx 0.3',
    );
    expect(substitutionPlain(conf())).toContain('(40 x 0.5 + 10 x 1 + 50 x 0) / (40 + 10 + 50)');
  });
  it('no rows: only the backend value', () => {
    expect(substitutionLatex(conf({ inputs: [], score: 0 }))).toBe('C = 0');
  });
  it('gate uses the real threshold', () => {
    expect(gateLatex(0.25)).toBe('C \\ge 0.25');
    expect(gateLatex(0.3)).toBe('C \\ge 0.3');
  });
  it('num trims', () => {
    expect(num(0.12345678)).toBe('0.1235');
    expect(num(40)).toBe('40');
  });
  it('terms agree within tolerance, and flag a disagreement', () => {
    expect(formulaTerms(conf()).agrees).toBe(true);
    expect(formulaTerms(conf({ score: 0.6 })).agrees).toBe(false);
  });
});

describe('KaTeX', () => {
  it('renders htmlAndMathml', () => {
    const html = renderLatex(GENERAL_LATEX);
    expect(html).toContain('katex-mathml');
    expect(html).toContain('<math');
  });
  it('returns null (fallback) on bad LaTeX', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(renderLatex('\\frac{')).toBeNull();
  });
});

function mount(params: RenderParams, onClose = () => {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(host);
  act(() => root.render(<ConfidenceFormulaDialog params={params} onClose={onClose} />));
  return host;
}
const params = (c: C) => ({ confidence: c }) as unknown as RenderParams;

describe('the dialog', () => {
  it('shows formula, table, rule, rows, the backend value and the weights note', () => {
    const host = mount(params(conf()));
    const dlg = host.querySelector('[role="dialog"]')!;
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(host.querySelector('[data-testid="formula-general"] .katex')).not.toBeNull();
    expect(host.querySelector('[data-testid="formula-gate"]')!.textContent).toContain('0.25');
    expect(host.textContent).toContain('Radius');
    expect(host.querySelector('[data-testid="formula-result"]')!.textContent).toContain('30%');
    expect(host.textContent).toContain('Placeholder weights');
  });
  it('shows the backend value and warns when the rows disagree', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const host = mount(params(conf({ score: 0.6 })));
    expect(host.querySelector('[data-testid="formula-result"]')!.textContent).toContain('60%');
    expect(warn).toHaveBeenCalled();
  });
  it('closes on Escape and traps Tab', () => {
    const onClose = vi.fn();
    const host = mount(params(conf()), onClose);
    const btn = host.querySelector('button')!;
    expect(document.activeElement).toBe(btn);
    const dlg = host.querySelector('[role="dialog"]')!;
    act(() => {
      btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(btn); // only one focusable: wraps to itself
    act(() => {
      dlg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });
});

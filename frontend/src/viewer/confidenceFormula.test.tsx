// D-36, Q-266: the formula formatter, the KaTeX fallback and the dialog.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { RenderParams } from '@/contract';
import { ConfidencePopover } from '@/app/ConfidencePopover';
import { renderLatex } from '@/app/FormulaMath';
import {
  GENERAL_LATEX,
  formulaTerms,
  gateLatex,
  num,
  partOf,
  partShares,
  substitutionLatex,
  substitutionPlain,
  tagChip,
} from './confidenceFormula';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

type C = NonNullable<RenderParams['confidence']>;
function conf(over: Partial<C> = {}): C {
  return {
    score: 0.3,
    measured_share: 0.1,
    estimated_share: 0.2,
    assumed_share: 0.7,
    threshold: 0.25,
    band: 'mostly_assumed',
    gate: { class_known: true, key_measurement: true, score_ok: true, passed: true },
    found: 'Data for: Radius.',
    needed: '',
    raise: null,
    inputs: [
      {
        id: 'radius',
        label: 'Radius',
        weight: 40,
        c: 0.5,
        tag: 'model_dependent',
        points: 20,
        fields: [],
      },
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
  it('general formula is the mock-up one', () => {
    expect(GENERAL_LATEX).toBe('C=\\dfrac{\\sum_i w_i\\,c_i}{\\sum_i w_i}');
  });
  it('substitutes the rows and folds c = 0 terms into + 0', () => {
    expect(substitutionLatex(conf())).toBe(
      'C=\\dfrac{40\\cdot \\tfrac{1}{2}+10\\cdot 1+0}{100}=\\dfrac{30}{100}=0.30',
    );
    expect(substitutionPlain(conf())).toBe('C = (40·0.5 + 10·1 + 0) / 100 = 30 / 100 = 0.30');
  });
  it('no rows: only the backend value', () => {
    expect(substitutionLatex(conf({ inputs: [], score: 0 }))).toBe('C = 0.00');
  });
  it('the final value is the backend score, not the row sum', () => {
    expect(substitutionLatex(conf({ score: 0.6 }))).toMatch(/=0\.60$/);
  });
  it('gate uses the real threshold', () => {
    expect(gateLatex(0.25)).toContain('C\\ge 0.25');
    expect(gateLatex(0.3)).toContain('C\\ge 0.3');
  });
  it('num trims', () => {
    expect(num(0.12345678)).toBe('0.1235');
    expect(num(40)).toBe('40');
  });
  it('terms agree within tolerance, and flag a disagreement', () => {
    expect(formulaTerms(conf()).agrees).toBe(true);
    expect(formulaTerms(conf({ score: 0.6 })).agrees).toBe(false);
  });
  it('maps the real tags to the mock-up bar parts (Q-267)', () => {
    expect(partOf('measured')).toBe('d');
    expect(partOf('derived')).toBe('p');
    expect(partOf('model_dependent')).toBe('p');
    for (const t of ['inferred_from_analog', 'artistic', 'missing']) expect(partOf(t)).toBe('a');
    // Contributions to the score (the chip's and Details' shares), not shares of the weight.
    const sh = partShares(conf());
    expect(sh.d).toBeCloseTo(0.1);
    expect(sh.p).toBeCloseTo(0.2);
    expect(sh.a).toBeCloseTo(0.7);
    expect(sh.d + sh.p).toBeCloseTo(conf().score);
  });
  it('chips follow the mock-up wording', () => {
    const i = conf().inputs;
    expect(tagChip(i[0]!).text).toBe('Physics, from a model');
    expect(tagChip(i[1]!).text).toBe('Satellite data');
    expect(tagChip(i[2]!).text).toBe('Assumed, drawn');
    expect(tagChip({ ...i[0]!, tag: 'derived', c: 0.5 }).text).toBe('Physics, one input assumed');
    // D-02: an analog value wears the Estimated badge, so its chip says so too.
    expect(tagChip({ ...i[0]!, tag: 'inferred_from_analog', c: 0 }).text).toBe(
      'Estimated, from a similar object',
    );
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

function mount(params: RenderParams, onClose = () => {}, inline = false) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(host);
  act(() => root.render(<ConfidencePopover params={params} onClose={onClose} inline={inline} />));
  return host;
}
const params = (c: C) => ({ confidence: c }) as unknown as RenderParams;

describe('the inline popover (build pane, issue #71 stream U)', () => {
  it('is a plain group inside the pane: no dialog, no backdrop, no Close button, same content', () => {
    const host = mount(params(conf()), () => {}, true);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('[data-testid="confidence-formula-backdrop"]')).toBeNull();
    expect(host.querySelector('.sx-acc-close')).toBeNull();
    const group = host.querySelector('[data-testid="confidence-formula"]')!;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-labelledby')).toBeTruthy();
    expect(group.querySelector('[data-testid="formula-result"]')!.textContent).toContain('30%');
    expect(group.querySelectorAll('.sx-acc-tbl tbody tr')).toHaveLength(3);
  });
});

describe('Show level in the Accuracy panel', () => {
  it('dims rows the level hides and leaves the score and points alone', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const c = conf();
    const first = c.inputs[0]!.tag;
    act(() =>
      createRoot(host).render(
        <ConfidencePopover
          params={params(c)}
          onClose={() => {}}
          inline
          isShown={(t) => t !== first}
        />,
      ),
    );
    expect(host.querySelectorAll('tr[data-dim="true"]').length).toBeGreaterThan(0);
    expect(host.querySelector('[data-testid="formula-result"]')!.textContent).toContain('30%');
    expect(host.textContent).toContain('the score does not move');
  });
});

describe('the popover', () => {
  it('has the mock-up sections in order and the backend value', () => {
    const host = mount(params(conf()));
    const dlg = host.querySelector('[role="dialog"]')!;
    expect(dlg.querySelector('.sx-pop-h')!.textContent).toContain('Accuracy');
    expect(dlg.querySelector('[data-testid="formula-result"]')!.textContent).toContain('30%');
    expect(dlg.querySelector('.sx-acc-bar')!.getAttribute('aria-label')).toBe(
      'Measured 10 percent, physics 20 percent, assumed 70 percent',
    );
    expect(dlg.querySelector('[data-testid="formula-general"] .katex')).not.toBeNull();
    expect(dlg.querySelector('[data-testid="formula-gate"]')!.textContent).toContain('0.25');
    const gv = Array.from(dlg.querySelectorAll('.sx-acc-gv')).map((e) => e.textContent);
    expect(gv).toEqual(['Yes', 'Yes', 'Yes']);
    expect(dlg.textContent).toContain('The 3D body is drawn.');
    expect(dlg.querySelectorAll('.sx-acc-tbl tbody tr')).toHaveLength(3);
    expect(dlg.textContent).toContain('20 / 40');
    expect(dlg.textContent).toContain('Placeholder weights');
  });
  it('shows No chips when the gate fails', () => {
    const host = mount(
      params(
        conf({
          gate: { class_known: true, key_measurement: false, score_ok: false, passed: false },
        }),
      ),
    );
    expect(Array.from(host.querySelectorAll('.sx-acc-gv')).map((e) => e.textContent)).toEqual([
      'Yes',
      'No',
      'No',
    ]);
    expect(host.textContent).toContain('The 3D body is not drawn.');
  });
  it('shows the backend value and warns when the rows disagree', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const host = mount(params(conf({ score: 0.6 })));
    expect(host.querySelector('[data-testid="formula-result"]')!.textContent).toContain('60%');
    expect(warn).toHaveBeenCalled();
    expect(host.querySelector('[data-testid="formula-disagree"]')!.textContent).toContain('do not add up');
  });
  it('closes on Escape and traps Tab', () => {
    const onClose = vi.fn();
    const host = mount(params(conf()), onClose);
    const btn = host.querySelector('button')!;
    expect(document.activeElement).toBe(btn);
    const dlg = host.querySelector('[role="dialog"]')!;
    act(() => {
      btn.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      );
    });
    expect(document.activeElement).toBe(btn);
    act(() => {
      dlg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });
});

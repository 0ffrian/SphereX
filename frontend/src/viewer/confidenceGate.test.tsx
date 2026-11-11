// D-36 stream B: the confidence gate in the plan, and the chip and breakdown.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import type { RenderParams } from '@/contract';
import { ConfidenceChip, ConfidenceDetails } from '@/app/ConfidencePanel';
import { fixture } from '@/test/sharedFixtures';
import { gateRefusal, inputBadge, percent } from './confidenceGate';
import { defaultContext, planRender } from './renderPlan';
import { HONESTY_STATES } from './honesty';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

function conf(passed: boolean): NonNullable<RenderParams['confidence']> {
  return {
    score: passed ? 0.54 : 0.15,
    measured_share: 0.4,
    estimated_share: passed ? 0.14 : 0.0,
    assumed_share: 0.46,
    threshold: 0.25,
    band: passed ? 'part_data' : 'too_little',
    gate: { class_known: true, key_measurement: passed, score_ok: passed, passed },
    found: 'Data for: Sun direction.',
    needed: passed ? '' : 'At least one key measurement: a gas measurement or a coma size.',
    raise: passed ? 'A better measurement of: radius.' : null,
    inputs: [
      { id: 'radius', label: 'Radius', weight: 15, c: 1, tag: 'measured', points: 15, fields: [] },
      { id: 'storms', label: 'Storms', weight: 15, c: 0, tag: 'artistic', points: 0, fields: [] },
      { id: 'gas', label: 'Gas', weight: 25, c: 0, tag: 'missing', points: 0, fields: [] },
    ],
    tag: 'derived',
    formula: 'C',
    weights_note: 'Placeholder weights.',
    note: 'It is not the probability that the picture is correct.',
  };
}

describe('the confidence gate in the plan', () => {
  const { card, params } = fixture('star');
  it('draws the body with no confidence block or a passed gate', () => {
    expect(planRender(card, params, defaultContext()).threeD).toBe(true);
    expect(planRender(card, { ...params, confidence: conf(true) }, defaultContext()).threeD).toBe(
      true,
    );
  });
  it('refuses with found and needed when the gate failed, at every Show level', () => {
    const p = { ...params, confidence: conf(false) };
    expect(gateRefusal(p)).toContain('Needed: At least one key measurement');
    for (const honesty of HONESTY_STATES) {
      const plan = planRender(card, p, defaultContext({ honesty }));
      expect(plan.threeD).toBe(false);
      expect(plan.message).toContain('Found: Data for: Sun direction.');
    }
  });
  it('words', () => {
    expect(percent(0.545)).toBe(55);
    expect(inputBadge('model_dependent')).toBe('Estimated');
    expect(inputBadge('missing')).toBe('Missing');
  });
});

describe('chip and breakdown', () => {
  const { params } = fixture('star');
  function mount(node: React.ReactNode): HTMLDivElement {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => createRoot(host).render(node));
    return host;
  }
  it('shows the score, the table and the not-a-probability note', () => {
    const p = { ...params, confidence: conf(true) };
    const chip = mount(<ConfidenceChip params={p} onOpen={() => {}} />);
    expect(chip.textContent).toContain('54%');
    const d = mount(<ConfidenceDetails params={p} />);
    expect(d.textContent).toContain('Part data, part assumed');
    expect(d.textContent).toContain('not the probability');
    expect(d.querySelectorAll('tbody tr')).toHaveLength(3);
  });
  it('shows the three gates for a refusal and no chip', () => {
    const p = { ...params, confidence: conf(false) };
    expect(mount(<ConfidenceChip params={p} onOpen={() => {}} />).textContent).toBe('');
    const d = mount(<ConfidenceDetails params={p} />);
    expect(d.textContent).toContain('Why there is no 3D model');
    expect(d.textContent).toContain('at least 25% (now 15%)');
  });
});

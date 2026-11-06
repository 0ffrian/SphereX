import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RefusalList } from './RefusalList';
import { groupMissing } from './refusals';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

// Test data only.
const MISSING = [
  'saturated:f002',
  'saturated:f000',
  'saturated:f001',
  'aperture_edge:f009',
  'zzz_new:abc',
  'spectrum:new_thing',
];

describe('RefusalList', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = (codes: string[]) =>
    act(() =>
      root.render(
        <RefusalList groups={groupMissing(codes)} lead="Frames not measured:" testId="list" />,
      ),
    );

  it('renders nothing for no codes', () => {
    render([]);
    expect(host.innerHTML).toBe('');
  });

  it('shows one disclosure per reason with its count, and notes as plain lines', () => {
    render(MISSING);
    const groups = [...host.querySelectorAll('[data-testid="refusal-group"]')];
    expect(groups.map((g) => g.getAttribute('data-reason'))).toEqual([
      'saturated',
      'aperture_edge',
      'zzz_new',
    ]);
    expect(groups[0]!.querySelector('summary')!.textContent).toBe(
      '3 frames where the detector flagged the object’s centre as saturated or unusable. (show frame IDs)',
    );
    expect(groups[2]!.querySelector('summary')!.textContent).toContain('reason code “zzz_new”');
    const notes = [...host.querySelectorAll('[data-testid="refusal-note"]')];
    expect(notes.map((n) => n.textContent)).toEqual(['Not available: spectrum:new_thing']);
  });

  it('labels the list with the lead line', () => {
    render(MISSING);
    const lead = host.querySelector('p')!;
    expect(lead.textContent).toBe('Frames not measured:');
    expect(lead.className).toContain('font-medium');
    const list = host.querySelector('ul')!;
    expect(list.getAttribute('aria-labelledby')).toBe(lead.id);
    expect(list.getAttribute('role')).toBe('list');
  });

  it('has no lead line when there are only notes', () => {
    render(['frames:moving_object_search']);
    expect(host.querySelector('p')).toBeNull();
    expect(host.querySelector('ul')!.hasAttribute('aria-labelledby')).toBe(false);
    expect(host.textContent).toContain('Frames for moving Solar System objects');
  });

  it('renders the frame IDs only once the group is opened', () => {
    render(MISSING);
    const details = host.querySelector<HTMLDetailsElement>('[data-testid="refusal-group"]')!;
    expect(details.open).toBe(false);
    expect(host.textContent).not.toContain('f000');
    act(() => {
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    });
    const region = details.querySelector('[data-testid="refusal-ids"]')!;
    expect(region.getAttribute('role')).toBe('region');
    expect(region.getAttribute('aria-label')).toBe('Frames not measured, frame IDs: saturated');
    // The flipbook's keys stay with the scroll box (Flipbook CONTROL_TAGS).
    expect(region.hasAttribute('data-own-keys')).toBe(true);
    expect(region.querySelector('ul')!.getAttribute('role')).toBe('list');
    expect(region.getAttribute('tabindex')).toBe('0');
    expect([...region.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'f000',
      'f001',
      'f002',
    ]);
    expect(details.querySelector('summary')!.textContent).toContain('(hide frame IDs)');
  });
});

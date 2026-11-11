import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildControls, useBuildControls, type BuildControlsSpec } from './BuildControls';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

function Owner({ spec }: { spec: BuildControlsSpec | null }) {
  useBuildControls('test', spec);
  return null;
}

describe('BuildControls slot', () => {
  it('shows nothing until a renderer registers, then its controls, and drops them on unmount', async () => {
    const onAge = vi.fn();
    const onFlare = vi.fn();
    const spec: BuildControlsSpec = {
      title: 'Surface',
      controls: [
        { kind: 'slider', id: 'age', label: 'Surface age', min: 0, max: 10, value: 4, valueText: '4 Myr', tag: 'artistic', onChange: onAge },
        { kind: 'button', id: 'f', label: 'Fire a big flare', onClick: onFlare },
        { kind: 'toggle', id: 'p', label: 'Pause', pressed: false, disabled: true, why: 'Nothing moves here.', onChange: () => {} },
      ],
      notes: [{ title: 'How it is worked out', lines: ['a'], placeholder: 'Placeholders.' }],
    };
    await act(async () => root.render(<><BuildControls /><Owner spec={null} /></>));
    expect(host.querySelector('[data-testid="build-controls"]')).toBeNull();
    await act(async () => root.render(<><BuildControls /><Owner spec={spec} /></>));
    const region = host.querySelector('[data-testid="build-controls"]')!;
    expect(region.textContent).toContain('Surface age');
    expect(region.querySelector('[data-testid="provenance-badge"]')!.textContent).toBe('Default');
    const slider = region.querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider.getAttribute('aria-valuetext')).toBe('4 Myr');
    const buttons = [...region.querySelectorAll('button')];
    await act(async () => buttons.find((b) => b.textContent === 'Fire a big flare')!.click());
    expect(onFlare).toHaveBeenCalled();
    const pause = buttons.find((b) => b.textContent === 'Pause')!;
    expect(pause.disabled).toBe(true);
    expect(pause.getAttribute('aria-label')).toBe('Pause. Nothing moves here.');
    await act(async () => root.render(<BuildControls />));
    expect(host.querySelector('[data-testid="build-controls"]')).toBeNull();
  });
});

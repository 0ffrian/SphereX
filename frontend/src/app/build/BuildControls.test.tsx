import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildControls, BuildSummaryRows, useBuildControls, type BuildControlsSpec } from './BuildControls';

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
        {
          kind: 'slider',
          id: 'age',
          label: 'Surface age',
          min: 0,
          max: 10,
          value: 4,
          valueText: '4 Myr',
          tag: 'artistic',
          onChange: onAge,
        },
        { kind: 'button', id: 'f', label: 'Fire a big flare', onClick: onFlare },
        {
          kind: 'toggle',
          id: 'p',
          label: 'Pause',
          pressed: false,
          disabled: true,
          why: 'Nothing moves here.',
          onChange: () => {},
        },
      ],
      notes: [{ title: 'How it is worked out', lines: ['a'], placeholder: 'Placeholders.' }],
    };
    await act(async () =>
      root.render(
        <>
          <BuildControls />
          <Owner spec={null} />
        </>,
      ),
    );
    expect(host.querySelector('[data-testid="build-controls"]')).toBeNull();
    await act(async () =>
      root.render(
        <>
          <BuildControls />
          <Owner spec={spec} />
        </>,
      ),
    );
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

describe('choices are ToggleGroups; the about-slot ones live in "About this flare"', () => {
  it('draws a choice as a ToggleGroup with no outlined badge, and moves slot "about" choices into the closed row', async () => {
    const onKind = vi.fn();
    const spec: BuildControlsSpec = {
      title: 'Close-up',
      controls: [
        { kind: 'choice', id: 'light', label: 'Light', value: 'a', options: [{ value: 'a', label: 'True colour' }, { value: 'b', label: 'Enhanced' }], tag: 'artistic', onChange: () => {} },
        { kind: 'choice', id: 'kind', slot: 'about', label: 'Flare type', value: 'closed', options: [{ value: 'closed', label: 'Closed' }, { value: 'open', label: 'Open' }], onChange: onKind },
        { kind: 'readout', id: 'where', slot: 'where', label: 'Looking at', value: 'Looking at 12\u00b0 N, 40\u00b0 E \u00b7 quiet' },
      ],
    };
    await act(async () =>
      root.render(
        <>
          <Owner spec={spec} />
          <BuildControls />
          <BuildSummaryRows />
        </>,
      ),
    );
    const ctl = host.querySelector('[data-testid="build-controls"]')!;
    expect(ctl.querySelector('.sx-seg')).not.toBeNull();
    expect(ctl.textContent).toContain('True colour');
    expect(ctl.textContent).not.toContain('Flare type');
    expect(ctl.textContent).not.toContain('Looking at');
    expect(ctl.querySelector('.sx-badge, [data-tag]:not(.sx-tag)')).toBeNull();
    const about = host.querySelector('[data-testid="about-flare-row"]')!;
    expect(about.textContent).toContain('Flare type');
    const open = [...about.querySelectorAll('button')].find((b) => b.textContent === 'Open')!;
    await act(async () => open.click());
    expect(onKind).toHaveBeenCalledWith('open');
  });
});

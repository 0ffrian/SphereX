import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpectrumPoint } from '@/app/api/types';
import { chartSummary, pointText, SpectrumChart } from './SpectrumChart';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

// Test data only, not physical claims.
const points: SpectrumPoint[] = [
  { wavelength_um: 0.8, flux: 2, error: 0.2, flagged: false, frame_id: 'f0' },
  { wavelength_um: 1.6, flux: 3, error: 0.3, flagged: true, frame_id: 'f1' },
  { wavelength_um: 2.4, flux: 2.5, error: 0, flagged: false, frame_id: 'f2' },
  { wavelength_um: 4.9, flux: 1.5, error: 0.1, flagged: false, frame_id: 'f3' },
];

describe('SpectrumChart', () => {
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

  const render = (onSelectFrame?: (id: string) => void) =>
    act(() =>
      root.render(
        <SpectrumChart
          points={points}
          fluxUnit="mJy"
          objectName="Test object"
          selectedFrameId="f3"
          {...(onSelectFrame ? { onSelectFrame } : {})}
        />,
      ),
    );

  it('draws one error bar per point with a non-zero error, and marks flagged points', () => {
    render();
    expect(host.querySelectorAll('[data-testid="error-bar"]')).toHaveLength(3);
    expect(host.querySelectorAll('[data-testid="flagged-point"]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-testid="point"]')).toHaveLength(3);
  });

  it('has an accessible summary and a legend naming the flagged marker', () => {
    render();
    const svg = host.querySelector('[data-testid="spectrum-chart"]')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe(
      'Spectrum of Test object: 4 points from 0.800 µm to 4.900 µm, 1 flagged. The data table below lists every point.',
    );
    expect(host.querySelector('[data-testid="chart-legend"]')!.textContent).toMatch(
      /Flagged by the pipeline/,
    );
    expect(host.textContent).toMatch(/Flux \(mJy\)/);
    expect(host.textContent).toMatch(/Wavelength \(µm\)/);
  });

  it('selects a frame when a point is clicked', () => {
    const onSelect = vi.fn();
    render(onSelect);
    const hits = host.querySelectorAll('circle[fill="transparent"]');
    expect(hits).toHaveLength(4);
    act(() => hits[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onSelect).toHaveBeenCalledWith('f1');
  });

  it('describes points and empty spectra in text', () => {
    expect(pointText(points[1]!, 'mJy')).toBe('1.600 µm: 3 ± 0.3 mJy, flagged');
    expect(chartSummary([], 'X')).toBe('Spectrum of X: no points.');
  });

  // Review findings 1 and 8: near-identical wavelengths hung the tick loop; one point padded by ±1.
  it('renders points at near-identical wavelengths and a single point', () => {
    const close: SpectrumPoint[] = [
      { wavelength_um: 1, flux: 2, error: 0, flagged: false, frame_id: 'a' },
      { wavelength_um: 1.0000000000000002, flux: 2, error: 0, flagged: false, frame_id: 'b' },
    ];
    act(() => root.render(<SpectrumChart points={close} fluxUnit="mJy" objectName="X" />));
    expect(host.querySelectorAll('[data-testid="point"]')).toHaveLength(2);
    const single: SpectrumPoint[] = [
      { wavelength_um: 0.8, flux: 1e-17, error: 0, flagged: false, frame_id: 'a' },
    ];
    act(() => root.render(<SpectrumChart points={single} fluxUnit="W/m2/um" objectName="X" />));
    const labels = [...host.querySelectorAll('svg text')].map((t) => t.textContent);
    expect(labels).not.toContain('0');
    expect(labels).not.toContain('-1');
  });
});

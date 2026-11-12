import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useAreaStore } from '@/app/shell/areaStore';
import { KnownPositionsLayer } from './KnownPositionsLayer';

vi.mock('@/app/sky/areaDraw', () => ({
  // RA 50 is behind the camera: no pixel.
  skyToPixels: (ra: number) => (ra === 50 ? null : { x: ra, y: 10 }),
}));

describe('KnownPositionsLayer', () => {
  it('draws no line across a position that is behind the camera', () => {
    const t = (n: number) => `2026-03-20T08:3${n}:00.000Z`;
    const positions = [10, 11, 50, 12, 13].map((ra, i) => ({ frame_id: `f${i}`, time: t(i), ra, dec: 1 }));
    useAreaStore.setState({
      flow: 'known',
      screen: 'list',
      refusal: null,
      known: { demo: false, objects: [{ id: '1', name: 'A', kind: 'asteroid', frames: 5, visits: 1, designation: '1 A', positions }] },
    });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    act(() => createRoot(container).render(<KnownPositionsLayer view={null} />));
    expect(container.querySelectorAll('polyline')).toHaveLength(2);
    expect(container.querySelectorAll('[data-testid="known-position"]')).toHaveLength(4);
  });
});

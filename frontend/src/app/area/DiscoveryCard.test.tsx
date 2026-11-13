// Issue #96 / Q-205: a prepared area's Discovery card says it is precomputed (and test data for a
// synthetic fixture), lists what is missing, wears no "Demo data" tag and opens the stored track.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAreaStore } from '@/app/shell/areaStore';
import { areaFixture, areaIndexFixture } from '@/test/areaFixtures';
import { realMovers, realSteps, type DiscoveryResult } from './areaService';
import { DiscoveryCard, MoverCard } from './DiscoveryCard';
import type { RealDiscovery } from './realArea';

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
  useAreaStore.getState().reset();
});

function realDisc(missing: string[] = []): DiscoveryResult {
  const f = areaFixture('multivisit');
  const real: RealDiscovery = {
    entry: areaIndexFixture().areas[1]!,
    summary: f.summary,
    dots: f.dots,
    tracks: f.tracks,
    missing,
    synthetic: true,
  };
  return { demo: false, real, steps: realSteps(real), dots: [], movers: realMovers(real) };
}

const box = {
  a: { ra: 209.8, dec: -19.8 },
  b: { ra: 210.2, dec: -20.2 },
  widthDeg: 0.4,
  heightDeg: 0.4,
};

describe('DiscoveryCard with a prepared area', () => {
  it('says precomputed and test data, lists the missing parts, and has no demo tag', async () => {
    const disc = realDisc(['area:tracks_unavailable', 'skybot:2']);
    useAreaStore.setState({ box, disc, screen: 'disc', step: 4, running: false });
    await act(async () => root.render(<DiscoveryCard />));
    expect(host.querySelector('[data-testid="area-precomputed"]')?.textContent).toMatch(
      /^Precomputed · run /,
    );
    expect(host.querySelector('[data-testid="area-test-data"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="demo-tag"]')).toBeNull();
    const items = [...host.querySelectorAll('[data-testid="area-missing"] li')];
    expect(items.map((li) => li.getAttribute('data-code'))).toEqual([
      'area:tracks_unavailable',
      'skybot:2',
    ]);
    expect(host.textContent).not.toMatch(/\(demo\)/);
  });

  it('offers each visit of a multi-visit area', async () => {
    useAreaStore.setState({ box, disc: realDisc(), screen: 'disc', step: 4, running: false });
    await act(async () => root.render(<DiscoveryCard />));
    const visits = areaFixture('multivisit').summary.n_visits;
    expect(host.querySelectorAll('[data-testid^="area-visit-"]')).toHaveLength(visits);
  });

  it('opens the stored track, not the demo mover card', async () => {
    useAreaStore.setState({ box, disc: realDisc(), screen: 'mover', sel: 0, step: 4 });
    await act(async () => root.render(<MoverCard />));
    expect(host.querySelector('[data-testid="real-track-card"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="mover-card"]')).toBeNull();
  });
});

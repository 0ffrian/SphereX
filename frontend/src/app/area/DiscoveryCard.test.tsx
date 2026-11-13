// Issue #96 / Q-205: a prepared area's Discovery card says it is precomputed (and test data for a
// synthetic fixture), lists what is missing, wears no "Demo data" tag and opens the stored track.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAreaStore } from '@/app/shell/areaStore';
import { useShellStore } from '@/app/shell/shellStore';
import { useAppStore } from '@/state/store';
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
      /^Precomputed · \d+ \w{3} \d{4} \d\d:\d\d UTC · /,
    );
    expect(host.querySelector('[data-testid="area-visits"]')?.textContent).toMatch(/visits|Visits/);
    // Plan answer 4: until the checks D4 to D7 exist, every Discovery result says so.
    const rates = host.querySelector('[data-testid="disc-rates"]')!;
    expect(rates.querySelector('b')?.textContent).toBe('Detection rates not measured yet');
    expect(rates.getAttribute('data-tone')).toBe('warn');
    expect(host.querySelector('[data-testid="disc-export"]')?.getAttribute('href')).toBe(
      `/v1/areas/${encodeURIComponent(disc.real!.entry.area_id)}/export.ecsv`,
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

  it('says nothing about rates while the steps run', async () => {
    useAreaStore.setState({ box, disc: realDisc(), screen: 'disc', step: 1, running: true });
    await act(async () => root.render(<DiscoveryCard />));
    expect(host.querySelector('[data-testid="disc-rates"]')).toBeNull();
  });

  it('a live area says "Computed live"', async () => {
    const disc = realDisc();
    disc.real = { ...disc.real!, entry: { ...disc.real!.entry, area_id: 'live-0123456789ab' } };
    useAreaStore.setState({ box, disc, screen: 'disc', step: 4, running: false });
    await act(async () => root.render(<DiscoveryCard />));
    expect(host.querySelector('[data-testid="area-precomputed"]')?.textContent).toMatch(/^Computed live · /);
  });

  it('opens the stored track, not the demo mover card', async () => {
    useAreaStore.setState({ box, disc: realDisc(), screen: 'mover', sel: 0, step: 4 });
    await act(async () => root.render(<MoverCard />));
    expect(host.querySelector('[data-testid="real-track-card"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="mover-card"]')).toBeNull();
  });

  it('a track no known object explains: Track it off (orbit not known), Build it the placeholder', async () => {
    const disc = realDisc();
    const i = disc.movers.findIndex((m) => m.track && !m.track.match);
    expect(i).toBeGreaterThanOrEqual(0);
    useAreaStore.setState({ box, disc, screen: 'mover', sel: i, step: 4 });
    await act(async () => root.render(<MoverCard />));
    const track = host.querySelector<HTMLButtonElement>('[data-testid="track-track"]')!;
    expect(track.disabled).toBe(true);
    expect(host.querySelector('[data-testid="track-no-orbit"]')?.textContent).toBe('Orbit not known');
    await act(async () => host.querySelector<HTMLElement>('[data-testid="track-build"]')!.click());
    expect(useShellStore.getState().build.open).toBe(true);
    const card = useAppStore.getState().card;
    expect(card?.id).toBe(`area:${disc.real!.entry.area_id}:${disc.movers[i]!.id}`);
    expect(useAppStore.getState().params?.layers.map((l) => [l.id, l.tag])).toEqual([['placeholder_shape', 'artistic']]);
    useShellStore.getState().closeBuild();
  });

  it('a track matched to a known object: Track it computes its Track around the track\'s own frame times', async () => {
    const disc = realDisc();
    const i = 0;
    const m0 = disc.movers[i]!;
    // Held UI issue 1: SkyBoT's designation already holds the number; never "433 433 Eros".
    const match = { designation: '433 Eros', number: 433, object_id: 'sbdb-9', v_mag: 11.2, median_sep_px: 0.31, fetched_at: '2026-11-13T07:00:00Z' };
    disc.movers[i] = { ...m0, known: '433 Eros', track: { ...m0.track!, verdict: 'found_blind', match } };
    const openTrack = vi.fn();
    useAreaStore.setState({ box, disc, screen: 'mover', sel: i, step: 4, openTrack });
    await act(async () => root.render(<MoverCard />));
    const btn = host.querySelector<HTMLButtonElement>('[data-testid="track-track"]')!;
    expect(btn.disabled).toBe(false);
    await act(async () => btn.click());
    expect(openTrack).toHaveBeenCalledTimes(1);
    const [obj, around] = openTrack.mock.calls[0]!;
    expect(obj.objectId).toBe('sbdb-9');
    expect(Date.parse(around)).toBeGreaterThan(0);
    expect(host.querySelector('[data-testid="track-known"]')?.textContent).toBe('433 Eros · 0.31 px from predicted');
    expect(host.textContent).not.toContain('433 433');
  });
});

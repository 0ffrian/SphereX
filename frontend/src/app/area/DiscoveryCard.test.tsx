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
    spectra: null,
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

// Issue #162 (A18.7): the spectrum check on the results rows and the Result card.
import MOCK_SPECTRA from './spectraMock.json';
import type { AreaSpectra } from './spectraApi';

/** The multivisit fixture (one track) with a spectrum check: a mock-up track (default T3: rock, heat glow) on it. */
function spectrumDisc(pick: readonly string[] = ['T3']): DiscoveryResult {
  const f = areaFixture('multivisit');
  const mock = structuredClone(MOCK_SPECTRA) as unknown as AreaSpectra;
  const tracks = f.tracks.tracks.map((t, i) => ({
    ...mock.tracks.find((m) => m.track_id === pick[i % pick.length])!,
    track_id: t.track_id,
  }));
  const real: RealDiscovery = {
    entry: areaIndexFixture().areas[1]!,
    summary: f.summary,
    dots: f.dots,
    tracks: f.tracks,
    spectra: { ...mock, tracks },
    missing: [],
    synthetic: true,
  };
  return { demo: false, real, steps: realSteps(real), dots: [], movers: realMovers(real) };
}

describe('the spectrum check', () => {
  afterEach(() => useAppStore.setState({ honesty: 'derived' }));

  it('adds the step, and each row ends in a dot and one word once it is done', async () => {
    const disc = spectrumDisc();
    const at = disc.steps.findIndex((s) => s.label === 'Check the spectrum');
    expect(at).toBe(disc.steps.length - 1);
    useAreaStore.setState({ box, disc, screen: 'disc', step: at - 1, running: true });
    await act(async () => root.render(<DiscoveryCard />));
    expect(host.querySelectorAll('[data-testid="spectrum-word"]')).toHaveLength(0);
    await act(async () => useAreaStore.setState({ step: at, running: false }));
    const words = [...host.querySelectorAll('[data-testid="spectrum-word"]')];
    expect(words).toHaveLength(disc.movers.length);
    expect(words[0]!.textContent).toBe('Rock-like');
    expect(words[0]!.getAttribute('data-tone')).toBe('ok');
    // The verdict is extra: the stored chip stays, and so does the order.
    expect(host.querySelectorAll('[data-testid^="disc-mover-"] .sx-chip')).toHaveLength(disc.movers.length);
    expect(host.querySelector('[data-testid="disc-steps"]')?.textContent).toContain('Check the spectrum');
  });

  it('the filter gains Rock-like n', async () => {
    const disc = spectrumDisc();
    useAreaStore.setState({ box, disc, screen: 'disc', step: disc.steps.length - 1, running: false });
    await act(async () => root.render(<DiscoveryCard />));
    const rock = host.querySelector<HTMLElement>('[data-testid="disc-filter-rock"]')!;
    const n = disc.movers.filter((m) => m.spectrum?.verdict === 'rock').length;
    expect(rock.textContent).toBe(`Rock-like ${n}`);
    await act(async () => rock.click());
    expect(host.querySelectorAll('[data-testid^="disc-mover-"]')).toHaveLength(n);
  });

  it('the demo path shows no spectrum check', async () => {
    const disc = realDisc();
    useAreaStore.setState({ box, disc: { ...disc, demo: true, real: null }, screen: 'disc', step: 4, running: false });
    await act(async () => root.render(<DiscoveryCard />));
    expect(host.querySelector('[data-testid="spectrum-word"]')).toBeNull();
    expect(host.querySelector('[data-testid="disc-filter"]')).toBeNull();
    expect(host.textContent).not.toContain('Check the spectrum');
  });

  it('the Result card: verdict, chart (role img with a label), rows and the accordion', async () => {
    useAreaStore.setState({ box, disc: spectrumDisc(), screen: 'mover', sel: 0, step: 5 });
    await act(async () => root.render(<MoverCard />));
    const v = host.querySelector('[data-testid="spectrum-verdict"]')!;
    expect(v.querySelector('b')?.textContent).toBe('Looks like sunlight off a rock');
    expect(v.textContent).toContain('Includes heat glow, as expected 1.16 AU from the Sun.');
    const chart = host.querySelector('[data-testid="spectrum-chart"]')!;
    expect(chart.getAttribute('role')).toBe('img');
    expect(chart.getAttribute('aria-label')).toMatch(/14 points.*Looks like sunlight off a rock/);
    expect(host.querySelector('[data-testid="spectrum-band"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="spectrum-glow"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="spectrum-distance"]')?.textContent).toBe('1.16 AU from the Sun, from its parallax');
    expect(host.querySelector('[data-testid="spectrum-section"] [data-testid="provenance-badge"]')?.getAttribute('data-tag')).toBe('model_dependent');
    // The accordion: the formula (KaTeX, MathML for screen readers) and Points used n.
    const how = host.querySelector('[data-testid="spectrum-how"] button')!;
    expect(how.getAttribute('aria-expanded')).toBe('false');
    await act(async () => (how as HTMLElement).click());
    expect(how.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[data-testid="spectrum-formula"] math')).not.toBeNull();
    expect(host.querySelector('[data-testid="spectrum-points"] button')?.textContent).toContain('14');
    expect(host.querySelectorAll('[data-testid="spectrum-points-list"] li')).toHaveLength(14);
  });

  it('Measured only hides the verdict, the range, the heat glow and the Distance row', async () => {
    useAppStore.setState({ honesty: 'measured' });
    useAreaStore.setState({ box, disc: spectrumDisc(), screen: 'mover', sel: 0, step: 5 });
    await act(async () => root.render(<MoverCard />));
    expect(host.querySelector('[data-testid="spectrum-verdict"]')).toBeNull();
    expect(host.querySelector('[data-testid="spectrum-band"]')).toBeNull();
    expect(host.querySelector('[data-testid="spectrum-glow"]')).toBeNull();
    expect(host.querySelector('[data-testid="spectrum-sun"]')).toBeNull();
    expect(host.querySelector('[data-testid="spectrum-distance"]')).toBeNull();
    const chart = host.querySelector('[data-testid="spectrum-chart"]')!;
    expect(chart.getAttribute('data-measured-only')).toBe('true');
    expect(chart.querySelectorAll('[data-testid="spectrum-point"]')).toHaveLength(14);
  });

  it('One colour: no chart, the Steady row only', async () => {
    const disc = spectrumDisc(['T5']);
    const i = disc.movers.findIndex((m) => m.spectrum?.verdict === 'one_colour');
    expect(i).toBe(0);
    useAreaStore.setState({ box, disc, screen: 'mover', sel: i, step: 5 });
    await act(async () => root.render(<MoverCard />));
    expect(host.querySelector('[data-testid="spectrum-verdict"] b')?.textContent).toBe('One colour only');
    expect(host.querySelector('[data-testid="spectrum-chart"]')).toBeNull();
    expect(host.querySelector('[data-testid="spectrum-steady"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="spectrum-colour"]')).toBeNull();
  });
});

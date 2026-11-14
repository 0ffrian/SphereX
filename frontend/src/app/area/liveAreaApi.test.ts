// The live area job API (issue #144): the contract's reply checks, the HTTP client and the mock.
import { describe, expect, it, vi } from 'vitest';
import {
  httpLiveAreaApi,
  LiveJobGone,
  liveBoxOf,
  mockFromEnv,
  mockLiveAreaApi,
  mockStatusAt,
  parsePlanReply,
  parseStartReply,
  parseStatusReply,
  type LivePlan,
} from './liveAreaApi';

const PLAN = {
  area_id: 'live-1',
  release: 'spherex_dr1',
  visits: [
    { start: '2026-06-12T11:11:00Z', end: '2026-06-12T11:24:00Z', n_frames: 7 },
    { start: '2026-06-12T12:49:00Z', end: '2026-06-12T13:02:00Z', n_frames: 7 },
  ],
  n_frames: 14,
  estimate_s: 540,
  box: { ra: 30, dec: 10, width_deg: 1, height_deg: 0.6 },
  alternatives: [],
  provenance: { visits: { tag: 'measured', source: 'test', formula: 'test' } },
};
const BOX = { ra: 30, dec: 10, width_deg: 1, height_deg: 0.6 };

const reply = (body: unknown, status = 200, type = 'application/json') =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type } });

describe('reply checks', () => {
  it('a plan, a stored area and each error code', () => {
    expect(parsePlanReply(PLAN)).toEqual({ kind: 'plan', plan: PLAN });
    expect(parsePlanReply({ area_id: 'x', state: 'done' })).toEqual({ kind: 'stored', areaId: 'x' });
    for (const code of ['area:no_visit_pair', 'upstream_unavailable', 'offline'])
      expect(parsePlanReply({ error: code, detail: 'd' })).toEqual({ kind: 'error', code, detail: 'd' });
  });
  it('anything else is "unavailable", never a made-up plan', () => {
    expect(parsePlanReply(null)).toEqual({ kind: 'unavailable' });
    expect(parsePlanReply({ detail: 'Not Found' })).toEqual({ kind: 'unavailable' });
    expect(parsePlanReply({ error: 'not_found', detail: 'x' })).toEqual({ kind: 'unavailable' });
    expect(parsePlanReply({ ...PLAN, visits: [PLAN.visits[0]] })).toEqual({ kind: 'unavailable' });
  });
  it('#147: an area already being computed, another area: refusal, and a null eta', () => {
    expect(parsePlanReply({ area_id: 'a', state: 'running', steps: [], elapsed_s: 3, eta_s: null })).toEqual({ kind: 'running', areaId: 'a', state: 'running' });
    expect(parsePlanReply({ error: 'area:too_large', detail: 'x' })).toEqual({ kind: 'error', code: 'area:too_large', detail: 'x' });
    expect(parseStatusReply({ area_id: 'a', state: 'done', step: null, steps: [], elapsed_s: 9, eta_s: null }).eta_s).toBeNull();
  });
  it('start: 429 queue_full is an error the card can name, not "unavailable"', () => {
    expect(parseStartReply({ error: 'queue_full', detail: 'x' })).toEqual({ kind: 'error', code: 'queue_full', detail: 'x' });
  });
  it('status: an unknown step id breaks the contract', () => {
    expect(() => parseStatusReply({ area_id: 'a', state: 'running', step: null, steps: [{ id: 'pair', label: 'x', state: 'done' }], elapsed_s: 0, eta_s: 1 })).toThrow();
  });
  it('start: queued or running', () => {
    expect(parseStartReply({ area_id: 'a', state: 'queued' })).toEqual({ kind: 'started', areaId: 'a', state: 'queued' });
    expect(parseStartReply({ area_id: 'a', state: 'running' })).toEqual({ kind: 'started', areaId: 'a', state: 'running' });
    expect(parseStartReply({ area_id: 'a', state: 'done' })).toEqual({ kind: 'stored', areaId: 'a' });
  });
  it('status: steps, times, queue position and error', () => {
    const s = parseStatusReply({
      area_id: 'a', state: 'failed', step: 'frames',
      steps: [{ id: 'visits', label: 'Find a pair of visits', state: 'done', done: 2, total: 2 }],
      elapsed_s: 12, eta_s: 0, queue_position: 2, error: { code: 'upstream_unavailable', detail: 'IRSA' },
    });
    expect(s.steps[0]).toEqual({ id: 'visits', label: 'Find a pair of visits', state: 'done', done: 2, total: 2 });
    expect(s.queue_position).toBe(2);
    expect(s.error).toEqual({ code: 'upstream_unavailable', detail: 'IRSA' });
    expect(() => parseStatusReply({ area_id: 'a', state: 'weird', steps: [], elapsed_s: 0, eta_s: 0 })).toThrow();
  });
  it('the request box never asks for more than 2° a side (a hair over is the backend\'s area:too_large)', () => {
    const b = liveBoxOf({ a: { ra: 10, dec: 1 }, b: { ra: 12, dec: -1 }, widthDeg: 2.0004, heightDeg: 1.99 });
    expect(b.width_deg).toBe(2);
    expect(b.height_deg).toBe(1.99);
  });
  it('the request box: centre and sides of the drawn corners, across RA 0', () => {
    expect(liveBoxOf({ a: { ra: 359.5, dec: 11 }, b: { ra: 0.5, dec: 10 }, widthDeg: 1, heightDeg: 1 })).toEqual({
      ra: 0, dec: 10.5, width_deg: 1, height_deg: 1,
    });
  });
});

describe('HTTP client', () => {
  it('posts the contract body and reads the plan', async () => {
    const fetchImpl = vi.fn(async () => reply(PLAN));
    const api = httpLiveAreaApi('/v1', fetchImpl as unknown as typeof fetch);
    expect(await api.plan(BOX)).toEqual({ kind: 'plan', plan: PLAN });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/v1/areas/live');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ ...BOX, start: false });
    await api.start(BOX);
    expect(JSON.parse((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body as string).start).toBe(true);
  });
  it('names the tool when it starts, so the server records the run (Q-471 (2))', async () => {
    const fetchImpl = vi.fn(async () => reply(PLAN));
    const api = httpLiveAreaApi('/v1', fetchImpl as unknown as typeof fetch);
    const bodyOf = (i: number) =>
      JSON.parse((fetchImpl.mock.calls[i] as unknown as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    await api.start(BOX, undefined, undefined, 'discovery');
    expect(bodyOf(0)).toEqual({ ...BOX, start: true, kind: 'discovery' });
    await api.start(BOX, undefined, undefined, 'known');
    expect(bodyOf(1).kind).toBe('known');
    // The coverage check starts nothing, so it records nothing.
    await api.plan(BOX);
    expect('kind' in bodyOf(2)).toBe(false);
  });
  it('a route the backend does not serve, an HTML page or no backend: unavailable', async () => {
    const notFound = httpLiveAreaApi('/v1', (async () => reply({ error: 'not_found', detail: 'Not Found' }, 404)) as unknown as typeof fetch);
    expect(await notFound.plan(BOX)).toEqual({ kind: 'unavailable' });
    const html = httpLiveAreaApi('/v1', (async () => reply('<!doctype html>', 200, 'text/html')) as unknown as typeof fetch);
    expect(await html.plan(BOX)).toEqual({ kind: 'unavailable' });
    const down = httpLiveAreaApi('/v1', (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch);
    expect(await down.plan(BOX)).toEqual({ kind: 'unavailable' });
  });
  it('a job the server no longer knows (404 job_not_found) is LiveJobGone', async () => {
    const api = httpLiveAreaApi('/v1', (async () => reply({ error: 'job_not_found', detail: 'x' }, 404)) as unknown as typeof fetch);
    await expect(api.status('a')).rejects.toBeInstanceOf(LiveJobGone);
  });
  it('Stop: 204 and 404 (already ended) are fine; a 500 is not stopped', async () => {
    const at = (status: number) => httpLiveAreaApi('/v1', (async () => new Response(null, { status })) as unknown as typeof fetch);
    await expect(at(204).stop('a')).resolves.toBeUndefined();
    await expect(at(404).stop('a')).resolves.toBeUndefined();
    await expect(at(500).stop('a')).rejects.toThrow('Stop failed (500).');
  });
  it('a job poll carries a timeout, so a hung reply cannot stall polling', async () => {
    let sig: AbortSignal | undefined;
    const api = httpLiveAreaApi('/v1', (async (_u: string, init?: RequestInit) => {
      sig = init?.signal ?? undefined;
      return reply({ area_id: 'a', state: 'running', step: null, steps: [], elapsed_s: 1, eta_s: 9 });
    }) as unknown as typeof fetch);
    await api.status('a');
    expect(sig).toBeInstanceOf(AbortSignal);
  });
  it('reads a job and stops it with DELETE', async () => {
    const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) =>
      init?.method === 'DELETE' ? new Response(null, { status: 204 }) : reply({ area_id: 'a b', state: 'running', step: null, steps: [], elapsed_s: 1, eta_s: 9 }),
    );
    const api = httpLiveAreaApi('/v1', fetchImpl as unknown as typeof fetch);
    expect((await api.status('a b')).state).toBe('running');
    await api.stop('a b');
    expect(fetchImpl.mock.calls[0]![0]).toBe('/v1/areas/live/a%20b');
    expect(fetchImpl.mock.calls[1]![1]?.method).toBe('DELETE');
  });
});

describe('mock', () => {
  const plan = PLAN as LivePlan;
  it('steps run in order with counts; elapsed and remaining add up to the estimate', () => {
    const s = mockStatusAt('a', 0.3, plan);
    expect(s.steps.map((x) => x.state)).toEqual(['done', 'running', 'todo', 'todo', 'todo', 'todo']);
    expect(s.step).toBe('frames');
    expect(s.steps[1]).toMatchObject({ done: 7, total: 14 });
    expect(s.elapsed_s + (s.eta_s ?? 0)).toBe(540);
    expect(mockStatusAt('a', 1, plan).eta_s).toBeNull();
    expect(mockStatusAt('a', 1, plan).state).toBe('done');
  });
  it('is used only when asked for in the URL or the env', () => {
    expect(mockFromEnv('', undefined)).toBeNull();
    expect(mockFromEnv('?live=mock', undefined)).not.toBeNull();
    expect(mockFromEnv('', 'mock')).not.toBeNull();
  });
  it('scenarios answer the contract\'s errors', async () => {
    expect(await mockLiveAreaApi('no_pair').plan(BOX)).toMatchObject({ kind: 'error', code: 'area:no_visit_pair' });
    expect(await mockLiveAreaApi('unreachable').plan(BOX)).toMatchObject({ kind: 'error', code: 'upstream_unavailable' });
    expect(await mockLiveAreaApi('offline').plan(BOX)).toMatchObject({ kind: 'error', code: 'offline' });
    expect(await mockLiveAreaApi('stored').plan(BOX)).toMatchObject({ kind: 'stored' });
  });
  it('a queued job waits, then runs to done', async () => {
    let t = 0;
    const api = mockLiveAreaApi('queued', { durationMs: 1000, now: () => t });
    const started = await api.start(BOX);
    expect(started).toMatchObject({ kind: 'started', state: 'queued' });
    const id = started.kind === 'started' ? started.areaId : '';
    expect((await api.status(id)).state).toBe('queued');
    t = 400 + 500;
    expect((await api.status(id)).state).toBe('running');
    t = 400 + 1000;
    expect((await api.status(id)).state).toBe('done');
  });
});

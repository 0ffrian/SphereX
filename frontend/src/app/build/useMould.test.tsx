// Issue #60: the moulding driver with a fake viewer (no GPU, fake clock). A level change that
// arrives while the body eases back to its normal pose (the last 450 ms) must not be dropped.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '@/test/sharedFixtures';
import { defaultContext, planRender } from '@/viewer/renderPlan';
import type { PlanContext, RenderPlan } from '@/viewer/planTypes';
import { buildDuration, DONE_AFTER_S, mouldScript } from '@/viewer/mould/mouldSteps';
import type { ViewerApp } from '@/viewer/ViewerApp';
import { FORMING_PROGRESS, TURN_SETTLE_MS, useMould, type MouldPhase } from './useMould';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

function fakeViewer() {
  let turn = { x: 0.3, y: 5 };
  return {
    showPlan: vi.fn(),
    clearObject: vi.fn(),
    setMould: vi.fn(),
    whenLoaded: vi.fn(async () => undefined),
    setTurn: vi.fn((x: number, y: number) => void (turn = { x, y })),
    getTurn: vi.fn(() => turn),
    isDraggingBody: vi.fn(() => false),
  };
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe('useMould', () => {
  it('a level change during the turn settle ends on the new plan, then says done', async () => {
    const { card, params } = fixture('asteroid_procedural');
    const ctxOf = (honesty: 'derived' | 'measured'): PlanContext => defaultContext({ honesty });
    const planA = planRender(card, params, ctxOf('derived'));
    const planB = planRender(card, params, ctxOf('measured'));
    expect(planB).not.toBe(planA);
    const n = mouldScript(planA)!.steps.length;
    const viewer = fakeViewer();
    const phases: MouldPhase[] = [];

    function Harness({ plan, ctx }: { plan: RenderPlan; ctx: PlanContext }) {
      useMould({
        viewer: viewer as unknown as ViewerApp,
        card,
        params,
        ctx,
        plan,
        seq: 1,
        animate: true,
        reducedMotion: false,
        onProgress: () => {},
        onPhase: (p) => phases.push(p),
      });
      return null;
    }
    const render = (plan: RenderPlan, honesty: 'derived' | 'measured') =>
      act(async () => root.render(<Harness plan={plan} ctx={ctxOf(honesty)} />));

    await render(planA, 'derived');
    await act(async () => {}); // whenLoaded
    // Run to just after the last step ends: the settle has started.
    const toDone = (buildDuration(n) + DONE_AFTER_S) * 1000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(toDone + TURN_SETTLE_MS / 4);
    });
    expect(phases.at(-1)).toBe('building');
    // The level changes now.
    await render(planB, 'measured');
    expect(phases.at(-1)).toBe('building');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TURN_SETTLE_MS * 2);
    });
    expect(phases.at(-1)).toBe('done');
    expect(viewer.showPlan.mock.calls.at(-1)![0]).toBe(planB);
    expect(viewer.setTurn).toHaveBeenLastCalledWith(0, 0);
    expect(viewer.setMould).toHaveBeenLastCalledWith(null);
  });
  it('waits for an engine to form the world before the steps play (issue #93)', async () => {
    const { card, params } = fixture('asteroid_procedural');
    const ctx = defaultContext({ honesty: 'derived' });
    const plan = planRender(card, params, ctx);
    const n = mouldScript(plan)!.steps.length;
    const viewer = fakeViewer();
    const phases: MouldPhase[] = [];
    const progress: (readonly number[])[] = [];

    function Harness({ hold }: { hold: boolean }) {
      useMould({
        viewer: viewer as unknown as ViewerApp,
        card,
        params,
        ctx,
        plan,
        seq: 1,
        animate: true,
        reducedMotion: false,
        hold,
        onProgress: (p) => progress.push([...p]),
        onPhase: (p) => phases.push(p),
      });
      return null;
    }
    await act(async () => root.render(<Harness hold />));
    await act(async () => {}); // whenLoaded
    // Far longer than a whole build: still waiting, the first step in progress and nothing else.
    await act(async () => {
      await vi.advanceTimersByTimeAsync((buildDuration(n) + DONE_AFTER_S) * 1000 * 3);
    });
    expect(phases.at(-1)).toBe('forming');
    expect(phases).not.toContain('building');
    expect(progress.at(-1)).toEqual([FORMING_PROGRESS, ...Array(n - 1).fill(0)]);
    // The engine has formed the world: the steps play from the start and end as usual.
    await act(async () => root.render(<Harness hold={false} />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(phases.at(-1)).toBe('building');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        (buildDuration(n) + DONE_AFTER_S) * 1000 + TURN_SETTLE_MS * 2,
      );
    });
    expect(phases.at(-1)).toBe('done');
    expect(progress.at(-1)).toEqual(Array(n).fill(1));
  });

  it('without an engine to wait for, the steps play at once; reduced motion shows the body built', async () => {
    const { card, params } = fixture('asteroid_procedural');
    const ctx = defaultContext({ honesty: 'derived' });
    const plan = planRender(card, params, ctx);
    const viewer = fakeViewer();
    const phases: MouldPhase[] = [];
    function Harness({ reduced }: { reduced: boolean }) {
      useMould({
        viewer: viewer as unknown as ViewerApp,
        card,
        params,
        ctx,
        plan,
        seq: reduced ? 2 : 1,
        animate: true,
        reducedMotion: reduced,
        hold: reduced,
        onProgress: () => {},
        onPhase: (p) => phases.push(p),
      });
      return null;
    }
    await act(async () => root.render(<Harness reduced={false} />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(phases).toContain('building');
    expect(phases).not.toContain('forming');
    phases.length = 0;
    // Reduced motion: no animation and no wait, even while an engine forms (R9).
    await act(async () => root.render(<Harness reduced />));
    expect(phases).toEqual(['done']);
  });
});

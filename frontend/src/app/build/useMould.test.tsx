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
import { TURN_SETTLE_MS, useMould, type MouldPhase } from './useMould';
import { useMouldLive } from './mouldLive';

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
  it('ends early only on the show that covered this build, never on one left from an earlier build', async () => {
    const { card, params } = fixture('asteroid_procedural');
    const ctx = defaultContext({ honesty: 'derived' });
    const plan = planRender(card, params, ctx);
    const viewer = fakeViewer();
    const phases: MouldPhase[] = [];
    function Harness({ seq }: { seq: number }) {
      useMould({
        viewer: viewer as unknown as ViewerApp,
        card,
        params,
        ctx,
        plan,
        seq,
        animate: true,
        reducedMotion: false,
        onProgress: () => {},
        onPhase: (p) => phases.push(p),
      });
      return null;
    }
    // Build A, then a Replay (build B) while A's show is still pending.
    await act(async () => root.render(<Harness seq={1} />));
    const buildA = useMouldLive.getState().buildSeq;
    await act(async () => root.render(<Harness seq={2} />));
    await act(async () => {}); // whenLoaded
    const buildB = useMouldLive.getState().buildSeq;
    expect(buildB).not.toBe(buildA);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(phases.at(-1)).toBe('building');
    // A's show ends now: B must keep building.
    act(() => useMouldLive.getState().markShown(buildA));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TURN_SETTLE_MS * 3);
    });
    expect(phases.at(-1)).toBe('building');
    // B's own show ends: B finishes there (after easing back to the normal pose).
    act(() => useMouldLive.getState().markShown(buildB));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TURN_SETTLE_MS * 3);
    });
    expect(phases.at(-1)).toBe('done');
  });
});

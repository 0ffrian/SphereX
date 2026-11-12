// Issue #60: drives the build pane's moulding animation on a ViewerApp (mock-up `openBuild`,
// `replay`, `loop`). Order: plan and load the real body first (behind the loading state), then
// play the steps: each stage shows the normal plan with the later steps' layers held back
// (`PlanContext.hold`), and the pose (scale, scaffold, morph, growth, shader knobs) follows the
// step progress. The last stage is the normal plan itself and the pose is cleared at the end, so
// the frame after a build is the normal render of the same card, params and seed.
//
// Reduced motion (R9): no animation; the built body is shown at once.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ObjectCard, RenderParams } from '@/contract';
import type { PlanContext, RenderPlan } from '@/viewer/planTypes';
import { planRender } from '@/viewer/renderPlan';
import type { ViewerApp } from '@/viewer/ViewerApp';
import {
  holdAt,
  isDone,
  mouldScript,
  poseAt,
  stageAt,
  stepProgress,
  type MouldScript,
} from '@/viewer/mould/mouldSteps';
import { useMouldLive } from './mouldLive';

export type MouldPhase = 'idle' | 'loading' | 'building' | 'done';

/** Mock-up build view: starting turn of the body and its auto-rotation while it is built. */
export const BUILD_START_TURN = { x: 0.28, y: 0.6 };
export const AUTO_TURN_RAD_PER_S = 0.28;
/** After a build the body eases back to the normal pose over this long. UI pacing. */
export const TURN_SETTLE_MS = 450;

export interface MouldState {
  phase: MouldPhase;
  script: MouldScript | null;
}

export interface MouldInputs {
  viewer: ViewerApp | null;
  card: ObjectCard | null;
  params: RenderParams | null;
  ctx: PlanContext;
  plan: RenderPlan | null;
  /** Changes start a new build (open, Replay, New seed). */
  seq: number;
  animate: boolean;
  reducedMotion: boolean;
  /** Hold the build back (the level is being raised first, so the first plan is not the final one). */
  wait?: boolean;
  /** Per-frame step progress for the strip (written to the DOM, not to React state). */
  onProgress(p: readonly number[]): void;
  onPhase?(phase: MouldPhase, script: MouldScript | null): void;
}

/** The plan of one stage: the normal plan with later layers held, framed like the normal plan. */
export function stagePlan(
  card: ObjectCard,
  params: RenderParams,
  ctx: PlanContext,
  plan: RenderPlan,
  script: MouldScript,
  stage: number,
): RenderPlan {
  const hold = holdAt(script, stage);
  if (hold.length === 0) return plan;
  const p = planRender(card, params, { ...ctx, hold });
  // Same camera framing for every stage (the camera never jumps between steps).
  return {
    ...p,
    extent: plan.extent,
    shader: p.shader && plan.shader ? { ...p.shader, distance: plan.shader.distance } : p.shader,
  };
}

export function useMould(inp: MouldInputs): MouldState {
  const [state, setState] = useState<MouldState>({ phase: 'idle', script: null });
  const latest = useRef(inp);
  // The newest inputs for the frame loop and callbacks (written after render, before effects).
  useLayoutEffect(() => {
    latest.current = inp;
  });
  const { viewer, plan, seq, animate, reducedMotion, wait } = inp;
  const seed = inp.params?.seed;
  const phaseRef = useRef<MouldPhase>('idle');

  // Start (or restart) a build on open, Replay and New seed.
  useEffect(() => {
    const { card, params, ctx, onProgress, onPhase } = latest.current;
    if (!viewer || wait) return;
    let cancelled = false;
    let raf = 0;
    const set = (phase: MouldPhase, script: MouldScript | null) => {
      phaseRef.current = phase;
      setState({ phase, script });
      onPhase?.(phase, script);
    };
    if (!plan || !card || !params) {
      viewer.setMould(null);
      if (plan) viewer.showPlan(plan);
      else viewer.clearObject();
      set('idle', null);
      return;
    }
    const script = mouldScript(plan);
    // The mould show (MouldOverlay) is the one clock for the strip: when the show that covered THIS
    // build has finished, so has the build. A show left over from an earlier build cannot end it.
    const token = useMouldLive.getState().startBuild();
    const finish = (settleTurn = false) => {
      viewer.setMould(null);
      // The newest plan (a honesty or mode change during the build ends on it).
      let shown = latest.current.plan ?? plan;
      viewer.showPlan(shown);
      onProgress(script ? script.steps.map(() => 1) : []);
      if (!settleTurn) {
        set('done', script);
        return;
      }
      // The body has been turning while it was built; the normal render is at turn (0, 0). Ease
      // back to it (the short way round) so the last frame is the normal render, then say done.
      const from = viewer.getTurn();
      const fromY = Math.atan2(Math.sin(from.y), Math.cos(from.y));
      const t0 = performance.now();
      const settle = (now: number) => {
        if (cancelled) return;
        const k = Math.min(1, (now - t0) / TURN_SETTLE_MS);
        const e = 1 - (1 - k) * (1 - k);
        viewer.setTurn(from.x * (1 - e), fromY * (1 - e));
        if (k < 1) raf = requestAnimationFrame(settle);
        else {
          viewer.setTurn(0, 0);
          // A level or mode change during the settle: draw the plan now asked for, then say done.
          const newest = latest.current.plan ?? plan;
          if (newest !== shown) {
            shown = newest;
            viewer.showPlan(newest);
          }
          set('done', script);
        }
      };
      raf = requestAnimationFrame(settle);
    };
    if (!animate || reducedMotion || !script) {
      finish();
      return;
    }
    set('loading', script);
    viewer.setMould(null);
    viewer.showPlan(plan);
    onProgress(script.steps.map(() => 0));
    void viewer.whenLoaded().then(() => {
      if (cancelled) return;
      // A honesty, mode or epoch change while it loaded: end on the plan now asked for.
      if (latest.current.plan !== plan) {
        finish();
        return;
      }
      const plans = script.steps.map((_, i) => stagePlan(card, params, ctx, plan, script, i));
      const n = script.steps.length;
      let stage = -1;
      let turn = { ...BUILD_START_TURN };
      viewer.setTurn(turn.x, turn.y);
      const t0 = performance.now();
      let last = t0;
      set('building', script);
      const loop = (now: number) => {
        if (cancelled) return;
        // The plan changed mid-build (honesty D-21: a stage of the old level must not stay on
        // screen): end at once on the new plan.
        if (latest.current.plan !== plan) {
          finish();
          return;
        }
        // Q-451: the show is the strip's one clock, so its end ends this build. Merge rule with the
        // #93 engine PRs (#122, #124, #125; PR #107 review): their hold / 'forming' phase must still
        // win, so once they land this finishes only after the engine has formed the world.
        if (useMouldLive.getState().shownFor === token) {
          finish(true);
          return;
        }
        const t = (now - t0) / 1000;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const p = stepProgress(t, n);
        const s = stageAt(t, n);
        if (s !== stage) {
          stage = s;
          viewer.showPlan(plans[s]!);
        }
        viewer.setMould(poseAt(script, p));
        // Mock-up: the body turns slowly while it is built, unless it is being dragged.
        if (!viewer.isDraggingBody()) {
          const cur = viewer.getTurn();
          turn = { x: cur.x, y: cur.y + dt * AUTO_TURN_RAD_PER_S };
          viewer.setTurn(turn.x, turn.y);
        }
        latest.current.onProgress(p);
        if (isDone(t, n)) {
          finish(true);
          return;
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // A new plan mid-build (honesty, mode) is handled below; only these restart a build.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, seq, animate, reducedMotion, plan?.id, seed, wait]);

  // A changed plan after the build (honesty, mode, epoch) is drawn as usual. Mid-build, the build
  // ends at once on the new plan (never a stage of an old plan on screen).
  useEffect(() => {
    if (!viewer || !plan) return;
    if (phaseRef.current === 'done' || phaseRef.current === 'idle') {
      viewer.showPlan(plan);
    }
  }, [viewer, plan]);

  return state;
}

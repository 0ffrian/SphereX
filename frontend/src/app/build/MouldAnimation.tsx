// The build stage's moulding animation: the mock-up's own (mockup/spherex-ui.html `makeBody`, `loop`),
// ported as it is (mouldBody.ts holds its shaders and per-kind staging) and drawn with a plain three
// WebGLRenderer on its own canvas. It plays over the stage while the real body is generated (a world
// engine spinning up, the plan loading): the sphere of triangles (wireframe), then the kind's steps
// (shape, relief, terrain, bands, storms, oceans, colour, clouds, rings, tails ...) with the mock-up's
// stage curve and 0.28 rad/s turn. In the generating wait its stage follows the build strip's real
// progress; for a body that is ready at once (baked, cached) it plays the same thing paced so the show lasts
// at least 5 s in all (MIN_SHOW_MS), for every body, cached ones included, and drives the strip itself. When the body is ready the mould
// finishes its stage quickly, then fades out (350 ms) as the real render shows.
// Decorative (aria-hidden); the caption text is the accessible status. Reduced motion: no animation,
// one still frame of the finished mould while it waits, and an instant hand-over.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { MouldKind } from '@/viewer/mould/mouldSteps';
import { initShared, makeBody } from './mouldBody';
import { useMouldLive } from './mouldLive';

/** UI pacing, not physical values. */
export const MOULD_SIZE_PX = 520;
export const CACHED_SHOW_MS = 1400;
/** Moon (12 Nov 2026): every build shows the mould for at least this long, cached bodies included. */
export const MIN_SHOW_MS = 5000;
export const FINISH_MS = 600;
/** Each step of the show gets at least this long, also after a long load (Moon: the body morphs slowly, Q-421). */
export const STEP_MIN_MS = 700;
export const HAND_OVER_MS = 350;
/** The mock-up's `STAGE_S` and the rotation speed of the body while it is built. */
export const STAGE_S = 2.3;
const TURN_RAD_PER_S = 0.28;
/** Number of stages the mock-up's body of each kind stages (its `PLAN`). */
const STAGES: Record<MouldKind, number> = {
  asteroid: 4, comet: 5, star: 4, dwarf: 4, rocky: 4, water: 5, gas: 5, nebula: 4, nova: 4,
};
const CAMERA_Z: Partial<Record<MouldKind, number>> = { comet: 7.2, gas: 7.2, nebula: 5.4, nova: 5 };

/** Objects whose show has played in this session: opening one again skips it. */
const seen = new Set<string>();
export function resetMouldSeen(): void {
  seen.clear();
}

const ease = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** What the body is made from: the card's measured values where it has them (else the mock-up's defaults). */
export interface MouldInputs {
  /** Effective temperature (stars, brown dwarfs) or equilibrium temperature (gas giants), K. */
  T?: number | null;
  giant?: boolean;
  /** The body's colour 0..1 (asteroids, comets), when the plan has one. */
  tint?: readonly number[] | null;
  elong?: readonly [number, number, number] | null;
}

export interface MouldAnimationProps {
  kind: MouldKind;
  inputs?: MouldInputs;
  seed?: number;
  /** Steps in the build strip (its progress array length). */
  steps: number;
  /** `rush`: the body is ready: finish (or play) the show over `rushMs`. */
  rush?: boolean;
  rushMs?: number;
  reduced?: boolean;
}

export function MouldAnimation({ kind, inputs, seed = 7, steps, rush = false, rushMs = CACHED_SHOW_MS, reduced = false }: MouldAnimationProps) {
  const ref = useRef<HTMLDivElement>(null);
  const live = useRef({ rush, rushMs, steps });
  useEffect(() => {
    live.current = { rush, rushMs, steps };
  });
  const rushFrom = useRef<{ t: number; snap: number } | null>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    // A canvas of its own per effect run: a lost context (StrictMode's double run) can't be reused.
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.dataset.testid = 'mould-canvas';
    // Fills the stage (not a fixed square): halos and glows fade out instead of being cut at a box edge.
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    host.appendChild(canvas);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      canvas.remove();
      return; // no WebGL: the caption alone covers the wait
    }
    initShared();
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
    const fitSize = () => {
      const w = host.clientWidth || MOULD_SIZE_PX;
      const h = host.clientHeight || MOULD_SIZE_PX;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // The body takes about 45% of the stage height (0.68 zoom), clear of the header and the step chips.
      camera.zoom = 0.68 * (Math.min(1, w / h) || 1);
      camera.updateProjectionMatrix();
    };
    fitSize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fitSize) : null;
    ro?.observe(host);
    camera.position.set(0, 0, CAMERA_Z[kind] ?? 4.4);
    const o = {
      kind,
      T: inputs?.T ?? undefined,
      giant: inputs?.giant,
      tint: inputs?.tint && inputs.tint.length >= 3 ? [inputs.tint[0], inputs.tint[1], inputs.tint[2]] : undefined,
      elong: inputs?.elong ?? undefined,
    };
    const body = makeBody(o, seed) as unknown as {
      root: THREE.Group;
      fixed: THREE.Group;
      apply(P: number[], t: number): void;
    };
    scene.add(body.root, body.fixed);
    const n = STAGES[kind];
    const rot = { x: 0.28, y: 0.6 };
    const t0 = performance.now();
    let last = t0;
    let raf = 0;
    let stopped = false;
    const reducedNow = reduced;

    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { rush: rushing, rushMs: ms, steps: ns } = live.current;
      const real = useMouldLive.getState().progress;
      // The overall build fraction the strip shows (0..1).
      const realF = real.length ? real.reduce((a, b) => a + b, 0) / real.length : 0;
      let f = realF;
      let stripP: number[] | null = null;
      if (reducedNow) f = 1;
      else if (rushing) {
        if (!rushFrom.current) rushFrom.current = { t: now, snap: realF };
        const k = clamp01((now - rushFrom.current.t) / ms);
        // Sequential stages over the rush; what is already built stays built.
        f = Math.max(rushFrom.current.snap, k);
        stripP = Array.from({ length: ns }, (_, i) => ease(clamp01(f * ns - i)));
      } else rushFrom.current = null;
      const P = [0, 0, 0, 0, 0];
      for (let i = 0; i < n; i++) P[i] = ease(clamp01(f * n - i));
      body.apply(P, reducedNow ? 3 : t);
      if (!reducedNow) rot.y += dt * TURN_RAD_PER_S;
      body.root.rotation.set(rot.x, rot.y, 0);
      renderer.render(scene, camera);
      const st = useMouldLive.getState();
      if (stripP) st.setOverride(stripP);
      else if (st.override) st.setOverride(null);
    };
    const loop = (now: number) => {
      if (stopped) return;
      frame(now);
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (stopped || raf || reducedNow) return;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVis);
    if (reducedNow) frame(performance.now());
    else start();
    return () => {
      stopped = true;
      stop();
      ro?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      useMouldLive.getState().setOverride(null);
      body.root.traverse((m: THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material }) => {
        m.geometry?.dispose();
        m.material?.dispose();
      });
      body.fixed.traverse((m: THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material }) => {
        m.geometry?.dispose();
        m.material?.dispose();
      });
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, seed, reduced]);

  return <div ref={ref} aria-hidden="true" className="sx-mould-host" />;
}

export interface MouldOverlayProps {
  /** The real render is not ready yet. */
  active: boolean;
  /** Session key for "already shown": the object id. */
  id: string;
  kind: MouldKind | null;
  /** Steps in the build strip. */
  steps: number;
  inputs?: MouldInputs;
  seed?: number;
  reduced: boolean;
  /** Under the animation, and the status text for assistive tech. */
  caption: string;
}

type Stage = 'off' | 'on' | 'rush' | 'leave';

/**
 * Covers the stage while `active`, then hands over: a ready body (shorter than ~1.4 s of waiting)
 * gets the short show once per session; a longer wait just fades out. Never delays more than that.
 */
export function MouldOverlay({ active, id, kind, steps, inputs, seed, reduced, caption }: MouldOverlayProps) {
  const [stage, setStage] = useState<Stage>('off');
  const [rushMs, setRushMs] = useState(CACHED_SHOW_MS);
  const [visible, setVisible] = useState(true);
  const startedAt = useRef(0);
  /** The build this show covers (mouldLive.buildSeq when it came on); its end finishes only that build. */
  const coveredBuild = useRef(-1);
  const stepsRef = useRef(steps);
  useEffect(() => {
    stepsRef.current = steps;
  });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const idRef = useRef(id);
  const stageRef = useRef<Stage>('off');
  const setSt = (s: Stage) => {
    stageRef.current = s;
    setStage(s);
  };
  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => {
    idRef.current = id;
  });
  useEffect(() => clear, []);

  useEffect(() => {
    const now = performance.now();
    const cur = stageRef.current;
    const leave = () => {
      // The show has reached its last step: the real build ends on it (one clock for the strip).
      useMouldLive.getState().markShown(coveredBuild.current);
      if (reduced) {
        seen.add(idRef.current);
        setSt('off');
        return;
      }
      setSt('leave');
      timers.current.push(
        setTimeout(() => {
          seen.add(idRef.current);
          setSt('off');
        }, HAND_OVER_MS),
      );
    };
    if (active && kind) {
      if (cur === 'on') return;
      clear();
      startedAt.current = now;
      coveredBuild.current = useMouldLive.getState().buildSeq;
      setSt('on');
      // Always drawn, also for a body seen before (at least MIN_SHOW_MS in all).
      setVisible(true);
      return;
    }
    if (cur !== 'on') return;
    clear();
    const elapsed = now - startedAt.current;
    if (reduced) return leave();
    // The mould plays its remaining stages over whatever is left of MIN_SHOW_MS (a cached body that
    // was ready at once gets the whole 5 s show). After a long real wait every step still gets
    // STEP_MIN_MS, so the body morphs through each one and the strip can be read (Q-421).
    const ms = Math.max(FINISH_MS, stepsRef.current * STEP_MIN_MS, MIN_SHOW_MS - elapsed);
    setRushMs(ms);
    setSt('rush');
    timers.current.push(setTimeout(leave, ms));
  }, [active, id, reduced, kind]);

  if (stage === 'off') return null;
  const leaving = stage === 'leave';
  return (
    <div
      className="sx-mould"
      data-testid="mould-overlay"
      data-stage={stage}
      data-leaving={leaving || undefined}
    >
      <span className="sr-only" role="status">
        {caption}
      </span>
      <div className="sx-mould-art" aria-hidden="true" style={{ opacity: visible ? undefined : 0 }}>
        {kind && <MouldAnimation kind={kind} steps={steps} inputs={inputs} seed={seed} rush={stage === 'rush' || leaving} rushMs={rushMs} reduced={reduced} />}
      </div>
    </div>
  );
}

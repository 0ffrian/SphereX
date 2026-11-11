// Issue #71 stream Y (D-37, Q-313 to Q-316): hosts the approved prototype's world engine in the app for rocky
// planets, water worlds and gas giants. `WorldGlobeStage` fills the build pane's globe stage; `WorldFlyStage` fills
// the left close-up pane with the prototype's surface (fly) view. Each is one `WorldEngine` on its own canvas (raw
// WebGL 2, the prototype's own shaders); `worldStore` applies every control change to both. The controls, the
// readouts and the "How each part is worked out" notes go to the build pane's Details through `useBuildControls`.
// A card `cardToWorld` refuses, a browser without WebGL 2, or "Measured only" keeps the old three.js path (the hosts
// call `onFail`, or are not mounted at all, see `useEngineWorld`).
import { useMouldLive } from './build/mouldLive';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Tag } from '@/contract';
import { useAppStore } from '@/state/store';
import { cardToWorld, type CardToWorldOk } from '@/engine/worlds/cardToWorld';
import { WORLD_FLUIDS, WorldEngine, type EngineState } from '@/engine/worlds/WorldEngine';
import { worldEngineSupported } from '@/engine/worlds/support';
import type { FluidKey, SpinMode } from '@/engine/worlds/types';
import { ProvenanceBadge } from './Badge';
import { useCloseUpStore } from './closeUpStore';
import { useBuildControls, type BuildControl, type BuildControlsSpec, type BuildNote } from './build/BuildControls';
import { buttonClass, pressedClass } from './ui';
import { drawReady, useWorldStore } from './worldStore';
import { FLY_NOTE, WORLD_HONESTY, WORLD_NOTE_LINES } from './worldNotes.generated';

/** The engine's world for the shown card, or null: not a planet, refused, or no WebGL 2 (old path). */
export function useEngineWorld(): CardToWorldOk | null {
  const card = useAppStore((s) => s.card);
  return useMemo(() => {
    if (!card || !worldEngineSupported()) return null;
    const r = cardToWorld(card);
    return r.ok ? r : null;
  }, [card]);
}

/** The prototype's slider ranges (core.js STARMIN ... PSMAX), as natural logs. */
const STAR = [Math.log(2300), Math.log(14000)] as const;
const ORB = [Math.log(0.25), Math.log(5)] as const;
const PS = [Math.log(0.002), Math.log(100)] as const;
const toSlider = (v: number, r: readonly [number, number]): number =>
  Math.max(0, Math.min(1000, Math.round(((Math.log(v) - r[0]) / (r[1] - r[0])) * 1000)));
const fromSlider = (s: number, r: readonly [number, number]): number => Math.exp(r[0] + (r[1] - r[0]) * (s / 1000));

const fmt = (x: number, d = 0): string => x.toLocaleString('en', { maximumFractionDigits: d });

/** Fly altitude, slider position (0..1000) and back, as the prototype's altToS / sToAlt. */
export function altToSlider(alt: number, r: [number, number]): number {
  return Math.round((Math.log(alt / r[0]) / Math.log(r[1] / r[0])) * 1000);
}
export function sliderToAlt(s: number, r: [number, number]): number {
  return r[0] * Math.pow(r[1] / r[0], s / 1000);
}

const READOUT_TAG: Record<string, Tag> = {
  'Starlight here': 'derived',
  'Gravity at the clouds': 'derived',
};

const FLUID_LABEL = (k: string): string => (WORLD_FLUIDS[k] as { label: string }).label;

// The prototype's "How each part is worked out" list and its honesty line are generated from the preview
// (scripts/gen-world-notes.mjs), so they cannot drift from it.
export { WORLD_NOTE_LINES, WORLD_HONESTY, FLY_NOTE };

/** Notes for the Details panel: the prototype's list plus what `cardToWorld` filled in or changed. */
export function worldNotes(world: CardToWorldOk): BuildNote[] {
  const notes: BuildNote[] = [{ title: 'How each part is worked out', lines: WORLD_NOTE_LINES, placeholder: WORLD_HONESTY }];
  if (world.assumptions.length || world.mismatches.length || world.missing.length) {
    const lines = world.assumptions.map((a) => `${a.field} = ${String(a.value)}: ${a.note}.`);
    for (const m of world.mismatches) lines.push(`Differs from the artifact: ${m}.`);
    for (const m of world.missing) lines.push(`Not on the card and not needed: ${m}.`);
    notes.push({
      title: 'Filled in, not measured',
      lines,
      placeholder: 'Each of these is an assumption of the model (Estimated or Default), not a measurement of this world.',
    });
  }
  return notes;
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

type Role = 'globe' | 'fly';

/**
 * Builds one engine on a canvas of its own inside `host`, drives its clock (the artifact's loop, with its pause) and
 * keeps React in step with it. The canvas is made here, in the effect, so a remount gets a fresh GL context.
 */
function useWorldEngine(role: Role, world: CardToWorldOk, onFail: (() => void) | undefined) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<WorldEngine | null>(null);
  const [failed, setFailed] = useState(false);
  const [rev, bump] = useReducer((n: number) => n + 1, 0);
  const presetId = world.preset.id;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement('canvas');
    canvas.style.cssText =
      'position:absolute;left:0;top:0;height:100%;display:block;touch-action:none;outline:none;width:' +
      (role === 'fly' ? '166.6667%' : '100%');
    host.appendChild(canvas);
    let e: WorldEngine;
    try {
      e = new WorldEngine(canvas);
      e.setPreset(world.preset);
    } catch (err) {
      console.warn('[world engine] could not start', err);
      canvas.remove();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the engine can only be tried once mounted
      setFailed(true);
      return;
    }
    const st = useWorldStore.getState();
    if (role === 'globe') {
      st.load(world);
      st.setGlobe(e);
      useWorldStore.setState({ playing: !reducedMotion() });
    } else {
      // The close-up opens in the state the globe is in: same controls, same turn angle, same clock.
      if (st.world?.preset.id === world.preset.id) e.setOverrides(st.applied);
      st.setFly(e);
    }
    setEngine(e);
    // A lost GL context leaves a black canvas: report it so the old path draws instead (not while we release it ourselves).
    const onLost = (ev: Event) => {
      ev.preventDefault();
      if (!dead) setFailed(true);
    };
    canvas.addEventListener('webglcontextlost', onLost);
    // Dev only: the verification scripts (issue #71) read and drive the engines through these.
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>)[`__sxWorld_${role}`] = e;

    // The world holds still while it forms (so the turn angle, and with it where the Sun is, stays what the
    // artifact has when its user presses Surface view) and starts moving when it has settled.
    e.playing = false;
    let released = false;
    let dead = false;
    let raf = 0;
    let shown = true;
    let last = performance.now();
    const frame = (now: number) => {
      if (dead) return;
      const dt = (now - last) / 1000;
      last = now;
      if (!released && e.spinup === 0) {
        released = true;
        const g = useWorldStore.getState();
        if (role === 'fly' && g.globe) e.syncSpin(g.globe);
        e.playing = g.playing;
      }
      if (shown && !document.hidden) e.tick(dt);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((es) => {
            for (const x of es) {
              const was = shown;
              shown = x.isIntersecting;
              // The fly pane was hidden while the globe turned: catch up to its phase when it shows again.
              if (role === 'fly' && shown && !was && released) {
                const g = useWorldStore.getState().globe;
                if (g) e.syncSpin(g);
              }
            }
          });
    io?.observe(host);
    // A new size is a new picture; nothing else redraws a paused world.
    const ro =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (drawReady(e)) e.draw();
          });
    ro?.observe(canvas);
    // React reads the readouts a few times a second while the world moves or forms, and not at all when it is paused and settled.
    let wasForming = true;
    const id = window.setInterval(() => {
      const forming = e.spinup > 0;
      if (shown && (e.playing || forming || wasForming)) bump();
      wasForming = forming;
    }, 400);
    return () => {
      if (import.meta.env.DEV) (window as unknown as Record<string, unknown>)[`__sxWorld_${role}`] = null;
      dead = true;
      canvas.removeEventListener('webglcontextlost', onLost);
      cancelAnimationFrame(raf);
      window.clearInterval(id);
      io?.disconnect();
      ro?.disconnect();
      const s = useWorldStore.getState();
      if (role === 'globe' && s.globe === e) s.setGlobe(null);
      if (role === 'fly' && s.fly === e) s.setFly(null);
      e.dispose();
      canvas.remove();
      setEngine(null);
    };
    // `world` is read once per mount: the hosts are keyed by the preset id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, presetId]);

  useEffect(() => {
    if (failed) onFail?.();
  }, [failed, onFail]);

  return { hostRef, engine, rev, bump, failed };
}

/** "Forming the planet…": drawn over the canvas until the spin-up has finished, so a half-formed world is never shown. */
function Forming({ gas }: { gas: boolean }) {
  // The build pane's MouldAnimation draws over this cover (and says the same words); the cover stays
  // so a half-formed world is never shown, and the words stay as the accessible status.
  useEffect(() => {
    useMouldLive.getState().setForming(true);
    return () => useMouldLive.getState().setForming(false);
  }, []);
  return (
    <div className="absolute inset-0 z-[2] bg-black" data-testid="world-forming">
      <span className="sr-only" role="status">
        {gas ? 'Forming the atmosphere' : 'Forming the planet…'}
      </span>
    </div>
  );
}

const SPIN_OPTIONS: { value: SpinMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'lock', label: 'Locked' },
  { value: 'res32', label: '3:2 resonance' },
  { value: 'rot', label: 'Rotating' },
];
const TECT_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'plates', label: 'Moving plates' },
  { value: 'lid', label: 'Stagnant lid' },
];
const LAYER_OPTIONS = ['Surface', 'Plates', 'Rainfall', 'Currents', 'Water'].map((label, i) => ({ value: String(i), label }));
const TIME_OPTIONS = [
  { value: '300', label: '5 minutes per second' },
  { value: '86400', label: '1 day per second' },
];

/** Every artifact world control as a BuildControls spec, mapped onto `WorldEngine.setOverrides`. */
export function worldControls(
  world: CardToWorldOk,
  engine: WorldEngine,
  s: EngineState,
  playing: boolean,
  apply: (o: Parameters<WorldEngine['setOverrides']>[0]) => void,
  setPlaying: (p: boolean) => void,
): BuildControlsSpec {
  const r = engine.readouts();
  const m = r.model as { a: number } | null;
  const t = world.tags;
  const gas = s.gas;
  const controls: BuildControl[] = [
    {
      id: 'fluid',
      kind: 'choice',
      label: 'Surface fluid',
      value: s.fluid,
      options: (Object.keys(WORLD_FLUIDS) as FluidKey[]).map((k) => ({ value: k, label: FLUID_LABEL(k) })),
      tag: t.fluid ?? 'model_dependent',
      onChange: (v) => apply({ fluid: v as FluidKey }),
    },
    { id: 'pause', kind: 'toggle', label: 'Pause', pressed: !playing, onChange: (p) => setPlaying(!p) },
  ];
  if (gas) {
    controls.push({
      id: 'time',
      kind: 'choice',
      label: 'Time',
      value: String(s.timeSec),
      options: TIME_OPTIONS,
      tag: 'artistic',
      onChange: (v) => apply({ timeSec: Number(v) }),
    });
  } else {
    controls.push(
      {
        id: 'spin',
        kind: 'choice',
        label: 'Spin',
        value: s.spin,
        options: SPIN_OPTIONS,
        tag: t.locked ?? 'model_dependent',
        onChange: (v) => apply({ spin: v as SpinMode }),
      },
      {
        id: 'tect',
        kind: 'choice',
        label: 'Crust',
        value: s.tect,
        options: TECT_OPTIONS,
        tag: 'model_dependent',
        why: 'Whether plates move is an assumption for every planet here.',
        onChange: (v) => apply({ tect: v as 'auto' | 'plates' | 'lid' }),
      },
      {
        id: 'layer',
        kind: 'choice',
        label: 'Show',
        value: String(s.overlay),
        options: LAYER_OPTIONS,
        tag: 'model_dependent',
        onChange: (v) => apply({ overlay: Number(v) }),
      },
      {
        id: 'co2',
        kind: 'toggle',
        label: 'CO₂ thermostat',
        pressed: s.co2,
        tag: 'model_dependent',
        onChange: (on) => apply({ co2: on }),
      },
      {
        id: 'clouds',
        kind: 'toggle',
        label: 'Clouds',
        pressed: s.clouds,
        tag: 'model_dependent',
        onChange: (on) => apply({ clouds: on }),
      },
      {
        id: 'zoom',
        kind: 'slider',
        label: 'Zoom',
        min: 0,
        max: 1000,
        step: 1,
        value: Math.round((Math.log(s.zoom) / Math.log(10)) * 1000),
        valueText: `${fmt(s.zoom, 1)}×`,
        tag: 'artistic',
        onChange: (v) => apply({ zoom: Math.exp((v / 1000) * Math.log(10)) }),
      },
      {
        id: 'obl',
        kind: 'slider',
        label: 'Axial tilt',
        min: 0,
        max: 85,
        step: 1,
        value: Math.round(s.obl * 57.2958),
        valueText: `${fmt(s.obl * 57.2958, 1)}°`,
        tag: 'model_dependent',
        disabled: s.locked,
        why: s.locked ? 'Not used: a locked planet keeps one face to its star.' : 'Not on the card; upright unless you tilt it.',
        onChange: (v) => apply({ obl: v / 57.2958 }),
      },
      {
        id: 'ecc',
        kind: 'slider',
        label: 'Orbit eccentricity',
        min: 0,
        max: 400,
        step: 1,
        value: Math.round(s.ecc * 1000),
        valueText: fmt(s.ecc, 3),
        tag: 'model_dependent',
        why: 'Not on the card; circular unless you change it.',
        onChange: (v) => apply({ ecc: v / 1000 }),
      },
    );
  }
  controls.push(
    {
      id: 'star',
      kind: 'slider',
      label: 'Star temperature',
      min: 0,
      max: 1000,
      step: 1,
      value: toSlider(s.Tstar, STAR),
      valueText: `${fmt(s.Tstar)} K`,
      tag: t.Ts ?? 'model_dependent',
      onChange: (v) => apply({ Tstar: fromSlider(v, STAR) }),
    },
    {
      id: 'orbit',
      kind: 'slider',
      label: 'Orbit size',
      min: 0,
      max: 1000,
      step: 1,
      value: toSlider(s.orbit, ORB),
      valueText: m ? `${fmt(m.a, m.a < 1 ? 3 : 2)} AU` : undefined,
      tag: t.a ?? 'model_dependent',
      onChange: (v) => apply({ orbit: fromSlider(v, ORB) }),
    },
    {
      id: 'ps',
      kind: 'slider',
      label: 'Atmosphere pressure',
      min: 0,
      max: 1000,
      step: 1,
      value: toSlider(s.Ps, PS),
      valueText: gas ? 'not used for a giant' : `${s.Ps < 0.1 ? fmt(s.Ps, 3) : fmt(s.Ps, 1)} bar`,
      tag: t.Ps ?? 'model_dependent',
      disabled: gas,
      why: gas ? 'A gas giant has no surface to press on.' : undefined,
      onChange: (v) => apply({ Ps: fromSlider(v, PS) }),
    },
  );
  const rowTag = (label: string): Tag => READOUT_TAG[label] ?? 'model_dependent';
  const rowOf = (label: string): string | undefined => r.rows.find(([l]) => l === label)?.[1];
  const key = (id: string, label: string, value: string | undefined, tag: Tag): void => {
    if (value !== undefined) controls.push({ id: `k-${id}`, kind: 'readout', slot: 'key', label, value, tag });
  };
  const p = world.preset;
  const radiusKm = `${fmt(p.Rj * 71492)} km`;
  if (gas) {
    key('temp', 'Temperature', rowOf('Equilibrium temperature'), rowTag('Equilibrium temperature'));
    key('radius', 'Radius', radiusKm, t.Rj ?? 'model_dependent');
    const prot = p.Prot ?? (p.locked ? p.P : undefined);
    key('rot', 'Rotation period', prot === undefined ? undefined : prot < 2 ? `${fmt(prot * 24, 1)} hours` : `${fmt(prot, 1)} days`, t.Prot ?? 'model_dependent');
    key('wind', 'Wind speed', rowOf('Wind speed'), rowTag('Wind speed'));
  } else {
    key('temp', 'Surface temperature', rowOf('Average surface temperature'), rowTag('Average surface temperature'));
    key('radius', 'Radius', radiusKm, t.Rj ?? 'model_dependent');
    key('ps', 'Surface pressure', `${s.Ps < 0.1 ? fmt(s.Ps, 3) : fmt(s.Ps, 1)} bar`, t.Ps ?? 'model_dependent');
    const g = (6.674e-11 * p.Me * 5.972e24) / (p.Rj * 71492e3) ** 2;
    key('g', 'Surface gravity', `${fmt(g, 1)} m/s\u00b2`, 'derived');
  }
  const inKey = gas ? ['Equilibrium temperature', 'Wind speed'] : ['Average surface temperature'];
  for (const [label, value] of r.rows)
    if (!inKey.includes(label)) controls.push({ id: `r-${label}`, kind: 'readout', label, value, tag: rowTag(label) });
  const filled = [
    ...world.assumptions.map((a) => `${a.field} = ${String(a.value)}: ${a.note}.`),
    ...world.mismatches.map((m) => `Differs from the artifact: ${m}.`),
  ];
  const notes: BuildNote[] = filled.length ? [{ title: 'Filled in, not measured', lines: filled }] : [];
  return { title: gas ? 'Gas giant' : 'Planet surface', controls, notes };
}

/** The prototype's world stage (globe), on the build pane's globe stage. */
export function WorldGlobeStage({ world, onFail }: { world: CardToWorldOk; onFail?: () => void }) {
  const { hostRef, engine, bump, failed, rev: clock } = useWorldEngine('globe', world, onFail);
  const rev = useWorldStore((s) => s.rev);
  const playing = useWorldStore((s) => s.playing);
  const apply = useWorldStore((s) => s.apply);
  const setPlaying = useWorldStore((s) => s.setPlaying);
  const flyOpen = useCloseUpStore((s) => !s.hidden && !s.held);

  // Looked up each render on purpose: the engine is the single source of truth for every value.
  const state = engine?.state();
  const spec = useMemo(
    () => (engine ? worldControls(world, engine, engine.state(), playing, apply, setPlaying) : null),
    // `rev` stands for "something the engine changed"; the clock bumps it while the world moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, world, playing, apply, setPlaying, rev, clock, bump],
  );
  useBuildControls('world', spec);

  // Click a place: the left close-up goes there (the artifact's globePick). With the close-up closed, drag turns a rocky world.
  useEffect(() => {
    const host = hostRef.current;
    const canvas = host?.querySelector('canvas');
    if (!engine || !canvas) return;
    let drag: { x: number; y: number } | null = null;
    const px = (e: PointerEvent): [number, number] => {
      const rc = canvas.getBoundingClientRect();
      const k = canvas.width / rc.width;
      return [(e.clientX - rc.left) * k, (e.clientY - rc.top) * k];
    };
    const canTurn = () => !engine.state().gas;
    canvas.style.cursor = 'grab';
    const down = (e: PointerEvent) => {
      if (useWorldStore.getState().fly) {
        const p = engine.globePick(...px(e));
        if (p) useWorldStore.getState().pick(p.lon, p.lat);
        return;
      }
      if (!canTurn()) return;
      drag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const s = engine.state();
      useWorldStore.getState().apply({
        yaw: s.yaw + ((e.clientX - drag.x) * 0.006) / s.zoom,
        pitch: Math.max(-1.4, Math.min(1.4, s.pitch + ((e.clientY - drag.y) * 0.006) / s.zoom)),
      });
      drag = { x: e.clientX, y: e.clientY };
    };
    const end = () => {
      drag = null;
      canvas.style.cursor = 'grab';
    };
    const key = (e: KeyboardEvent) => {
      if (useWorldStore.getState().fly || !canTurn()) return;
      const s = engine.state();
      const d: Record<string, [number, number]> = { ArrowLeft: [-0.1, 0], ArrowRight: [0.1, 0], ArrowUp: [0, -0.1], ArrowDown: [0, 0.1] };
      const mv = d[e.key];
      if (!mv) return;
      e.preventDefault();
      useWorldStore.getState().apply({ yaw: s.yaw + mv[0], pitch: Math.max(-1.4, Math.min(1.4, s.pitch + mv[1])) });
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('keydown', key);
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', `${world.preset.label}, simulated planet. Click a place to look at it in the close-up on the left.`);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', end);
      canvas.removeEventListener('pointercancel', end);
      canvas.removeEventListener('keydown', key);
    };
  }, [engine, hostRef, world.preset.label]);

  const forming = !!engine && engine.spinup > 0;
  return (
    <div
      ref={hostRef}
      className="absolute inset-0 z-[1] overflow-hidden bg-black"
      data-testid="world-engine-globe"
      data-world={world.preset.label}
      data-fly={flyOpen ? '1' : '0'}
      data-failed={failed ? '1' : '0'}
      data-spinup={engine ? engine.spinup : ''}
    >
      {forming && <Forming gas={!!state?.gas} />}
    </div>
  );
}

// Moon (11 Nov 2026): no on-render control bars. Height follows scroll, pinch and the zoom bar; the
// layer list lives in Details. Kept behind this flag so the controls can come back.
const SHOW_FLY_BAR = false as boolean;
/** The prototype's surface (fly) view with its altitude slider and Fly forward, in the left pane. */
export function WorldFlyStage({
  world,
  reduced,
  onFail,
}: {
  world: CardToWorldOk;
  reduced: boolean;
  onFail?: () => void;
}) {
  const { hostRef, engine, bump, failed } = useWorldEngine('fly', world, onFail);
  const target = useWorldStore((s) => s.target);
  const [entered, setEntered] = useState(false);
  const settled = !!engine && engine.spinup === 0;
  const [about, setAbout] = useState(false);
  const [, redo] = useReducer((n: number) => n + 1, 0);

  // Entry: draw the globe view once (the camera aims from it), then the artifact's aim and landing height.
  useEffect(() => {
    const host = hostRef.current;
    const canvas = host?.querySelector('canvas');
    if (!engine || !canvas) return;
    let done = false;
    const enter = () => {
      if (done || engine.spinup > 0) return;
      engine.draw();
      if (!engine.view()) return;
      engine.setFly(true);
      done = true;
      setEntered(true);
      if (drawReady(engine)) engine.draw();
      bump();
    };
    enter();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(enter);
    ro?.observe(canvas);
    return () => ro?.disconnect();
  }, [engine, hostRef, bump, settled]);

  // A click on the globe (build pane): go there.
  useEffect(() => {
    if (!engine || !entered || !target) return;
    engine.setFlyPlace(target.lon, target.lat);
    if (drawReady(engine)) engine.draw();
    redo();
  }, [engine, entered, target]);

  // Scroll for altitude, drag to look, arrows or W A S D to move.
  useEffect(() => {
    const host = hostRef.current;
    const canvas = host?.querySelector('canvas');
    if (!engine || !entered || !host || !canvas) return;
    const draw = () => {
      if (drawReady(engine)) engine.draw();
      redo();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = engine.altRange();
      engine.fly.alt = Math.max(r[0], Math.min(r[1], engine.fly.alt * Math.exp(e.deltaY * 0.0015)));
      draw();
    };
    let drag: [number, number] | null = null;
    const down = (e: PointerEvent) => {
      drag = [e.clientX, e.clientY];
      canvas.setPointerCapture(e.pointerId);
      canvas.focus();
      canvas.style.cursor = 'grabbing';
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      engine.fly.head += (e.clientX - drag[0]) * 0.005;
      engine.fly.pitch = Math.max(-1.2, Math.min(0.6, engine.fly.pitch - (e.clientY - drag[1]) * 0.004));
      drag = [e.clientX, e.clientY];
      draw();
    };
    const end = () => {
      drag = null;
      canvas.style.cursor = 'grab';
    };
    const key = (e: KeyboardEvent) => {
      // Browser and system shortcuts (Ctrl+S, Cmd+W, Alt+Left) are not ours.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const st = Math.max(2, engine.fly.alt * 0.8);
      const k = e.key;
      if (k === 'ArrowUp' || k === 'w') engine.flyMove(st, 0);
      else if (k === 'ArrowDown' || k === 's') engine.flyMove(-st, 0);
      else if (k === 'ArrowLeft' || k === 'a') engine.fly.head -= 0.08;
      else if (k === 'ArrowRight' || k === 'd') engine.fly.head += 0.08;
      else return;
      e.preventDefault();
      draw();
    };
    canvas.style.cursor = 'grab';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute(
      'aria-label',
      'Surface view. Scroll to change height, drag to look around, arrow keys or W A S D to move and turn.',
    );
    host.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('keydown', key);
    return () => {
      host.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', end);
      canvas.removeEventListener('pointercancel', end);
      canvas.removeEventListener('keydown', key);
    };
  }, [engine, entered, hostRef]);

  const gas = engine?.state().gas ?? false;
  const range = engine ? engine.altRange() : ([1, 2] as [number, number]);
  const alt = engine && entered ? engine.fly.alt : 0;
  const forming = !!engine && engine.spinup > 0;
  return (
    <div className="absolute inset-0 z-[1] overflow-hidden bg-black" data-testid="world-engine-fly" data-failed={failed ? '1' : '0'}>
      <div ref={hostRef} className="absolute inset-0" />
      {forming && <Forming gas={gas} />}
      {SHOW_FLY_BAR && engine && entered && (
        <div className="sx-cu-controls" role="group" aria-label="Surface view controls" style={{ zIndex: 3 }}>
          <label htmlFor="world-alt" className="flex-1 basis-40">
            {gas ? 'Height above the clouds' : 'Height above the ground'}:{' '}
            <span data-testid="world-alt-label">{`${fmt(alt, alt < 10 ? 1 : 0)} km`}</span>
            <input
              id="world-alt"
              type="range"
              min={0}
              max={1000}
              step={1}
              value={altToSlider(alt, range)}
              aria-valuetext={`${fmt(alt, alt < 10 ? 1 : 0)} km`}
              className="mt-1 block w-full"
              onChange={(e) => {
                engine.setFlyAlt(sliderToAlt(Number(e.target.value), range));
                if (drawReady(engine)) engine.draw();
                redo();
              }}
            />
          </label>
          <button
            type="button"
            className={`${buttonClass} ${pressedClass}`}
            aria-pressed={engine.fly.auto}
            disabled={reduced}
            title={reduced ? 'Off while you prefer reduced motion' : undefined}
            onClick={() => {
              engine.setFlyAuto(!engine.fly.auto);
              redo();
            }}
          >
            Fly forward
          </button>
          <button type="button" className={buttonClass} aria-expanded={about} onClick={() => setAbout((a) => !a)}>
            What is drawn
          </button>
        </div>
      )}
      {SHOW_FLY_BAR && engine && about && (
        <div
          className="absolute inset-x-4 bottom-36 z-[3] max-h-[45%] overflow-auto rounded-lg border border-[#323a3e] bg-[#242729f2] p-3 text-xs text-neutral-200"
          data-testid="world-layers"
        >
          <p className="mb-2">{WORLD_NOTE_LINES.find((l) => l.startsWith('Surface view:'))}</p>
          <ul className="flex flex-col gap-1">
            <li className="flex flex-wrap items-center gap-2">
              <ProvenanceBadge tag="model_dependent" />
              <span>Terrain, climate, rivers, clouds and winds: the world engine&rsquo;s model, run from this object&rsquo;s numbers.</span>
            </li>
            <li className="flex flex-wrap items-center gap-2">
              <ProvenanceBadge tag="artistic" />
              <span>Detail finer than the terrain grid, and the heights, clouds and air drawn {gas ? '2' : '3'} times taller than real.</span>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

/** The honesty caption of the left pane while the engine's surface view is shown (the mock-up's `.cu-tag`). */
export function worldCaption(gas: boolean): string {
  return `Close-up · from orbit, click the globe to look at a place · heights, clouds and air drawn ${gas ? '2' : '3'} times taller, fine detail is an artist's addition (Default), not a photograph`;
}

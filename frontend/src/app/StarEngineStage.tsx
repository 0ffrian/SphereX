// Issue #71 stream X (D-37): hosts the approved prototype's star engine in the app. `StarGlobeStage`
// fills the build pane's globe stage for a star card; `StarFlareStage` fills the left close-up pane with
// the prototype's flare close-up and its light-curve chart. Both draw on their own canvases (raw WebGL 2,
// the prototype's own shaders) for ANY star card; the controls and the "How each part is worked out"
// notes go to the build pane's Details through `useBuildControls`. A star the engine refuses (no
// temperature, brown dwarf, Mira) or a browser without WebGL 2 keeps the TSL star path (the hosts call
// `onFail`, or are not mounted at all, see `useEngineStar`).
//
// Issue #93 W1: the star's shader compiles in the background while a loader shows (B7); a compile that fails or has
// not finished after STAR_READY_TIMEOUT_MS takes the TSL path (the engine watchdog); the engine loop draws at most 60
// frames a second (STAR_FPS_CAP); the surface close-up keeps only its surface canvas (render notes 0.5).
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Tag } from '@/contract';
import { useAppStore } from '@/state/store';
import { nudge, projectSurface, globeRot, GLOBE_TILT } from '@/engine/stars/starPick';
import { placeText, useStarTarget } from './starTargetStore';
import { useStarChart } from './starChartStore';
import { useStarView } from './starViewStore';
import { useBuildControls, type BuildControl, type BuildControlsSpec, type BuildNote } from './build/BuildControls';
import { cardToStar, type StarFromCard } from '@/engine/stars/cardToStar';
import { FrameCap } from '@/viewer/render/quality';
import { readyOrTimeout, STAR_READY_TIMEOUT_MS } from './engineWatchdog';
import GridLoader, { type GridLoaderProps } from './island/GridLoader';
import {
  StarEngine,
  starEngineSupported,
  type StarLight,
  type StarMode,
  type StarScaleView,
} from '@/engine/stars/StarEngine';

/** The engine's star for the shown card, or null: no star card, refused, or no WebGL 2 (TSL fallback). */
export function useEngineStar(): StarFromCard | null {
  const card = useAppStore((s) => s.card);
  return useMemo(() => {
    if (!starEngineSupported()) return null;
    const r = cardToStar(card);
    return r.ok ? r : null;
  }, [card]);
}

const READOUT_TAG: Record<string, Tag> = {
  'Colour from the spectrum': 'derived',
  'Brightest wavelength': 'derived',
  'Surface gravity': 'derived',
  'Size of one cell': 'model_dependent',
  'Cells per star radius': 'model_dependent',
  'Boiling cells': 'derived',
  'Rossby number': 'model_dependent',
  'Average magnetic field': 'model_dependent',
  'Magnetic field': 'model_dependent',
  'Surface covered by spots': 'inferred_from_analog',
  'X10 flare, about every': 'inferred_from_analog',
};
const LIGHT_LABEL: Record<StarLight, string> = {
  0: 'True colour',
  2: 'Enhanced',
  3: 'Observatory',
};
// The left pane is the close-up now, so the globe offers two views; the engine's 'close' view is not offered.
const SCALE_LABEL: Partial<Record<StarScaleView, string>> = {
  big: 'Larger detail',
  true: 'True scale',
};

/**
 * Issue #93 W1 (render notes 0.2, star host only): the engine loop draws at most this many frames a second (a due-time
 * cap, `FrameCap`: on a 144 Hz panel the frames come 13.9 or 20.8 ms apart, about 58 a second on average). Each step
 * advances by the real time since the last drawn frame, so the star moves at the same speed. The prototype's own
 * resolution scalers react to the frame time: the surface shrinks above an average of 42 ms and grows below 19 ms, the
 * plasma above 36 ms and below 20 ms. A cap at 60 keeps the average near 17 ms, under both "grow" limits, so the cap
 * never holds the picture at a lower resolution; a cap below about 53 a second would. null: no cap (the display rate).
 * Q-66 and R5.7 say the three.js path draws at the display rate; they do not cover the engines (see the W1 report).
 */
export const STAR_FPS_CAP: number | null = 60;

/** Builds the engine in `host`, drives its clock, and keeps React in step with it. */
function useStarEngine(
  mode: StarMode,
  star: StarFromCard,
  redrawMs: number,
  slot: string = mode,
  surface = false,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<StarEngine | null>(null);
  const [failed, setFailed] = useState(false);
  /** True until the star's shader has compiled (the loader shows meanwhile). */
  const [compiling, setCompiling] = useState(true);
  const [rev, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let dead = false;
    let broken = false;
    let e: StarEngine | null = null;
    let onLost: ((ev: Event) => void) | null = null;
    let raf = 0;
    let io: IntersectionObserver | null = null;
    let ro: ResizeObserver | null = null;
    let id = 0;
    let cancelReady = (): void => undefined;
    // Any failure to start (no WebGL 2, a compile or link error, a compile past the watchdog's limit, a lost context)
    // takes the TSL path: the host calls onFail and unmounts this stage.
    const fail = (err: unknown) => {
      if (dead || broken) return;
      broken = true;
      console.warn('[star engine] could not start', err);
      cancelReady();
      cancelAnimationFrame(raf);
      window.clearInterval(id);
      setFailed(true);
    };
    // Built a tick later, so React's development double mount (mount, unmount, mount in one go) builds one engine,
    // not two compiling the same shader (as WorldEngineStage does).
    const boot = window.setTimeout(() => {
      if (dead) return;
      let en: StarEngine;
      try {
        en = new StarEngine(host, { mode, surface });
      } catch (err) {
        fail(err);
        return;
      }
      e = en;
      if (!en.supported) {
        fail(new Error('this browser gave the star no WebGL 2'));
        return;
      }
      setEngine(en);
      // A lost GL context leaves a black canvas: report it so the TSL path draws instead (not while we release it ourselves).
      onLost = (ev: Event) => {
        ev.preventDefault();
        fail(new Error('WebGL context lost'));
      };
      for (const c of en.layers) c.addEventListener('webglcontextlost', onLost);
      // Dev only: the parity scripts (issue #71) pause and seek the engine through this.
      if (import.meta.env.DEV)
        (window as unknown as Record<string, unknown>)[`__sxStar_${slot}`] = en;
      let shown = true;
      const cap = new FrameCap(STAR_FPS_CAP ? 1000 / STAR_FPS_CAP : null);
      let last = performance.now();
      const frame = (now: number) => {
        if (dead || broken) return;
        if (cap.shouldDraw(now)) {
          const dt = (now - last) / 1000;
          last = now;
          try {
            if (shown && !document.hidden) en.tick(dt);
          } catch (err) {
            // An exception here used to end the loop silently, leaving a frozen star.
            fail(err);
            return;
          }
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      io =
        typeof IntersectionObserver === 'undefined'
          ? null
          : new IntersectionObserver((es) => {
              for (const x of es) shown = x.isIntersecting;
            });
      io?.observe(host);
      ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => en.draw());
      ro?.observe(host);
      id = window.setInterval(() => {
        if (shown) bump();
      }, redrawMs);
      // Issue #93 W1 (B7): the shader compiles in the background; the loader shows until it is linked.
      cancelReady = readyOrTimeout(
        en.whenReady(),
        STAR_READY_TIMEOUT_MS,
        () => {
          if (dead) return;
          setCompiling(false);
          bump();
        },
        fail,
      );
    }, 0);
    return () => {
      window.clearTimeout(boot);
      dead = true;
      cancelReady();
      cancelAnimationFrame(raf);
      window.clearInterval(id);
      io?.disconnect();
      ro?.disconnect();
      if (e) {
        if (import.meta.env.DEV)
          (window as unknown as Record<string, unknown>)[`__sxStar_${slot}`] = null;
        if (onLost) for (const c of e.layers) c.removeEventListener('webglcontextlost', onLost);
        // Never blocks: a compile still running is waited for in the background (StarEngine.dispose).
        e.dispose();
      }
      setEngine(null);
      setCompiling(true);
    };
  }, [mode, redrawMs, slot, surface]);

  // A new star: the same engine, a new preset.
  const { preset } = star;
  useEffect(() => {
    if (!engine) return;
    engine.setStar(preset);
    bump();
  }, [engine, preset]);

  // Light and field lines are one state for the globe and both close-ups (the Details controls write it here).
  const light = useStarView((s) => s.light);
  const lines = useStarView((s) => s.lines);
  useEffect(() => {
    if (!engine) return;
    if (engine.light !== light) engine.setLight(light);
    engine.setFieldLines(lines);
    engine.draw();
    bump();
  }, [engine, light, lines]);

  // The View pill reaches the close-up too (cell size: larger detail or true scale).
  const scale = useStarView((s) => s.scale);
  useEffect(() => {
    if (!engine || engine.scale === scale) return;
    engine.setScale(scale);
    engine.draw();
    bump();
  }, [engine, scale]);

  return { hostRef, engine, failed, compiling: compiling && !failed, rev, bump };
}

/** The build pane's loader sequence (as WorldEngineStage's "Forming…"), so the waits look alike. */
const STAR_LOADER_LOOK: GridLoaderProps = {
  mode: 'sequence',
  sequence: ['spiral-cw', 'ripple-out', 'plus-full', 'frame', 'ripple-in', 'spiral-ccw'],
  speed: 'normal',
};

const reducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/**
 * Issue #93 W1 (B7): drawn over the stage while the star's shader compiles, so a slow first compile never looks like a
 * frozen or empty page. It does not block: the controls and readouts already work. Under reduced motion it stands still.
 */
export function StarPreparing() {
  const reduced = reducedMotion();
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[2] grid place-content-center justify-items-center gap-3 bg-black text-center text-xs text-neutral-300"
      data-testid="star-preparing"
    >
      <span aria-hidden="true">
        <GridLoader
          color="green"
          rounded
          size={36}
          gap={2}
          blur={0.3}
          {...(reduced ? { pattern: 'heartbeat', static: true } : STAR_LOADER_LOOK)}
        />
      </span>
      <span role="status">
        Preparing the star…
        <span className="mt-1 block text-neutral-400">
          Preparing the graphics. The first time can take a few seconds.
        </span>
      </span>
    </div>
  );
}

/** The left close-up's zoom: wheel and two-finger pinch on the stage, and registration for the zoom bar. */
function useCloseUpZoom(host: React.RefObject<HTMLDivElement | null>, engine: StarEngine | null, bump: () => void) {
  useEffect(() => {
    if (!engine) return;
    useStarView.getState().setCloseUp(engine);
    return () => {
      if (useStarView.getState().closeUp === engine) useStarView.getState().setCloseUp(null);
    };
  }, [engine]);
  useEffect(() => {
    const el = host.current;
    if (!el || !engine) return;
    const apply = (k: number) => {
      engine.setZoom(engine.zoom * k);
      bump();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      apply(Math.exp(-e.deltaY * 0.0015));
    };
    const pts = new Map<number, { x: number; y: number }>();
    let last = 0;
    const dist = () => {
      const [a, b] = [...pts.values()];
      return Math.hypot(a!.x - b!.x, a!.y - b!.y);
    };
    const down = (e: PointerEvent) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) last = dist();
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const d = dist();
        if (last > 0 && d > 0) apply(d / last);
        last = d;
      }
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      last = 0;
    };
    el.style.setProperty('touch-action', 'none');
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, [host, engine, bump]);
}

/** "0.19 R☉" for a small star, "281,341 km" never: the short form of the radius. */
function sizeText(rsun: number): string {
  return `${rsun < 10 ? rsun.toFixed(2) : Math.round(rsun).toLocaleString('en')} R\u2609`;
}

/** The prototype's "Star surface" stage, on the build pane's globe stage. */
export function StarGlobeStage({ star, onFail }: { star: StarFromCard; onFail?: () => void }) {
  const { hostRef, engine, failed, compiling, bump } = useStarEngine('globe', star, 500);
  const target = useStarTarget((s) => s.target);
  // A new star starts looking at its strongest spot group, on the flare close-up.
  useEffect(() => useStarTarget.getState().reset(), [star.preset.id]);
  useEffect(() => {
    if (failed) onFail?.();
  }, [failed, onFail]);

  let spec: BuildControlsSpec | null = null;
  if (engine) {
    const flares = engine.hasFlares();
    const rot = engine.rotation();
    const controls: BuildControl[] = [
      {
        id: 'light',
        kind: 'choice',
        label: 'Light',
        value: String(engine.light),
        options: ([0, 2, 3] as StarLight[]).map((l) => ({ value: String(l), label: LIGHT_LABEL[l] })),
        onChange: (v) => useStarView.getState().setLight(Number(v) as StarLight),
      },
      {
        id: 'scale',
        kind: 'choice',
        label: 'View',
        value: engine.scale === 'close' ? 'true' : engine.scale,
        options: (Object.keys(SCALE_LABEL) as StarScaleView[]).map((s) => ({
          value: s,
          label: SCALE_LABEL[s] ?? s,
        })),
        onChange: (v) => {
          engine.setScale(v as StarScaleView);
          useStarView.getState().setScale(v as StarScaleView);
          bump();
        },
      },
      {
        id: 'lines',
        kind: 'toggle',
        group: 'flare-actions',
        label: 'Field lines',
        pressed: engine.fieldLines,
        onChange: (on) => useStarView.getState().setLines(on),
      },
      {
        id: 'fire',
        kind: 'button',
        group: 'flare-actions',
        label: 'Fire a big flare',
        disabled: !flares,
        why: flares ? undefined : 'This star has no spot groups, so it has no sunspot-driven flares.',
        onClick: () => {
          // The flare starts at the spot group the close-up is looking at (or the nearest one: a quiet place cannot flare).
          const cu = useStarView.getState().closeUp;
          const info = cu?.closeInfo();
          const group = info && info.near >= 0 ? info.near : undefined;
          engine.fireFlare(group);
          cu?.fireFlare(group);
          if (info && !info.active && info.nearAt) useStarTarget.getState().pick(info.nearAt);
          // The prototype's button switches to Observatory view when it fires in true colour: keep the others in step.
          useStarView.getState().setLight(engine.light);
          bump();
        },
      },
      ...(target !== null
        ? [
            {
              id: 'home',
              kind: 'button',
              label: 'Back to the active region',
              onClick: () => useStarTarget.getState().home(),
            } as BuildControl,
          ]
        : []),
      { id: 'latest', kind: 'readout', slot: 'latest', label: 'Latest flare on this star', value: engine.latestFlare(), tag: 'inferred_from_analog' },
      { id: 'k-teff', kind: 'readout', slot: 'key', label: 'Surface temperature', value: `${Math.round(star.teff.value).toLocaleString('en')} K`, tag: star.teff.tag },
      { id: 'k-size', kind: 'readout', slot: 'key', label: 'Size', value: sizeText(star.radius.value), tag: star.radius.tag },
      {
        id: 'k-rot',
        kind: 'readout',
        slot: 'key',
        label: 'Rotation period',
        value: rot.text,
        tag: star.rotation.tag,
      },
      ...engine.readouts().filter((r) => r.label !== 'Surface temperature').map(
        (r): BuildControl => ({
          id: `r-${r.label}`,
          kind: 'readout',
          slot: r.label === 'Average magnetic field' ? 'key' : undefined,
          label: r.label,
          value: r.value,
          tag: READOUT_TAG[r.label],
        }),
      ),
    ];
    // Key numbers come in a fixed order: the engine's own temperature and field rows are placed among ours.
    const order = ['Surface temperature', 'Size', 'Rotation period', 'Average magnetic field'];
    const keyed = controls.filter((c) => c.kind === 'readout' && c.slot === 'key');
    const others = controls.filter((c) => !(c.kind === 'readout' && c.slot === 'key'));
    keyed.sort((x, y) => order.indexOf(x.label) - order.indexOf(y.label));
    const notes: BuildNote[] = [];
    const filled = [...star.assumed];
    if (rot.used && star.rotation.note) filled.push(`Rotation period: ${star.rotation.note}`);
    if (filled.length) notes.push({ title: 'Filled in, not measured', lines: filled });
    spec = { title: 'Star surface', controls: [...others, ...keyed], notes };
  }
  useBuildControls('star-surface', spec);

  // Drag turns the star (yaw, by the engine's own clock `ST.time`, which sets its rotation: rot = 0.55 + time * 0.012).
  // A click (moved under 5 px) picks the place under the pointer; the left close-up moves there (the planets' globePick).
  const down = useRef<{ x: number; y: number; time: number; moved: boolean } | null>(null);
  const marker = useRef<HTMLSpanElement>(null);
  const clock = (): { time: number } | null => {
    const st = (engine?.state as { ST?: { time: number } } | undefined)?.ST;
    return st && typeof st.time === 'number' ? st : null;
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = down.current;
    const st = clock();
    if (!d || !engine || !st || engine.scale === 'close') return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= 5) return;
    d.moved = true;
    const b = e.currentTarget.getBoundingClientRect();
    const discPx = b.height / (2 * engine.globeHalf()); // pixels per star radius
    // Dragging right brings the surface to the right: the facing longitude (rot) goes down.
    st.time = d.time - ((e.clientX - d.x) / discPx) / 0.012;
    engine.draw();
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = down.current;
    down.current = null;
    if (!d || d.moved || !engine || engine.scale === 'close') return;
    const b = e.currentTarget.getBoundingClientRect();
    const p = engine.pick((e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height);
    if (p) useStarTarget.getState().pick(p);
  };
  // The marker for the picked place follows the star's turn; it hides on the far side.
  const picked = useStarTarget((s) => s.target);
  const hasFlares = engine?.hasFlares() ?? false;
  useEffect(() => {
    const el = marker.current;
    if (!el || !engine) return;
    let raf = 0;
    const place = () => {
      const st = clock();
      const c = engine.layers[0];
      // No pick yet: the close-up looks at the strongest spot group, so the ring marks that (as the planets' do).
      const at = picked ?? (hasFlares ? engine.closeTarget() : null);
      if (at && st && c && c.clientHeight && engine.scale !== 'close') {
        const q = projectSurface(at, globeRot(st.time), GLOBE_TILT);
        const aspect = c.clientWidth / c.clientHeight;
        el.style.display = q.visible ? 'block' : 'none';
        el.style.left = `${((q.x / (aspect * engine.globeHalf()) + 1) / 2) * 100}%`;
        el.style.top = `${((1 - q.y / engine.globeHalf()) / 2) * 100}%`;
      } else el.style.display = 'none';
      raf = requestAnimationFrame(place);
    };
    raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, picked, hasFlares]);
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!engine) return;
    const step = (5 * Math.PI) / 180;
    const d: Record<string, [number, number]> = {
      ArrowUp: [step, 0],
      ArrowDown: [-step, 0],
      ArrowRight: [0, step],
      ArrowLeft: [0, -step],
    };
    const m = d[e.key];
    if (!m) return;
    e.preventDefault();
    const st = useStarTarget.getState();
    st.pick(nudge(st.target ?? engine.closeTarget(), m[0], m[1]));
  };

  return (
    <div
      className="absolute inset-0 bg-black"
      style={{ touchAction: 'none', cursor: 'grab' }}
      tabIndex={0}
      role="application"
      aria-label="Star globe. Drag to turn the star. Click a place, or press the arrow keys, to look at that place in the close-up on the left."
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        down.current = { x: e.clientX, y: e.clientY, time: clock()?.time ?? 0, moved: false };
      }}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => {
        down.current = null;
      }}
      onKeyDown={onKey}
      data-testid="star-engine-globe"
      data-star={star.preset.label}
      data-preset={JSON.stringify(star.preset)}
    >
      <div ref={hostRef} className="absolute inset-0" />
      {compiling && <StarPreparing />}
      <span
        ref={marker}
        aria-hidden="true"
        data-testid="star-pick-marker"
        className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
        style={{ display: 'none' }}
      />
    </div>
  );
}

/**
 * The star's close-up, in the left pane: the engine's oblique flare/horizon camera over the CURRENT TARGET place (the
 * strongest spot group by default; a click on the globe moves it, as for the planets). The engine drives the view from the
 * star's own state there: its granulation, the spots near that place, loops and flares only where a spot group is. The
 * light curve and player in Details follow the flare at the target.
 */
export function StarFlareStage({ star, onFail }: { star: StarFromCard; onFail?: () => void }) {
  const { hostRef, engine, failed, compiling, bump } = useStarEngine('closeup', star, 150);
  useCloseUpZoom(hostRef, engine, bump);
  const target = useStarTarget((s) => s.target);
  const preset = star.preset;
  useEffect(() => {
    if (failed) onFail?.();
  }, [failed, onFail]);
  // The target moves the camera (null = the strongest spot group).
  useEffect(() => {
    if (!engine) return;
    engine.setCloseTarget(target);
    bump();
  }, [engine, target, preset, bump]);

  const flare = engine?.flare() ?? null;
  const chart = engine?.chart() ?? null;
  const info = engine?.closeInfo() ?? null;
  const at = engine ? engine.closeTarget() : null;
  let spec: BuildControlsSpec | null = null;
  if (engine && flare && info) {
    const quiet = !info.active;
    spec = {
      title: 'Close-up',
      controls: [
        {
          id: 'where',
          kind: 'readout',
          slot: 'where',
          label: 'Looking at',
          value: `Looking at ${placeText(target ?? at)} \u00b7 ${quiet ? 'quiet' : info.flaring ? 'flaring' : 'spot group'}`,
        },
        {
          id: 'kind',
          kind: 'choice',
          slot: 'about',
          label: 'Flare type',
          value: flare.kind,
          options: [
            { value: 'closed', label: 'Closed' },
            { value: 'open', label: 'Open' },
          ],
          onChange: (v) => {
            engine.setFlareKind(v as 'closed' | 'open');
            bump();
          },
        },
        {
          id: 'cls',
          kind: 'choice',
          slot: 'about',
          label: 'Flare class',
          value: flare.cls,
          options: [
            { value: 'c', label: 'C' },
            { value: 'm', label: 'M' },
            { value: 'x', label: 'X' },
          ],
          onChange: (v) => {
            engine.setFlareClass(v as 'c' | 'm' | 'x');
            bump();
          },
        },
        {
          id: 'stage',
          kind: 'readout',
          slot: 'about',
          label: 'What is happening',
          value: quiet
            ? 'A quiet place: boiling cells only. No spot group is in view, so there are no loops and no flare can start here. Pick a spot group on the globe, or press Fire a big flare.'
            : !info.auto
              ? `${flare.caption} (a flare you chose; press Play for the live one)`
              : info.flaring
                ? flare.caption
                : 'A spot group with its magnetic loops. No flare here right now; the star’s schedule will start one.',
        },
      ],
      notes: engine.notes(),
    };
  }
  useBuildControls('star-flare', spec);

  // The light curve goes to the Details pane (StarEngineDetails), not over the picture.
  const flareT = flare?.t;
  useEffect(() => {
    if (!engine || !chart || flareT === undefined) return;
    useStarChart.getState().set({
      soft: chart.soft,
      hard: chart.hard,
      t: flareT,
      playing: flare?.playing ?? false,
      setTime: (t) => {
        engine.setFlareTime(t);
        bump();
      },
      setPlaying: (p) => {
        engine.setPaused(!p);
        bump();
      },
    });
    // `chart` is a new object each read; the curves change only with the flare kind and class.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, flareT, flare?.playing, flare?.kind, flare?.cls]);
  useEffect(() => () => useStarChart.getState().set(null), []);

  return (
    <div
      className="absolute inset-0 bg-black"
      data-testid="star-engine-flare"
      data-at={at ? `${at.lat.toFixed(4)},${at.lon.toFixed(4)}` : ''}
      data-active={info ? String(info.active) : ''}
    >
      <div ref={hostRef} className="absolute inset-0" />
      {compiling && <StarPreparing />}
    </div>
  );
}

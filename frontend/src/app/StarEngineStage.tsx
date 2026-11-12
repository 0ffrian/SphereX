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
import { nudge } from '@/engine/stars/starPick';
import { placeText, useStarTarget } from './starTargetStore';
import { useBuildControls, type BuildControl, type BuildControlsSpec } from './build/BuildControls';
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
  2: 'Enhanced colour',
  3: 'Observatory view',
};
const SCALE_LABEL: Record<StarScaleView, string> = {
  big: 'Whole star, larger detail',
  true: 'Whole star, true scale',
  close: 'Close-up',
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

function starValuesNote(star: StarFromCard): BuildControl[] {
  const out: BuildControl[] = [];
  if (star.assumed.length)
    out.push({
      id: 'assumed',
      kind: 'readout',
      label: 'Filled in, not measured',
      value: star.assumed.join('; '),
      tag: 'model_dependent',
    });
  return out;
}

/** The prototype's "Star surface" stage, on the build pane's globe stage. */
export function StarGlobeStage({ star, onFail }: { star: StarFromCard; onFail?: () => void }) {
  const { hostRef, engine, failed, compiling, bump } = useStarEngine('globe', star, 500);
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
        options: ([0, 2, 3] as StarLight[]).map((l) => ({
          value: String(l),
          label: LIGHT_LABEL[l],
        })),
        onChange: (v) => {
          engine.setLight(Number(v) as StarLight);
          bump();
        },
      },
      {
        id: 'scale',
        kind: 'choice',
        label: 'View',
        value: engine.scale,
        options: (Object.keys(SCALE_LABEL) as StarScaleView[]).map((s) => ({
          value: s,
          label: SCALE_LABEL[s],
        })),
        onChange: (v) => {
          engine.setScale(v as StarScaleView);
          bump();
        },
      },
      {
        id: 'pause',
        kind: 'toggle',
        label: 'Pause',
        pressed: engine.paused,
        onChange: (p) => {
          engine.setPaused(p);
          bump();
        },
      },
      {
        id: 'lines',
        kind: 'toggle',
        label: 'Field lines',
        pressed: engine.fieldLines,
        onChange: (on) => {
          engine.setFieldLines(on);
          bump();
        },
      },
      {
        id: 'fire',
        kind: 'button',
        label: 'Fire a big flare',
        disabled: !flares,
        why: flares
          ? undefined
          : 'This star has no spot groups, so it has no sunspot-driven flares.',
        tag: 'inferred_from_analog',
        onClick: () => {
          engine.fireFlare();
          bump();
        },
      },
      {
        id: 'latest',
        kind: 'readout',
        label: 'Latest flare on this star',
        value: engine.latestFlare(),
        tag: 'inferred_from_analog',
      },
      {
        id: 'rot',
        kind: 'slider',
        label: 'Rotation period',
        min: 0,
        max: 1000,
        step: 1,
        value: rot.position,
        valueText: rot.text,
        tag: star.rotation.tag,
        disabled: !rot.used,
        why: rot.used
          ? star.rotation.note
          : 'Not used for this star: it has no outer convection layer or is not a dwarf.',
        onChange: (v) => {
          engine.setRotationPosition(v);
          bump();
        },
      },
      {
        id: 'what',
        kind: 'readout',
        label: 'What you are seeing',
        value: engine.caption() || engine.stageTag(),
      },
      ...engine.readouts().map((r): BuildControl => ({
        id: `r-${r.label}`,
        kind: 'readout',
        label: r.label,
        value: r.value,
        tag: r.label === 'Surface temperature' ? star.teff.tag : READOUT_TAG[r.label],
      })),
      ...starValuesNote(star),
    ];
    spec = { title: 'Star surface', controls, notes: engine.notes() };
  }
  useBuildControls('star-surface', spec);

  // Click a place: the left close-up moves there (the planets' globePick). Limb and space do nothing.
  const down = useRef<{ x: number; y: number } | null>(null);
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = down.current;
    down.current = null;
    if (
      !d ||
      !engine ||
      engine.scale === 'close' ||
      Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5
    )
      return;
    const b = e.currentTarget.getBoundingClientRect();
    const p = engine.pick((e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height);
    if (p) useStarTarget.getState().pick(p);
  };
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
      ref={hostRef}
      className="absolute inset-0 bg-black"
      tabIndex={0}
      role="application"
      aria-label="Star globe. Click a place, or press the arrow keys, to look at that place in the close-up on the left."
      onPointerDown={(e) => {
        down.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={onUp}
      onKeyDown={onKey}
      data-testid="star-engine-globe"
      data-star={star.preset.label}
      data-preset={JSON.stringify(star.preset)}
    >
      {compiling && <StarPreparing />}
    </div>
  );
}

// The chart of the prototype (its CH box and viewBox), drawn as SVG.
const CH = { x0: 44, x1: 512, y0: 124, y1: 12 };
const cx = (t: number) => CH.x0 + (CH.x1 - CH.x0) * t;
const cy = (v: number) => CH.y0 + (CH.y1 - CH.y0) * v;
const path = (a: number[]) =>
  a.map((v, i) => `${i ? 'L' : 'M'}${cx(i / 240).toFixed(1)} ${cy(v).toFixed(1)}`).join('');

/** The prototype's flare close-up with its light-curve chart, in the left pane. */
export function StarFlareStage({ star, onFail }: { star: StarFromCard; onFail?: () => void }) {
  const { hostRef, engine, failed, compiling, bump } = useStarEngine('closeup', star, 150);
  useEffect(() => {
    if (failed) onFail?.();
  }, [failed, onFail]);

  const flare = engine?.flare() ?? null;
  const chart = engine?.chart() ?? null;
  let spec: BuildControlsSpec | null = null;
  if (engine && flare) {
    spec = {
      title: 'Solar flare close-up',
      controls: [
        {
          id: 'kind',
          kind: 'choice',
          label: 'Flare type',
          value: flare.kind,
          options: [
            { value: 'closed', label: 'Closed' },
            { value: 'open', label: 'Open' },
          ],
          tag: 'artistic',
          onChange: (v) => {
            engine.setFlareKind(v as 'closed' | 'open');
            bump();
          },
        },
        {
          id: 'cls',
          kind: 'choice',
          label: 'Flare class',
          value: flare.cls,
          options: [
            { value: 'c', label: 'C' },
            { value: 'm', label: 'M' },
            { value: 'x', label: 'X' },
          ],
          tag: 'artistic',
          onChange: (v) => {
            engine.setFlareClass(v as 'c' | 'm' | 'x');
            bump();
          },
        },
        {
          id: 'pause',
          kind: 'toggle',
          label: 'Pause the flare',
          pressed: !flare.playing,
          onChange: (p) => {
            engine.setPaused(p);
            bump();
          },
        },
        {
          id: 'lines',
          kind: 'toggle',
          label: 'Flare field lines',
          pressed: engine.fieldLines,
          onChange: (on) => {
            engine.setFieldLines(on);
            bump();
          },
        },
        {
          id: 'time',
          kind: 'slider',
          label: 'Time since the start',
          min: 0,
          max: 1000,
          step: 1,
          value: Math.round(flare.t * 1000),
          valueText: flare.minutes,
          tag: 'artistic',
          onChange: (v) => {
            engine.setFlareTime(v / 1000);
            bump();
          },
        },
        { id: 'stage', kind: 'readout', label: 'What is happening', value: flare.caption },
      ],
      notes: engine.notes(),
    };
  }
  useBuildControls('star-flare', spec);

  const scrub = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!engine) return;
    const b = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - b.left) / b.width) * 524;
    engine.setFlareTime((px - CH.x0) / (CH.x1 - CH.x0));
    bump();
  };

  return (
    <div className="absolute inset-0 bg-black" data-testid="star-engine-flare">
      <div ref={hostRef} className="absolute inset-0" />
      {compiling && <StarPreparing />}
      {flare && (
        <span
          className="pointer-events-none absolute left-4 top-12 max-w-[calc(100%-2rem)] rounded bg-neutral-900/80 px-2 py-1 text-xs text-neutral-300"
          data-testid="flare-tag"
        >
          {flare.tag}
        </span>
      )}
      {chart && flare && (
        <div
          className="absolute inset-x-3 bottom-[8.75rem] z-[2] rounded-lg border border-neutral-700 bg-neutral-900/85 p-2"
          data-testid="flare-chart"
        >
          <div className="mb-1 flex flex-wrap items-center gap-3 text-xs text-neutral-300">
            <span>Flare brightness over 60 minutes</span>
            <span className="text-[#c98a08]">Soft X-rays (hot loops)</span>
            <span className="text-[#2f9bd4]">Hard X-rays (fast electrons)</span>
          </div>
          <svg
            viewBox="0 0 524 164"
            role="img"
            aria-label="Example flare light curve. Hard X-rays peak in short bursts during the rise of the soft X-rays, which then fade slowly. Tap or drag to move the time."
            className="block max-h-24 w-full touch-none"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              scrub(e);
            }}
            onPointerMove={(e) => e.buttons && scrub(e)}
          >
            <title>Example flare brightness over 60 minutes</title>
            {[0, 0.5, 1].map((v) => (
              <g key={v}>
                <line x1={CH.x0} x2={CH.x1} y1={cy(v)} y2={cy(v)} stroke="#2a2a30" />
                <text
                  x={CH.x0 - 8}
                  y={cy(v) + 4}
                  textAnchor="end"
                  fill="#a1a1aa"
                  fontSize="11"
                  fontFamily="monospace"
                >
                  {v}
                </text>
              </g>
            ))}
            {[0, 15, 30, 45, 60].map((m) => (
              <text
                key={m}
                x={cx(m / 60)}
                y={CH.y0 + 18}
                textAnchor="middle"
                fill="#a1a1aa"
                fontSize="11"
                fontFamily="monospace"
              >
                {m}
              </text>
            ))}
            <text x={CH.x1} y={CH.y0 + 34} textAnchor="end" fill="#a1a1aa" fontSize="11">
              minutes
            </text>
            <path
              d={path(chart.hard)}
              fill="none"
              stroke="#2f9bd4"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path
              d={path(chart.soft)}
              fill="none"
              stroke="#c98a08"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <line
              x1={cx(flare.t)}
              x2={cx(flare.t)}
              y1={CH.y1}
              y2={CH.y0}
              stroke="#fafafa"
              strokeWidth="1.5"
            />
            <circle
              cx={cx(flare.t)}
              cy={cy(chart.soft[Math.round(flare.t * 240)] ?? 0)}
              r="4.5"
              fill="#c98a08"
              stroke="#111114"
              strokeWidth="2"
            />
          </svg>
          <p className="mt-1 text-xs text-neutral-400">
            Example curve. Hard X-rays follow the rate of change of soft X-rays (the Neupert
            effect).
          </p>
        </div>
      )}
    </div>
  );
}

/** The star's surface close-up (the artifact's `Close-up` view), centred where the globe was clicked. */
export function StarSurfaceCloseUp({ star, onFail }: { star: StarFromCard; onFail?: () => void }) {
  // Issue #93 W1 (0.5): the surface close-up keeps only its surface canvas (no plasma or line overlays).
  const { hostRef, engine, failed, compiling, bump } = useStarEngine(
    'globe',
    star,
    400,
    'surface',
    true,
  );
  const target = useStarTarget((s) => s.target);
  const preset = star.preset;
  useEffect(() => {
    if (failed) onFail?.();
  }, [failed, onFail]);
  useEffect(() => {
    if (!engine) return;
    engine.setScale('close');
  }, [engine, preset]);
  useEffect(() => {
    if (!engine) return;
    engine.setCloseTarget(target);
    bump();
  }, [engine, target, preset, bump]);
  const at = engine ? engine.closeTarget() : null;
  useBuildControls(
    'star-surface-close',
    engine
      ? {
          title: 'Close-up on the star',
          controls: [
            {
              id: 'at',
              kind: 'readout',
              label: 'Looking at',
              value: placeText(target ?? at),
              tag: target ? 'artistic' : 'inferred_from_analog',
            },
            {
              id: 'home',
              kind: 'button',
              label: 'Back to the active region',
              disabled: target === null,
              why: target === null ? 'Already looking at the strongest spot group.' : undefined,
              onClick: () => useStarTarget.getState().home(),
            },
          ],
        }
      : null,
  );
  return (
    <div
      ref={hostRef}
      className="absolute inset-0 bg-black"
      data-testid="star-engine-surface"
      data-at={at ? `${at.lat.toFixed(4)},${at.lon.toFixed(4)}` : ''}
    >
      {compiling && <StarPreparing />}
    </div>
  );
}

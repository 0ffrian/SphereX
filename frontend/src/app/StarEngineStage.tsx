// Issue #71 stream X (D-37): hosts the approved prototype's star engine in the app. `StarGlobeStage`
// fills the build pane's globe stage for a star card; `StarFlareStage` fills the left close-up pane with
// the prototype's flare close-up and its light-curve chart. Both draw on their own canvases (raw WebGL 2,
// the prototype's own shaders) for ANY star card; the controls and the "How each part is worked out"
// notes go to the build pane's Details through `useBuildControls`. A star the engine refuses (no
// temperature, brown dwarf, Mira) or a browser without WebGL 2 keeps the TSL star path (the hosts call
// `onFail`, or are not mounted at all, see `useEngineStar`).
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Tag } from '@/contract';
import { useAppStore } from '@/state/store';
import { nudge, projectSurface, globeRot, GLOBE_HALF, GLOBE_TILT } from '@/engine/stars/starPick';
import { placeText, useStarTarget } from './starTargetStore';
import { useStarChart } from './starChartStore';
import { useBuildControls, type BuildControl, type BuildControlsSpec } from './build/BuildControls';
import { cardToStar, type StarFromCard } from '@/engine/stars/cardToStar';
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

/** Builds the engine in `host`, drives its clock, and keeps React in step with it. */
function useStarEngine(mode: StarMode, star: StarFromCard, redrawMs: number, slot: string = mode) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<StarEngine | null>(null);
  const [failed, setFailed] = useState(false);
  const [rev, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let e: StarEngine;
    try {
      e = new StarEngine(host, { mode });
    } catch (err) {
      console.warn('[star engine] could not start', err);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the engine can only be tried once mounted
      setFailed(true);
      return;
    }
    if (!e.ready) {
      e.dispose();
      setFailed(true);
      return;
    }
    let dead = false;
    setEngine(e);
    // A lost GL context leaves a black canvas: report it so the TSL path draws instead (not while we release it ourselves).
    const onLost = (ev: Event) => {
      ev.preventDefault();
      if (!dead) setFailed(true);
    };
    for (const c of e.layers) c.addEventListener('webglcontextlost', onLost);
    // Dev only: the parity scripts (issue #71) pause and seek the engine through this.
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>)[`__sxStar_${slot}`] = e;
    let raf = 0;
    let shown = true;
    let last = performance.now();
    const frame = (now: number) => {
      if (dead) return;
      const dt = (now - last) / 1000;
      last = now;
      if (shown && !document.hidden) e.tick(dt);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((es) => {
            for (const x of es) shown = x.isIntersecting;
          });
    io?.observe(host);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => e.draw());
    ro?.observe(host);
    const id = window.setInterval(() => {
      if (shown) bump();
    }, redrawMs);
    return () => {
      if (import.meta.env.DEV) (window as unknown as Record<string, unknown>)[`__sxStar_${slot}`] = null;
      dead = true;
      for (const c of e.layers) c.removeEventListener('webglcontextlost', onLost);
      cancelAnimationFrame(raf);
      window.clearInterval(id);
      io?.disconnect();
      ro?.disconnect();
      e.dispose();
      setEngine(null);
    };
  }, [mode, redrawMs, slot]);

  // A new star: the same engine, a new preset.
  const { preset } = star;
  useEffect(() => {
    if (!engine) return;
    engine.setStar(preset);
    bump();
  }, [engine, preset]);

  return { hostRef, engine, failed, rev, bump };
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
  const { hostRef, engine, failed, bump } = useStarEngine('globe', star, 500);
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
        why: flares ? undefined : 'This star has no spot groups, so it has no sunspot-driven flares.',
        tag: 'inferred_from_analog',
        onClick: () => {
          engine.fireFlare();
          bump();
        },
      },
      { id: 'latest', kind: 'readout', label: 'Latest flare on this star', value: engine.latestFlare(), tag: 'inferred_from_analog' },
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
        why: rot.used ? star.rotation.note : 'Not used for this star: it has no outer convection layer or is not a dwarf.',
        onChange: (v) => {
          engine.setRotationPosition(v);
          bump();
        },
      },
      { id: 'what', kind: 'readout', label: 'What you are seeing', value: engine.caption() || engine.stageTag() },
      ...engine.readouts().map(
        (r): BuildControl => ({
          id: `r-${r.label}`,
          kind: 'readout',
          label: r.label,
          value: r.value,
          tag: r.label === 'Surface temperature' ? star.teff.tag : READOUT_TAG[r.label],
        }),
      ),
      ...starValuesNote(star),
    ];
    spec = { title: 'Star surface', controls, notes: engine.notes() };
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
    const discPx = b.height / (2 * GLOBE_HALF); // pixels per star radius
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
  useEffect(() => {
    const el = marker.current;
    if (!el || !engine) return;
    let raf = 0;
    const place = () => {
      const st = clock();
      const c = engine.layers[0];
      if (picked && st && c && c.clientHeight && engine.scale !== 'close') {
        const q = projectSurface(picked, globeRot(st.time), GLOBE_TILT);
        const aspect = c.clientWidth / c.clientHeight;
        el.style.display = q.visible ? 'block' : 'none';
        el.style.left = `${((q.x / (aspect * GLOBE_HALF) + 1) / 2) * 100}%`;
        el.style.top = `${((1 - q.y / GLOBE_HALF) / 2) * 100}%`;
      } else el.style.display = 'none';
      raf = requestAnimationFrame(place);
    };
    raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, picked]);
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

/** The prototype's flare close-up with its light-curve chart, in the left pane. */
export function StarFlareStage({ star, onFail }: { star: StarFromCard; onFail?: () => void }) {
  const { hostRef, engine, failed, bump } = useStarEngine('closeup', star, 150);
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

  // The light curve goes to the Details pane (StarEngineDetails), not over the picture.
  const flareT = flare?.t;
  useEffect(() => {
    if (!engine || !chart || flareT === undefined) return;
    useStarChart.getState().set({
      soft: chart.soft,
      hard: chart.hard,
      t: flareT,
      setTime: (t) => {
        engine.setFlareTime(t);
        bump();
      },
    });
    // `chart` is a new object each read; the curves change only with the flare kind and class.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, flareT, flare?.kind, flare?.cls]);
  useEffect(() => () => useStarChart.getState().set(null), []);

  return (
    <div className="absolute inset-0 bg-black" data-testid="star-engine-flare">
      <div ref={hostRef} className="absolute inset-0" />
    </div>
  );
}

/** The star's surface close-up (the artifact's `Close-up` view), centred where the globe was clicked. */
export function StarSurfaceCloseUp({ star, onFail }: { star: StarFromCard; onFail?: () => void }) {
  const { hostRef, engine, failed, bump } = useStarEngine('globe', star, 400, 'surface');
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
    />
  );
}

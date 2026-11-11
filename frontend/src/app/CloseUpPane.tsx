// Issue #71 stream H (D-36, Q-274 to Q-276): the close-up pane, the app's version of the mock-up's
// #cuPane. It fills the LEFT half of the app over the sky (on top, 45% high, on a phone) while the
// globe stays in the build pane on the right, and it serves every kind as the mock-up does:
//   rocky and gas giants: the Surface view (orbit view, src/viewer/orbit);
//   stars: the flare close-up (stream G's `StarCloseUp`; until it lands, a plain caption);
//   asteroids and comets: the same body from near its surface.
// The picture is rendered by the viewer's renderer and painted into this pane's own canvas (the
// mock-up's cuDraw does the same); this layer has the honesty caption (.sx-cu-tag, the
// mock-up's .cu-tag), the controls and the input. Keyboard: arrows or W A S D move and turn, + and -
// change the height, Page Up and Page Down tilt. Reduced motion: no automatic flying.
import { useEffect, useReducer, useRef, useState } from 'react';
import type { CloseUpInfo } from '@/viewer/ViewerApp';
import { useCloseUpStore } from './closeUpStore';
import { ORBIT_NOTE } from '@/viewer/orbit/orbitSources';
import { altRange } from '@/viewer/orbit/orbitMath';
import { ProvenanceBadge } from './Badge';
import { buttonClass, pressedClass } from './ui';
import { StarCloseUp } from './StarCloseUp';
import { RockCloseUp } from './RockCloseUp';
import { StarFlareStage, StarSurfaceCloseUp } from './StarEngineStage';
import { placeText, useStarTarget } from './starTargetStore';
import { STAR_CLOSEUP_TAG, useStarCloseUp } from './starCloseUp';

/** The mock-up's cuTag for the flare close-up, true to the prototype: a Sun-like flare, not this star's own. */
const ENGINE_CAPTION =
  'Close-up · a flare at the edge of a Sun-like star, hydrogen-alpha with hot loops · illustrative (Default), not a measurement of this star';

export type CloseUpKind = 'orbit' | 'star' | 'body';

/** Which close-up an object type gets. */
export function closeUpKindOf(type: string | null | undefined): CloseUpKind | null {
  switch (type) {
    case 'planet_rocky':
    case 'planet_water':
    case 'gas_giant':
      return 'orbit';
    case 'star':
    case 'star_mira':
    case 'star_ttauri':
      return 'star';
    case 'asteroid':
    case 'asteroid_procedural':
    case 'asteroid_shape':
    case 'comet':
      return 'body';
    default:
      return null;
  }
}

export function closeUpButtonLabel(kind: CloseUpKind | null): string {
  return kind === 'orbit' ? 'Surface view' : 'Close-up view';
}

/** The mock-up's caption for each kind (its `.cu-tag` wording: "Close-up · what · honesty"). */
export function closeUpCaption(kind: CloseUpKind, info: CloseUpInfo | null, gas: boolean, starOk = false): string {
  if (kind === 'star') return starOk ? STAR_CLOSEUP_TAG : 'Close-up · not available for this star (no surface model)';
  if (kind === 'body') return 'Close-up · the same body seen from near its surface · generated (Default)';
  if (info?.refusal) return `Close-up · ${info.refusal}`;
  return gas
    ? 'Close-up · from orbit, click the globe to look at a place · generated from the solved winds (Default), not a photograph'
    : 'Close-up · from orbit, click the globe to look at a place · generated from physics (Default), not a photograph';
}

export function CloseUpPane() {
  const viewer = useCloseUpStore((s) => s.viewer);
  const plan = useCloseUpStore((s) => s.plan);
  const type = useCloseUpStore((s) => s.type);
  const info = useCloseUpStore((s) => s.info);
  const hidden = useCloseUpStore((s) => s.hidden);
  const reducedMotion = useCloseUpStore((s) => s.reducedMotion);
  const fixture = useCloseUpStore((s) => s.fixture);
  const held = useCloseUpStore((s) => s.held);
  const engineStar = useCloseUpStore((s) => s.engineStar);
  const [engineFailed, setEngineFailed] = useState(false);
  const left = useStarTarget((s) => s.left);
  const starTarget = useStarTarget((s) => s.target);
  const kind = closeUpKindOf(type);
  // Issue #71 stream X (D-37): a star the prototype's engine draws opens with the build, with the flare close-up.
  const engine = kind === 'star' && engineStar && !engineFailed ? engineStar : null;
  const open = !hidden && kind !== null && (engine ? !held : info !== null && info.mode !== null);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [about, setAbout] = useState(false);
  const focusRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = viewer?.orbitView ?? null;
  const gas = view?.kind === 'gas';
  const starProps = useStarCloseUp(kind === 'star' && !engine ? plan : null, null);
  const drag = useRef<{ pts: Map<number, { x: number; y: number }>; pinch: number | null }>({
    pts: new Map(),
    pinch: null,
  });

  // The pane's canvas receives the picture (orbit view and body close-up).
  useEffect(() => {
    const c = canvasRef.current;
    if (!viewer || !c) return;
    viewer.setCloseUpCanvas(c);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => viewer.requestCloseRender());
    ro?.observe(c);
    return () => {
      ro?.disconnect();
      viewer.setCloseUpCanvas(null);
    };
  }, [viewer, kind]);

  const changed = () => {
    viewer?.requestCloseRender();
    bump();
  };

  // The wheel must be non-passive to stop the page scrolling.
  useEffect(() => {
    const el = focusRef.current;
    if (!el || !view) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      view.wheel(e.deltaY);
      viewer?.requestCloseRender();
      bump();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [view, viewer]);

  // A click on the globe (in the build pane on the right) moves the surface view to that place.
  useEffect(() => {
    if (!viewer || !view || !open) return;
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="viewer-stage"] canvas');
    if (!canvas) return;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
      const place = viewer.pickGlobe(e.clientX, e.clientY);
      if (place) {
        view.goTo(place);
        viewer.requestCloseRender();
        bump();
      }
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
    };
  }, [viewer, view, open]);

  if (!kind) return null;
  const caption = engine
    ? left === 'surface'
      ? `Close-up · the star\u2019s surface at ${placeText(starTarget)} · generated (Default), not a photograph`
      : ENGINE_CAPTION
    : closeUpCaption(kind, info, gas, starProps !== null);
  const [lo, hi] = view ? altRange(view.kind) : [0, 1];
  const alt = view?.state.altKm ?? 0;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!view) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.focus();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const prev = d.pts.get(e.pointerId);
    if (!view || !prev) return;
    if (d.pts.size >= 2) {
      d.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...d.pts.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (d.pinch !== null && dist > 0) view.pinch(dist / d.pinch);
      d.pinch = dist;
    } else {
      view.drag(e.clientX - prev.x, e.clientY - prev.y);
      d.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    changed();
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current.pts.delete(e.pointerId);
    drag.current.pinch = null;
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (view?.key(e.key)) {
      e.preventDefault();
      changed();
    }
  };

  return (
    <div
      className={`sx-cu${open ? ' open' : ''}`}
      aria-hidden={open ? undefined : true}
      data-testid="closeup-pane"
      data-kind={kind}
    >
      <canvas ref={canvasRef} className="sx-cu-canvas" aria-hidden="true" />
      {view && (
        <div
          ref={focusRef}
          className="sx-cu-focus"
          tabIndex={open ? 0 : -1}
          role="application"
          aria-label={`${gas ? 'Cloud tops' : 'Surface'} view. Drag to look around, scroll or press plus and minus to change height, arrow keys or W A S D to move and turn, Page Up and Page Down to tilt.`}
          data-testid="orbit-focus"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        />
      )}
      {kind === 'body' && <RockCloseUp active={open} />}
      {engine && open && left === 'flare' && (
        <StarFlareStage key={engine.preset.id} star={engine} onFail={() => setEngineFailed(true)} />
      )}
      {engine && open && left === 'surface' && (
        <StarSurfaceCloseUp key={engine.preset.id} star={engine} onFail={() => setEngineFailed(true)} />
      )}
      {engine && open && (
        <div className="absolute right-3 top-3 z-[3] flex flex-wrap items-center gap-2" role="group" aria-label="Star close-up">
          <button type="button" className={`${buttonClass} ${pressedClass}`} aria-pressed={left === 'flare'} onClick={() => useStarTarget.getState().show('flare')}>
            Flare close-up
          </button>
          <button type="button" className={`${buttonClass} ${pressedClass}`} aria-pressed={left === 'surface'} onClick={() => useStarTarget.getState().show('surface')}>
            Surface close-up
          </button>
          {left === 'surface' && (
            <button type="button" className={buttonClass} disabled={starTarget === null} onClick={() => useStarTarget.getState().home()}>
              Back to the active region
            </button>
          )}
        </div>
      )}
      {kind === 'star' && !engine && starProps && open && (
        <div className="absolute inset-0 bg-black" data-testid="star-closeup">
          <StarCloseUp {...starProps} className="absolute inset-0" />
        </div>
      )}
      <span className="sx-cu-tag" data-testid="closeup-caption">
        {caption}
      </span>
      {view && (
        <div className="sx-cu-controls" role="group" aria-label="Surface view controls">
          <label htmlFor="orbit-alt" className="flex-1 basis-40">
            {gas ? 'Height above the clouds' : 'Height above the ground'}: <span data-testid="orbit-alt-label">{formatKm(alt)}</span>
            <input
              id="orbit-alt"
              type="range"
              min={0}
              max={1000}
              step={1}
              value={view.slider}
              aria-valuemin={lo}
              aria-valuemax={hi}
              aria-valuetext={formatKm(alt)}
              className="mt-1 block w-full"
              onChange={(e) => {
                view.setAltitudeSlider(Number(e.target.value));
                changed();
              }}
            />
          </label>
          <button
            type="button"
            className={`${buttonClass} ${pressedClass}`}
            aria-pressed={view.flying}
            disabled={reducedMotion}
            title={reducedMotion ? 'Off while you prefer reduced motion' : undefined}
            onClick={() => {
              view.setFlying(!view.flying);
              changed();
            }}
          >
            Fly forward
          </button>
          <button type="button" className={buttonClass} aria-expanded={about} onClick={() => setAbout((a) => !a)}>
            What is drawn
          </button>
        </div>
      )}
      {view && about && info?.resolved && (
        <div className="absolute inset-x-4 bottom-36 z-[3] max-h-[45%] overflow-auto rounded-lg border border-[#323a3e] bg-[#242729f2] p-3 text-xs text-neutral-200" data-testid="orbit-layers">
          <p className="mb-2">{ORBIT_NOTE}</p>
          <ul className="flex flex-col gap-1">
            {info.resolved.layers.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2">
                <ProvenanceBadge tag={l.tag} fixture={fixture} />
                <span>
                  {l.label}
                  {l.drawn ? '' : ' (not drawn: no data)'}. {l.note}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function formatKm(km: number): string {
  return `${km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString('en')} km`;
}

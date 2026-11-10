// Issue #71 stream H (D-36, Q-274 to Q-276): the close-up pane, the app's version of the mock-up's
// #cuPane. It opens on the left half of the stage (on top when narrow), the globe moves into the
// other half (ViewerApp does that), and it serves every kind as the mock-up does:
//   rocky and gas giants: the Surface view (orbit view, src/viewer/orbit);
//   stars: the flare close-up (stream G's `StarCloseUp`; until it lands, a plain caption);
//   asteroids and comets: the same body from near its surface.
// The picture is drawn into the viewer canvas; this layer has the honesty caption (.sx-cu-tag, the
// mock-up's .cu-tag), the controls and the input. Keyboard: arrows or W A S D move and turn, + and -
// change the height, Page Up and Page Down tilt. Reduced motion: no automatic flying.
import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import type { ViewerApp, CloseUpInfo } from '@/viewer/ViewerApp';
import { ORBIT_NOTE } from '@/viewer/orbit/orbitSources';
import { altRange } from '@/viewer/orbit/orbitMath';
import { ProvenanceBadge } from './Badge';
import { buttonClass, pressedClass } from './ui';

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
  return kind === 'orbit' ? 'Surface view' : 'Side close-up';
}

/** Typed mount point for stream G's flare close-up; null until that component lands. */
export type StarCloseUpComponent = (props: { viewer: ViewerApp | null }) => ReactNode;
export const STAR_CLOSE_UP: { component: StarCloseUpComponent | null } = { component: null };

/** The mock-up's caption for each kind (its `.cu-tag` wording: "Close-up · what · honesty"). */
export function closeUpCaption(kind: CloseUpKind, info: CloseUpInfo | null, gas: boolean): string {
  if (kind === 'star') {
    return STAR_CLOSE_UP.component
      ? "Close-up · a flare on the star's surface · illustrative (Default), not a measurement"
      : 'Close-up · not available yet for stars';
  }
  if (kind === 'body') return 'Close-up · the same body seen from near its surface · generated (Default)';
  if (info?.refusal) return `Close-up · ${info.refusal}`;
  return gas
    ? 'Close-up · from orbit, click the globe to look at a place · generated from the solved winds (Default), not a photograph'
    : 'Close-up · from orbit, click the globe to look at a place · generated from physics (Default), not a photograph';
}

export function CloseUpPane({
  viewer,
  kind,
  open,
  info,
  reducedMotion,
  fixture,
}: {
  viewer: ViewerApp | null;
  kind: CloseUpKind | null;
  open: boolean;
  info: CloseUpInfo | null;
  reducedMotion: boolean;
  fixture: boolean;
}) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [about, setAbout] = useState(false);
  const focusRef = useRef<HTMLDivElement>(null);
  const view = viewer?.orbitView ?? null;
  const gas = view?.kind === 'gas';
  const stack = info?.layout === 'stack';
  const drag = useRef<{ pts: Map<number, { x: number; y: number }>; pinch: number | null }>({
    pts: new Map(),
    pinch: null,
  });

  const changed = () => {
    viewer?.requestRender();
    bump();
  };

  // The wheel must be non-passive to stop the page scrolling.
  useEffect(() => {
    const el = focusRef.current;
    if (!el || !view) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      view.wheel(e.deltaY);
      changed();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `changed` only reads `viewer`
  }, [view, viewer]);

  // A click on the globe (the other half) moves the surface view to that place.
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
        changed();
      }
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `changed` only reads `viewer`
  }, [viewer, view, open]);

  if (!kind) return null;
  const caption = closeUpCaption(kind, info, gas);
  const StarMount = kind === 'star' ? STAR_CLOSE_UP.component : null;
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
      className={`sx-cu${open ? ' open' : ''}${stack ? ' stack' : ''}`}
      aria-hidden={open ? undefined : true}
      data-testid="closeup-pane"
      data-kind={kind}
    >
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
      {StarMount && <StarMount viewer={viewer} />}
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

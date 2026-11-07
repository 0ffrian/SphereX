// The sky view: the main pane of the shell. A real all-sky colour image (GET /v1/sky/index.json,
// equirect) on an inside-out sphere (viewer/sky/SkyView.ts) that the user drags, zooms and clicks.
//
// - A click (pointer moved < 5 px) picks the position under the pointer, analytically from the
//   camera ray (skyMath), and runs the normal search with "ra,dec" (6 decimals). The store aborts
//   any older search, so a stale reply never wins. Picked coordinates are `derived` (Q-25).
// - Markers for the quick-pick targets, placed from /v1/resolve; clicking one searches it by name.
// - Smaller markers for positions whose frames are cached (/v1/sky/cached): they load at once.
//   A target already marked is not marked twice (cachedMarkers.ts).
// - Never blank: the shell and search render first; the pane shows a loading state, then the
//   smallest image, then a larger one on capable devices. With no image installed it shows a
//   coordinate grid and says so; clicking still picks coordinates.
// - No React re-render per pointer move: the readout and markers are written from refs.
// - R9: keyboard pan/zoom on the canvas (arrows, +/−, R), Enter picks the centre, on-screen pan
//   and zoom buttons (WCAG 2.5.7), aria-label and a text alternative.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { EstimatedBadge, ProvenanceBadge } from '@/app/Badge';
import type { SkyCachedObject, SkySurvey } from '@/app/api/types';
import { isApiError } from '@/app/api/errors';
import { formatCoords } from '@/app/format';
import { getSkyApi, useAppStore } from '@/state/store';
import { prefersReducedMotion, type RendererBackend } from '@/viewer/ViewerApp';
import { SkyView } from '@/viewer/sky/SkyView';
import {
  formatFov,
  interpolateView,
  isClick,
  KEY_PAN_FRACTION,
  KEY_ZOOM_FACTOR,
  panByFraction,
  panByPixels,
  pickQuery,
  raDecToScreen,
  screenToRaDec,
  separationDeg,
  WHEEL_ZOOM_RATE,
  zoomAt,
  type RaDec,
  type ScreenPoint,
  type SkyCamera,
} from '@/viewer/sky/skyMath';
import { pickSurvey, planSkyLoad } from '@/viewer/sky/surveys';
import { PICK_FORMULA } from './positionTags';
import { publishReadout } from './readout';
import {
  cachedMarkerDescription,
  cachedMarkerLabel,
  cachedMarkerQuery,
  cachedMarkersToShow,
} from './cachedMarkers';
import { useCachedMarkers } from './useCachedMarkers';
import { useTargetMarkers, type TargetMarker } from './useTargetMarkers';

/**
 * Start view. A display choice (artistic), roughly towards the Galactic centre, where the Milky Way
 * is brightest in the infrared. Not data and not shown as data.
 */
export const DEFAULT_SKY_VIEW: SkyCamera = { ra: 266.4, dec: -28.9, fovDeg: 60 };
/** Fly to a newly found object when it is farther than this fraction of the field from the centre. */
const FLY_IF_OFF_CENTRE = 0.35;
/** Field of view after flying to an object, at most. Display value. */
const FLY_FOV_DEG = 20;
const FLY_MS = 700;
/** Same breakpoint as the bottom-sheet layout in index.css. */
const PHONE_QUERY = '(max-width: 640px)';
/** Where a found object is put on a phone, as a fraction of the sky's height from the top. */
const PHONE_OBJECT_Y = 0.22;
/** Pause after the last keyboard or button pan before the new view is announced. UI pacing. */
const VIEW_SAY_DELAY_MS = 600;

/** Q-25, Q-91: typed and picked coordinates are user input, tagged `derived`. */
export { PICK_FORMULA };

type SkyState =
  | { kind: 'starting' }
  | { kind: 'loading'; survey: SkySurvey | null }
  | { kind: 'ready'; survey: SkySurvey; width: number }
  | { kind: 'none' }
  | { kind: 'unusable'; reason: string }
  | { kind: 'error'; message: string; survey: SkySurvey | null }
  | { kind: 'no_renderer' };

interface Marker {
  key: string;
  ra: number;
  dec: number;
  el: HTMLElement | null;
}

const SCRATCH: ScreenPoint = { x: 0, y: 0, inFront: false };
const PICK_SCRATCH: RaDec = { ra: 0, dec: 0 };

function deviceCaps(maxTextureSize: number) {
  const coarse =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return { maxTextureSize, coarsePointer: coarse, saveData: conn?.saveData === true };
}

export function SkyPane({ children }: { children?: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<SkyView | null>(null);
  // Marker elements by key; filled by ref callbacks, read by the render listener (not React state).
  const [markers] = useState(() => new Map<string, Marker>());
  const [placedEls] = useState(() => new WeakSet<HTMLElement>());
  const flyCancel = useRef<(() => void) | null>(null);
  const [view, setViewInstance] = useState<SkyView | null>(null);
  const [backend, setBackend] = useState<RendererBackend | null>(null);
  const [state, setState] = useState<SkyState>({ kind: 'starting' });
  const [picked, setPicked] = useState<{ ra: number; dec: number } | null>(null);
  const [fixtureSky, setFixtureSky] = useState(false);
  const search = useAppStore((s) => s.skySearch);
  const resolved = useAppStore((s) => s.sky.resolved);
  const descId = useId();
  const targets = useTargetMarkers(view !== null);
  const cachedAll = useCachedMarkers(view !== null);
  // After the target markers are placed, so a target is never drawn twice, not even briefly.
  const cached = useMemo(
    () => (targets.done ? cachedMarkersToShow(cachedAll, targets.markers) : []),
    [cachedAll, targets.done, targets.markers],
  );
  // R9: keyboard and button pans say where the view is now (the readout is not a live region).
  const [viewSay, setViewSay] = useState('');
  const sayTimer = useRef<number | null>(null);
  const announceView = (cam: Readonly<SkyCamera>) => {
    if (sayTimer.current !== null) window.clearTimeout(sayTimer.current);
    sayTimer.current = window.setTimeout(() => {
      sayTimer.current = null;
      const dec = `${cam.dec >= 0 ? '+' : '−'}${Math.abs(cam.dec).toFixed(1)}`;
      setViewSay(
        `View centre RA ${cam.ra.toFixed(1)}°, Dec ${dec}°, ${formatFov(cam.fovDeg)} across.`,
      );
    }, VIEW_SAY_DELAY_MS);
  };
  useEffect(
    () => () => {
      if (sayTimer.current !== null) window.clearTimeout(sayTimer.current);
    },
    [],
  );
  // D-32: the credit is always visible. Panels read its height (--sx-credit-h) to stay clear of it
  // (desktop) or to keep their content above it (phone bottom sheet, where it sits on top).
  const creditRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    const credit = creditRef.current;
    if (!host || !credit || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      host.style.setProperty('--sx-credit-h', `${Math.ceil(credit.offsetHeight)}px`);
    });
    ro.observe(credit);
    return () => ro.disconnect();
  }, []);

  // ---- Renderer ---------------------------------------------------------------------------------
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let app: SkyView | null = null;
    // A canvas per mount, so a StrictMode re-mount never shares a GPU context (as ViewerPanel).
    const canvas = document.createElement('canvas');
    canvas.className =
      'peer absolute inset-0 block h-full w-full touch-none select-none outline-none ' +
      'cursor-grab data-[dragging=true]:cursor-grabbing focus-visible:outline-2 ' +
      'focus-visible:-outline-offset-2 focus-visible:outline-sx-green';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-roledescription', 'sky map');
    canvas.setAttribute('aria-label', 'All-sky view. Starting.');
    canvas.setAttribute('aria-describedby', descId);
    canvas.dataset.testid = 'sky-canvas';
    host.prepend(canvas);

    SkyView.create(canvas, DEFAULT_SKY_VIEW).then(
      (created) => {
        if (cancelled) {
          created.dispose();
          return;
        }
        app = created;
        viewRef.current = created;
        canvas.dataset.backend = created.backend;
        setBackend(created.backend);
        setViewInstance(created);
        if (import.meta.env.MODE === 'fixtures') {
          (window as unknown as { __sxSky?: SkyView }).__sxSky = created;
        }
      },
      (err: unknown) => {
        if (cancelled) return;
        console.warn('[sky] no WebGPU or WebGL2 backend available', err);
        canvas.dataset.backend = 'unavailable';
        setState({ kind: 'no_renderer' });
      },
    );
    return () => {
      cancelled = true;
      app?.dispose();
      viewRef.current = null;
      setViewInstance(null);
      canvas.remove();
    };
  }, [descId]);

  // ---- Index and image ---------------------------------------------------------------------------
  useEffect(() => {
    if (!view) return;
    const controller = new AbortController();
    const canvas = hostRef.current?.querySelector('canvas');
    void (async () => {
      let survey: SkySurvey | null;
      try {
        const res = await getSkyApi().skyIndex(controller.signal);
        if (res.fixture) {
          setFixtureSky(true);
          useAppStore.getState().skyMarkFixtureSeen();
        }
        if (res.data.surveys.length === 0) {
          setState({ kind: 'none' });
          return;
        }
        survey = pickSurvey(res.data.surveys);
        if (!survey) {
          setState({
            kind: 'unusable',
            reason: 'The installed sky images are not in ICRS equirectangular form.',
          });
          return;
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        // 404 or 501: the endpoint is not there, i.e. no sky image is installed.
        if (isApiError(e) && (e.kind === 'not_found' || e.status === 501)) {
          setState({ kind: 'none' });
          return;
        }
        setState({
          kind: 'error',
          message: 'The list of sky images could not be loaded.',
          survey: null,
        });
        return;
      }
      setState({ kind: 'loading', survey });
      const plan = planSkyLoad(survey, deviceCaps(view.maxTextureSize));
      if (!plan.first) {
        setState({ kind: 'unusable', reason: 'No sky image fits this device.' });
        return;
      }
      try {
        const size = await view.loadEquirect(plan.first.url, controller.signal);
        if (canvas) canvas.dataset.skyWidth = String(size.width);
        setState({ kind: 'ready', survey, width: size.width });
      } catch {
        if (controller.signal.aborted) return;
        setState({ kind: 'error', message: 'The sky image could not be loaded.', survey });
        return;
      }
      if (!plan.upgrade) return;
      try {
        const size = await view.loadEquirect(plan.upgrade.url, controller.signal);
        if (canvas) canvas.dataset.skyWidth = String(size.width);
        setState({ kind: 'ready', survey, width: size.width });
      } catch {
        // The smaller image stays on screen (never blank); nothing else to do.
      }
    })();
    return () => controller.abort();
  }, [view]);

  // ---- Canvas label (R9) ------------------------------------------------------------------------
  useEffect(() => {
    const canvas = hostRef.current?.querySelector('canvas');
    if (!canvas) return;
    const what =
      state.kind === 'ready'
        ? `All-sky image: ${state.survey.title}.`
        : state.kind === 'none'
          ? 'Sky view with a coordinate grid; no sky image is installed.'
          : state.kind === 'loading' || state.kind === 'starting'
            ? 'All-sky view, loading.'
            : 'Sky view with a coordinate grid; the sky image is not shown.';
    canvas.setAttribute('aria-label', what);
  }, [state]);

  // ---- Markers: positions follow every render, written straight to the DOM ------------------------
  useEffect(() => {
    if (!view) return;
    const place = (cam: Readonly<SkyCamera>, w: number, h: number) => {
      for (const m of markers.values()) {
        if (!m.el) continue;
        const p = raDecToScreen(cam, m.ra, m.dec, w, h, SCRATCH);
        const on = p.inFront && p.x > -8 && p.x < w + 8 && p.y > -8 && p.y < h + 8;
        m.el.style.visibility = on ? 'visible' : 'hidden';
        if (on) m.el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
      }
    };
    const off = view.onRender(place);
    view.requestRender();
    return off;
  }, [view, markers]);

  // The ref callback below is a new function on every render, so React detaches (null) and
  // re-attaches the same element each time. Only an element seen for the first time is hidden
  // until the next render places it; a re-attached one keeps its position (no flicker).
  const registerMarker = (key: string, ra: number, dec: number) => (el: HTMLElement | null) => {
    const map = markers;
    if (!el) {
      map.delete(key);
      return;
    }
    map.set(key, { key, ra, dec, el });
    if (placedEls.has(el)) return;
    placedEls.add(el);
    el.style.visibility = 'hidden';
    viewRef.current?.requestRender();
  };

  // ---- Fly to a newly found object that is off-centre ----------------------------------------------
  // On a phone the panel is a bottom sheet over the lower part of the sky, so the object is put
  // in the upper part instead (PHONE_OBJECT_Y of the height from the top).
  useEffect(() => {
    if (!view || !resolved) return;
    const cam = view.getView();
    const sheet = typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches;
    const fovDeg = Math.min(cam.fovDeg, FLY_FOV_DEG);
    const target: SkyCamera = sheet
      ? { ra: resolved.ra, dec: resolved.dec - (0.5 - PHONE_OBJECT_Y) * fovDeg, fovDeg }
      : { ra: resolved.ra, dec: resolved.dec, fovDeg };
    const offCentre =
      separationDeg(cam.ra, cam.dec, resolved.ra, resolved.dec) > FLY_IF_OFF_CENTRE * cam.fovDeg;
    if (!sheet && !offCentre) return;
    if (prefersReducedMotion()) {
      view.setView(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = (now - t0) / FLY_MS;
      view.setView(interpolateView(cam, target, t));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    flyCancel.current = () => cancelAnimationFrame(raf);
    return () => cancelAnimationFrame(raf);
  }, [view, resolved]);

  // ---- Picking --------------------------------------------------------------------------------------
  const pickAt = (px: number, py: number) => {
    const v = viewRef.current;
    if (!v) return;
    const { width, height } = v.getSize();
    const p = screenToRaDec(v.getView(), px, py, width, height, PICK_SCRATCH);
    const q = pickQuery(p.ra, p.dec);
    const [ra, dec] = q.split(',').map(Number) as [number, number];
    setPicked({ ra, dec });
    void search({ q, kind: 'coords', origin: 'sky' });
  };

  const pickTarget = (m: TargetMarker) => {
    setPicked(null);
    void search({ q: m.name, kind: 'name', origin: 'sky' });
  };

  const pickCached = (c: SkyCachedObject) => {
    setPicked(null);
    void search(cachedMarkerQuery(c));
  };

  // Any other search (typed, a quick pick, a link, Back) replaces the pick: its marker and the
  // "Picked …" line must not stay next to a different object.
  useEffect(
    () =>
      useAppStore.subscribe((s, prev) => {
        const q = s.sky.query;
        if (q === prev.sky.query || !q) return;
        if (!(q.origin === 'sky' && q.kind === 'coords')) setPicked(null);
      }),
    [],
  );

  // ---- Pointer, wheel and keys -------------------------------------------------------------------
  useEffect(() => {
    if (!view) return;
    const canvas = hostRef.current?.querySelector('canvas');
    if (!canvas) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number } | null = null;
    let maxMove = 0;
    let pinchDist = 0;
    let pinchMid = { x: 0, y: 0 };
    let hover: { x: number; y: number } | null = null;
    let readoutFrame: number | null = null;

    const local = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const sendReadout = () => {
      readoutFrame = null;
      const cam = view.getView();
      if (hover) {
        const { width, height } = view.getSize();
        const p = screenToRaDec(cam, hover.x, hover.y, width, height, PICK_SCRATCH);
        publishReadout({ ra: p.ra, dec: p.dec, fovDeg: cam.fovDeg, source: 'pointer' });
      } else {
        publishReadout({ ra: cam.ra, dec: cam.dec, fovDeg: cam.fovDeg, source: 'centre' });
      }
    };
    const queueReadout = () => {
      if (readoutFrame === null) readoutFrame = requestAnimationFrame(sendReadout);
    };
    const offRender = view.onRender(queueReadout);
    const stopFly = () => {
      flyCancel.current?.();
      flyCancel.current = null;
    };
    const setDragging = (on: boolean) => {
      canvas.dataset.dragging = String(on);
      view.setInteracting(on);
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      stopFly();
      canvas.setPointerCapture?.(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 1) {
        start = p;
        maxMove = 0;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()] as [typeof p, typeof p];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        maxMove = Number.POSITIVE_INFINITY; // a pinch is never a click
      }
      setDragging(true);
    };
    const onMove = (e: PointerEvent) => {
      const p = local(e);
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        if (e.pointerType === 'mouse') {
          hover = p;
          queueReadout();
        }
        return;
      }
      pointers.set(e.pointerId, p);
      const { width, height } = view.getSize();
      if (pointers.size === 1) {
        if (start) maxMove = Math.max(maxMove, Math.hypot(p.x - start.x, p.y - start.y));
        if (!isClick(maxMove))
          view.setView(panByPixels(view.getView(), p.x - prev.x, p.y - prev.y, height));
        hover = e.pointerType === 'mouse' ? p : null;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()] as [typeof p, typeof p];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        let cam = view.getView();
        if (pinchDist > 0 && dist > 0)
          cam = zoomAt(cam, pinchDist / dist, width, height, mid.x, mid.y);
        cam = panByPixels(cam, mid.x - pinchMid.x, mid.y - pinchMid.y, height);
        view.setView(cam);
        pinchDist = dist;
        pinchMid = mid;
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      const p = local(e);
      const wasSingle = pointers.size === 1;
      pointers.delete(e.pointerId);
      if (pointers.size === 0) setDragging(false);
      if (pointers.size === 1) {
        // Lifting one finger of a pinch: carry on panning with the other, never a click.
        const [rest] = [...pointers.values()] as [{ x: number; y: number }];
        start = rest;
      }
      if (e.type === 'pointerup' && wasSingle && isClick(maxMove)) pickAt(p.x, p.y);
    };
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || pointers.size > 0) return;
      hover = null;
      queueReadout();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopFly();
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const factor = Math.exp(e.deltaY * scale * WHEEL_ZOOM_RATE);
      const { width, height } = view.getSize();
      const p = local(e);
      view.setView(zoomAt(view.getView(), factor, width, height, p.x, p.y));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const cam = view.getView();
      const { width, height } = view.getSize();
      let next: SkyCamera;
      switch (e.key) {
        case 'ArrowLeft':
          next = panByFraction(cam, KEY_PAN_FRACTION, 0);
          break;
        case 'ArrowRight':
          next = panByFraction(cam, -KEY_PAN_FRACTION, 0);
          break;
        case 'ArrowUp':
          next = panByFraction(cam, 0, KEY_PAN_FRACTION);
          break;
        case 'ArrowDown':
          next = panByFraction(cam, 0, -KEY_PAN_FRACTION);
          break;
        case '+':
        case '=':
          next = zoomAt(cam, 1 / KEY_ZOOM_FACTOR, width, height);
          break;
        case '-':
        case '_':
          next = zoomAt(cam, KEY_ZOOM_FACTOR, width, height);
          break;
        case 'r':
        case 'R':
          next = DEFAULT_SKY_VIEW;
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          pickAt(width / 2, height / 2);
          return;
        default:
          return;
      }
      e.preventDefault();
      stopFly();
      hover = null;
      view.setView(next);
      announceView(view.getView());
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('keydown', onKey);
    queueReadout();
    return () => {
      offRender();
      if (readoutFrame !== null) cancelAnimationFrame(readoutFrame);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKey);
    };
    // pickAt reads the latest search through the store action, which is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const nudge = (kind: 'in' | 'out' | 'left' | 'right' | 'up' | 'down' | 'reset') => {
    const v = viewRef.current;
    if (!v) return;
    flyCancel.current?.();
    const cam = v.getView();
    const { width, height } = v.getSize();
    const next =
      kind === 'in'
        ? zoomAt(cam, 1 / KEY_ZOOM_FACTOR, width, height)
        : kind === 'out'
          ? zoomAt(cam, KEY_ZOOM_FACTOR, width, height)
          : kind === 'left'
            ? panByFraction(cam, KEY_PAN_FRACTION, 0)
            : kind === 'right'
              ? panByFraction(cam, -KEY_PAN_FRACTION, 0)
              : kind === 'up'
                ? panByFraction(cam, 0, KEY_PAN_FRACTION)
                : kind === 'down'
                  ? panByFraction(cam, 0, -KEY_PAN_FRACTION)
                  : DEFAULT_SKY_VIEW;
    v.setView(next);
    announceView(v.getView());
  };

  const survey =
    state.kind === 'ready' || state.kind === 'loading' || state.kind === 'error'
      ? state.survey
      : null;
  const resolvedLabel = resolved ? (resolved.name ?? formatCoords(resolved.ra, resolved.dec)) : '';
  const showPicked =
    picked !== null &&
    !(resolved && separationDeg(resolved.ra, resolved.dec, picked.ra, picked.dec) < 1 / 3600);

  return (
    <div
      ref={hostRef}
      className="sx-sky-pane relative h-full w-full overflow-hidden"
      data-testid="sky-pane"
      data-sky-state={state.kind}
    >
      {/* The canvas is prepended here by the effect above. */}
      <div
        className="pointer-events-none absolute inset-0 hidden peer-focus-visible:block"
        aria-hidden="true"
      >
        <span className="absolute top-1/2 left-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-sx-green/80" />
      </div>
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_100%_at_50%_50%,transparent_55%,#000a_100%)]"
        aria-hidden="true"
      />
      <p id={descId} className="sr-only">
        Drag to look around, use the mouse wheel or pinch to zoom, and click or tap to pick a
        position: its coordinates go into the search. With the keyboard, the arrow keys pan, plus
        and minus zoom, R resets the view and Enter picks the centre. The position under the pointer
        is shown at the top right. You can also type coordinates or a name in the search field.
      </p>

      {/* Panels sit right after the canvas in the tab order. */}
      {children}

      {/* Markers: buttons placed by the render listener (no React render per frame). */}
      <ul
        className="pointer-events-none absolute inset-0 m-0 list-none p-0"
        aria-label="Targets on the sky"
        data-testid="sky-markers"
      >
        {targets.markers.map((m) => (
          <li
            key={`t:${m.name}`}
            ref={registerMarker(`t:${m.name}`, m.ra, m.dec)}
            className="absolute top-0 left-0 will-change-transform"
          >
            <button
              type="button"
              className="sx-marker pointer-events-auto"
              onClick={() => pickTarget(m)}
              aria-label={`${m.name} on the sky: open it`}
              data-testid="sky-marker"
            >
              <span className="sx-marker-ring" aria-hidden="true" />
              <span className="sx-marker-label">{m.name}</span>
            </button>
          </li>
        ))}
        {cached.map((c) => (
          <li
            key={`c:${c.id}`}
            ref={registerMarker(`c:${c.id}`, c.ra, c.dec)}
            className="absolute top-0 left-0 will-change-transform"
          >
            <button
              type="button"
              className="sx-marker sx-marker-cached pointer-events-auto"
              onClick={() => pickCached(c)}
              aria-label={cachedMarkerDescription(c)}
              title={`${cachedMarkerLabel(c)}: cached, loads instantly`}
              data-testid="sky-cached-marker"
              data-object-id={c.id}
            >
              <span className="sx-marker-ring" aria-hidden="true" />
              <span className="sx-marker-label">
                {cachedMarkerLabel(c)} · cached, loads instantly
              </span>
            </button>
          </li>
        ))}
        {resolved && (
          <li
            key={`sel:${resolved.id}`}
            ref={registerMarker(`sel:${resolved.id}`, resolved.ra, resolved.dec)}
            className="absolute top-0 left-0 will-change-transform"
            data-testid="sky-selected"
          >
            <span
              className="sx-marker sx-marker-selected"
              role="img"
              aria-label={`Selected: ${resolvedLabel}`}
            >
              <span className="sx-marker-ring" aria-hidden="true" />
            </span>
          </li>
        )}
        {showPicked && picked && (
          <li
            key={`pick:${picked.ra},${picked.dec}`}
            ref={registerMarker(`pick:${picked.ra},${picked.dec}`, picked.ra, picked.dec)}
            className="absolute top-0 left-0 will-change-transform"
            data-testid="sky-picked"
          >
            <span
              className="sx-marker sx-marker-picked"
              role="img"
              aria-label={`Picked position: ${formatCoords(picked.ra, picked.dec)}`}
            >
              <span className="sx-marker-ring" aria-hidden="true" />
            </span>
          </li>
        )}
      </ul>

      {/* On-screen pan and zoom (WCAG 2.5.7: an alternative to dragging). */}
      {/* A column at the right; a row along the top on phones, clear of the bottom sheet. */}
      <div role="group" aria-label="Sky view controls" className="sx-sky-ctrls">
        <SkyButton label="Zoom in on the sky" onClick={() => nudge('in')} glyph="plus" />
        <SkyButton label="Zoom out on the sky" onClick={() => nudge('out')} glyph="minus" />
        <span className="sx-sky-ctrls-sep" aria-hidden="true" />
        <SkyButton label="Pan up (north)" onClick={() => nudge('up')} glyph="up" />
        <SkyButton label="Pan left (east)" onClick={() => nudge('left')} glyph="left" />
        <SkyButton label="Pan right (west)" onClick={() => nudge('right')} glyph="right" />
        <SkyButton label="Pan down (south)" onClick={() => nudge('down')} glyph="down" />
        <SkyButton label="Reset the sky view" onClick={() => nudge('reset')} glyph="reset" />
      </div>

      {/* Status of the sky image: never a blank pane. */}
      {state.kind !== 'ready' && (
        // Near the top and click-through, so the centre of the sky stays clickable.
        <div className="pointer-events-none absolute inset-x-4 top-4 flex justify-center">
          <p
            className="max-w-md rounded-xl border border-sx-border bg-sx-card/90 px-4 py-3 text-center text-sm text-sx-fg shadow-lg"
            data-testid="sky-status"
          >
            {state.kind === 'starting' || state.kind === 'loading' ? (
              <span className="inline-flex items-center gap-2" data-testid="sky-loading">
                <span
                  className="inline-block size-2.5 animate-pulse rounded-full bg-sx-green"
                  aria-hidden="true"
                />
                Loading the sky image…
              </span>
            ) : state.kind === 'none' ? (
              'No sky image is installed, so only a coordinate grid is shown. Click to pick a position, or type a name or coordinates in the search.'
            ) : state.kind === 'unusable' ? (
              `${state.reason} Only a coordinate grid is shown; picking positions and the search still work.`
            ) : state.kind === 'error' ? (
              `${state.message} Only a coordinate grid is shown; picking positions and the search still work.`
            ) : (
              'This browser has no WebGPU or WebGL2, so the sky cannot be drawn. The search still works.'
            )}
          </p>
        </div>
      )}

      {/* Provenance and credit of the picture (D-02, A11). */}
      {/* Always on top and never covered by a panel (D-32; see --sx-credit-h above). */}
      <div ref={creditRef} className="sx-sky-credit" data-testid="sky-credit-box">
        {survey && (
          <p
            className="pointer-events-auto flex flex-wrap items-center gap-1.5"
            data-testid="sky-credit"
          >
            <span className="text-sx-fg">{survey.title}</span>
            {survey.tag === 'derived' ? (
              <EstimatedBadge tooltip={survey.formula ?? ''} />
            ) : (
              <ProvenanceBadge
                tag={survey.tag}
                tooltip={survey.formula ?? survey.assumption ?? undefined}
                srText
              />
            )}
            {fixtureSky && (
              <span className="rounded bg-amber-400 px-1 text-[10px] font-bold tracking-wide text-black">
                SYNTHETIC
              </span>
            )}
            <span className="basis-full">{survey.credit}</span>
          </p>
        )}
        {picked && (
          <p
            className="pointer-events-auto flex flex-wrap items-center gap-1.5"
            data-testid="sky-picked-text"
          >
            <span className="text-sx-fg">Picked {formatCoords(picked.ra, picked.dec)}</span>
            <EstimatedBadge tooltip={PICK_FORMULA} />
          </p>
        )}
        {targets.done && targets.unplaced.length > 0 && (
          <p className="text-sx-fg">
            Not shown on the sky (lookup failed): {targets.unplaced.join(', ')}. Search them by name
            instead.
          </p>
        )}
        {/* Legend for the small lilac dots: their label shows only on hover or focus, and a touch
            screen has no hover. */}
        {cached.length > 0 && (
          <p className="flex items-center gap-1.5" data-testid="sky-cached-legend">
            <span
              className="inline-block size-2.5 flex-none rounded-full border border-black bg-[#e9d5ff] shadow-[0_0_0_1px_#e9d5ffaa]"
              aria-hidden="true"
            />
            <span>Lilac dots: already downloaded, open instantly.</span>
          </p>
        )}
        {/* Renderer details, for the team; hidden on phones to save space. */}
        <p className="sx-hide-s">
          {state.kind === 'ready' ? `${state.width}×${state.width / 2} px · ` : ''}
          {backend === 'webgpu' ? 'WebGPU' : backend === 'webgl2' ? 'WebGL2' : ''}
        </p>
      </div>
      <p aria-live="polite" className="sr-only" data-testid="sky-view-announcer">
        {viewSay}
      </p>
    </div>
  );
}

const GLYPHS: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  up: 'm6 15 6-6 6 6',
  down: 'm6 9 6 6 6-6',
  left: 'm15 6-6 6 6 6',
  right: 'm9 6 6 6-6 6',
  reset: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5',
};

function SkyButton({
  label,
  glyph,
  onClick,
}: {
  label: string;
  glyph: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="sx-sky-btn grid place-items-center rounded-lg border border-sx-border bg-sx-muted/90 text-sx-fg transition-colors hover:bg-sx-muted-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sx-green"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" className="sx-ico size-4" aria-hidden="true">
        <path d={GLYPHS[glyph]} />
      </svg>
    </button>
  );
}

// Area search on the sky (A18.1, A18.2; issue #96, P8): one 2D canvas in SkyPane's layer slot,
// `pointer-events: none`, drawn from the SkyView render listener with the camera of that frame and
// on state changes (D-34: no loop; the blink redraws on its ticks only, without a WebGL render).
// Device pixel ratio at most 1.5 (D-05). It also registers the square drawing (pointer mode `draw`),
// the track hit test, the text alternative (appended to the canvas's aria-describedby) and the
// focusable square (keys, A18.9). The three.js SkyView is not changed.
import { useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useShellStore } from '@/app/shell/shellStore';
import {
  addSkyDescribedBy,
  registerSkyLayer,
  setSkyDrawHandler,
  SkyViewContext,
  type SkyDrawPoint,
} from '@/app/sky/layers';
import { invalidateSkySafeRect, skySafeRect } from '@/app/sky/safeRect';
import { areaSizeLabel, areaTextAlternative, squareGroupLabel } from '@/app/messages';
import { openAreaEntry, type AreaState } from '@/state/area';
import { useAppStore, type HonestyState } from '@/state/store';
import { effectiveHonesty } from '@/viewer/honesty';
import { raDecToScreen, type ScreenPoint, type SkyCamera } from '@/viewer/sky/skyMath';
import { AREA_TOOL_ENABLED } from './areaTool';
import { searchSquareFromCard } from './AreaCard';
import { visitNumbers } from './blink';
import {
  checkSquare,
  formatSideDeg,
  isSquareKey,
  MIN_SQUARE_PX,
  nudgeSquare,
  skySquareFromScreen,
  squareFromDrag,
} from './drawSquare';
import {
  drawArea,
  emptyStats,
  hitTestTracks,
  type AreaDrawStats,
  type AreaOutline,
} from './drawLayer';
import { boxCorners, type SkySquare } from './geometry';
import { prepareScene, type AreaScene } from './scene';
import { useBlink, useDrawEscape } from './useAreaLifecycle';

/** D-05: the layer's backing store is at most this many device pixels per CSS px. */
export const AREA_MAX_DPR = 1.5;

const SCRATCH: ScreenPoint = { x: 0, y: 0, inFront: false };

/** The square that covers an area's box (keyboard edits start from it). */
function boxSquare(e: {
  ra: number;
  dec: number;
  width_deg: number;
  height_deg: number;
}): SkySquare {
  return { ra: e.ra, dec: e.dec, sideDeg: Math.max(e.width_deg, e.height_deg) };
}

/** The square shown for keyboard edits when only an area box is open (a link, Fly there). */
function squareOf(area: AreaState): SkySquare | null {
  if (area.square) return area.square;
  const e = openAreaEntry(area);
  return e ? boxSquare(e) : null;
}

/**
 * The square the keys act on (review finding 3): while an area is open and the square has not
 * been edited since, the area's own box, never a square left from an earlier drag.
 */
function keySquare(area: AreaState, edited: boolean): SkySquare | null {
  const e = openAreaEntry(area);
  if (e && !edited) return boxSquare(e);
  return squareOf(area);
}

function altText(area: AreaState, honesty: HonestyState | null): string {
  const e = openAreaEntry(area);
  if (!e || area.summary.status !== 'ready') return '';
  const visits = visitNumbers(area.summary.data, area.dots.data);
  const nDots = area.dots.data?.visits.find((v) => v.visit === area.visit)?.dots.length ?? 0;
  return areaTextAlternative({
    widthDeg: e.width_deg,
    heightDeg: e.height_deg,
    visit: area.visit,
    nVisits: visits.length,
    measured: effectiveHonesty(honesty) === 'measured',
    nDots,
    tracks: area.layers.tracks ? (area.tracks.data?.tracks ?? null) : null,
  });
}

interface AreaLayerHook {
  stats(): AreaDrawStats & { visit: number; redraws: number };
  skyToScreen(ra: number, dec: number): { x: number; y: number; inFront: boolean } | null;
  trackDotScreen(trackId: string): { x: number; y: number } | null;
}

export function AreaLayer() {
  const view = useContext(SkyViewContext);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const altId = useId();
  const summary = useAppStore((s) => s.area.summary.data);
  const dots = useAppStore((s) => s.area.dots.data);
  const tracks = useAppStore((s) => s.area.tracks.data);
  const scene = useMemo<AreaScene | null>(
    () => (dots ? prepareScene(summary, dots, tracks) : null),
    [summary, dots, tracks],
  );
  const sceneRef = useRef<AreaScene | null>(null);
  const active = useShellStore((s) => s.tool === 'area') && AREA_TOOL_ENABLED;
  const alt = useAppStore((s) => (active ? altText(s.area, s.honesty) : ''));
  // Stable selections only (a new object per call would re-render forever).
  const drawn = useAppStore((s) => s.area.square);
  const boxEntry = useAppStore((s) => openAreaEntry(s.area));
  const square = !active
    ? null
    : (drawn ??
      (boxEntry
        ? {
            ra: boxEntry.ra,
            dec: boxEntry.dec,
            sideDeg: Math.max(boxEntry.width_deg, boxEntry.height_deg),
          }
        : null));

  // Shared with the draw handler, the hit test and the render listener (refs, no React render).
  const draft = useRef<{ start: SkyDrawPoint; cur: SkyDrawPoint } | null>(null);
  /** The square was moved with the keys since the last search: the outline shows it. */
  const edited = useRef(false);
  const areaId = useAppStore((s) => s.area.areaId);
  /** The area the square was edited for (false: not edited); a new area shows its box again. */
  const [editedFor, setEditedFor] = useState<string | null | false>(false);
  const editedShown = editedFor !== false && editedFor === areaId;
  // A new area (a snap, a link, Fly there) shows its box: earlier key edits no longer apply.
  useEffect(() => {
    edited.current = false;
  }, [areaId]);
  const camRef = useRef<{ cam: SkyCamera; w: number; h: number } | null>(null);
  const scheduleRef = useRef<() => void>(() => undefined);
  const statsRef = useRef<AreaDrawStats>(emptyStats());
  const redraws = useRef(0);

  useBlink();
  useDrawEscape();

  // ---- Drawing -------------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!view || !canvas) return;
    // jsdom and odd browsers have no 2D context: the layer then draws nothing (never crashes).
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const cam: SkyCamera = { ra: 0, dec: 0, fovDeg: 60 };
    let w = 0;
    let h = 0;
    let have = false;
    let frame = 0;
    let dpr = 0;

    const placeGroup = (outline: AreaOutline | null) => {
      const g = groupRef.current;
      if (!g) return;
      if (!outline) {
        g.style.visibility = 'hidden';
        return;
      }
      const corners =
        outline.kind === 'box'
          ? boxCorners(
              outline.box.ra,
              outline.box.dec,
              outline.box.width_deg,
              outline.box.height_deg,
            )
          : boxCorners(
              outline.square.ra,
              outline.square.dec,
              outline.square.sideDeg,
              outline.square.sideDeg,
            );
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const c of corners) {
        const p = raDecToScreen(cam, c.ra, c.dec, w, h, SCRATCH);
        if (!p.inFront) {
          g.style.visibility = 'hidden';
          return;
        }
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
      g.style.visibility = 'visible';
      g.style.transform = `translate3d(${x0.toFixed(1)}px, ${y0.toFixed(1)}px, 0)`;
      g.style.width = `${Math.max(1, x1 - x0).toFixed(1)}px`;
      g.style.height = `${Math.max(1, y1 - y0).toFixed(1)}px`;
    };

    /** Inactive and already emptied: nothing to do until the tool is chosen (review F9). */
    let cleared = false;
    const redraw = () => {
      frame = 0;
      if (!have) return;
      if (useShellStore.getState().tool !== 'area' || !AREA_TOOL_ENABLED) {
        if (cleared) return;
        // A 0 x 0 backing store: no pixels kept or composited while the sky is used without Area.
        canvas.width = 0;
        canvas.height = 0;
        dpr = 0;
        for (const t of sceneRef.current?.tracks ?? []) {
          t.sx.fill(Number.NaN);
          t.sy.fill(Number.NaN);
        }
        statsRef.current = emptyStats();
        placeGroup(null);
        cleared = true;
        return;
      }
      cleared = false;
      const nextDpr = Math.min(window.devicePixelRatio || 1, AREA_MAX_DPR);
      const bw = Math.max(1, Math.round(w * nextDpr));
      const bh = Math.max(1, Math.round(h * nextDpr));
      if (canvas.width !== bw || canvas.height !== bh || dpr !== nextDpr) {
        canvas.width = bw;
        canvas.height = bh;
        dpr = nextDpr;
        invalidateSkySafeRect();
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraws.current++;
      const s = useAppStore.getState();
      const a = s.area;
      const scene = sceneRef.current;
      const entry = openAreaEntry(a);
      const sq = squareOf(a);
      let outline: AreaOutline | null = null;
      if (entry && !edited.current) {
        outline = {
          kind: 'box',
          box: entry,
          label: areaSizeLabel(entry.width_deg, entry.height_deg),
        };
      } else if (sq) {
        outline = { kind: 'square', square: sq, label: formatSideDeg(sq.sideDeg) };
      }
      let draftIn: { square: ReturnType<typeof squareFromDrag>; label: string } | null = null;
      if (draft.current) {
        const scr = squareFromDrag(draft.current.start, draft.current.cur);
        draftIn = {
          square: scr,
          label: formatSideDeg(skySquareFromScreen(scr, cam, w, h).sideDeg),
        };
      }
      statsRef.current = drawArea(ctx, {
        scene: entry ? scene : null,
        visit: a.visit,
        step: a.step,
        layers: a.layers,
        measured: effectiveHonesty(s.honesty) === 'measured',
        selected: a.selectedResult,
        outline,
        draft: draftIn,
        cam,
        width: w,
        height: h,
        safe: skySafeRect(),
      });
      placeGroup(outline);
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(redraw);
    };
    scheduleRef.current = schedule;

    // H1: onRender passes the view's live camera object; keep a copy.
    const off = view.onRender((c, ww, hh) => {
      cam.ra = c.ra;
      cam.dec = c.dec;
      cam.fovDeg = c.fovDeg;
      if (ww !== w || hh !== h) invalidateSkySafeRect();
      w = ww;
      h = hh;
      have = true;
      camRef.current = { cam, w, h };
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      redraw();
    });
    const offStore = useAppStore.subscribe((s, p) => {
      if (s.area !== p.area || s.honesty !== p.honesty) schedule();
    });
    const offShell = useShellStore.subscribe((s, p) => {
      if (s.tool !== p.tool || s.pointerMode !== p.pointerMode) schedule();
    });
    const onResize = () => {
      invalidateSkySafeRect();
      schedule();
    };
    window.addEventListener('resize', onResize);

    if (import.meta.env.MODE === 'fixtures') {
      const hook: AreaLayerHook = {
        stats: () => ({
          ...statsRef.current,
          visit: useAppStore.getState().area.visit,
          redraws: redraws.current,
        }),
        skyToScreen: (ra, dec) => {
          if (!have) return null;
          const p = raDecToScreen(cam, ra, dec, w, h);
          return { x: p.x, y: p.y, inFront: p.inFront };
        },
        trackDotScreen: (trackId) => {
          const t = sceneRef.current?.tracks.find((x) => x.id === trackId);
          if (!t) return null;
          const visit = useAppStore.getState().area.visit;
          for (let k = 0; k < t.sx.length; k++) {
            if (t.pointVisit[k] === visit && !Number.isNaN(t.sx[k]!))
              return { x: t.sx[k]!, y: t.sy[k]! };
          }
          return null;
        },
      };
      (window as unknown as { __sxAreaLayer?: AreaLayerHook }).__sxAreaLayer = hook;
    }

    view.requestRender();
    return () => {
      off();
      offStore();
      offShell();
      window.removeEventListener('resize', onResize);
      if (frame) cancelAnimationFrame(frame);
      scheduleRef.current = () => undefined;
      camRef.current = null;
    };
  }, [view]);

  // A new scene (data arrived) redraws with the cached camera.
  useLayoutEffect(() => {
    sceneRef.current = scene;
    scheduleRef.current();
  }, [scene]);

  // ---- Draw handler (pointer mode `draw`) ------------------------------------------------------
  useEffect(
    () =>
      setSkyDrawHandler({
        start: (p) => {
          draft.current = { start: p, cur: p };
          scheduleRef.current();
        },
        move: (p) => {
          if (!draft.current) return;
          draft.current.cur = p;
          scheduleRef.current();
        },
        end: (p) => {
          const d = draft.current;
          draft.current = null;
          scheduleRef.current();
          const c = camRef.current;
          if (!d || !c) return;
          const scr = squareFromDrag(d.start, p);
          const sq = skySquareFromScreen(scr, c.cam, c.w, c.h);
          const refusal = checkSquare(scr.side, sq.sideDeg);
          const store = useAppStore.getState();
          if (refusal) {
            store.areaRefuse(refusal);
            return;
          }
          edited.current = false;
          setEditedFor(false);
          void searchSquareFromCard(sq);
        },
        cancel: () => {
          draft.current = null;
          scheduleRef.current();
        },
      }),
    [],
  );

  // ---- Hit test (after marker buttons, before the sky's pick; A18.2) ---------------------------
  useEffect(
    () =>
      registerSkyLayer({
        id: 'area',
        order: 10,
        hitTest: (x, y) => {
          const shell = useShellStore.getState();
          if (!AREA_TOOL_ENABLED || shell.tool !== 'area' || shell.pointerMode !== 'pan') {
            return false;
          }
          const id = hitTestTracks(sceneRef.current, x, y);
          if (id === null) return false;
          useAppStore.getState().areaSelectResult(id);
          return true;
        },
      }),
    [],
  );

  // ---- Text alternative (A18.2, A21.12): appended, never replacing the shell's ------------------
  useEffect(() => (alt ? addSkyDescribedBy(altId) : undefined), [alt, altId]);

  // ---- Keys on the square (A18.9): only while it has focus --------------------------------------
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const store = useAppStore.getState();
    const sq = keySquare(store.area, edited.current);
    if (!sq) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      edited.current = false;
      setEditedFor(false);
      void searchSquareFromCard(sq);
      return;
    }
    if (!isSquareKey(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const c = camRef.current;
    const minDeg = c ? (MIN_SQUARE_PX * c.cam.fovDeg) / Math.max(1, c.h) : 0;
    edited.current = true;
    setEditedFor(store.area.areaId);
    store.areaSetSquare(nudgeSquare(sq, e.key, e.shiftKey, minDeg));
  };

  const groupLabel =
    editedShown || !boxEntry
      ? square
        ? squareGroupLabel(square.sideDeg, square.sideDeg)
        : ''
      : squareGroupLabel(boxEntry.width_deg, boxEntry.height_deg);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 block h-full w-full"
        aria-hidden="true"
        data-testid="area-layer"
      />
      {active && square && (
        <div
          ref={groupRef}
          role="group"
          tabIndex={0}
          aria-label={groupLabel}
          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight Enter"
          className="sx-area-square pointer-events-none absolute top-0 left-0"
          style={{ visibility: 'hidden' }}
          onKeyDown={onKeyDown}
          onFocus={() => scheduleRef.current()}
          data-testid="area-square"
        />
      )}
      <p id={altId} className="sr-only" data-testid="area-alt">
        {alt}
      </p>
    </>
  );
}

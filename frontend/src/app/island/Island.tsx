// The island (mock-up `.island-wrap`): a 52 px circle at the top centre of the screen with the grid
// loader at rest. While the object is found and its frames searched it widens into a "Thinking"
// pill with the loading sentence. When the panel opens it grows and moves to where the panel is,
// and the panel's content fades in over it; when the panel closes it moves back up (#66).
//
// It is decorative apart from the status line while it thinks, and it takes no clicks. Its box is
// state (px) so the move is one CSS transition; the panel reports where it is (islandStore).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAppStore } from '@/state/store';
import { useShellStore } from '@/app/shell/shellStore';
import { displayName } from '@/app/displayName';
import { useElapsedSeconds } from '@/app/StatusBoxes';
import GridLoader from './GridLoader';
import { FOUND_LOOK, IDLE_LOOK, LOADER_BASE, SEARCHING_LOOK, UPDATING_LOOK } from './loaderLooks';
import { areaMiniTitle, useAreaStore } from '@/app/shell/areaStore';
import { subscribeMotion } from '@/app/sky/skyMotion';
import { isThinking } from './islandText';
import { useIslandStore } from './islandStore';

const CIRCLE = 52;
const TOP = 4;
/** Phone width (the app's own breakpoint): the header is full, so the island sits over the sky. */
const COMPACT = '(max-width: 640px)';
/** The move takes 0.6 s (index.css); the panel shows once it is over. */
const TRAVEL_MS = 700;

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const change = () => setOn(mq.matches);
    mq.addEventListener('change', change);
    return () => mq.removeEventListener('change', change);
  }, [query]);
  return on;
}

export function Island() {
  const sky = useAppStore((s) => s.sky);
  const panelBox = useIslandStore((s) => s.panelBox);
  const arrived = useIslandStore((s) => s.arrived);
  const travels = useIslandStore((s) => s.travels);
  const setArrived = useIslandStore((s) => s.setArrived);
  const setTravels = useIslandStore((s) => s.setTravels);
  const reduced = useMedia('(prefers-reduced-motion: reduce)');
  const compact = useMedia(COMPACT);

  // Only a panel that opens after the island thought is travelled to; one opened from the rail
  // with nothing loading just shows, and the island stays at the top.
  // A minimised card (an area card, or the Flipbook card): the island is a pill that holds its place.
  const objMini = useShellStore((s) =>
    s.minimised && (s.tool === 'flipbook' || s.tool === 'spectrum')
      ? (sky.resolved ? displayName(sky.resolved.name) || 'Flipbook' : 'Flipbook')
      : null,
  );
  // Q-456: a minimised build view is a pill too, named after the body; a click brings it back.
  const buildMini = useShellStore((s) =>
    s.build.open && s.buildMinimised
      ? (sky.resolved ? displayName(sky.resolved.name) || '3D view' : '3D view')
      : null,
  );
  const areaMiniOn = useAreaStore((s) => s.minimised) || objMini !== null || buildMini !== null;
  const inPanel = panelBox !== null && travels && !areaMiniOn;
  const thinking = panelBox === null && isThinking(sky.status);
  // While the sky view moves, the island shows "Updating" for a moment (a cue only; nothing loads).
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = subscribeMotion(() => {
      setMoving(true);
      clearTimeout(t);
      t = setTimeout(() => setMoving(false), 900);
    });
    return () => {
      off();
      clearTimeout(t);
    };
  }, []);
  // The square tools (Known objects, Discovery): the island says what the dummy search is doing, and
  // it holds the place of a minimised card (a click brings it back).
  const areaSay = useAreaStore((s) => s.say);
  const areaCardMini = useAreaStore((s) => (s.minimised ? areaMiniTitle(s) : null));
  const areaMini = buildMini ?? areaCardMini ?? objMini;
  const areaRunning = useAreaStore((s) => s.running);
  const restore = () => {
    if (buildMini !== null) {
      useShellStore.getState().setBuildMinimised(false);
      return;
    }
    // The card grows out of the island again, as when it first opened.
    setTravels(true);
    if (objMini !== null) useShellStore.getState().setMinimised(false);
    else useAreaStore.getState().setMinimised(false);
  };
  const miniRef = useRef<HTMLButtonElement>(null);
  // Focus moves to the pill when a card is minimised, not again when its name changes.
  const miniOn = areaMini !== null;
  useEffect(() => {
    if (miniOn) miniRef.current?.focus({ preventScroll: true });
  }, [miniOn]);
  const areaOn = areaSay !== null || areaMini !== null;
  const updating = !thinking && !areaOn && moving && panelBox === null;
  // The island travels into the area card once an area is set (after its Searching / found state),
  // exactly as it does into the object panel; drawing an area is not a trip.
  const areaTool = useShellStore((s) => s.tool === 'area');
  const areaStaged = useAreaStore((s) => s.stage === 'set');
  const areaSet = areaTool && areaStaged;
  const pillOn = thinking || updating || areaOn;
  const panelTool = useShellStore((s) => s.tool === 'flipbook' || s.tool === 'spectrum');
  useEffect(() => {
    // Thinking starts a trip. It ends when the panel is closed, or when the search ended with no
    // panel to go to (a right-click card): a later panel from the rail has nothing to travel for.
    if (thinking || areaSet) setTravels(true);
    else if (!panelTool) setTravels(false);
  }, [thinking, areaSet, panelTool, setTravels]);
  // While it thinks there is no panel to take an Escape, so the island takes it and leaves the tool
  // (a key that was already handled, such as Escape in the search field, is left alone).
  useEffect(() => {
    if (!thinking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (useShellStore.getState().tool === 'sky') return;
      useShellStore.getState().closePanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [thinking]);
  const seconds = useElapsedSeconds(thinking ? sky.startedAt : null);
  // One word; after 20 s it says it is still going.
  const word = thinking && seconds >= 20 ? 'Still searching' : 'Searching';

  const wrapRef = useRef<HTMLDivElement>(null);
  const inRef = useRef<HTMLDivElement>(null);
  const [bezelW, setBezelW] = useState(0);
  const [bezelH, setBezelH] = useState(0);
  // Mock-up floating layout: on a desktop width it rests at the bottom right (the cards float there
  // too, and it travels into the panel's box from there). A phone keeps it over the top of the sky.
  const corner = !compact && bezelH > 0;
  const [top, setTop] = useState(TOP);
  const [ready, setReady] = useState(false);
  const [pill, setPill] = useState({ w: CIRCLE, h: CIRCLE });

  // The bezel's width, to centre the circle (its box is in px so the move is one transition), and
  // the top it rests at: the header's, or on a phone the top of the sky.
  useLayoutEffect(() => {
    const bezel = wrapRef.current?.offsetParent as HTMLElement | null;
    if (!bezel) return;
    const measure = () => {
      setBezelW(bezel.clientWidth);
      setBezelH(bezel.clientHeight);
      const view = bezel.querySelector('.sx-view');
      if (!compact || !view) return setTop(TOP);
      const v = view.getBoundingClientRect();
      const b = bezel.getBoundingClientRect();
      setTop(Math.round(v.top - b.top - bezel.clientTop + 8));
    };
    measure();
    const frame = requestAnimationFrame(() => setReady(true));
    if (typeof ResizeObserver === 'undefined') return () => cancelAnimationFrame(frame);
    let again = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(again);
      again = requestAnimationFrame(measure);
    });
    ro.observe(bezel);
    // The sky moves down when the fixture banner appears, and back when it goes.
    const view = bezel.querySelector('.sx-view');
    if (view) ro.observe(view);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(again);
      ro.disconnect();
    };
  }, [compact]);

  // The pill's natural size for its text (the inner box sizes to its content, at most 340 px).
  useLayoutEffect(() => {
    if (!pillOn || !inRef.current) return;
    setPill({ w: inRef.current.offsetWidth, h: inRef.current.offsetHeight });
  }, [pillOn, word, updating, areaSay?.text, areaMini]);

  // The panel shows once the island has got there.
  useEffect(() => {
    if (!inPanel || arrived) return;
    if (reduced) {
      setArrived(true);
      return;
    }
    const t = setTimeout(() => setArrived(true), TRAVEL_MS);
    return () => clearTimeout(t);
  }, [inPanel, arrived, reduced, setArrived]);

  let box: { left: number; top: number; width: number; height: number; radius: number };
  if (panelBox && !areaMiniOn) box = { ...panelBox, radius: 10 };
  else if (corner && pillOn)
    box = {
      left: bezelW - pill.w - 16,
      top: bezelH - pill.h - 16,
      width: pill.w,
      height: pill.h,
      radius: Math.min(pill.h / 2, 24),
    };
  else if (corner)
    box = {
      left: bezelW - CIRCLE - 16,
      top: bezelH - CIRCLE - 16,
      width: CIRCLE,
      height: CIRCLE,
      radius: CIRCLE / 2,
    };
  else if (pillOn)
    box = {
      left: (bezelW - pill.w) / 2,
      top,
      width: pill.w,
      height: pill.h,
      radius: Math.min(pill.h / 2, 24),
    };
  else
    box = {
      left: (bezelW - CIRCLE) / 2,
      top,
      width: CIRCLE,
      height: CIRCLE,
      radius: CIRCLE / 2,
    };

  const mode = inPanel ? 'panel' : pillOn ? 'thinking' : 'idle';
  return (
    <div
      ref={wrapRef}
      className="sx-orb-wrap"
      data-testid="island"
      data-mode={mode}
      data-compact={compact ? '' : undefined}
      data-ready={ready && bezelW > 0 ? '' : undefined}
      data-arrived={arrived ? '' : undefined}
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        visibility: bezelW > 0 ? undefined : 'hidden',
      }}
    >
      <div className="sx-orb-glow" aria-hidden="true" data-on={mode !== 'panel' ? '' : undefined} />
      <div className="sx-orb" style={{ borderRadius: box.radius }}>
        <div className="sx-orb-in" ref={inRef} data-mode={mode}>
          {/* Moves only while it searches (a progress indicator). At rest it is lit and still: WCAG
              2.2.2, and no repaint of the page every frame for a decoration (issue #66, Q-121).
              smoothui's loader is an <output aria-label="Loading">, a live region: hidden here, the
              word beside it is the status. */}
          {areaMini !== null ? (
            <button
              type="button"
              ref={miniRef}
              className="sx-orb-mini"
              onClick={restore}
              aria-label={`${areaMini}, minimised. Open it`}
              title="Open"
              data-testid="island-mini"
            >
              <span aria-hidden="true" className="contents">
                <GridLoader
                  {...(areaRunning ? SEARCHING_LOOK : FOUND_LOOK)}
                  className="flex-none"
                />
              </span>
              <span className="sx-orb-word">{areaMini}</span>
            </button>
          ) : (
          <span aria-hidden="true" className="contents">
            {thinking || areaSay?.kind === 'searching' ? (
              <GridLoader {...SEARCHING_LOOK} className="flex-none" />
            ) : areaSay?.kind === 'found' ? (
              <GridLoader {...FOUND_LOOK} className="flex-none" />
            ) : updating && !reduced ? (
              <GridLoader {...UPDATING_LOOK} className="flex-none" />
            ) : (
              <GridLoader {...LOADER_BASE} {...IDLE_LOOK} />
            )}
          </span>
          )}
          {areaSay && (
            <span className="sx-orb-word" role="status" data-testid="area-island">
              {areaSay.text}
            </span>
          )}
          {thinking && (
            <span className="sx-orb-word" role="status" data-testid="loading">
              {word}
            </span>
          )}
          {/* A visual cue while the view moves; not announced (nothing is loading). */}
          {updating && (
            <span className="sx-orb-word" aria-hidden="true" data-testid="island-updating">
              Updating
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

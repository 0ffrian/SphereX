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
import { useElapsedSeconds } from '@/app/StatusBoxes';
import GridLoader from './GridLoader';
import { IDLE_LOOK, LOADER_BASE, SEARCHING_LOOK } from './loaderLooks';
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
  const inPanel = panelBox !== null && travels;
  const thinking = panelBox === null && isThinking(sky.status);
  const panelTool = useShellStore((s) => s.tool === 'flipbook' || s.tool === 'spectrum');
  useEffect(() => {
    // Thinking starts a trip. It ends when the panel is closed, or when the search ended with no
    // panel to go to (a right-click card): a later panel from the rail has nothing to travel for.
    if (thinking) setTravels(true);
    else if (!panelTool) setTravels(false);
  }, [thinking, panelTool, setTravels]);
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
    if (!thinking || !inRef.current) return;
    setPill({ w: inRef.current.offsetWidth, h: inRef.current.offsetHeight });
  }, [thinking, word]);

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
  if (panelBox) box = { ...panelBox, radius: 10 };
  else if (corner && thinking)
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
  else if (thinking)
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

  const mode = inPanel ? 'panel' : thinking ? 'thinking' : 'idle';
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
          <span aria-hidden="true" className="contents">
            {thinking ? (
              <GridLoader {...SEARCHING_LOOK} className="flex-none" />
            ) : (
              <GridLoader {...LOADER_BASE} {...IDLE_LOOK} />
            )}
          </span>
          {thinking && (
            <span className="sx-orb-word" role="status" data-testid="loading">
              {word}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

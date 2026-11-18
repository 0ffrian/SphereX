// The panel that the active tool opens: the object panel (object info, the flipbook cutout and the
// spectrum, as one scrolling card). 'sky' shows no panel; the 3D viewer is the build pane
// (app/build/BuildPane.tsx, issue #60), not a floating card.
import { displayName } from '@/app/displayName';
import { formatCoords } from '@/app/format';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { Flipbook } from '@/app/flipbook/Flipbook';
import { useSelection } from '@/app/build/selectedBody';
import { isThinking } from '@/app/island/islandText';
import { boxInBezel, useIslandStore } from '@/app/island/islandStore';
import { useAppStore } from '@/state/store';
import { AreaCard } from './AreaCard';
import { PanelCard } from './PanelCard';
import { useShellStore } from './shellStore';

export function Panels() {
  const tool = useShellStore((s) => s.tool);
  const thinking = useAppStore((s) => isThinking(s.sky.status));
  const minimised = useShellStore((s) => s.minimised);
  // A new search opens the card again (its result belongs on screen, not in the pill).
  const query = useAppStore((s) => s.sky.query);
  useEffect(() => {
    useShellStore.getState().setMinimised(false);
  }, [query]);
  // While the object is found and its frames searched the island thinks (issue #66); the panel
  // opens from it when the data is in (or the search failed, so the error and Try again show).
  if (tool === 'area') return <AreaCard />;
  // Minimised: the island's pill holds its place (Island.tsx) and a click on it brings it back.
  if ((tool === 'flipbook' || tool === 'spectrum') && !thinking && !minimised)
    return <ObjectPanel />;
  return null;
}

/**
 * Tells the island where this panel is while it is mounted, and keeps it up to date.
 *
 * Not a ResizeObserver on the panel: SkyPane's own observer sets `--sx-credit-h`, which resizes the
 * panel, and a second observer on it makes the browser log "ResizeObserver loop completed with
 * undelivered notifications". The panel changes size when its content changes (mutations, a
 * picture decoding), when the credit strip changes height (the style of the sky pane), or when the
 * window does; each of those schedules one measurement on the next frame.
 */
function useReportBox(ref: React.RefObject<HTMLElement | null>): void {
  const setPanelBox = useIslandStore((s) => s.setPanelBox);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => setPanelBox(boxInBezel(el));
    report();
    let frame = 0;
    const soon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(report);
    };
    const mo = new MutationObserver(soon);
    mo.observe(el, { childList: true, subtree: true, characterData: true, attributes: true });
    const host = el.parentElement;
    if (host) mo.observe(host, { attributes: true, attributeFilter: ['style'] });
    window.addEventListener('resize', soon);
    el.addEventListener('load', soon, true);
    return () => {
      cancelAnimationFrame(frame);
      mo.disconnect();
      window.removeEventListener('resize', soon);
      el.removeEventListener('load', soon, true);
      setPanelBox(null);
    };
  }, [ref, setPanelBox]);
}

function ObjectPanel() {
  const tool = useShellStore((s) => s.tool);
  const focusSeq = useShellStore((s) => s.focusSeq);
  const closePanel = useShellStore((s) => s.closePanel);
  const sky = useAppStore((s) => s.sky);
  const bodyRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  // Pending only while the island travels here (it thought first); otherwise it shows at once.
  const pending = useIslandStore((s) => s.travels && !s.arrived);
  useReportBox(rootRef);
  const selection = useSelection();

  // The Spectrum tool scrolls to the spectrum section; the Flipbook tool to the top.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    if (tool === 'spectrum') {
      body.querySelector('[data-testid="spectrum-panel"]')?.scrollIntoView({ block: 'start' });
    } else body.scrollTop = 0;
  }, [tool, focusSeq]);

  const r = sky.resolved;
  const subtitle = r
    ? displayName(r.name) || formatCoords(r.ra, r.dec)
    : sky.query
      ? `Looking up ${sky.query.q}`
      : 'No object yet';
  const nFrames = sky.frames?.frames.length ?? 0;

  return (
    <PanelCard
      bare
      title={tool === 'spectrum' ? 'Spectrum' : 'Flipbook'}
      subtitle={subtitle}
      icon={tool === 'spectrum' ? 'spectrum' : 'flipbook'}
      onClose={closePanel}
      returnFocusTo={`[data-testid="tool-${tool}"]`}
      bodyRef={bodyRef}
      rootRef={rootRef}
      pending={pending}
      testId="object-panel"
    >
      {(close) => (
        <>
          {sky.status === 'idle' && (
            <p className="p-4 text-sm text-sx-mfg" data-testid="panel-empty">
              No object yet. Click a point or a marker on the sky, or search a name or RA, Dec.
            </p>
          )}
          <Flipbook
            onClose={close}
            // Issue #60: the same "Build it" as the selected object's card, for a typed search.
            onBuild={selection ? () => useShellStore.getState().openBuild(true) : undefined}
          />
          {tool === 'spectrum' && sky.status === 'ready' && nFrames === 0 && !sky.progress && (
            <p className="p-4 text-sm text-sx-mfg">There is no spectrum without frames.</p>
          )}
        </>
      )}
    </PanelCard>
  );
}

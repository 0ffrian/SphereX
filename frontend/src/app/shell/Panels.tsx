// The panel that the active tool opens: the object panel (object info, the flipbook cutout and the
// spectrum, as one scrolling card). 'sky' shows no panel; the 3D viewer is the build pane
// (app/build/BuildPane.tsx, issue #60), not a floating card.
import { useEffect, useRef } from 'react';
import { Flipbook } from '@/app/flipbook/Flipbook';
import { formatCoords } from '@/app/format';
import { SpectrumPanel } from '@/app/spectrum/SpectrumPanel';
import { useSelection } from '@/app/build/selectedBody';
import { useAppStore } from '@/state/store';
import { PanelCard } from './PanelCard';
import { useShellStore } from './shellStore';

export function Panels() {
  const tool = useShellStore((s) => s.tool);
  if (tool === 'flipbook' || tool === 'spectrum') return <ObjectPanel />;
  return null;
}

function ObjectPanel() {
  const tool = useShellStore((s) => s.tool);
  const focusSeq = useShellStore((s) => s.focusSeq);
  const closePanel = useShellStore((s) => s.closePanel);
  const sky = useAppStore((s) => s.sky);
  const bodyRef = useRef<HTMLDivElement>(null);
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
    ? (r.name ?? formatCoords(r.ra, r.dec))
    : sky.query
      ? `Looking up ${sky.query.q}`
      : 'No object yet';
  const nFrames = sky.frames?.frames.length ?? 0;

  return (
    <PanelCard
      title={tool === 'spectrum' ? 'Spectrum' : 'Flipbook'}
      subtitle={subtitle}
      icon={tool === 'spectrum' ? 'spectrum' : 'flipbook'}
      onClose={closePanel}
      returnFocusTo={`[data-testid="tool-${tool}"]`}
      bodyRef={bodyRef}
      testId="object-panel"
    >
      {sky.status === 'idle' && (
        <p className="text-sm text-sx-mfg" data-testid="panel-empty">
          No object yet. Click a point or a marker on the sky, or search a name or RA, Dec.
        </p>
      )}
      <Flipbook />
      <SpectrumPanel />
      {tool === 'spectrum' && sky.status === 'ready' && nFrames === 0 && !sky.progress && (
        <p className="text-sm text-sx-mfg">There is no spectrum without frames.</p>
      )}
      {selection && (
        // Issue #60: the same "Build it" as the selected object's card, for a typed search.
        <div className="flex">
          <button
            type="button"
            className="sx-btn sx-btn-ghost"
            onClick={() => useShellStore.getState().openBuild(true)}
            data-testid="panel-build-it"
          >
            Build it in 3D
          </button>
        </div>
      )}
    </PanelCard>
  );
}

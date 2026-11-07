// The panel that the active tool opens: the object panel (object info, the flipbook cutout and the
// spectrum, as one scrolling card) or the 3D viewer. 'sky' shows no panel.
import { useEffect, useRef } from 'react';
import { Flipbook } from '@/app/flipbook/Flipbook';
import { formatCoords } from '@/app/format';
import { SpectrumPanel } from '@/app/spectrum/SpectrumPanel';
import { StatusLine } from '@/app/StatusLine';
import { ViewerPanel } from '@/app/ViewerPanel';
import { useAppStore } from '@/state/store';
import { PanelCard } from './PanelCard';
import { useShellStore } from './shellStore';

export function Panels() {
  const tool = useShellStore((s) => s.tool);
  if (tool === 'flipbook' || tool === 'spectrum') return <ObjectPanel />;
  if (tool === 'viewer') return <ViewerCard />;
  return null;
}

function ObjectPanel() {
  const tool = useShellStore((s) => s.tool);
  const focusSeq = useShellStore((s) => s.focusSeq);
  const closePanel = useShellStore((s) => s.closePanel);
  const sky = useAppStore((s) => s.sky);
  const bodyRef = useRef<HTMLDivElement>(null);

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
    </PanelCard>
  );
}

function ViewerCard() {
  const closePanel = useShellStore((s) => s.closePanel);
  return (
    <PanelCard
      title="3D viewer"
      subtitle="Sky Sculptor: the loaded body in 3D"
      icon="viewer"
      wide
      onClose={closePanel}
      returnFocusTo={'[data-testid="tool-viewer"]'}
      testId="viewer-card"
    >
      <ViewerPanel />
      <StatusLine />
    </PanelCard>
  );
}

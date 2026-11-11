// Issue #71 stream U (Q-294): the two floating panels of the mock-up's build view that sit at the
// bottom of the screen: the zoom bar (bottom left, `.zoom`: minus, the zoom, plus) and the tool
// dock (bottom centre, `.dock`: target, audio, haptics, area, then search). Both are shell chrome in
// the mock-up and are drawn here only while the build is open, on a desktop width (a phone keeps
// the tab bar). Each button does a real thing or says it cannot:
//   zoom bar   -> the 3D view (ViewerApp.zoom / resetView; the value is its own zoom, 100% = as opened)
//   target     -> back to the sky (closes the build)
//   audio      -> the spectrum tool (the fingerprint chart; its Listen sweep is also in "Hear it")
//   fingerprint-> "Feel it" (the build pane's Feel panel)
//   area       -> Area search: not built, shown disabled
//   search     -> the search field
import { useEffect, useState } from 'react';
import { Icon } from '@/app/shell/icons';
import { RailIcon } from '@/app/shell/railIcons';
import { openTool } from '@/app/shell/ToolRail';
import { useViewControls } from '@/app/engineView';
import { closeBuildPane } from './focus';
import type { PopId } from '@/app/ViewerPanel';

/** "150%": the view's zoom against the view the body opened with. */
export function zoomPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function ZoomBar() {
  const vc = useViewControls();
  const [ratio, setRatio] = useState(1);
  // The view also zooms with the wheel and a pinch, so the value is read, not counted.
  useEffect(() => {
    const read = () => setRatio(vc.ratio());
    read();
    const id = window.setInterval(read, 250);
    return () => window.clearInterval(id);
  }, [vc]);
  const step = (dir: 'in' | 'out') => {
    vc.zoom(dir);
    setRatio(vc.ratio());
  };
  // A control the drawing view cannot do is disabled and says why in its name.
  const named = (label: string, off: string | null) => (off ? `${label}. Not available: ${off}` : label);
  return (
    <div className="sx-fl sx-zoom" role="group" aria-label="Zoom the 3D view" data-testid="build-zoom">
      <button
        type="button"
        className="sx-btn-i"
        aria-label={named('Zoom out', vc.zoomOff)}
        title={vc.zoomOff ?? 'Zoom out'}
        disabled={vc.zoomOff !== null}
        onClick={() => step('out')}
      >
        <Icon name="zoomOut" className="size-4" />
      </button>
      <button
        type="button"
        className="sx-zval"
        aria-label={vc.resetOff ? named('Reset the zoom', vc.resetOff) : `Reset the zoom. Now ${zoomPercent(ratio)}`}
        title={vc.resetOff ?? 'Reset zoom'}
        disabled={vc.resetOff !== null}
        onClick={() => {
          vc.reset();
          setRatio(vc.ratio());
        }}
        data-testid="build-zoom-value"
      >
        {zoomPercent(ratio)}
      </button>
      <button
        type="button"
        className="sx-btn-i"
        aria-label={named('Zoom in', vc.zoomOff)}
        title={vc.zoomOff ?? 'Zoom in'}
        disabled={vc.zoomOff !== null}
        onClick={() => step('in')}
      >
        <Icon name="zoomIn" className="size-4" />
      </button>
    </div>
  );
}

export function BuildDock({ pop, onPop }: { pop: PopId | null; onPop(p: PopId | null): void }) {
  return (
    <nav className="sx-fl sx-dock" aria-label="Tools and search" data-testid="build-dock">
      <ul className="m-0 flex list-none gap-1 p-0">
        <li>
          <button
            type="button"
            className="sx-dtool"
            data-active="true"
            aria-label="Sky view. Closes the build."
            title="Sky view (closes the build)"
            onClick={closeBuildPane}
            data-testid="dock-sky"
          >
            <RailIcon id="sky" />
          </button>
        </li>
        <li>
          <button
            type="button"
            className="sx-dtool"
            aria-label="Spectrum. Opens the fingerprint chart and closes the build."
            title="Spectrum"
            onClick={() => openTool('spectrum')}
            data-testid="dock-spectrum"
          >
            <RailIcon id="spectrum" />
          </button>
        </li>
        <li>
          <button
            type="button"
            className="sx-dtool"
            aria-pressed={pop === 'feel'}
            aria-label="Feel the surface"
            title="Feel the surface"
            onClick={() => onPop(pop === 'feel' ? null : 'feel')}
            data-testid="dock-feel"
          >
            <Icon name="fingerprint" className="size-5" />
          </button>
        </li>
        <li>
          <button
            type="button"
            className="sx-dtool"
            disabled
            aria-label="Area search. Not available yet."
            title="Area search: not available yet"
            data-testid="dock-area"
          >
            <Icon name="area" className="size-5" />
          </button>
        </li>
      </ul>
      <i className="sx-vsep" aria-hidden="true" />
      <button
        type="button"
        className="sx-dtool"
        aria-label="Search the sky"
        aria-keyshortcuts="/"
        title="Search (/)"
        onClick={() => {
          const input = document.querySelector<HTMLInputElement>('[data-testid="search-input"]');
          input?.focus();
          input?.select();
        }}
        data-testid="dock-search"
      >
        <Icon name="search" className="size-5" />
      </button>
    </nav>
  );
}

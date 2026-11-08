// App shell in the mock-up's layout (mockup/spherex-ui.html): a full-viewport dark bezel with the
// brand, fixture banner and RA/Dec readout on top, the tool rail on the left, the sky view as the
// main pane, the transport bar bottom left and the search pill bottom right. The active tool opens
// a floating panel (object info, flipbook, spectrum; or the 3D viewer) over the sky.
//
// DOM (and Tab) order: header, search, tools, sky (canvas, then the open panel, markers and sky
// controls), transport. The live announcer stays global.
import { useEffect } from 'react';
import { useAppStore } from '@/state/store';
import { FlipbookSessionProvider } from './flipbook/session';
import { FixtureBanner } from './FixtureBanner';
import { LiveAnnouncer } from './LiveAnnouncer';
import { SearchBar } from './search/SearchBar';
import { Panels } from './shell/Panels';
import { Readout } from './shell/Readout';
import { useShellStore } from './shell/shellStore';
import { isEditableTarget, isSearchShortcut } from './shell/shortcuts';
import { ToolRail } from './shell/ToolRail';
import { Transport } from './shell/Transport';
import { SkyPane } from './sky/SkyPane';
import { useHashSync } from './useHashSync';

/** A new search opens the object panel (unless it is already open at the spectrum). */
function useOpenPanelOnSearch(): void {
  useEffect(() => {
    const open = () => {
      const { tool, setTool } = useShellStore.getState();
      if (tool !== 'flipbook' && tool !== 'spectrum') setTool('flipbook');
    };
    // A search from a shared link may have started before this subscription.
    if (useAppStore.getState().sky.query !== null) open();
    return useAppStore.subscribe((s, prev) => {
      if (s.sky.query !== prev.sky.query && s.sky.query !== null) open();
    });
  }, []);
}

/** "/" focuses the search field from anywhere except a text field. */
function useSearchShortcut(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const hit = isSearchShortcut({
        key: e.key,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        editable: isEditableTarget(e.target),
        handled: e.defaultPrevented,
      });
      if (!hit) return;
      const input = document.querySelector<HTMLInputElement>('[data-testid="search-input"]');
      if (!input) return;
      e.preventDefault();
      input.focus();
      input.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  useOpenPanelOnSearch();
  useHashSync();
  useSearchShortcut();
  return (
    <FlipbookSessionProvider>
      <div className="sx-screen">
        <div className="sx-bezel">
          <header className="sx-top">
            <div className="sx-brand">
              <span className="sx-brand-mark" aria-hidden="true">
                {Array.from({ length: 9 }, (_, i) => (
                  <span key={i} />
                ))}
              </span>
              <h1>Shift &amp; Spectrum</h1>
              <small>SPHEREx sky</small>
            </div>
            <FixtureBanner />
            <Readout />
          </header>
          <div className="sx-search-slot">
            <SearchBar />
          </div>
          <ToolRail />
          <main className="sx-view" aria-label="Sky view">
            <SkyPane>
              <Panels />
            </SkyPane>
          </main>
          <div className="sx-transport-slot">
            <Transport />
          </div>
        </div>
        <LiveAnnouncer />
      </div>
    </FlipbookSessionProvider>
  );
}

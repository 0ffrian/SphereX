// App shell in the mock-up's layout (mockup/spherex-ui.html): a full-viewport dark bezel with the
// fixture banner and RA/Dec readout on top, the tool rail on the left, the sky view as the
// main pane, the transport bar bottom left and the search pill bottom right. The active tool opens
// a floating panel (object info, flipbook, spectrum) over the sky.
//
// Issue #60: a marker click selects the object (brackets on the sky and the top-centre card with
// See fingerprint / Build it). Build it splits the view: the sky moves to the left half and the
// build pane on the right moulds the body. The rail's 3D viewer opens the same pane, built.
//
// DOM (and Tab) order: header, search, tools, sky (canvas, then the open panel, markers and sky
// controls), transport. The live announcer stays global.
import { useEffect, useState } from 'react';
import { useAppStore, type SkyQuery } from '@/state/store';
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
import { BuildPane } from './build/BuildPane';
import { SelectedCard } from './build/SelectedCard';
import { useSelectedBodyLoader } from './build/selectedBody';
import { Island } from './island/Island';

/**
 * A new search opens the object panel (unless it is already open at the spectrum), a marker click
 * included (#49). A right-click or long press on the sky asks for the selected object's card
 * instead, which offers the fingerprint and the build (issues #60, #64).
 */
function useOpenPanelOnSearch(): void {
  useEffect(() => {
    const open = (q: SkyQuery) => {
      const shell = useShellStore.getState();
      // A typed search or a link starts without a card; a click on the sky is cleared where it is
      // made (SkyPane), so a right-click that selects and asks for the card is not undone here.
      if (q.origin !== 'sky') shell.cancelCard();
      if (q.origin === 'sky' && shell.cardRequested) return;
      // The build pane keeps the view while a link or Back changes the object under it.
      if (shell.build.open) return;
      if (shell.tool !== 'flipbook' && shell.tool !== 'spectrum') shell.setTool('flipbook');
    };
    // A search from a shared link may have started before this subscription.
    const first = useAppStore.getState().sky.query;
    if (first !== null) open(first);
    return useAppStore.subscribe((s, prev) => {
      if (s.sky.query !== prev.sky.query && s.sky.query !== null) open(s.sky.query);
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

/** True on a phone-width screen, where the build pane is a sheet over the whole sky (issue #60). */
function usePhoneWidth(): boolean {
  const query = '(max-width: 640px)';
  const [phone, setPhone] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

export function App() {
  useOpenPanelOnSearch();
  useHashSync();
  useSearchShortcut();
  useSelectedBodyLoader();
  const split = useShellStore((s) => s.build.open);
  // Under the phone sheet the sky must not be reachable by Tab or a screen reader.
  const phone = usePhoneWidth();
  const skyHidden = split && phone;
  return (
    <FlipbookSessionProvider>
      <div className="sx-screen">
        <div className="sx-bezel" data-split={split || undefined}>
          <header className="sx-top">
            {/* The page heading stays for assistive technology; the brand is not drawn (Q-123). */}
            <h1 className="sr-only">Shift &amp; Spectrum</h1>
            <FixtureBanner />
            <Readout />
          </header>
          <div className="sx-search-slot">
            <SearchBar />
          </div>
          <ToolRail />
          <main className="sx-view" aria-label="Sky view" data-split={split || undefined}>
            <div className="sx-sky-slot" inert={skyHidden || undefined}>
              <SkyPane>
                <SelectedCard />
                <Panels />
              </SkyPane>
            </div>
            {split && <BuildPane />}
          </main>
          {/* The flipbook transport belongs to the flipbook: it steps aside in the split view. */}
          <div className="sx-transport-slot" inert={split || undefined}>
            <Transport />
          </div>
          {/* Issue #66 (mock-up `.island-wrap`): the island, over everything in the bezel. */}
          <Island />
        </div>
        <LiveAnnouncer />
      </div>
    </FlipbookSessionProvider>
  );
}

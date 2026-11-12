// App shell in the mock-up's floating layout (mockup/spherex-ui.html): a full-viewport dark bezel with
// the sky full-bleed under floating cards: the flipbook player top left, the RA/Dec card (and the
// fixture banner) top right, the zoom card bottom left, the dock (tools, then the search) bottom
// centre and the island bottom right. The active tool opens a floating card (object info, flipbook,
// spectrum) at the bottom right over the sky. Phone width stacks them: player on top, dock below.
//
// Issue #60: a marker click selects the object (brackets on the sky and the top-centre card with
// See fingerprint / Build it). Build it splits the view: the sky moves to the left half and the
// build pane on the right moulds the body. The rail's 3D viewer opens the same pane, built.
//
// DOM (and Tab) order: header, sky (canvas, then the open panel, markers and sky controls), dock
// (tools, then search), zoom, transport. The live announcer stays global.
import { useEffect, useState } from 'react';
import { useAppStore, type SkyQuery } from '@/state/store';
import { FlipbookSessionProvider } from './flipbook/session';
import { FixtureBanner } from './FixtureBanner';
import { LiveAnnouncer } from './LiveAnnouncer';
import { Panels } from './shell/Panels';
import { Readout } from './shell/Readout';
import { useShellStore } from './shell/shellStore';
import { isEditableTarget, isSearchShortcut } from './shell/shortcuts';
import { SkyDock } from './shell/SkyDock';
import { SkyZoom } from './shell/SkyZoom';
import { FrameRate } from './shell/FrameRate';
import { Transport } from './shell/Transport';
import { SkyPane } from './sky/SkyPane';
import { useHashSync } from './useHashSync';
import { BuildPane, closeBuildPane } from './build/BuildPane';
import { SelectedCard } from './build/SelectedCard';
import { useSelectedBodyLoader } from './build/selectedBody';
import { Island } from './island/Island';
import { SoundProvider } from '@/sound/SoundProvider';
import { ErrorBoundary } from './ErrorBoundary';

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

/** Issue #102: the build pane's fallback can close it, since a reload reopens it (`&build`). */
const CLOSE_BUILD = { label: 'Close build', onClick: closeBuildPane };

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
  const buildOpen = useShellStore((s) => s.build.open);
  // Q-457: a minimised build stays mounted (hidden), and the sky is the view again.
  const buildMini = useShellStore((s) => s.buildMinimised);
  const split = buildOpen && !buildMini;
  // Under the phone sheet the sky must not be reachable by Tab or a screen reader.
  const phone = usePhoneWidth();
  const skyHidden = split && phone;
  // Issue #102: a new search clears a part that failed, so the demo goes on without a reload.
  const query = useAppStore((s) => s.sky.query);
  const resetKeys = [query];
  return (
    <SoundProvider>
      <FlipbookSessionProvider>
        <div className="sx-screen">
          <div className="sx-bezel" data-split={split || undefined}>
            <header className="sx-top">
              {/* The page heading stays for assistive technology; the brand is not drawn (Q-124). */}
              <h1 className="sr-only">Shift &amp; Spectrum</h1>
              <FixtureBanner />
              {/* Q-456: no Sound control on the sky; the sound settings sit in the build view's Ambience dropdown. */}
              <ErrorBoundary
                area="The sky position"
                resetKeys={resetKeys}
                className="absolute top-4 right-4 z-50"
              >
                <Readout />
              </ErrorBoundary>
            </header>
            <main className="sx-view" aria-label="Sky view" data-split={split || undefined}>
              {/* Issue #102: each part fails on its own; a throw in one leaves the others usable. */}
              <div className="sx-sky-slot" inert={skyHidden || undefined}>
                <ErrorBoundary area="The sky view" resetKeys={resetKeys} className="m-4">
                  <SkyPane>
                    <ErrorBoundary
                      area="The object card"
                      resetKeys={resetKeys}
                      className="relative z-10 m-4"
                    >
                      <SelectedCard />
                    </ErrorBoundary>
                    <ErrorBoundary
                      area="This panel"
                      resetKeys={resetKeys}
                      className="relative z-10 m-4"
                    >
                      <Panels />
                    </ErrorBoundary>
                  </SkyPane>
                </ErrorBoundary>
              </div>
              {buildOpen && (
                <div className={buildMini ? 'sx-bp-mini' : 'contents'} inert={buildMini || undefined} aria-hidden={buildMini || undefined}>
                  <ErrorBoundary
                    area="The build pane"
                    resetKeys={resetKeys}
                    action={CLOSE_BUILD}
                    className="relative z-10 m-4"
                  >
                    <BuildPane />
                  </ErrorBoundary>
                </div>
              )}
            </main>
            {/* Mock-up floating layout: the dock (tools, then the search) bottom centre and the zoom
                card bottom left, over the full-bleed sky; the player is top left, the readout top
                right (the header) and the island bottom right. */}
            {/* Issue #102: the floating parts fail on their own too; a fallback sits in their corner. */}
            <ErrorBoundary
              area="The search and tools"
              resetKeys={resetKeys}
              className="absolute bottom-4 left-1/2 z-30 -translate-x-1/2"
            >
              <SkyDock />
            </ErrorBoundary>
            <div className="sx-zoom-slot" inert={split || undefined}>
              <ErrorBoundary
                area="The zoom control"
                resetKeys={resetKeys}
                className="absolute bottom-4 left-4 z-30"
              >
                <SkyZoom />
              </ErrorBoundary>
            </div>
            {/* The flipbook transport belongs to the flipbook: it steps aside in the split view. */}
            <div className="sx-transport-slot" inert={split || undefined}>
              <ErrorBoundary
                area="The frame player"
                resetKeys={resetKeys}
                className="absolute top-4 left-4 z-30"
              >
                <Transport />
                <FrameRate />
              </ErrorBoundary>
            </div>
            {/* Issue #66 (mock-up `.island-wrap`): the island, over everything in the bezel. */}
            <ErrorBoundary
              area="The status island"
              resetKeys={resetKeys}
              className="absolute right-4 bottom-4 z-40"
            >
              <Island />
            </ErrorBoundary>
          </div>
          <LiveAnnouncer />
        </div>
      </FlipbookSessionProvider>
    </SoundProvider>
  );
}

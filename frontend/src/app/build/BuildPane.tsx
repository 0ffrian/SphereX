// Issue #60, rebuilt for issue #71 stream U (Q-294): the build pane (mock-up `#bpane`, `openBuild`,
// `closeBuild`, `setShifted`). While the body is built the pane fills the screen over the dimmed sky
// with the body in the middle and the numbered steps under it; when the build ends it slides to the
// right half and the close-up opens on the left (`shifted`). On a phone it stays a full-height
// sheet. The header is the mock-up's: "Building <name>", its kind, then Accuracy, Ambience, Explore, Details and
// the close button. One panel opens under those buttons at a time (`pop`). Details (the honesty
// level, view controls, what is drawn and not drawn) is the app's one extra button: the mock-up has
// no counterpart. Focus moves into the pane when it opens and back to the object's marker (or the
// rail button) when it closes. Escape closes the open panel first, then the pane; Back closes.
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { BUILD_POP_ID, ViewerPanel, type PopId } from '@/app/ViewerPanel';
import { CloseUpPane, closeUpKindOf } from '@/app/CloseUpPane';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { useCloseUpStore } from '@/app/closeUpStore';
import { StatusLine } from '@/app/StatusLine';
import { StatePill } from '@/app/island/StatePill';
import { GENERATING_LOOK } from '@/app/island/loaderLooks';
import { ReadPaper, ZoomBar } from './BuildChrome';
import { Icon, type IconName } from '@/app/shell/icons';
import { isEditableTarget } from '@/app/shell/shortcuts';
import { useShellStore } from '@/app/shell/shellStore';
import { useAppStore } from '@/state/store';
import { useAmbienceStore } from '@/app/sound/ambienceStore';
import { useShallow } from 'zustand/react/shallow';
import { useSound, useSoundStatus } from '@/sound/SoundProvider';
import { useSoundSettings } from '@/sound/settings';
import { flyIsland, useSpringResize } from './exploreMotion';
import { ExploreIcon } from './ExploreIcon';
import type { MouldPhase } from './useMould';
import { closeBuildPane } from './focus';
import { displayName } from '@/app/displayName';
import { loadBodyFor, typeLabel, useSelection } from './selectedBody';

export { closeBuildPane };

/** The mock-up's pause between the last step finishing and the pane sliding right (`shiftT`). */
export const SHIFT_DELAY_MS = 650;

/** The header buttons that open a panel, in the mock-up's order (Details is the app's extra). */
const POP_BUTTONS: { id: PopId; label: string; title: string; icon: IconName }[] = [
  { id: 'acc', label: 'Accuracy', title: 'Accuracy', icon: 'accuracy' },
  {
    id: 'details',
    label: 'Details',
    title: 'Details: levels, view and what is drawn',
    icon: 'details',
  },
];

export function BuildPane() {
  const build = useShellStore((s) => s.build);
  const body = useShellStore((s) => s.body);
  const selection = useSelection();
  const card = useAppStore((s) => s.card);
  const params = useAppStore((s) => s.params);
  const query = useAppStore((s) => s.sky.query);
  const closeType = useCloseUpStore((s) => s.type);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const [phase, setPhase] = useState<MouldPhase>('idle');
  const [say, setSay] = useState('');
  const [pop, setPopState] = useState<PopId | null>(null);
  const popRef = useRef<PopId | null>(null);
  const buttonRefs = useRef<Partial<Record<PopId, HTMLButtonElement | null>>>({});
  const closeKind = closeUpKindOf(params?.type);
  const closeHidden = useCloseUpStore((s) => s.hidden);
  const [usesSeed, setUsesSeed] = useState(true);
  const spinRef = useRef<SVGSVGElement>(null);
  const sayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (sayTimer.current) clearTimeout(sayTimer.current);
    },
    [],
  );

  // The body of the selected object when it is loaded; otherwise whatever body the store holds
  // (the rail's 3D viewer with no selection).
  const name = displayName(selection?.name ?? card?.name ?? null) || null;
  const bodyHere = selection && body.status !== 'idle' && body.id === selection.id ? body : null;
  const type = typeLabel(params?.type);
  // The mock-up's title (Q-298, amends Q-113): "Building X" for a build that is played, and it stays;
  // the bare name when the body is shown built at once (`B.quick`).
  const title = name ? (build.animate ? `Building ${name}` : name) : '3D view';
  const subtitle =
    bodyHere?.status === 'loading'
      ? 'Looking up its 3D model…'
      : bodyHere?.status === 'none'
        ? 'No 3D model'
        : (type ?? (name ? '' : 'No object loaded'));
  const message =
    bodyHere?.status === 'none'
      ? `There is no 3D model of ${name} to build. ${bodyHere.reason}`
      : null;

  // Mock-up `setShifted`: the pane slides to the right half 650 ms after the last step, and the
  // close-up opens on the left. A body shown built at once (the rail's 3D viewer, `B.quick`) starts
  // shifted. The flag is per build (`seq`), so a Replay or a New seed starts full width again.
  const [shiftedSeq, setShiftedSeq] = useState(-1);
  const shifted = !build.animate || shiftedSeq === build.seq;
  const paneRef = useRef<HTMLElement>(null);
  // Full view or the right half: the pane springs between them (transform only, Q-450).
  useSpringResize(paneRef, shifted && !closeHidden && closeKind ? 'half' : 'full');
  useEffect(() => {
    if (!build.animate || phase !== 'done') return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const id = window.setTimeout(() => setShiftedSeq(build.seq), reduced ? 0 : SHIFT_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [phase, build.animate, build.seq]);
  // Q-457: minimised, the pane is hidden behind the island's pill: its keys stay off until restored,
  // and on restore focus goes back to its title.
  const minimised = useShellStore((s) => s.buildMinimised);
  // The close-up waits for the shift (a store the close-up pane and the viewer panel both read). It is
  // also held while the build is minimised, so a hidden close-up stops drawing (its fly view stays
  // mounted and paused, ready for the restore).
  useEffect(() => {
    useCloseUpStore.getState().setHeld(!shifted || minimised);
    return () => useCloseUpStore.getState().setHeld(false);
  }, [shifted, minimised]);

  const setPop = useCallback((next: PopId | null, returnFocus = false) => {
    const prev = popRef.current;
    popRef.current = next;
    setPopState(next);
    if (next === null && returnFocus && prev) {
      // Hear it has no header button any more (Q-450): it opens from Details, so focus goes back there.
      const back = prev === 'hear' ? 'details' : prev;
      requestAnimationFrame(() => buttonRefs.current[back]?.focus());
    }
  }, []);

  // Focus into the pane when it opens (R9: the user knows where they are).
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const onPhase = useCallback(
    (p: MouldPhase) => {
      setPhase(p);
      if (!name) return;
      if (sayTimer.current) clearTimeout(sayTimer.current);
      // Cleared first, so a Replay says "Building X" again (a live region only speaks a change).
      if (p === 'building') {
        setSay('');
        sayTimer.current = setTimeout(() => setSay(`Building ${name}`), 60);
      } else if (p === 'done' && build.animate) {
        setSay('');
        sayTimer.current = setTimeout(() => setSay(`Built ${name}`), 60);
      }
    },
    [name, build.animate],
  );

  // Escape closes the open panel first (focus goes back to its button), then the pane. It works from
  // anywhere in the page that is not a text field (mock-up: Esc closes the build).
  // Ambience (the wind that outlives the Hear it panel) must always be visible and stoppable (WCAG 1.4.2).
  const ambienceOn = useAmbienceStore((s) => s.ambience && s.playing);
  // Q-456: Ambience opens a dropdown (this body's atmosphere and the sound settings, AmbiencePanel).
  // Its click unlocks audio (Q-73: a user gesture). The icon is crossed out until something can be
  // heard: before the first click, with Sound off, or with neither the atmosphere nor the fly view's
  // ambience on.
  const sound = useSound();
  const soundStatus = useSoundStatus();
  const settings = useSoundSettings(useShallow((st) => ({ soundOn: st.soundOn, ambienceOn: st.ambienceOn })));
  const atmoOn = useAmbienceStore((s) => s.ambience && s.playing && s.key === (card?.id ?? ''));
  const audible = settings.soundOn && (atmoOn || (soundStatus.unlocked && settings.ambienceOn));
  const renderPop = (b: (typeof POP_BUTTONS)[number]) => (
    <button
      key={b.id}
      ref={(el) => {
        buttonRefs.current[b.id] = el;
      }}
      type="button"
      className="sx-bp-tool sx-bp-text"
      title={b.title}
      data-pop={b.id}
      aria-expanded={pop === b.id}
      aria-controls={BUILD_POP_ID}
      onClick={() => setPop(pop === b.id ? null : b.id)}
      data-testid={`build-${b.id === 'acc' ? 'accuracy' : b.id}`}
    >
      <Icon name={b.icon} className="size-[15px]" />
      <span>{b.label}</span>
    </button>
  );
  useEffect(() => {
    if (!ambienceOn) return;
    const onM = (e: globalThis.KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'm' || e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented || isEditableTarget(e.target)) return;
      useAmbienceStore.getState().stop();
    };
    window.addEventListener('keydown', onM);
    return () => window.removeEventListener('keydown', onM);
  }, [ambienceOn]);
  const onEscape = useCallback(() => {
    if (popRef.current) setPop(null, true);
    else closeBuildPane();
  }, [setPop]);
  // Q-457: the pane (and its zoom card and paper button) shrinks into the island on a spring, in
  // animate-ui's style, and only then is it hidden; restoring grows it back out of the island.
  const flyEls = () => [
    paneRef.current,
    document.querySelector<HTMLElement>('[data-testid="build-zoom"]'),
    document.querySelector<HTMLElement>('[data-testid="build-paper"]'),
  ];
  const stopFly = useRef<() => void>(() => {});
  /** A second click while the pane is on its way into the island does nothing (no snap back). */
  const minimising = useRef(false);
  const minimise = useCallback(() => {
    if (minimising.current) return;
    minimising.current = true;
    setPop(null);
    stopFly.current();
    stopFly.current = flyIsland(flyEls(), 'in', () => {
      minimising.current = false;
      useShellStore.getState().setBuildMinimised(true);
    });
  }, [setPop]);
  const wasMini = useRef(minimised);
  useLayoutEffect(() => {
    if (wasMini.current && !minimised) {
      minimising.current = false;
      titleRef.current?.focus({ preventScroll: true });
      stopFly.current();
      stopFly.current = flyIsland(flyEls(), 'out');
    }
    wasMini.current = minimised;
  }, [minimised]);
  useEffect(() => () => stopFly.current(), []);
  useEffect(() => {
    if (minimised) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isEditableTarget(e.target)) return;
      e.preventDefault();
      onEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onEscape, minimised]);
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    onEscape();
  };

  const replay = () => {
    useShellStore.getState().replayBuild();
    // Mock-up: the replay icon turns once (skipped under reduced motion by the CSS rule).
    spinRef.current?.animate?.([{ rotate: '0deg' }, { rotate: '-360deg' }], {
      duration: 650,
      easing: 'cubic-bezier(.34,1.2,.64,1)',
    });
    setPop(null);
  };
  // The store holds another object's card (or none yet): wait, and do not hand it to the viewer.
  const blocked = selection !== null && (!bodyHere || bodyHere.status === 'loading');
  const canBuild = params !== null && !message && !blocked;
  const seedMoot = !usesSeed;
  const NO_SEED_TEXT = "This body's surface is baked, so a new seed would look the same";

  // The build actions the mock-up has no buttons for (it replays from code): the top of Details.
  const actions = (
    <div className="sx-bp-actions" role="group" aria-label="Build actions">
      <button
        type="button"
        className="sx-btn-sm"
        aria-label="Replay the build"
        disabled={!canBuild}
        onClick={replay}
        data-testid="build-replay"
      >
        <svg ref={spinRef} viewBox="0 0 24 24" className="sx-ico size-3.5" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5" />
        </svg>
        Replay
      </button>
      <button
        type="button"
        className="sx-btn-sm"
        aria-label={seedMoot ? `New seed. ${NO_SEED_TEXT}` : 'Build it again with a new seed'}
        title={seedMoot ? NO_SEED_TEXT : undefined}
        // A disabled control is clearer here: nothing happens, and the name says why.
        disabled={!canBuild || seedMoot}
        onClick={() => {
          useShellStore.getState().newSeed();
          setPop(null);
        }}
        data-testid="build-seed"
      >
        <Icon name="shuffle" className="size-3.5" />
        New seed
      </button>
    </div>
  );

  // The note box (level badge, "artist's impression", "Generated live from physics…") is gone: the
  // provenance stays in the Details lists. What is left of this slot is the "N hidden at this level"
  // button, shown only when there is one.
  const level = (extra: ReactNode) =>
    name &&
    bodyHere?.status !== 'none' &&
    extra && (
      <p className="sx-bp-tag" data-testid="build-level">
        {extra}
      </p>
    );

  return (
    <>
      {/* The close-up fills the left half over the sky, as the mock-up's #cuPane (Q-275). */}
      {/* Issue #102: a throw in the close-up leaves the build pane usable. A new object, a new kind
          of close-up, or hiding and showing it again (the toggle next to Feel) gives it a fresh try. */}
      <ErrorBoundary
        area="The close-up"
        resetKeys={[query, closeType, closeHidden]}
        className="relative z-10 m-4"
      >
        <CloseUpPane />
      </ErrorBoundary>
      <aside
        ref={paneRef}
        className="sx-bp"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        data-testid="build-pane"
        data-phase={phase}
        data-shifted={shifted || undefined}
        // No split: the body keeps the whole view after it is built (the close-up is off).
        data-solo={closeHidden || !closeKind || undefined}
        data-pop={pop ?? undefined}
      >
        <header className="sx-bp-head">
          <div className="min-w-0">
            <h2 id={titleId} ref={titleRef} tabIndex={-1} data-testid="build-title">
              {title}
            </h2>
            <p data-testid="build-subtitle">{subtitle}</p>
          </div>
          <div className="sx-bp-tools" role="group" aria-label="Build tools">
            {/* Moon (12 Nov 2026, Q-450): Accuracy, Ambience, Explore, Details, then close. Ambience
                opens a dropdown with this body's atmosphere and the sound settings (Q-456; crossed out
                until something can be heard); Hear it opens from a row in Details (PR #107 review).
                Explore is the split view (the close-up on the left). */}
            {renderPop(POP_BUTTONS[0]!)}
            {canBuild && (
              <button
                ref={(el) => {
                  buttonRefs.current.amb = el;
                }}
                type="button"
                className="sx-bp-tool sx-bp-text"
                title="Ambience and sound settings"
                data-pop="amb"
                aria-expanded={pop === 'amb'}
                aria-controls={BUILD_POP_ID}
                onClick={() => {
                  // Synchronously inside the click: browsers only start audio from a user activation.
                  void sound.unlock();
                  setPop(pop === 'amb' ? null : 'amb');
                }}
                data-testid="build-ambience"
              >
                <Icon name={audible ? 'hear' : 'hearOff'} className="size-[15px]" />
                <span>Ambience</span>
              </button>
            )}
            {canBuild && closeKind && (
              <button
                type="button"
                className="sx-bp-tool sx-bp-text sx-bp-toggle"
                aria-pressed={!closeHidden}
                title="Explore: the close-up on the left"
                onClick={() => useCloseUpStore.getState().setHidden(!closeHidden)}
                data-testid="build-explore"
              >
                <ExploreIcon on={!closeHidden} className="size-[15px]" />
                <span>Explore</span>
              </button>
            )}
            {renderPop(POP_BUTTONS[1]!)}
            <i className="sx-bp-sep" aria-hidden="true" />
            <button
              type="button"
              className="sx-bp-tool"
              aria-label="Minimise the build view"
              title="Minimise (the pill reopens it)"
              onClick={minimise}
              data-testid="build-minimise"
            >
              <Icon name="minimise" className="size-4" />
            </button>
            <button
              type="button"
              className="sx-bp-tool"
              aria-label="Close the build view"
              title="Close (Esc)"
              onClick={closeBuildPane}
              data-testid="build-close"
            >
              <Icon name="close" className="size-4" />
            </button>
          </div>
        </header>
        {bodyHere?.status === 'loading' ? (
          <div className="sx-bp-msg" data-testid="build-generating">
            <StatePill look={GENERATING_LOOK} word="Generating" />
          </div>
        ) : message ? (
          <div className="sx-bp-msg" role="status" data-testid="build-message">
            <p>{message}</p>
            {bodyHere?.status === 'none' && bodyHere.transient && selection && (
              <button
                type="button"
                className="sx-btn sx-btn-ghost mt-3"
                onClick={() => loadBodyFor(selection.id)}
                data-testid="build-retry"
              >
                Try again
              </button>
            )}
          </div>
        ) : (
          <ViewerPanel
            // A new seed is a new body: the panel and its ViewerApp stay, the build starts again.
            pane={{
              seq: build.seq,
              animate: build.animate,
              seedOffset: build.seedOffset,
              blocked,
              onPhase,
              onUsesSeed: setUsesSeed,
              pop,
              onPop: setPop,
              actions,
              caption: level,
            }}
          />
        )}
        <div className="sx-bp-status sr-only">
          <StatusLine />
        </div>
        <p className="sr-only" aria-live="polite" data-testid="build-announcer">
          {say}
        </p>
      </aside>
      {/* Q-457: no dock in the build view (Moon); the zoom card and the paper link stay. */}
      <ZoomBar />
      <ReadPaper />
    </>
  );
}

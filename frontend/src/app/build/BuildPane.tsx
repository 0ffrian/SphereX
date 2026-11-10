// Issue #60: the build pane (mock-up `.bpane`, `openBuild`, `closeBuild`). The sky moves to the left
// half and this pane takes the right half; on a phone it is a full-height sheet over the sky. It
// holds the one 3D view (ViewerPanel with its ViewerApp canvas), the title "Building <name>", the
// tools (Feel, Replay, New seed, Close) and the numbered steps. Focus moves into the pane when it
// opens and back to the object's marker (or the rail button) when it closes. Escape and Back close.
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ViewerPanel } from '@/app/ViewerPanel';
import { StatusLine } from '@/app/StatusLine';
import { Icon } from '@/app/shell/icons';
import { isEditableTarget } from '@/app/shell/shortcuts';
import { useShellStore } from '@/app/shell/shellStore';
import { useAppStore } from '@/state/store';
import { ProvenanceBadge } from '@/app/Badge';
import { effectiveHonesty, HONESTY_LABEL } from '@/viewer/honesty';
import type { MouldPhase } from './useMould';
import { focusAfterBuildClose } from './focus';
import { PREBUILT_NOTE } from '@/app/messages';
import { loadBodyFor, typeLabel, useSelection } from './selectedBody';

/** Closes the pane (× and Escape; the hash follows, see useHashSync) and returns focus. */
export function closeBuildPane(): void {
  const { tool } = useShellStore.getState();
  useShellStore.getState().closeBuild();
  focusAfterBuildClose(tool);
}

export function BuildPane() {
  const build = useShellStore((s) => s.build);
  const body = useShellStore((s) => s.body);
  const selection = useSelection();
  const card = useAppStore((s) => s.card);
  const params = useAppStore((s) => s.params);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const [phase, setPhase] = useState<MouldPhase>('idle');
  const [say, setSay] = useState('');
  const [feel, setFeel] = useState(false);
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
  const name = selection?.name ?? card?.name ?? null;
  const bodyHere = selection && body.status !== 'idle' && body.id === selection.id ? body : null;
  const type = typeLabel(params?.type);
  // "Building X" while it is being built, "X" once it is built (or opened built).
  const built = phase === 'done' || !build.animate;
  const title = name ? (built ? name : `Building ${name}`) : '3D view';
  const fixtureSky = useAppStore((s) => s.sky.fixture);
  const honesty = effectiveHonesty(useAppStore((s) => s.honesty));
  const levelTag =
    honesty === 'measured' ? 'measured' : honesty === 'derived' ? 'derived' : 'artistic';
  const subtitle =
    bodyHere?.status === 'loading'
      ? 'Looking up its 3D model…'
      : bodyHere?.status === 'none'
        ? 'No 3D model'
        : (type ?? (name ? '' : 'No object loaded'));
  const message =
    bodyHere?.status === 'none'
      ? `There is no 3D model of ${selection!.name} to build. ${bodyHere.reason}`
      : null;

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

  // Escape closes from anywhere in the page that is not a text field (mock-up: Esc closes the build).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isEditableTarget(e.target)) return;
      e.preventDefault();
      closeBuildPane();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    closeBuildPane();
  };

  const replay = () => {
    useShellStore.getState().replayBuild();
    // Mock-up: the replay icon turns once (skipped under reduced motion by the CSS rule).
    spinRef.current?.animate?.([{ rotate: '0deg' }, { rotate: '-360deg' }], {
      duration: 650,
      easing: 'cubic-bezier(.34,1.2,.64,1)',
    });
  };
  // The store holds another object's card (or none yet): wait, and do not hand it to the viewer.
  const blocked = selection !== null && (!bodyHere || bodyHere.status === 'loading');
  const canBuild = params !== null && !message && !blocked;
  const seedMoot = !usesSeed;
  const NO_SEED_TEXT = "This body's surface is baked, so a new seed would look the same";

  return (
    <aside
      className="sx-bp"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      data-testid="build-pane"
      data-phase={phase}
    >
      <header className="sx-bp-head">
        <div className="min-w-0">
          <h2 id={titleId} ref={titleRef} tabIndex={-1} data-testid="build-title">
            {title}
          </h2>
          <p data-testid="build-subtitle" className="flex flex-wrap items-center gap-2">
            {subtitle && <span>{subtitle}</span>}
            {bodyHere?.status === 'ready' && bodyHere.prebuilt && (
              <span className="text-xs text-sx-mfg" data-testid="build-prebuilt">
                {PREBUILT_NOTE}
              </span>
            )}
            {name && (
              // The level the body is shown at (D-02, D-21), visible without opening Details.
              <span className="inline-flex items-center gap-1" data-testid="build-level">
                <ProvenanceBadge
                  tag={levelTag}
                  fixture={fixtureSky || (card?.id.startsWith('fixture:') ?? false)}
                />
                {honesty === 'artistic' && (
                  <span className="text-xs text-sx-mfg">artist&rsquo;s impression</span>
                )}
                <span className="sr-only">{HONESTY_LABEL[honesty]}</span>
              </span>
            )}
          </p>
        </div>
        <div className="sx-bp-tools" role="group" aria-label="Build tools">
          <button
            type="button"
            className="sx-bp-tool sx-bp-feel"
            aria-pressed={feel}
            title="Feel the surface"
            onClick={() => setFeel((f) => !f)}
            data-testid="build-feel"
          >
            <Icon name="fingerprint" className="size-4" />
            <span>Feel</span>
          </button>
          <button
            type="button"
            className="sx-bp-tool"
            aria-label="Replay the build"
            title="Replay"
            disabled={!canBuild}
            onClick={replay}
            data-testid="build-replay"
          >
            <svg ref={spinRef} viewBox="0 0 24 24" className="sx-ico size-4" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5" />
            </svg>
          </button>
          <button
            type="button"
            className="sx-bp-tool"
            aria-label={seedMoot ? `New seed. ${NO_SEED_TEXT}` : 'Build it again with a new seed'}
            title={seedMoot ? NO_SEED_TEXT : 'New seed'}
            // aria-disabled would keep it focusable for the tooltip, but a disabled control is
            // clearer here: nothing happens, and the name above says why.
            disabled={!canBuild || seedMoot}
            onClick={() => useShellStore.getState().newSeed()}
            data-testid="build-seed"
          >
            <Icon name="shuffle" className="size-4" />
          </button>
          <i className="sx-bp-sep" aria-hidden="true" />
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
      {feel && (
        // TODO(Atish, M5): wire Feel to TouchHaptics (src/haptics/profiles.ts) over this canvas, as
        // the mock-up's `bpFeel`. Until then the toggle only says so (no silent no-op).
        <p className="sx-bp-note" role="status" data-testid="build-feel-note">
          Touch feedback arrives with the phone build.
        </p>
      )}
      {message ? (
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
          }}
        />
      )}
      <div className="sx-bp-status">
        <StatusLine />
      </div>
      <p className="sr-only" aria-live="polite" data-testid="build-announcer">
        {say}
      </p>
    </aside>
  );
}

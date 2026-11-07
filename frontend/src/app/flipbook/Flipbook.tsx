// A1.1 P0 flipbook (UML 08): plays an object's SPHEREx frames in the order the API lists them and
// shows each frame's time and wavelength. Play/pause, step, scrubber and speed sit in the shell's
// transport bar (app/shell/Transport.tsx); both read one playback session (session.tsx). Clicking
// the ring on the object opens its spectrum (UML 09). Rainbow Trails is a view mode (D-28, P1).
// Raw | Colour (colourMode.ts): the grey frames, the frames tinted by wavelength, or the backend's
// SPHEREx colour composite (one picture; the transport bar does not drive it).
// Keyboard (R9): Space or K play/pause, ←/→ step, Home/End first/last, while focus is in the
// flipbook but not on a button or form field (those keep their own keys).
import { useMemo, useState, type KeyboardEvent } from 'react';
import type { FramesResponse, ResolveResponse } from '@/app/api/types';
import { DataBadge, EstimatedBadge, ProvenanceBadge } from '@/app/Badge';
import { positionProvenance } from '@/app/sky/positionTags';
import { formatCoords, formatUtc, formatWavelength } from '@/app/format';
import { framesRetryText, framesSearchingText, searchErrorMessage } from '@/app/messages';
import { RefusalList } from '@/app/RefusalList';
import { groupMissing } from '@/app/refusals';
import { ErrorBox, LoadingBox } from '@/app/StatusBoxes';
import { buttonClass, pressedClass } from '@/app/ui';
import { describeFrame, useAppStore, type SkyState } from '@/state/store';
import {
  colourHidden,
  colourHiddenNote,
  effectiveColour,
  tintColour,
  transportLocked,
} from './colourMode';
import { ColourControls, CompositeView, TintLegend } from './ColourViews';
import { FramesProgress } from './FramesProgress';
import {
  frameSize,
  gridSize,
  placeFrame,
  placementStyle,
  registrationFor,
  ringOnGrid,
  type PixelSize,
} from './frameGrid';
import { flipbookKeyAction } from './keys';
import { RainbowTrails, RainbowTrailsLegend, trailsUnavailableReason } from './RainbowTrails';
import { useFlipbookSession } from './session';
import { trailsMonochrome } from './wavelengthColor';

export function Flipbook() {
  const sky = useAppStore((s) => s.sky);
  const retry = useAppStore((s) => s.skyRetry);
  if (sky.status === 'idle') return null;

  return (
    <section aria-labelledby="flipbook-heading" className="flex flex-col gap-3">
      {/* A section label: the card's title already says "Flipbook" and names the object. */}
      {/* No `uppercase`: it would turn "SPHEREx" into "SPHEREX". */}
      <h3 id="flipbook-heading" className="text-sm font-medium text-neutral-400">
        SPHEREx frames
      </h3>
      {sky.status === 'resolving' && (
        <LoadingBox text={`Finding “${sky.query?.q ?? ''}”…`} startedAt={sky.startedAt} />
      )}
      {sky.status === 'loading_frames' && (
        <>
          <LoadingBox
            text={framesSearchingText(
              sky.resolved ? formatCoords(sky.resolved.ra, sky.resolved.dec) : (sky.query?.q ?? ''),
            )}
            startedAt={sky.startedAt}
          />
          {sky.progress?.retry && (
            <p className="text-sm text-amber-200" data-testid="frames-retry">
              {framesRetryText(sky.progress.retry)}
            </p>
          )}
        </>
      )}
      {sky.status === 'error' && sky.error && (
        <ErrorBox
          message={searchErrorMessage(sky.error, sky.query?.q ?? '')}
          detail={sky.error.detail}
          onRetry={() => void retry()}
        />
      )}
      {sky.status === 'ready' && sky.resolved && sky.frames && (
        <>
          {/* First, so it is in view on a phone's bottom sheet too. */}
          {sky.progress && (
            <FramesProgress
              progress={sky.progress}
              frames={sky.frames}
              where={sky.resolved.resolver === 'coords' ? 'spot' : 'object'}
            />
          )}
          <ObjectHeader sky={sky} resolved={sky.resolved} frames={sky.frames} />
          {sky.frames.frames.length === 0 ? (
            sky.progress ? (
              <MissingList missing={sky.frames.missing} hideDeferred />
            ) : (
              <NoFrames frames={sky.frames} />
            )
          ) : (
            <Player sky={sky} resolved={sky.resolved} frames={sky.frames} />
          )}
        </>
      )}
    </section>
  );
}

function objectName(resolved: ResolveResponse): string {
  return resolved.name ?? formatCoords(resolved.ra, resolved.dec);
}

function ObjectHeader({
  sky,
  resolved,
  frames,
}: {
  sky: SkyState;
  resolved: ResolveResponse;
  frames: FramesResponse;
}) {
  const loadSpectrum = useAppStore((s) => s.skyLoadSpectrum);
  const cachedAt = frames.cached_at ?? resolved.cached_at;
  const position = positionProvenance(resolved.resolver, sky.query?.origin === 'sky');
  const notes = [
    cachedAt ? `Cached ${formatUtc(cachedAt)}` : null,
    sky.fixture ? 'synthetic fixture data' : null,
  ].filter((t) => t !== null);
  return (
    <div className="flex flex-col gap-1">
      {/* The card's subtitle shows the name; screen readers get it here, with the position. */}
      <p className="sr-only" data-testid="object-name">
        {objectName(resolved)}
      </p>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-neutral-300">
        <span>
          {formatCoords(resolved.ra, resolved.dec)}
          {resolved.moving && ' · moving object'}
        </span>
        {/* D-02: the position wears its badge too (Q-25, Q-91 for typed and picked ones). */}
        <ProvenanceBadge
          tag={position.tag}
          tooltip={position.tooltip}
          srText
          fixture={sky.fixture}
        />
      </p>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-neutral-400">
        <span>Data release: {frames.data_release} ·</span>
        <span data-testid="stretch">Display stretch: {frames.stretch.kind}</span>
        {/* A display choice, not data: Estimated even on fixtures (Fixture replaces Measured only). */}
        <EstimatedBadge tooltip={stretchFormula(frames)} />
      </p>
      {notes.length > 0 && <p className="text-sm text-neutral-400">{notes.join(' · ')}</p>}
      {frames.frames.length > 0 && (
        <button
          type="button"
          className={`${buttonClass} self-start`}
          onClick={() => void loadSpectrum()}
          disabled={sky.spectrum.status === 'loading' || sky.spectrum.status === 'waiting'}
        >
          Show spectrum
        </button>
      )}
    </div>
  );
}

/** The display stretch is `derived` (#1): its formula is the stretch kind and parameters. */
function stretchFormula(frames: FramesResponse): string {
  return `Display stretch ${frames.stretch.kind}, parameters ${JSON.stringify(frames.stretch.params)}`;
}

/**
 * Refused frames and notes from the frames reply (A4.1), grouped by reason. `hideDeferred`: the
 * progress box already says how many frames are still to download.
 */
function MissingList({
  missing,
  hideDeferred = false,
}: {
  missing: readonly string[];
  hideDeferred?: boolean;
}) {
  const groups = useMemo(
    () =>
      groupMissing(
        hideDeferred ? missing.filter((c) => !c.startsWith('cutouts:deferred:')) : missing,
      ),
    [missing, hideDeferred],
  );
  return <RefusalList groups={groups} lead="Frames found but not shown:" testId="missing" />;
}

function NoFrames({ frames }: { frames: FramesResponse }) {
  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
      data-testid="no-frames"
    >
      <p>There are no SPHEREx frames to show for this object.</p>
      <MissingList missing={frames.missing} />
    </div>
  );
}

/** Focus inside these keeps its own keys; `[data-own-keys]` marks scroll boxes (RefusalList). */
const CONTROL_TAGS = 'button, input, select, textarea, a, summary, [data-own-keys]';

function Player({
  sky,
  resolved,
  frames: response,
}: {
  sky: SkyState;
  resolved: ResolveResponse;
  frames: FramesResponse;
}) {
  const frames = response.frames;
  const n = frames.length;
  const index = Math.min(sky.index, n - 1);
  const frame = frames[index]!;

  const seek = useAppStore((s) => s.skySeek);
  const step = useAppStore((s) => s.skyStep);
  const togglePlay = useAppStore((s) => s.skyTogglePlay);
  const setViewMode = useAppStore((s) => s.skySetViewMode);
  const loadSpectrum = useAppStore((s) => s.skyLoadSpectrum);
  const setColour = useAppStore((s) => s.skySetColour);

  const honesty = useAppStore((s) => s.honesty);
  const session = useFlipbookSession();
  const { status, canPlay, loadedCount, failedCount } = session;

  // Decoded sizes, only for frames whose size the reply does not state (frameGrid.ts frameSize).
  const [decoded, setDecoded] = useState<ReadonlyMap<string, PixelSize>>(() => new Map());

  const current = status[index] ?? 'pending';

  // One fixed grid and scale for the whole object (frameGrid.ts): the box never changes size.
  const grid = useMemo(
    () => gridSize(frames.map((f) => frameSize(f, decoded.get(f.cutout_url)))),
    [frames, decoded],
  );
  const registration = registrationFor(response.north_up);
  const size = frameSize(frame, decoded.get(frame.cutout_url));
  const placement = size ? placeFrame(grid, frame, size, registration) : null;
  const ring = placement ? ringOnGrid(grid, placement, frame, registration) : null;

  const trailsReason = trailsUnavailableReason(resolved, response, {
    imageSize: session.size,
    allSettled: status.every((s) => s !== 'pending'),
  });
  const monochrome = trailsMonochrome(honesty);
  const colour = effectiveColour(sky.colour, honesty);
  const hiddenColour = colourHidden(sky.colour, honesty);
  const composite = colour === 'composite';
  const tint = colour === 'tint';
  // Rainbow Trails dots sit on the cutouts' pixel grid, not on the composite's.
  const viewMode = trailsReason || composite ? 'frames' : sky.viewMode;
  const name = objectName(resolved);
  const frameText = describeFrame(response, index);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // The composite is one picture: the frame keys do nothing while it shows.
    if (transportLocked(colour)) return;
    const action = flipbookKeyAction({
      key: e.key,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      onControl: e.target instanceof Element && e.target.closest(CONTROL_TAGS) !== null,
      canPlay,
    });
    if (action === null) return;
    if (action === 'block') {
      // Play is disabled while cutouts load; still stop Space from scrolling the page.
      e.preventDefault();
      return;
    }
    if (action === 'toggle') togglePlay();
    else if (action === 'prev') step(-1);
    else if (action === 'next') step(1);
    else if (action === 'first') seek(0);
    else seek(n - 1);
    e.preventDefault();
  };

  return (
    <div
      role="region"
      aria-label={`SPHEREx frames for ${name}`}
      className="flex flex-col gap-3"
      onKeyDown={onKeyDown}
      data-testid="flipbook"
    >
      {!response.north_up && !composite && (
        <p className="text-sm text-amber-200" data-testid="orientation-note">
          Frames are in the telescope’s native orientation, so the picture may rotate between
          frames.
        </p>
      )}

      <ColourControls choice={sky.colour} onChange={(c) => setColour(c)} />
      {hiddenColour && (
        <p className="text-sm text-amber-200" data-testid="colour-hidden-note">
          {colourHiddenNote(sky.colour.view)}
        </p>
      )}

      {composite ? (
        <CompositeView
          name={name}
          fixture={sky.fixture}
          onShowSpectrum={() => void loadSpectrum()}
        />
      ) : (
        <>
          <div
            tabIndex={0}
            role="group"
            aria-label={`Frame viewer. ${frameText}. Space plays or pauses; arrow keys step.`}
            className="relative isolate aspect-square w-full max-w-md overflow-hidden rounded-lg border border-neutral-800 bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
            data-colour={colour}
            data-grid={grid}
            data-testid="frame-viewer"
          >
            {current === 'failed' ? (
              <p
                className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-neutral-300"
                data-testid="cutout-unavailable"
              >
                Cutout unavailable for this frame.
              </p>
            ) : (
              // The frame at its place on the grid; the tint layer has exactly the same box. Until a
              // frame of unknown size has decoded, it is loaded but not shown (no wrong placement).
              <div
                className="absolute"
                style={
                  placement
                    ? placementStyle(grid, placement)
                    : { inset: 0, visibility: 'hidden' as const }
                }
                data-testid="frame-place"
              >
                <img
                  key={frame.cutout_url}
                  src={frame.cutout_url}
                  alt={`SPHEREx cutout of ${name}. ${frameText}. Display stretch ${response.stretch.kind}.${tint ? ' Tinted by wavelength (false colour).' : ''}`}
                  className="absolute inset-0 h-full w-full"
                  style={{ imageRendering: 'pixelated' }}
                  draggable={false}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    const url = frame.cutout_url;
                    if (frame.width !== undefined || img.naturalWidth === 0 || decoded.has(url)) {
                      return;
                    }
                    setDecoded((prev) =>
                      new Map(prev).set(url, { w: img.naturalWidth, h: img.naturalHeight }),
                    );
                  }}
                  data-testid="cutout"
                />
                {tint && current === 'loaded' && (
                  // Grey luminance × the frame's false colour: a multiply blend over the pixelated
                  // image, so the pixels stay sharp and nothing is decoded or allocated per frame.
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background: tintColour(frame.wavelength_um),
                      mixBlendMode: 'multiply',
                    }}
                    aria-hidden="true"
                    data-testid="tint-overlay"
                    data-wavelength={frame.wavelength_um}
                  />
                )}
              </div>
            )}
            {viewMode === 'trails' && (
              // Offered only on a shared north-up grid, where frames sit at offset 0: the dots use
              // each frame's own (x, y) on the same N×N grid.
              <RainbowTrails
                frames={frames}
                width={grid}
                height={grid}
                currentIndex={index}
                monochrome={monochrome}
              />
            )}
            {ring && current === 'loaded' && (
              <button
                type="button"
                className="absolute flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-sky-400"
                style={{
                  left: `${(ring.x / grid) * 100}%`,
                  top: `${(ring.y / grid) * 100}%`,
                }}
                aria-label={`Show spectrum for ${name}`}
                title={`Show spectrum for ${name}`}
                onClick={() => void loadSpectrum()}
                data-testid="object-ring"
              >
                <svg viewBox="0 0 40 40" className="size-9" aria-hidden="true">
                  <circle cx="20" cy="20" r="15" fill="none" stroke="#0a0a0a" strokeWidth="4" />
                  <circle cx="20" cy="20" r="15" fill="none" stroke="#38bdf8" strokeWidth="2" />
                </svg>
              </button>
            )}
            {sky.fixture && (
              <span className="pointer-events-none absolute right-1 bottom-1 rounded bg-amber-400 px-1 text-[10px] font-bold tracking-wide text-black">
                SYNTHETIC
              </span>
            )}
          </div>

          {/* Fixed-width digits and reserved lines, so a frame's caption never moves what follows. */}
          <div className="flex flex-col gap-1 text-sm tabular-nums" data-testid="frame-caption">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span data-testid="frame-counter">
                Frame {index + 1} of {n}
              </span>
              <span className="flex items-center gap-1.5">
                <span data-testid="frame-wavelength">{formatWavelength(frame.wavelength_um)}</span>
                <DataBadge fixture={sky.fixture} />
              </span>
              <span className="flex items-center gap-1.5">
                <span data-testid="frame-time">{formatUtc(frame.time)}</span>
                <DataBadge fixture={sky.fixture} />
              </span>
            </div>
            <span
              className="line-clamp-2 min-h-10 text-neutral-400"
              title={frame.flags.length > 2 ? frame.flags.join(', ') : undefined}
              data-testid="frame-flags"
            >
              {frame.flags.length > 0 ? `Flags: ${frame.flags.join(', ')}` : 'No flags'}
            </span>
          </div>

          <p className="min-h-10 text-sm text-neutral-400" data-testid="preload-progress">
            Cutouts loaded: {loadedCount} of {n}
            {failedCount > 0 && ` · ${failedCount} unavailable`}
            {!canPlay && n >= 2 && <span> · Play starts once the next frames have loaded.</span>}
          </p>
          {tint && (
            <TintLegend wavelengthUm={frame.wavelength_um} stretch={stretchFormula(response)} />
          )}
        </>
      )}

      {!composite && (
        <div role="group" aria-label="View mode" className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`${buttonClass} ${pressedClass}`}
            aria-pressed={viewMode === 'frames'}
            onClick={() => setViewMode('frames')}
          >
            Frames
          </button>
          <button
            type="button"
            className={`${buttonClass} ${pressedClass}`}
            aria-pressed={viewMode === 'trails'}
            disabled={trailsReason !== null}
            aria-describedby={trailsReason ? 'trails-reason' : undefined}
            onClick={() => setViewMode('trails')}
            data-testid="trails-toggle"
          >
            Rainbow Trails
          </button>
          {trailsReason && (
            <span
              id="trails-reason"
              className="text-sm text-neutral-400"
              data-testid="trails-reason"
            >
              {trailsReason}
            </span>
          )}
        </div>
      )}
      {viewMode === 'trails' && <RainbowTrailsLegend monochrome={monochrome} />}

      <MissingList missing={response.missing} hideDeferred={sky.progress !== null} />
    </div>
  );
}

/** Plain SVG icons: the Unicode media glyphs render as colour emoji on some systems. */
export function StepIcon({ kind }: { kind: 'first' | 'prev' | 'next' | 'last' }) {
  const flip = kind === 'first' || kind === 'prev';
  const bar = kind === 'first' || kind === 'last';
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4"
      aria-hidden="true"
      style={flip ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path d="M3 2.5 L11 8 L3 13.5 Z" fill="currentColor" />
      {bar && <rect x="12" y="2.5" width="2" height="11" fill="currentColor" />}
    </svg>
  );
}

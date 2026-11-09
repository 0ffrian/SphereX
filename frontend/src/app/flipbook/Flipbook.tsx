// A1.1 P0 flipbook (UML 08): plays an object's SPHEREx frames in the order the API lists them and
// shows each frame's time and wavelength. Play/pause, step, scrubber and speed sit in the shell's
// transport bar (app/shell/Transport.tsx); both read one playback session (session.tsx). Clicking
// the ring on the object opens its spectrum (UML 09). Rainbow Trails is a view mode (D-28, P1).
// Raw | Colour (colourMode.ts): the grey frames, the frames tinted by wavelength, or the backend's
// SPHEREx colour composite (one picture; the transport bar does not drive it).
// Overlays (issue #12, P1): Gaia/WISE markers, flagged pixels, field of view, contamination and
// a "Combine frames" panel; optional, loaded on first use, never block playback. Markers and the
// flag mask are drawn with the shown frame's own grid placement (frameGrid.ts), so they follow
// the picture; they are not drawn on the colour composite (its own grid).
// Keyboard (R9): Space or K play/pause, ←/→ step, Home/End first/last, while focus is in the
// flipbook but not on a button or form field (those keep their own keys).
import { useCallback, useLayoutEffect, useMemo, useState, type KeyboardEvent } from 'react';
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
  largestSide,
  markersOnGrid,
  noDataKind,
  placeFrame,
  placementStyle,
  registrationFor,
  ringOnGrid,
  type NoData,
  type PixelSize,
} from './frameGrid';
import { shownIndexIn } from './frameSwap';
import { flipbookKeyAction } from './keys';
import {
  countNoData,
  NO_DATA_CAPTION,
  NO_DATA_KINDS,
  noDataCaptionVisible,
  noDataSummary,
} from './noData';
import { CombinePanel } from './overlays/CombinePanel';
import { FlagMaskImage } from './overlays/FlagMask';
import { MarkerLayer } from './overlays/MarkerLayer';
import { overlayView } from './overlays/model';
import { ContaminationNote, OverlayControls, OverlayDetails } from './overlays/OverlayPanel';
import { RainbowTrails, RainbowTrailsLegend, trailsUnavailableReason } from './RainbowTrails';
import { useFlipbookSession } from './session';
import { useFrameSwap } from './useFrameSwap';
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

/**
 * Grid area that no pixel of the frame covers (frameGrid.ts noDataKind): dark grey diagonal
 * hatching, so "no data" does not read as black sky. Static (no transition or animation): during
 * playback it comes and goes with the clipped frames, as part of their picture. The frame and its
 * tint are drawn on top, so the tint never covers it. Decorative: the text says the same.
 */
const NO_DATA_HATCH = 'repeating-linear-gradient(135deg, #2a2a2e 0 3px, #18181b 3px 7px)';

/** Focus inside these keeps its own keys; `[data-own-keys]` marks scroll boxes (RefusalList). */
const CONTROL_TAGS = 'button, input, select, textarea, a, summary, [data-own-keys]';

const SLOTS = [0, 1] as const;

/** Said under the overlay toggles while the colour composite shows (it has its own pixel grid). */
const OVERLAYS_NOT_ON_COMPOSITE =
  'Overlays are drawn on the frames, not on the colour composite. Choose Raw or Wavelength tint to see them.';

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
  // The requested frame (timer, keys, scrubber). The viewer shows `frame` below, which trails it
  // until the next picture has decoded (frameSwap.ts).
  const index = Math.min(sky.index, n - 1);
  const requested = frames[index]!;

  const seek = useAppStore((s) => s.skySeek);
  const step = useAppStore((s) => s.skyStep);
  const togglePlay = useAppStore((s) => s.skyTogglePlay);
  const setViewMode = useAppStore((s) => s.skySetViewMode);
  const loadSpectrum = useAppStore((s) => s.skyLoadSpectrum);
  const setColour = useAppStore((s) => s.skySetColour);

  const honesty = useAppStore((s) => s.honesty);
  const session = useFlipbookSession();
  const { status, canPlay, loadedCount, failedCount, setShownIndex } = session;

  // Decoded sizes, only for frames whose size the reply does not state (frameGrid.ts frameSize).
  const [decoded, setDecoded] = useState<ReadonlyMap<string, PixelSize>>(() => new Map());
  const onSize = useCallback(
    (url: string, size: PixelSize) =>
      setDecoded((prev) => {
        const old = prev.get(url);
        return old && old.w === size.w && old.h === size.h ? prev : new Map(prev).set(url, size);
      }),
    [],
  );

  const requestedStatus = status[index] ?? 'pending';
  const target = useMemo(
    () => ({ index, url: requested.cutout_url, status: requestedStatus }),
    [index, requested.cutout_url, requestedStatus],
  );
  const swap = useFrameSwap(target, onSize);
  const shownAt = shownIndexIn(swap.state.shown, (i) => frames[i]?.cutout_url, n);
  const shownIndex = shownAt ?? index;
  const frame = frames[shownIndex]!;
  // What the viewer draws for the shown frame; before anything is shown, no picture yet.
  const view = shownAt !== null && swap.state.shown ? swap.state.shown.kind : 'loading';
  const picture = view === 'picture';
  // The flag-mask URL that failed to load, if any (the legend says so; the picture stays).
  const [failedMask, setFailedMask] = useState<string | null>(null);

  // The transport bar's frame number and wavelength follow the picture.
  useLayoutEffect(() => setShownIndex(shownIndex), [shownIndex, setShownIndex]);
  useLayoutEffect(() => () => setShownIndex(null), [setShownIndex]);

  // One fixed grid and scale for the whole object (frameGrid.ts): the box never changes size.
  const registration = registrationFor(response.north_up);
  const { grid, fullSide, summary } = useMemo(() => {
    const sizes = frames.map((f) => frameSize(f, decoded.get(f.cutout_url)));
    return {
      grid: gridSize(sizes),
      fullSide: largestSide(sizes),
      // One steady line for the whole object (R9: nothing flashes during playback).
      summary: noDataSummary(countNoData(frames, sizes, registration)),
    };
  }, [frames, decoded, registration]);
  const size = frameSize(frame, decoded.get(frame.cutout_url));
  const placement = size ? placeFrame(grid, frame, size, registration) : null;
  const ring = placement ? ringOnGrid(grid, placement, frame, registration) : null;
  // Hatched only under a drawn frame: while it loads or when it failed, nothing is claimed.
  const noData: NoData =
    size && placement && picture ? noDataKind(grid, placement, size, fullSide) : 'none';
  const captionOn = noDataCaptionVisible(sky.playing, noData);

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
  const frameText = describeFrame(response, shownIndex);
  const alt = `SPHEREx cutout of ${name}. ${frameText}. Display stretch ${response.stretch.kind}.${tint ? ' Tinted by wavelength (false colour).' : ''}${noData === 'none' ? '' : ` ${NO_DATA_CAPTION[noData]} The hatched area has no data.`}`;

  // Overlays for this frame (issue #12); null until loaded. Q-28: shown like the ring.
  // Memoised on (overlays state, frame): playback re-renders on every tick, and a stable view
  // keeps OverlayDetails' own memo (groupMissing) from recomputing.
  const overlays = useMemo(
    () => overlayView(sky.overlays, frame.frame_id),
    [sky.overlays, frame.frame_id],
  );
  const ovFrame = overlays?.frame;
  // On the frame's own grid placement (cutout pixels + whole-pixel offset), dropping any that
  // would fall off the frame (hatched no-data) or off the grid; drawn only with the picture.
  // Not memoised: a handful of markers, and `placement` is rebuilt on every render.
  const markers =
    overlays && ovFrame && placement
      ? markersOnGrid(
          ovFrame.markers.filter((m) => overlays.show[m.catalog]),
          grid,
          placement,
        )
      : [];
  const showMask =
    overlays?.show.flags === true && ovFrame !== undefined && failedMask !== ovFrame.flags_url;
  const overlaysOn = Object.values(sky.overlays.toggles).some(Boolean);
  // Map centre: the object's position in this frame when the reply gives one, else the resolved one.
  const center = { ra: frame.ra ?? resolved.ra, dec: frame.dec ?? resolved.dec };

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
            // Diagnostics (frameSwap.ts): what is shown, requests passed before they were shown,
            // older decodes dropped after the timeout, and decodes that failed.
            data-shown={view}
            data-shown-index={shownIndex}
            data-late={swap.state.late}
            data-timed-out={swap.state.timedOut}
            data-decode-failed={swap.state.failed}
            data-testid="frame-viewer"
          >
            {noData !== 'none' && (
              // Behind the frame: only the grid area outside the frame's rectangle shows it.
              <div
                className="pointer-events-none absolute inset-0"
                style={{ background: NO_DATA_HATCH }}
                aria-hidden="true"
                data-testid="no-data-hatch"
                data-no-data={noData}
              />
            )}
            {/* The frame at its place on the grid; the tint layer has exactly the same box. Two
                <img> slots serve the whole object: the front one is drawn, the other decodes the
                next frame out of sight, then they swap (frameSwap.ts); neither is remounted. A
                frame of unknown size is not placed until it has decoded (no wrong placement). */}
            <div
              className="absolute"
              style={
                placement && picture
                  ? placementStyle(grid, placement)
                  : { inset: 0, visibility: 'hidden' as const }
              }
              data-testid="frame-place"
            >
              {SLOTS.map((slot) => {
                const isFront = slot === swap.state.front;
                const src = swap.state.srcs[slot];
                return (
                  <img
                    key={slot}
                    ref={swap.slots[slot]}
                    src={src ?? undefined}
                    alt={isFront ? alt : ''}
                    aria-hidden={isFront ? undefined : true}
                    className="absolute inset-0 h-full w-full"
                    style={{
                      imageRendering: 'pixelated',
                      visibility: isFront && picture ? undefined : 'hidden',
                    }}
                    draggable={false}
                    data-slot={slot}
                    data-testid={isFront ? 'cutout' : 'cutout-next'}
                  />
                );
              })}
              {tint && picture && (
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
              {picture && showMask && ovFrame && (
                // The shown frame's mask, in the frame's own box (same size and orientation as
                // its cutout), above the tint so its colours stay as the legend says.
                <FlagMaskImage
                  url={ovFrame.flags_url}
                  onError={() => setFailedMask(ovFrame.flags_url)}
                />
              )}
            </div>
            {picture && markers.length > 0 && (
              // Grid pixels (markersOnGrid): the same transform as the picture's placement box.
              <MarkerLayer markers={markers} width={grid} height={grid} />
            )}
            {view === 'failed' && (
              <p
                className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-neutral-300"
                data-testid="cutout-unavailable"
              >
                Cutout unavailable for this frame.
              </p>
            )}
            {viewMode === 'trails' && (
              // Offered only on a shared north-up grid, where frames sit at offset 0: the dots use
              // each frame's own (x, y) on the same N×N grid.
              <RainbowTrails
                frames={frames}
                width={grid}
                height={grid}
                currentIndex={shownIndex}
                monochrome={monochrome}
              />
            )}
            {ring && picture && (
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

          {/* Fixed-width digits and reserved lines, so a frame's caption never moves what follows.
              Everything here names the shown frame, so it changes with the picture. */}
          <div className="flex flex-col gap-1 text-sm tabular-nums" data-testid="frame-caption">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span data-testid="frame-counter">
                Frame {shownIndex + 1} of {n}
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
            {summary !== null && (
              // Only for objects with a hatched frame. The steady line stays for every frame; the
              // per-frame caption shows only while paused or stopped (R9: nothing flashes during
              // playback). Its cell holds every caption, the inactive ones invisible (and so not
              // read out), so it is as tall as the longest at any width and nothing moves.
              <div className="flex flex-col gap-1" data-testid="frame-no-data">
                <span className="flex items-center gap-1.5 text-neutral-300">
                  <span
                    className="inline-block h-3 w-5 shrink-0 rounded-sm border border-neutral-600"
                    style={{ background: NO_DATA_HATCH }}
                    aria-hidden="true"
                    data-testid="no-data-swatch"
                  />
                  <span data-testid="no-data-summary">{summary}</span>
                </span>
                <div className="grid" data-testid="no-data-caption-cell">
                  {NO_DATA_KINDS.map((k) => {
                    const on = captionOn && noData === k;
                    return (
                      <span
                        key={k}
                        className={`col-start-1 row-start-1 text-amber-200 ${on ? '' : 'invisible'}`}
                        data-testid={on ? 'frame-no-data-caption' : undefined}
                      >
                        {NO_DATA_CAPTION[k]}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {overlays && <ContaminationNote view={overlays} fixture={sky.fixture} />}

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

      <OverlayControls sky={sky} view={overlays} />
      {composite && overlaysOn && (
        <p className="text-sm text-neutral-400" data-testid="overlay-composite-note">
          {OVERLAYS_NOT_ON_COMPOSITE}
        </p>
      )}
      {overlays && !composite && (
        <OverlayDetails
          view={overlays}
          sky={sky}
          frame={frame}
          index={shownIndex}
          center={center}
          flagFailed={ovFrame !== undefined && failedMask === ovFrame.flags_url}
        />
      )}

      {n >= 2 && <CombinePanel sky={sky} frames={frames} />}

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

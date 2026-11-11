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
import { displayName } from '@/app/displayName';
import { useCallback, useId, useLayoutEffect, useMemo, useState, type KeyboardEvent } from 'react';
import type { FramesResponse, ResolveResponse } from '@/app/api/types';
import { DataBadge, EstimatedBadge } from '@/app/Badge';
import { Row, ToggleGroup } from '@/app/PanelControls';
import { Icon } from '@/app/shell/icons';
import { positionProvenance, positionText } from '@/app/sky/positionTags';
import { searchErrorMessage } from '@/app/messages';
import { RefusalList } from '@/app/RefusalList';
import { groupMissing } from '@/app/refusals';
import { ErrorBox } from '@/app/StatusBoxes';
import { describeFrame, useAppStore, type SkyState } from '@/state/store';
import {
  colourHidden,
  colourHiddenNote,
  effectiveColour,
  tintColour,
  transportLocked,
} from './colourMode';
import { CompositeView, TintLegend } from './ColourViews';
import { FramesTab, FramesWait } from './FramesProgress';
import { FlipbookSpectrum } from './FlipbookSpectrum';
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
import { trailsMonochrome, wavelengthColor } from './wavelengthColor';

export function Flipbook({ onClose, onBuild }: { onClose(): void; onBuild?: () => void }) {
  const sky = useAppStore((s) => s.sky);
  const retry = useAppStore((s) => s.skyRetry);
  if (sky.status === 'idle') return null;
  const name = sky.resolved
    ? objectName(sky.resolved)
    : (sky.query?.q ?? 'Flipbook');

  // Not a Player: the picture area alone (black), with the name and close over it.
  const area = (inner: React.ReactNode) => (
    <div className="fb-view" data-testid="frame-viewer-wait">
      <TopTabs name={name} onClose={onClose} />
      {inner}
    </div>
  );

  if (sky.status === 'resolving' || sky.status === 'loading_frames') {
    // The island says it; the card is not shown meanwhile (Panels.tsx).
    return area(null);
  }
  if (sky.status === 'error' && sky.error) {
    return (
      <>
        {area(null)}
        <div className="fb-c" style={{ paddingBottom: 16 }}>
          <ErrorBox
            message={searchErrorMessage(sky.error, sky.query?.q ?? '')}
            detail={sky.error.detail}
            onRetry={() => void retry()}
          />
        </div>
      </>
    );
  }
  if (sky.status === 'ready' && sky.resolved && sky.frames) {
    if (sky.frames.frames.length === 0) {
      return (
        <>
          {area(sky.progress ? <FramesWait progress={sky.progress} frames={sky.frames} /> : null)}
          {!sky.progress && (
            <div className="fb-c" style={{ paddingBottom: 16 }}>
              <NoFrames frames={sky.frames} />
            </div>
          )}
          {/* Only when something is actually listed: an empty padded strip under the picture otherwise. */}
          {sky.progress && sky.frames.missing.some((c) => !c.startsWith('cutouts:deferred:')) && (
            <div className="fb-c" style={{ paddingBottom: 16 }}>
              <MissingList missing={sky.frames.missing} hideDeferred />
            </div>
          )}
        </>
      );
    }
    return (
      <Player sky={sky} resolved={sky.resolved} frames={sky.frames} onClose={onClose} onBuild={onBuild} />
    );
  }
  return null;
}

function objectName(resolved: ResolveResponse): string {
  return displayName(resolved.name) || positionText(resolved);
}

/** The object's name (top left) and the close button (top right), each on a small dark tab. */
function TopTabs({ name, onClose }: { name: string; onClose(): void }) {
  return (
    <div className="fb-over">
      <h2 className="fb-name" title={name} data-testid="object-name">
        {name}
      </h2>
      <button
        type="button"
        className="fb-x"
        aria-label="Close the flipbook"
        title="Close (Esc)"
        onClick={onClose}
        data-testid="panel-close"
      >
        <Icon name="close" className="size-4" />
      </button>
    </div>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "24 Aug 2025" (UTC), or '' when the time does not parse. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
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

type MoreTab = 'overlays' | 'about' | 'combine';

function Player({
  sky,
  resolved,
  frames: response,
  onClose,
  onBuild,
}: {
  sky: SkyState;
  resolved: ResolveResponse;
  frames: FramesResponse;
  onClose(): void;
  onBuild?: () => void;
}) {
  const [moreTab, setMoreTab] = useState<MoreTab>('overlays');
  const tabsId = useId();
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

  const moreCount = Object.values(sky.overlays.toggles).filter(Boolean).length;
  const cachedAt = response.cached_at ?? resolved.cached_at;
  const position = positionProvenance(resolved.resolver, sky.query?.origin === 'sky');
  const panelId = (t: MoreTab) => `${tabsId}-${t}`;
  const dot = wavelengthColor(frame.wavelength_um);

  const viewer = (
    <div
      tabIndex={0}
      role="group"
      aria-label={`Frame viewer. ${frameText}. Space plays or pauses; arrow keys step.`}
      className="fb-view"
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
      {/* The frame at its place on the grid; the tint layer has exactly the same box. Two <img>
          slots serve the whole object: the front one is drawn, the other decodes the next frame
          out of sight, then they swap (frameSwap.ts); neither is remounted. A frame of unknown
          size is not placed until it has decoded (no wrong placement). */}
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
          // Grey luminance × the frame's false colour: a multiply blend over the pixelated image.
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: tintColour(frame.wavelength_um), mixBlendMode: 'multiply' }}
            aria-hidden="true"
            data-testid="tint-overlay"
            data-wavelength={frame.wavelength_um}
          />
        )}
        {picture && showMask && ovFrame && (
          <FlagMaskImage url={ovFrame.flags_url} onError={() => setFailedMask(ovFrame.flags_url)} />
        )}
      </div>
      {picture && markers.length > 0 && <MarkerLayer markers={markers} width={grid} height={grid} />}
      {view === 'failed' && (
        <p
          className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-neutral-300"
          data-testid="cutout-unavailable"
        >
          Cutout unavailable for this frame.
        </p>
      )}
      {viewMode === 'trails' && (
        <RainbowTrails
          frames={frames}
          width={grid}
          height={grid}
          currentIndex={shownIndex}
          monochrome={monochrome}
        />
      )}
      {ring && picture && (
        // The target ring: a marker only; the spectrum is always shown in the card.
        <span
          className="fb-ring"
          style={{ left: `${(ring.x / grid) * 100}%`, top: `${(ring.y / grid) * 100}%` }}
          aria-hidden="true"
          data-testid="object-ring"
        />
      )}
      <TopTabs name={name} onClose={onClose} />
      {sky.fixture && (
        <span className="pointer-events-none absolute top-14 left-2.5 z-[3] rounded bg-amber-400 px-1 text-[10px] font-bold tracking-wide text-black">
          SYNTHETIC
        </span>
      )}
      {sky.progress && <FramesTab progress={sky.progress} frames={response} />}
      <span className="fb-cap fb-cap-l" data-testid="frame-date">
        <i style={{ background: dot }} aria-hidden="true" />
        {shortDate(frame.time)}
      </span>
      <span className="fb-cap fb-cap-r" data-testid="frame-counter">
        <span>
          <b>{shownIndex + 1}</b>
          <span className="fb-dim"> / {n}</span>
        </span>
      </span>
    </div>
  );

  return (
    <div
      role="region"
      aria-label={`SPHEREx frames for ${name}`}
      className="flex flex-col"
      onKeyDown={onKeyDown}
      data-testid="flipbook"
    >
      {composite ? (
        <div className="fb-c" style={{ paddingBottom: 0 }}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[15.5px] font-semibold" data-testid="object-name">
              {name}
            </h2>
            <button type="button" className="fb-x" aria-label="Close the flipbook" onClick={onClose}>
              <Icon name="close" className="size-4" />
            </button>
          </div>
          <CompositeView name={name} fixture={sky.fixture} onShowSpectrum={() => undefined} />
        </div>
      ) : (
        viewer
      )}

      <div className="fb-c">
        <div className="fb-two">
          <ToggleGroup
            label="Picture"
            value={sky.colour.on ? 'colour' : 'raw'}
            options={[
              { value: 'raw', label: 'Raw', testId: 'colour-raw' },
              { value: 'colour', label: 'Colour', testId: 'colour-on' },
            ]}
            onChange={(v) => setColour({ ...sky.colour, on: v === 'colour' })}
            testId="colour-switch"
          />
          {onBuild && (
            <div className="sx-pc-grp">
              <span className="sx-eyebrow">3D</span>
              <button type="button" className="fb-btn-primary" onClick={onBuild} data-testid="panel-build-it">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z M12 12l8-4.5 M12 12v9 M12 12 4 7.5" />
                </svg>
                Build it
              </button>
            </div>
          )}
        </div>
        {sky.colour.on && (
          <ToggleGroup
            label="Colour view"
            hideLabel
            value={sky.colour.view}
            options={[
              { value: 'tint', label: 'Wavelength tint', testId: 'colour-tint' },
              { value: 'composite', label: 'SPHEREx composite', testId: 'colour-composite' },
            ]}
            onChange={(v) => setColour({ on: true, view: v })}
            testId="colour-view"
          />
        )}
        {hiddenColour && (
          <p className="fb-muted" style={{ color: 'var(--warn)' }} data-testid="colour-hidden-note">
            {colourHiddenNote(sky.colour.view)}
          </p>
        )}
        {tint && <TintLegend wavelengthUm={frame.wavelength_um} stretch={stretchFormula(response)} />}
        {overlays && !composite && <ContaminationNote view={overlays} fixture={sky.fixture} />}

        <FlipbookSpectrum name={name} />

        <div className="fb-rows" data-testid="more">
          <Row title="More" count={moreCount > 0 ? `${moreCount} on` : 'None on'} testId="more-row">
            <ToggleGroup<MoreTab>
              tabs
              hideLabel
              label="More"
              value={moreTab}
              onChange={setMoreTab}
              panelIds={{ overlays: panelId('overlays'), about: panelId('about'), combine: panelId('combine') }}
              options={[
                { value: 'overlays', label: 'Overlays', testId: 'more-tab-overlays' },
                { value: 'about', label: 'About', testId: 'more-tab-about' },
                { value: 'combine', label: 'Combine', testId: 'more-tab-combine' },
              ]}
              testId="more-tabs"
            />
            <div role="tabpanel" id={panelId('overlays')} hidden={moreTab !== 'overlays'} className="flex flex-col gap-3">
              <OverlayControls sky={sky} view={overlays} />
              {composite && overlaysOn && (
                <p className="fb-muted" data-testid="overlay-composite-note">
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
            </div>
            <div role="tabpanel" id={panelId('about')} hidden={moreTab !== 'about'} className="flex flex-col gap-3">
              <dl className="fb-dl">
                <dt>Position</dt>
                <dd>
                  {positionText(resolved)}
                  {resolved.moving && ' · moving object'}
                  {sky.fixture ? (
                    <DataBadge fixture variant="tag" />
                  ) : (
                    position.tag !== 'measured' && <EstimatedBadge variant="tag" tooltip={position.tooltip} />
                  )}
                </dd>
                <dt>Release</dt>
                <dd>
                  {response.data_release}
                  {cachedAt && shortDate(cachedAt) ? `, cached ${shortDate(cachedAt)}` : ''}
                  {sky.fixture && ' · synthetic fixture data'}
                </dd>
                <dt>Stretch</dt>
                <dd>
                  <span data-testid="stretch">{response.stretch.kind}</span>
                  {/* A display choice, not data: Estimated. */}
                  <EstimatedBadge variant="tag" tooltip={stretchFormula(response)} />
                </dd>
                <dt>Flags</dt>
                <dd data-testid="frame-flags">{frame.flags.length > 0 ? frame.flags.join(', ') : 'none'}</dd>
                <dt>Orientation</dt>
                <dd data-testid="orientation-note">
                  {response.north_up
                    ? 'North up, so the frames share one grid'
                    : 'Native, so the picture may rotate between frames'}
                </dd>
                {summary !== null && (
                  <>
                    <dt>Edges</dt>
                    <dd data-testid="frame-no-data">
                      <span
                        className="inline-block h-3 w-5 shrink-0 rounded-sm border border-neutral-600"
                        style={{ background: NO_DATA_HATCH }}
                        aria-hidden="true"
                        data-testid="no-data-swatch"
                      />
                      <span data-testid="no-data-summary">{summary}</span>
                    </dd>
                  </>
                )}
                <dt>Cutouts</dt>
                <dd data-testid="preload-progress">
                  {loadedCount} of {n} loaded
                  {failedCount > 0 && ` · ${failedCount} unavailable`}
                </dd>
                {!composite && (
                  <>
                    <dt>Trails</dt>
                    <dd>
                      {trailsReason ? (
                        <span id="trails-reason" data-testid="trails-reason">
                          Rainbow Trails: {trailsReason}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="fb-stop"
                          aria-pressed={viewMode === 'trails'}
                          onClick={() => setViewMode(viewMode === 'trails' ? 'frames' : 'trails')}
                          data-testid="trails-toggle"
                        >
                          {viewMode === 'trails' ? 'Show the frames' : 'Show Rainbow Trails'}
                        </button>
                      )}
                    </dd>
                  </>
                )}
              </dl>
              {viewMode === 'trails' && <RainbowTrailsLegend monochrome={monochrome} />}
              <MissingList missing={response.missing} hideDeferred={sky.progress !== null} />
            </div>
            <div role="tabpanel" id={panelId('combine')} hidden={moreTab !== 'combine'}>
              {n >= 2 ? (
                <CombinePanel sky={sky} frames={frames} />
              ) : (
                <p className="fb-muted">Combining needs two or more frames.</p>
              )}
            </div>
          </Row>
        </div>
      </div>
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

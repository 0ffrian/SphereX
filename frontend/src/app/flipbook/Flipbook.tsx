// A1.1 P0 flipbook (UML 08): plays an object's SPHEREx frames in the order the API lists them,
// with play/pause, step, scrubber and speed; shows each frame's time and wavelength. Clicking the
// ring on the object opens its spectrum (UML 09). Rainbow Trails is a view mode (D-28, P1).
// Keyboard (R9): Space or K play/pause, ←/→ step, Home/End first/last, while focus is in the
// flipbook but not on a button or form field (those keep their own keys).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { FramesResponse, ResolveResponse } from '@/app/api/types';
import { DataBadge, EstimatedBadge } from '@/app/Badge';
import { formatCoords, formatUtc, formatWavelength } from '@/app/format';
import { searchErrorMessage } from '@/app/messages';
import { RefusalList } from '@/app/RefusalList';
import { groupMissing } from '@/app/refusals';
import { ErrorBox, LoadingBox } from '@/app/StatusBoxes';
import { buttonClass, pressedClass } from '@/app/ui';
import { describeFrame, useAppStore, type SkyState } from '@/state/store';
import { flipbookKeyAction } from './keys';
import { FPS_OPTIONS, readyToPlay, type Fps } from './playback';
import { RainbowTrails, RainbowTrailsLegend, trailsUnavailableReason } from './RainbowTrails';
import { useCutoutPreload, type CutoutStatus } from './useCutoutPreload';
import { trailsMonochrome } from './wavelengthColor';

export function Flipbook() {
  const sky = useAppStore((s) => s.sky);
  const retry = useAppStore((s) => s.skyRetry);
  if (sky.status === 'idle') return null;

  return (
    <section aria-labelledby="flipbook-heading" className="flex flex-col gap-3">
      <h2 id="flipbook-heading" className="text-lg font-medium">
        SPHEREx frames
      </h2>
      {sky.status === 'resolving' && (
        <LoadingBox text={`Finding “${sky.query?.q ?? ''}”…`} startedAt={sky.startedAt} />
      )}
      {sky.status === 'loading_frames' && (
        <LoadingBox
          text="Asking the archive for frames… IRSA can be slow."
          startedAt={sky.startedAt}
        />
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
          <ObjectHeader sky={sky} resolved={sky.resolved} frames={sky.frames} />
          {sky.frames.frames.length === 0 ? (
            <NoFrames frames={sky.frames} />
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
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-base font-semibold" data-testid="object-name">
        {objectName(resolved)}
      </h3>
      <p className="text-sm text-neutral-300">
        {formatCoords(resolved.ra, resolved.dec)}
        {resolved.moving && ' · moving object'}
      </p>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-neutral-400">
        <span>Data release: {frames.data_release} ·</span>
        <span data-testid="stretch">Display stretch: {frames.stretch.kind}</span>
        {sky.fixture ? <DataBadge fixture /> : <EstimatedBadge tooltip={stretchFormula(frames)} />}
        {cachedAt && <span>· Cached {formatUtc(cachedAt)}</span>}
        {sky.fixture && <span>· synthetic fixture data</span>}
      </p>
      {frames.frames.length > 0 && (
        <button
          type="button"
          className={`${buttonClass} self-start`}
          onClick={() => void loadSpectrum()}
          disabled={sky.spectrum.status === 'loading'}
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

/** Refused frames and notes from the frames reply (A4.1), grouped by reason. */
function MissingList({ missing }: { missing: readonly string[] }) {
  const groups = useMemo(() => groupMissing(missing), [missing]);
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
  const setFps = useAppStore((s) => s.skySetFps);
  const setViewMode = useAppStore((s) => s.skySetViewMode);
  const loadSpectrum = useAppStore((s) => s.skyLoadSpectrum);

  const honesty = useAppStore((s) => s.honesty);
  const preload = useCutoutPreload(frames);
  const status = preload.status;
  const statusRef = useRef<readonly CutoutStatus[]>(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Playback timer. Each tick reads the latest preload state through the ref.
  useEffect(() => {
    if (!sky.playing) return;
    const id = setInterval(() => {
      const s = statusRef.current;
      useAppStore.getState().skyAdvance((i) => s[i] === 'loaded' || s[i] === 'failed');
    }, 1000 / sky.fps);
    return () => clearInterval(id);
  }, [sky.playing, sky.fps]);

  // Natural size of the cutouts, from the shown image. Keeps the last known size between frames.
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  const settled = (i: number) => status[i] === 'loaded' || status[i] === 'failed';
  const loadedCount = status.filter((s) => s === 'loaded').length;
  const failedCount = status.filter((s) => s === 'failed').length;
  const canPlay = n >= 2 && (sky.playing || readyToPlay(index, n, settled));
  const current = status[index] ?? 'pending';

  const imageSize = dims ?? preload.size;
  const trailsReason = trailsUnavailableReason(resolved, response, {
    imageSize,
    allSettled: status.every((s) => s !== 'pending'),
  });
  const monochrome = trailsMonochrome(honesty);
  const viewMode = trailsReason ? 'frames' : sky.viewMode;
  const name = objectName(resolved);
  const frameText = describeFrame(response, index);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
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
      {!response.north_up && (
        <p className="text-sm text-amber-200" data-testid="orientation-note">
          Frames are in the telescope’s native orientation, so the picture may rotate between
          frames.
        </p>
      )}

      <div
        tabIndex={0}
        role="group"
        aria-label={`Frame viewer. ${frameText}. Space plays or pauses; arrow keys step.`}
        className="relative w-full max-w-md overflow-hidden rounded-lg border border-neutral-800 bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
        style={{ aspectRatio: imageSize ? `${imageSize.w} / ${imageSize.h}` : '1 / 1' }}
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
          <img
            key={frame.cutout_url}
            src={frame.cutout_url}
            alt={`SPHEREx cutout of ${name}. ${frameText}. Display stretch ${response.stretch.kind}.`}
            className="absolute inset-0 h-full w-full"
            style={{ imageRendering: 'pixelated' }}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (
                img.naturalWidth > 0 &&
                (dims?.w !== img.naturalWidth || dims?.h !== img.naturalHeight)
              ) {
                setDims({ w: img.naturalWidth, h: img.naturalHeight });
              }
            }}
            data-testid="cutout"
          />
        )}
        {imageSize && viewMode === 'trails' && (
          <RainbowTrails
            frames={frames}
            width={imageSize.w}
            height={imageSize.h}
            currentIndex={index}
            monochrome={monochrome}
          />
        )}
        {imageSize && current === 'loaded' && (
          <button
            type="button"
            className="absolute flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-sky-400"
            style={{
              left: `${((frame.x + 0.5) / imageSize.w) * 100}%`,
              top: `${((frame.y + 0.5) / imageSize.h) * 100}%`,
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

      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
        data-testid="frame-caption"
      >
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
        <span className="text-neutral-400">
          {frame.flags.length > 0 ? `Flags: ${frame.flags.join(', ')}` : 'No flags'}
        </span>
      </div>

      <div
        role="group"
        aria-label="Playback controls"
        className="flex flex-wrap items-center gap-2"
      >
        <button
          type="button"
          className={buttonClass}
          aria-label="First frame"
          title="First frame"
          onClick={() => seek(0)}
        >
          <StepIcon kind="first" />
        </button>
        <button
          type="button"
          className={buttonClass}
          aria-label="Previous frame"
          title="Previous frame"
          onClick={() => step(-1)}
        >
          <StepIcon kind="prev" />
        </button>
        <button
          type="button"
          className={`${buttonClass} min-w-24`}
          onClick={togglePlay}
          disabled={!canPlay}
          aria-describedby={!canPlay && n >= 2 ? 'play-wait' : undefined}
          data-testid="play-pause"
        >
          {sky.playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          className={buttonClass}
          aria-label="Next frame"
          title="Next frame"
          onClick={() => step(1)}
        >
          <StepIcon kind="next" />
        </button>
        <button
          type="button"
          className={buttonClass}
          aria-label="Last frame"
          title="Last frame"
          onClick={() => seek(n - 1)}
        >
          <StepIcon kind="last" />
        </button>
        <label className="flex items-center gap-2 text-sm">
          Speed
          <select
            className="min-h-11 rounded-md border border-neutral-500 bg-neutral-900 px-2 text-neutral-100 focus-visible:outline-2 focus-visible:outline-sky-400"
            value={sky.fps}
            onChange={(e) => setFps(Number(e.target.value) as Fps)}
          >
            {FPS_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f} frame{f === 1 ? '' : 's'}/s
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span>Frame</span>
        <input
          type="range"
          min={0}
          max={n - 1}
          step={1}
          value={index}
          onChange={(e) => seek(Number(e.target.value))}
          aria-valuetext={frameText}
          className="h-11 w-full max-w-md accent-sky-400"
          data-testid="scrubber"
        />
      </label>

      <p className="text-sm text-neutral-400" data-testid="preload-progress">
        Cutouts loaded: {loadedCount} of {n}
        {failedCount > 0 && ` · ${failedCount} unavailable`}
        {!canPlay && n >= 2 && (
          <span id="play-wait"> · Play starts once the next frames have loaded.</span>
        )}
      </p>

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
          <span id="trails-reason" className="text-sm text-neutral-400" data-testid="trails-reason">
            {trailsReason}
          </span>
        )}
      </div>
      {viewMode === 'trails' && <RainbowTrailsLegend monochrome={monochrome} />}

      <MissingList missing={response.missing} />
    </div>
  );
}

/** Plain SVG icons: the Unicode media glyphs render as colour emoji on some systems. */
function StepIcon({ kind }: { kind: 'first' | 'prev' | 'next' | 'last' }) {
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

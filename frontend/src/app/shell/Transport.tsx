// Bottom-left transport bar (mock-up `.player`): previous / play / next, the frame scrubber,
// "Frame n/N", the wavelength and the speed. It drives the flipbook's store actions and reads the
// shared playback session (flipbook/session.tsx); it holds no playback logic of its own.
// While the SPHEREx colour composite shows (one picture), every control is disabled and a short
// note says how to get the frames back (colourMode.ts).
import { useId } from 'react';
import { formatWavelength } from '@/app/format';
import { FPS_OPTIONS, type Fps } from '@/app/flipbook/playback';
import { useFlipbookSession } from '@/app/flipbook/session';
import {
  COMPOSITE_TRANSPORT_NOTE,
  effectiveColour,
  transportLocked,
} from '@/app/flipbook/colourMode';
import { trailsMonochrome, wavelengthColor } from '@/app/flipbook/wavelengthColor';
import { describeFrame, useAppStore } from '@/state/store';
import { Icon } from './icons';

export function Transport() {
  const sky = useAppStore((s) => s.sky);
  const step = useAppStore((s) => s.skyStep);
  const seek = useAppStore((s) => s.skySeek);
  const togglePlay = useAppStore((s) => s.skyTogglePlay);
  const setFps = useAppStore((s) => s.skySetFps);
  const { canPlay, shownIndex } = useFlipbookSession();
  // The dot is the Rainbow Trails false colour (`derived`, Q-27): one colour in "Measured only".
  const honesty = useAppStore((s) => s.honesty);
  const monochrome = trailsMonochrome(honesty);
  const locked = transportLocked(effectiveColour(sky.colour, honesty));
  const waitId = useId();
  const lockedId = useId();

  const response = sky.status === 'ready' ? sky.frames : null;
  const n = response?.frames.length ?? 0;
  const index = n > 0 ? Math.min(sky.index, n - 1) : 0;
  // The readout names the frame on screen (it can trail the scrubber until its picture decodes).
  const shown = shownIndex !== null && shownIndex < n ? shownIndex : index;
  const frame = response?.frames[shown] ?? null;
  const has = n > 0 && !locked;
  const frameText = response && has ? describeFrame(response, index) : 'No frames loaded';
  const percent = n > 1 ? (index / (n - 1)) * 100 : 0;

  return (
    <div role="region" aria-label="Playback controls" className="sx-player" data-testid="transport">
      <button
        type="button"
        className="sx-btn-i"
        aria-label="Previous frame"
        title="Previous frame"
        onClick={() => step(-1)}
        disabled={!has}
        aria-describedby={locked ? lockedId : undefined}
      >
        <Icon name="prev" className="size-4" />
      </button>
      <button
        type="button"
        className="sx-btn-i sx-btn-play"
        onClick={togglePlay}
        disabled={!canPlay || locked}
        aria-describedby={locked ? lockedId : !canPlay && n >= 2 ? waitId : undefined}
        data-testid="play-pause"
      >
        <Icon name={sky.playing ? 'pause' : 'play'} className="size-4" />
        <span className="sr-only">{sky.playing ? 'Pause' : 'Play'}</span>
      </button>
      <button
        type="button"
        className="sx-btn-i"
        aria-label="Next frame"
        title="Next frame"
        onClick={() => step(1)}
        disabled={!has}
        aria-describedby={locked ? lockedId : undefined}
      >
        <Icon name="next" className="size-4" />
      </button>
      {locked && (
        <p id={lockedId} className="sx-player-note" data-testid="transport-locked">
          {COMPOSITE_TRANSPORT_NOTE}
        </p>
      )}
      {!locked && (
        <label className="sx-scrub">
          <span className="sr-only">Frame</span>
          <input
            type="range"
            min={0}
            max={Math.max(0, n - 1)}
            step={1}
            value={index}
            disabled={!has}
            onChange={(e) => seek(Number(e.target.value))}
            aria-valuetext={frameText}
            style={{ ['--p' as string]: `${percent}%` }}
            data-testid="scrubber"
          />
        </label>
      )}
      {!locked && (
        <p className="sx-frame-info" aria-hidden="true">
          {frame && (
            <span
              className="sx-dot"
              style={{ color: monochrome ? '#a1a1aa' : wavelengthColor(frame.wavelength_um) }}
            />
          )}
          <span>
            Frame <b>{has ? shown + 1 : '–'}</b>/{has ? n : '–'}
          </span>
          <span className="sx-hide-s">
            <b>{frame ? formatWavelength(frame.wavelength_um) : '– µm'}</b>
          </span>
        </p>
      )}
      {!locked && (
        <label className="sx-speed">
          <span className="sr-only">Speed</span>
          <select
            value={sky.fps}
            onChange={(e) => setFps(Number(e.target.value) as Fps)}
            disabled={!has}
            title="Speed"
          >
            {FPS_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f} fps
              </option>
            ))}
          </select>
        </label>
      )}
      {!canPlay && !locked && n >= 2 && (
        <span id={waitId} className="sr-only">
          Play starts once the next frames have loaded.
        </span>
      )}
    </div>
  );
}

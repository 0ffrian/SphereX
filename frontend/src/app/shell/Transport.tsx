// Bottom-left transport bar (mock-up `.player`): previous / play / next, the frame scrubber,
// "Frame n/N", the wavelength and the frame's colour indicator. It drives the flipbook's store actions and reads the
// shared playback session (flipbook/session.tsx); it holds no playback logic of its own.
// While the SPHEREx colour composite shows (one picture), every control is disabled and a short
// note says how to get the frames back (colourMode.ts).
import { useId } from 'react';
import GridLoader from '@/app/island/GridLoader';
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
        <div className="sx-frame-info" aria-hidden="true">
          {/* Mock-up `.wgrid`: the plus-hollow grid loader, in the frame's colour; it pulses slowly
              at rest and runs its wave and ripple sequence while playing (still under reduced
              motion, which GridLoader handles). */}
          <span className="sx-wgrid" data-testid="frame-indicator">
            <GridLoader
              size={18}
              gap={1}
              rounded
              color={
                frame ? (monochrome ? '#a1a1aa' : wavelengthColor(frame.wavelength_um)) : '#a1a1aa'
              }
              {...(sky.playing
                ? {
                    mode: 'sequence' as const,
                    sequence: ['wave-lr', 'ripple-out', 'wave-rl', 'ripple-in'],
                    speed: 'fast' as const,
                  }
                : { mode: 'pulse' as const, pattern: 'plus-hollow' as const, speed: 'slow' as const })}
            />
          </span>
          <span>
            Frame <b>{has ? shown + 1 : '–'}</b>
            <span className="sx-frame-n">/{has ? n : '–'}</span>
          </span>
          {/* Not on the span with sx-hide-s: a display utility would beat its phone-width rule. */}
          <span className="sx-hide-s">
            <b>{frame ? frame.wavelength_um.toFixed(2) : '–'}</b> µm
          </span>
        </div>
      )}
      {!canPlay && !locked && n >= 2 && (
        <span id={waitId} className="sr-only">
          Play starts once the next frames have loaded.
        </span>
      )}
    </div>
  );
}

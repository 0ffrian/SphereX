// Top-right RA/Dec card (mock-up `.coords`, a floating card; Inter with tabular figures): the position under the pointer, or the view centre.
// Written straight into its text nodes from the readout feed (app/sky/readout.ts), so pointer moves
// never re-render React. Not a live region: it would talk on every move.
import { useEffect, useRef } from 'react';
import { subscribeReadout } from '@/app/sky/readout';
import { formatUtc, formatWavelength, TIME_WITHOUT_ZONE } from '@/app/format';
import { useFlipbookSession } from '@/app/flipbook/session';
import { useAppStore } from '@/state/store';
import { formatFov, formatReadout } from '@/viewer/sky/skyMath';

export function Readout() {
  const ra = useRef<HTMLElement>(null);
  const dec = useRef<HTMLElement>(null);
  const fov = useRef<HTMLSpanElement>(null);
  const src = useRef<HTMLSpanElement>(null);
  // The sub-line under the card names the frame on screen (mock-up: wavelength, date, frame n/N).
  const response = useAppStore((s) => (s.sky.status === 'ready' ? s.sky.frames : null));
  const index = useAppStore((s) => s.sky.index);
  const { shownIndex } = useFlipbookSession();
  const n = response?.frames.length ?? 0;
  const shown = n > 0 ? (shownIndex !== null && shownIndex < n ? shownIndex : Math.min(index, n - 1)) : 0;
  const frame = response?.frames[shown] ?? null;
  const when = frame ? formatUtc(frame.time) : null;

  useEffect(
    () =>
      subscribeReadout((v) => {
        const t = formatReadout(v.ra, v.dec);
        if (ra.current) ra.current.textContent = t.ra;
        if (dec.current) dec.current.textContent = t.dec;
        if (fov.current) fov.current.textContent = formatFov(v.fovDeg);
        if (src.current)
          src.current.textContent = v.source === 'pointer' ? 'Under the pointer' : 'View centre';
      }),
    [],
  );

  return (
    <div className="sx-coords-wrap">
      <p className="sx-coords" data-testid="sky-readout">
        <span className="sr-only">Sky position: </span>
        <abbr className="sx-coords-k" title="Right ascension">
          RA
        </abbr>{' '}
        <b ref={ra} data-testid="readout-ra">
          --
        </b>{' '}
        <abbr className="sx-coords-k" title="Declination">
          Dec
        </abbr>{' '}
        <b ref={dec} data-testid="readout-dec">
          --
        </b>
        <br />
        <span className="sx-coords-sub-in">
          <span ref={src}>View centre</span> ·{' '}
          <abbr className="no-underline" title="Field of view: how wide the view is">
            FOV
          </abbr>{' '}
          <span ref={fov}>--</span> ·{' '}
          <abbr className="no-underline" title="ICRS: the standard sky coordinate frame (J2000)">
            ICRS
          </abbr>
        </span>
      </p>
      {/* Moon (11 Nov 2026): no frame line under the readout; the player and the Flipbook picture show it. */}
      {false as boolean && frame && (
        <p className="sx-coords-sub" data-testid="sky-readout-frame">
          {formatWavelength(frame.wavelength_um)}
          <br />
          {when !== null && when !== TIME_WITHOUT_ZONE ? `${when.slice(0, 10)} · ` : ''}frame{' '}
          {shown + 1}/{n}
        </p>
      )}
    </div>
  );
}

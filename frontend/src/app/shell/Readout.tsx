// Top-right RA/Dec readout (mock-up `.coords`): the position under the pointer, or the view centre.
// Written straight into its text nodes from the readout feed (app/sky/readout.ts), so pointer moves
// never re-render React. Not a live region: it would talk on every move.
import { useEffect, useRef } from 'react';
import { subscribeReadout } from '@/app/sky/readout';
import { formatFov, formatReadout } from '@/viewer/sky/skyMath';

export function Readout() {
  const ra = useRef<HTMLElement>(null);
  const dec = useRef<HTMLElement>(null);
  const fov = useRef<HTMLSpanElement>(null);
  const src = useRef<HTMLSpanElement>(null);

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
    <p
      className="ml-auto shrink-0 text-right font-mono text-xs leading-4 text-sx-mfg"
      data-testid="sky-readout"
    >
      <span className="sr-only">Sky position: </span>
      <abbr className="text-sx-fg no-underline" title="Right ascension">
        RA
      </abbr>{' '}
      <b className="font-medium text-sx-fg tabular-nums" ref={ra} data-testid="readout-ra">
        --
      </b>{' '}
      <abbr className="text-sx-fg no-underline" title="Declination">
        Dec
      </abbr>{' '}
      <b className="font-medium text-sx-fg tabular-nums" ref={dec} data-testid="readout-dec">
        --
      </b>
      <br />
      <span ref={src}>View centre</span> ·{' '}
      <abbr className="no-underline" title="Field of view: how wide the view is">
        FOV
      </abbr>{' '}
      <span ref={fov}>--</span> ·{' '}
      <abbr className="no-underline" title="ICRS: the standard sky coordinate frame (J2000)">
        ICRS
      </abbr>
    </p>
  );
}

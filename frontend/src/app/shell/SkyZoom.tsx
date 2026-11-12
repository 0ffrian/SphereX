// The sky view's zoom card (bottom left, mock-up `.zoom`): minus, the zoom, plus. It drives the same
// zoom as the wheel and the + and - keys (sky/skyZoom.ts); the value is how much narrower the view is
// than the one the sky opened with, read from the readout feed (no React render per frame).
import { useEffect, useRef } from 'react';
import { DEFAULT_SKY_VIEW } from '@/app/sky/SkyPane';
import { subscribeReadout } from '@/app/sky/readout';
import { skyZoom, skyZoomPercent } from '@/app/sky/skyZoom';
import { KEY_ZOOM_FACTOR } from '@/viewer/sky/skyMath';
import { Icon } from './icons';

export function SkyZoom() {
  const value = useRef<HTMLButtonElement>(null);
  useEffect(
    () =>
      subscribeReadout((v) => {
        const t = skyZoomPercent(DEFAULT_SKY_VIEW.fovDeg, v.fovDeg);
        if (value.current) {
          value.current.textContent = t;
          value.current.setAttribute('aria-label', `Reset the zoom. Now ${t}`);
        }
      }),
    [],
  );
  return (
    <div className="sx-fl sx-zoom" role="group" aria-label="Zoom the sky" data-testid="sky-zoom">
      <button
        type="button"
        className="sx-btn-i"
        aria-label="Zoom out"
        title="Zoom out (-)"
        onClick={() => skyZoom()?.zoom(KEY_ZOOM_FACTOR)}
      >
        <Icon name="zoomOut" className="size-4" />
      </button>
      <button
        type="button"
        className="sx-zval"
        ref={value}
        aria-label="Reset the zoom"
        title="Reset the view (R)"
        onClick={() => skyZoom()?.reset()}
        data-testid="sky-zoom-value"
      >
        100%
      </button>
      <button
        type="button"
        className="sx-btn-i"
        aria-label="Zoom in"
        title="Zoom in (+)"
        onClick={() => skyZoom()?.zoom(1 / KEY_ZOOM_FACTOR)}
      >
        <Icon name="zoomIn" className="size-4" />
      </button>
    </div>
  );
}

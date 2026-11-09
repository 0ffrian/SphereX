// Gaia and WISE markers over the cutout (issue #12, R4 display level 1). Placed with the same
// percentage maths as the object ring, (x + 0.5) / w. Shape tells the catalogues apart, not only
// colour: Gaia is a circle, WISE a diamond. pointer-events: none, so the ring underneath still
// takes clicks. The list of markers for screen readers is MarkerList (R9).
import type { OverlayMarker } from '@/app/api/types';
import { markerPercent } from './geometry';

/**
 * Display styling, not data (an open design choice): amber and pink read on black and differ
 * from the sky-blue object ring (#38bdf8); each has a dark outline for bright stars.
 */
export const MARKER_STYLE = {
  gaia: { colour: '#fbbf24', shape: 'circle' },
  wise: { colour: '#f472b6', shape: 'diamond' },
} as const;

/** Marker half-size in CSS px; fixed on screen whatever the cutout's zoom. */
const R = 7;

export function MarkerLayer({
  markers,
  width,
  height,
}: {
  markers: readonly OverlayMarker[];
  width: number;
  height: number;
}) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      aria-hidden="true"
      data-testid="marker-layer"
    >
      {markers.map((m) => {
        const left = markerPercent(m.x, width);
        const top = markerPercent(m.y, height);
        const style = MARKER_STYLE[m.catalog];
        return (
          <svg
            key={`${m.catalog}:${m.id}`}
            x={`${left}%`}
            y={`${top}%`}
            overflow="visible"
            data-testid="marker"
            data-catalog={m.catalog}
            data-id={m.id}
            data-shape={style.shape}
            data-left={left}
            data-top={top}
          >
            {style.shape === 'circle' ? (
              <>
                <circle r={R} fill="none" stroke="#0a0a0a" strokeWidth={3.5} />
                <circle r={R} fill="none" stroke={style.colour} strokeWidth={1.75} />
              </>
            ) : (
              <>
                <path
                  d={`M0 ${-R} L${R} 0 L0 ${R} L${-R} 0 Z`}
                  fill="none"
                  stroke="#0a0a0a"
                  strokeWidth={3.5}
                />
                <path
                  d={`M0 ${-R} L${R} 0 L0 ${R} L${-R} 0 Z`}
                  fill="none"
                  stroke={style.colour}
                  strokeWidth={1.75}
                />
              </>
            )}
          </svg>
        );
      })}
    </svg>
  );
}

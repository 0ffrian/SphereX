// Rainbow Trails view mode (D-28, handover §5): one dot per frame at the object's position in
// that frame, coloured by wavelength. Uses only the frames the flipbook already loaded. Positions
// are comparable across frames only when the cutouts share one north-up grid, so the mode is
// offered only then (see trailsUnavailableReason).
import type { Frame, FramesResponse, ResolveResponse } from '@/app/api/types';
import { EstimatedBadge } from '@/app/Badge';
import { formatUtc, formatWavelength } from '@/app/format';
import {
  SPHEREX_MAX_UM,
  SPHEREX_MIN_UM,
  WAVELENGTH_COLOR_FORMULA,
  wavelengthColor,
  wavelengthGradient,
} from './wavelengthColor';

/** What the player knows about the cutouts: a size to draw on, and whether loading has finished. */
export interface CutoutAvailability {
  imageSize: { w: number; h: number } | null;
  allSettled: boolean;
}

export const TRAILS_NO_CUTOUTS =
  'No cutout could be loaded, so there is no picture to draw Rainbow Trails on.';
export const TRAILS_WAITING = 'Rainbow Trails is available once the first cutout has loaded.';

/** Why Rainbow Trails cannot be shown, or null when it can. */
export function trailsUnavailableReason(
  resolved: ResolveResponse | null,
  frames: FramesResponse | null,
  cutouts: CutoutAvailability,
): string | null {
  if (!resolved || !frames || frames.frames.length === 0) return 'No frames are loaded.';
  if (!frames.north_up) {
    return 'Rainbow Trails needs the frames on one north-up grid; these are in the telescope’s native orientation.';
  }
  if (!resolved.moving)
    return 'Rainbow Trails is for moving objects; this one is not marked as moving.';
  if (!cutouts.imageSize) return cutouts.allSettled ? TRAILS_NO_CUTOUTS : TRAILS_WAITING;
  return null;
}

interface RainbowTrailsProps {
  frames: readonly Frame[];
  width: number;
  height: number;
  currentIndex: number;
  /** Draw every dot in one colour (for "Measured only": the false colour is `derived`). */
  monochrome?: boolean;
}

export function RainbowTrails({
  frames,
  width,
  height,
  currentIndex,
  monochrome = false,
}: RainbowTrailsProps) {
  const r = Math.max(width, height) * 0.022;
  const path = frames.map((f, i) => `${i === 0 ? 'M' : 'L'}${f.x + 0.5} ${f.y + 0.5}`).join(' ');
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      data-testid="rainbow-trails"
    >
      <path
        d={path}
        fill="none"
        stroke="rgb(255 255 255 / 0.35)"
        strokeWidth={r * 0.25}
        vectorEffect="non-scaling-stroke"
      />
      {frames.map((f, i) => (
        <circle
          key={f.frame_id}
          data-testid="trail-dot"
          cx={f.x + 0.5}
          cy={f.y + 0.5}
          r={i === currentIndex ? r * 1.5 : r}
          fill={monochrome ? '#e5e5e5' : wavelengthColor(f.wavelength_um)}
          stroke={i === currentIndex ? '#ffffff' : '#0a0a0a'}
          strokeWidth={i === currentIndex ? 2 : 1}
          vectorEffect="non-scaling-stroke"
        >
          <title>{`${formatWavelength(f.wavelength_um)}, ${formatUtc(f.time)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

export function RainbowTrailsLegend({ monochrome = false }: { monochrome?: boolean }) {
  if (monochrome) {
    return (
      <p className="text-sm text-neutral-300" data-testid="trails-legend">
        One dot per frame. The false colour is hidden in Measured only.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1 text-sm text-neutral-300" data-testid="trails-legend">
      <span className="flex items-center gap-2">
        Colour shows wavelength (false colour)
        <EstimatedBadge tooltip={WAVELENGTH_COLOR_FORMULA} />
      </span>
      <div
        className="h-3 w-full max-w-xs rounded-sm"
        style={{ background: wavelengthGradient() }}
        aria-hidden="true"
      />
      <div className="flex w-full max-w-xs justify-between text-xs text-neutral-400">
        <span>{SPHEREX_MIN_UM} µm</span>
        <span>{SPHEREX_MAX_UM} µm</span>
      </div>
    </div>
  );
}

// Flagged pixels (issue #12): the backend's RGBA mask PNG for this frame, drawn over the cutout at
// the same size and orientation, with a legend from `flag_groups`. The mask is `measured`: the
// SPHEREx pipeline's own pixel flags.
import type { FlagGroup, ProvenanceEntry } from '@/app/api/types';
import { ProvenanceBadge } from './ProvenanceBadge';
import { FLAG_GROUP_LABEL } from './text';

export function FlagMaskImage({ url, onError }: { url: string; onError: () => void }) {
  return (
    <img
      key={url}
      src={url}
      // Decorative here: the legend under the viewer says what the colours mean.
      alt=""
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ imageRendering: 'pixelated' }}
      draggable={false}
      onError={onError}
      data-testid="flag-mask"
    />
  );
}

const rgbaCss = ([r, g, b, a]: FlagGroup['rgba']) =>
  `rgb(${r} ${g} ${b} / ${(a / 255).toFixed(3)})`;

export function FlagLegend({
  groups,
  provenance,
  fixture,
  failed,
}: {
  groups: readonly FlagGroup[];
  provenance: ProvenanceEntry;
  fixture: boolean;
  failed: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 text-sm text-neutral-300" data-testid="flag-legend">
      <p className="flex flex-wrap items-center gap-1.5">
        <span>Flagged pixels (detector flags)</span>
        <ProvenanceBadge entry={provenance} fixture={fixture} />
      </p>
      {failed && (
        <p className="text-amber-200" data-testid="flag-mask-failed">
          The flag mask for this frame could not be loaded.
        </p>
      )}
      <ul role="list" className="flex flex-col gap-0.5">
        {groups.map((g) => (
          <li key={g.group} className="flex list-none items-center gap-2">
            <span
              className="inline-block size-3.5 shrink-0 rounded-sm border border-neutral-500"
              style={{ background: rgbaCss(g.rgba) }}
              aria-hidden="true"
            />
            <span>
              {FLAG_GROUP_LABEL[g.group]}
              {g.names.length > 0 && (
                <span className="text-neutral-400"> ({g.names.join(', ')})</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

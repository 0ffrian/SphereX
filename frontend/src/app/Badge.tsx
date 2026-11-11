// D-02 provenance badge for SPHEREx data shown in the flipbook and spectrum. Synthetic fixture
// data never wears the Measured badge, even though the fixture reply says `tag: 'measured'`.
import { useState } from 'react';
import type { Tag } from '@/contract';
import { badgeForTag } from '@/viewer/honesty';

export function DataBadge({ fixture }: { fixture: boolean }) {
  if (fixture) {
    return (
      <span
        className="rounded border border-amber-400 px-1.5 py-0.5 text-xs font-medium text-amber-300"
        title="Synthetic fixture data for development, not a SPHEREx measurement"
        data-testid="badge"
      >
        Fixture
      </span>
    );
  }
  return (
    <span
      className="rounded border border-emerald-400 px-1.5 py-0.5 text-xs font-medium text-emerald-300"
      title="Measured by SPHEREx"
      data-testid="badge"
    >
      Measured
    </span>
  );
}

/**
 * D-02 Estimated badge for `derived`, `model_dependent` and `inferred_from_analog` values. The
 * tooltip states the formula, assumption or analog.
 */
export function EstimatedBadge({ tooltip }: { tooltip: string }) {
  // A `title` tooltip opens only on mouse hover, so the badge is a button: a tap or Enter shows
  // the formula as visible text next to it (WCAG 2.1.1, 1.4.13), Escape or a second press hides it.
  const [open, setOpen] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <button
        type="button"
        className="cursor-help rounded border border-sky-400 px-1.5 py-0.5 text-xs font-medium text-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
        title={tooltip}
        // No aria-expanded: screen readers already hear the formula in the name, and the note
        // it opens is visual only.
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        data-testid="badge-estimated"
      >
        Estimated
        {/* The tooltip is not read by screen readers, so the formula is also in the name. */}
        <span className="sr-only" data-testid="badge-estimated-formula">
          : {tooltip}
        </span>
      </button>
      {open && (
        // Already in the button's name, so hidden from screen readers to avoid reading it twice.
        <span
          className="text-xs text-sky-200"
          aria-hidden="true"
          data-testid="badge-estimated-note"
        >
          {tooltip}
        </span>
      )}
    </span>
  );
}

/** What each D-02 badge means, in plain words (the tooltip when a layer gives none). */
const BADGE_MEANING = {
  Measured: 'Measured: taken straight from observations.',
  Estimated: 'Estimated: worked out from data with a stated method or assumption.',
  Default: 'Default: the artist’s choice, not data.',
} as const;

/**
 * D-02 badge for any provenance tag, as used in the 3D viewer legend: `measured` is Measured,
 * the three model tags are Estimated (the tooltip states the formula, assumption or analog), and
 * `artistic` is Default. The text is visible, so colour is never the only cue.
 *
 * - `srText`: also put the tooltip in the text for screen readers, which do not read `title`.
 * - `fixture`: synthetic data never wears the Measured badge (A11, Q-32); it reads "Fixture".
 */
export function ProvenanceBadge({
  tag,
  tooltip,
  srText = false,
  fixture = false,
  variant = 'outline',
}: {
  tag: Tag;
  tooltip?: string;
  srText?: boolean;
  fixture?: boolean;
  /** 'tag': the design-language tag (11px uppercase, --s3 fill, coloured dot). */
  variant?: 'outline' | 'tag';
}) {
  const name = badgeForTag(tag);
  if (fixture && name === 'Measured') {
    return (
      <span
        className="rounded border border-amber-400 px-1.5 py-0.5 text-xs font-medium text-amber-300"
        title="Synthetic fixture data for development, not a SPHEREx measurement"
        data-testid="provenance-badge"
        data-tag={tag}
      >
        Fixture
      </span>
    );
  }
  const style =
    name === 'Measured'
      ? 'border-emerald-400 text-emerald-300'
      : name === 'Estimated'
        ? 'border-sky-400 text-sky-300'
        : 'border-neutral-400 text-neutral-300';
  if (variant === 'tag') {
    const dot = name === 'Measured' ? 'var(--p-meas)' : name === 'Estimated' ? 'var(--p-phys)' : 'var(--p-asm)';
    return (
      <span
        className="sx-tagbadge"
        style={{ ['--dot' as string]: dot }}
        title={tooltip ?? BADGE_MEANING[name]}
        data-testid="provenance-badge"
        data-tag={tag}
      >
        {name}
        {srText && tooltip && <span className="sr-only">: {tooltip}</span>}
      </span>
    );
  }
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-xs font-medium ${style}`}
      title={tooltip ?? BADGE_MEANING[name]}
      data-testid="provenance-badge"
      data-tag={tag}
    >
      {name}
      {srText && tooltip && <span className="sr-only">: {tooltip}</span>}
    </span>
  );
}

// D-02 provenance badges. Every badge is the D-38 tag (issue #174): 11px uppercase on `--s3`, with
// a 6px dot in its provenance colour, never a coloured outline. Synthetic fixture data never wears
// the Measured badge, even though the fixture reply says `tag: 'measured'`.
import { useState } from 'react';
import type { Tag } from '@/contract';
import { badgeForTag } from '@/viewer/honesty';

const FIXTURE_TITLE = 'Synthetic fixture data for development, not a SPHEREx measurement';
const FIXTURE_DOT = 'var(--color-warn)';

export function DataBadge({ fixture }: { fixture: boolean }) {
  return (
    <span
      className="sx-tagbadge"
      style={{ ['--dot' as string]: fixture ? FIXTURE_DOT : 'var(--p-meas)' }}
      title={fixture ? FIXTURE_TITLE : 'Measured by SPHEREx'}
      data-testid="badge"
    >
      {fixture ? 'Fixture' : 'Measured'}
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
        className="sx-tagbadge cursor-help focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        style={{ ['--dot' as string]: 'var(--p-phys)' }}
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
        <span className="text-xs text-muted" aria-hidden="true" data-testid="badge-estimated-note">
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

const BADGE_DOT = {
  Measured: 'var(--p-meas)',
  Estimated: 'var(--p-phys)',
  Default: 'var(--p-asm)',
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
}: {
  tag: Tag;
  tooltip?: string;
  srText?: boolean;
  fixture?: boolean;
}) {
  const name = badgeForTag(tag);
  if (fixture && name === 'Measured') {
    return (
      <span
        className="sx-tagbadge"
        style={{ ['--dot' as string]: FIXTURE_DOT }}
        title={FIXTURE_TITLE}
        data-testid="provenance-badge"
        data-tag={tag}
      >
        Fixture
      </span>
    );
  }
  return (
    <span
      className="sx-tagbadge"
      style={{ ['--dot' as string]: BADGE_DOT[name] }}
      title={tooltip ?? BADGE_MEANING[name]}
      data-testid="provenance-badge"
      data-tag={tag}
    >
      {name}
      {srText && tooltip && <span className="sr-only">: {tooltip}</span>}
    </span>
  );
}

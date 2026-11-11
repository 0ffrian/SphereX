// Feature card (A21.5; Q-172, built ahead for Area on issue #96's instruction, Q-406): a tool's own
// card in the object card's slot (top centre, min(340px, 100% − 24px), z 25). A `section` named by
// its h2; × only (Minimise is P9). The heading takes focus when the card opens (R9). No live region
// (red-team M10): what changes inside it is announced through the shell's announcer, and a blink
// tick is never read out.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { invalidateSkySafeRect } from '@/app/sky/safeRect';
import { Icon } from './icons';

export function FeatureCard({
  title,
  subtitle,
  onClose,
  closeLabel,
  testId,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose(): void;
  /** Accessible name of ×; defaults to "Close <title>". */
  closeLabel?: string;
  testId: string;
  children?: ReactNode;
}) {
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  // The card covers part of the sky: the safe rectangle (labels, fly-to) follows its size.
  useEffect(() => {
    invalidateSkySafeRect();
    const el = cardRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return invalidateSkySafeRect;
    const ro = new ResizeObserver(() => invalidateSkySafeRect());
    ro.observe(el);
    return () => {
      ro.disconnect();
      invalidateSkySafeRect();
    };
  }, []);

  return (
    <div className="sx-island-wrap sx-feature-card" data-feature-card="">
      <section className="sx-island" aria-labelledby={titleId} data-testid={testId} ref={cardRef}>
        <header className="sx-island-head">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} ref={headingRef} tabIndex={-1} data-testid={`${testId}-title`}>
              {title}
            </h2>
            {subtitle !== undefined && <p data-testid={`${testId}-subtitle`}>{subtitle}</p>}
          </div>
          <button
            type="button"
            className="sx-panel-x"
            aria-label={closeLabel ?? `Close ${title}`}
            title="Close"
            onClick={onClose}
            data-testid={`${testId}-close`}
          >
            <Icon name="close" className="size-4" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

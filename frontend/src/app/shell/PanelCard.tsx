// Floating panel card (mock-up "Flipbook — Barnard's Star" island card): a titled, closable,
// non-modal region over the sky. Escape (from inside the card) closes it and returns focus to the
// tool button that opens it. On phone width it is a bottom sheet (index.css).
import { useId, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { Icon, type IconName } from './icons';

export function PanelCard({
  title,
  subtitle,
  icon,
  wide = false,
  onClose,
  returnFocusTo,
  bodyRef,
  testId,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  icon: IconName;
  wide?: boolean;
  onClose(): void;
  /** CSS selector of the element that gets focus after Escape or the close button. */
  returnFocusTo: string;
  bodyRef?: Ref<HTMLDivElement>;
  testId: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const close = () => {
    onClose();
    // After React has removed the card.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(returnFocusTo)?.focus());
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    close();
  };
  return (
    <section
      aria-labelledby={titleId}
      className={`sx-panel ${wide ? 'sx-panel-wide' : ''}`}
      onKeyDown={onKeyDown}
      data-testid={testId}
    >
      <header className="sx-panel-head">
        <span
          className="grid size-9 flex-none place-items-center rounded-xl bg-sx-muted text-sx-green"
          aria-hidden="true"
        >
          <Icon name={icon} />
        </span>
        <div className="min-w-0">
          <h2 id={titleId}>{title}</h2>
          {subtitle && (
            // A long name is cut with an ellipsis; the tooltip has it in full.
            <p className="truncate" title={typeof subtitle === 'string' ? subtitle : undefined}>
              {subtitle}
            </p>
          )}
        </div>
        <button
          type="button"
          className="sx-panel-x"
          aria-label={`Close ${title}`}
          title="Close (Esc)"
          onClick={close}
        >
          <Icon name="close" className="size-4" />
        </button>
      </header>
      <div className="sx-panel-body" ref={bodyRef}>
        {children}
      </div>
    </section>
  );
}

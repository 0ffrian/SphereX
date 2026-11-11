// Floating panel card (mock-up "Flipbook — Barnard's Star" island card): a titled, closable,
// non-modal region over the sky. Escape (from inside the card) closes it and returns focus to the
// tool button that opens it. On phone width it is a bottom sheet (index.css).
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { Icon, type IconName } from './icons';

export function PanelCard({
  title,
  subtitle,
  icon,
  wide = false,
  onClose,
  returnFocusTo,
  bodyRef,
  rootRef,
  pending = false,
  bare = false,
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
  rootRef?: Ref<HTMLElement>;
  /** The island is still on its way here (#66): the card is laid out, but not shown yet. */
  pending?: boolean;
  /**
   * No header strip and no body padding: the content starts at the card's top edge and draws its
   * own name and close button (the Flipbook's picture, with tabs over it). `children` then gets
   * the close function (it returns focus to the tool button).
   */
  bare?: boolean;
  testId: string;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const rootEl = useRef<HTMLElement | null>(null);
  // Focus lost to <body> (the button that started the search, such as Try again, was unmounted
  // while the island thought): bring it to the card's title once the card can take it (R9, WCAG
  // 2.4.3). Focus anywhere else, say the search box, is left alone.
  useEffect(() => {
    if (pending) return;
    const a = document.activeElement;
    if (!a || a === document.body) (bare ? rootEl.current : titleRef.current)?.focus({ preventScroll: true });
  }, [pending, bare]);
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
      aria-labelledby={bare ? undefined : titleId}
      aria-label={bare ? `${title}${typeof subtitle === 'string' ? `: ${subtitle}` : ''}` : undefined}
      tabIndex={bare ? -1 : undefined}
      ref={(el) => {
        rootEl.current = el;
        if (typeof rootRef === 'function') rootRef(el);
        else if (rootRef) (rootRef as { current: HTMLElement | null }).current = el;
      }}
      className={`sx-panel ${wide ? 'sx-panel-wide' : ''}`}
      data-bare={bare ? '' : undefined}
      onKeyDown={onKeyDown}
      data-island={pending ? 'pending' : undefined}
      // Laid out, so the island knows its box, but transparent and out of reach until it arrives.
      inert={pending || undefined}
      data-testid={testId}
    >
      {!bare && (
      <header className="sx-panel-head">
        <span
          className="grid size-9 flex-none place-items-center rounded-xl bg-sx-muted text-sx-green"
          aria-hidden="true"
        >
          <Icon name={icon} />
        </span>
        <div className="min-w-0">
          <h2 id={titleId} ref={titleRef} tabIndex={-1}>
            {title}
          </h2>
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
      )}
      <div className="sx-panel-body" ref={bodyRef}>
        {typeof children === 'function' ? children(close) : children}
      </div>
    </section>
  );
}

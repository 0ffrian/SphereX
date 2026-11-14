// Floating panel card (mock-up "Flipbook — Barnard's Star" island card): a titled, closable,
// non-modal region over the sky. Escape (from inside the card) closes it and returns focus to the
// tool button that opens it. On phone width it is a bottom sheet (index.css).
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { useIslandStore } from '@/app/island/islandStore';
import { Icon, type IconName } from './icons';
import { BackArrow } from './BackArrow';

/** Hands the element to a function or object ref (kept out of the component: a ref's owner is the caller). */
function assignRef(ref: Ref<HTMLElement> | undefined, el: HTMLElement | null) {
  if (typeof ref === 'function') ref(el);
  else if (ref) (ref as { current: HTMLElement | null }).current = el;
}

export function PanelCard({
  title,
  subtitle,
  icon,
  wide = false,
  onClose,
  onMinimise,
  returnFocusTo,
  bodyRef,
  rootRef,
  pending = false,
  bare = false,
  testId,
  back,
  wrapSubtitle = false,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  /** The header's icon on its tile; none for the live area card (no icon tiles, issue #144). */
  icon?: IconName;
  wide?: boolean;
  onClose(): void;
  /** Shows a minimise button beside close: the card folds into the island's pill. */
  onMinimise?: () => void;
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
  /**
   * A ← before the title that steps back one level (issue #173); Escape inside the card does the
   * same, and × still closes everything.
   */
  back?: { label: string; go(): void } | null;
  /** The subtitle wraps to two lines instead of being cut (a sentence, not a name). */
  wrapSubtitle?: boolean;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  // The area cards (Known objects, Discovery) are travelled to by the island like the object panel:
  // laid out and measured at once, shown once it has arrived (AreaCard reports the box).
  const islandPending = useIslandStore((s) => testId === 'area-card' && s.travels && !s.arrived);
  pending = pending || islandPending;
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const rootEl = useRef<HTMLElement | null>(null);
  // Focus lost to <body> (the button that started the search, such as Try again, was unmounted
  // while the island thought): bring it to the card's title once the card can take it (R9, WCAG
  // 2.4.3). Focus anywhere else, say the search box, is left alone.
  useEffect(() => {
    if (pending) return;
    const a = document.activeElement;
    if (a && a !== document.body) return;
    // A21.5: restoring a minimised card (its pill unmounts, focus falls to <body>) focuses its
    // heading. A bare card draws its own heading; it takes focus when it is focusable (tabIndex -1).
    const heading = bare ? rootEl.current?.querySelector<HTMLElement>('h2[tabindex]') : titleRef.current;
    (heading ?? rootEl.current)?.focus({ preventScroll: true });
  }, [pending, bare]);
  const close = () => {
    onClose();
    // After React has removed the card.
    // The dock no longer has a button for every card (Flipbook, Spectrum): when the one asked for is
    // not there, focus goes to the sky itself, never lost to <body> (WCAG 2.4.3).
    requestAnimationFrame(() =>
      (
        document.querySelector<HTMLElement>(returnFocusTo) ??
        document.querySelector<HTMLElement>('[data-testid="sky-canvas"]')
      )?.focus(),
    );
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    if (back) back.go();
    else close();
  };
  return (
    <section
      aria-labelledby={bare ? undefined : titleId}
      aria-label={bare ? `${title}${typeof subtitle === 'string' ? `: ${subtitle}` : ''}` : undefined}
      tabIndex={bare ? -1 : undefined}
      ref={(el) => {
        rootEl.current = el;
        assignRef(rootRef, el);
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
        {back && (
          <button
            type="button"
            className="sx-panel-x sx-panel-back"
            aria-label={back.label}
            title={`${back.label} (Esc)`}
            onClick={back.go}
            data-testid="area-back"
          >
            <BackArrow />
          </button>
        )}
        {icon && (
          <span
            className="grid size-9 flex-none place-items-center rounded-xl bg-sx-muted text-sx-green"
            aria-hidden="true"
          >
            <Icon name={icon} />
          </span>
        )}
        <div className="min-w-0">
          <h2 id={titleId} ref={titleRef} tabIndex={-1}>
            {title}
          </h2>
          {subtitle && (
            // A long name is cut with an ellipsis; the tooltip has it in full.
            <p
              className={wrapSubtitle ? 'line-clamp-2' : 'truncate'}
              title={typeof subtitle === 'string' ? subtitle : undefined}
            >
              {subtitle}
            </p>
          )}
        </div>
        {onMinimise && (
          <button
            type="button"
            className="sx-panel-x"
            aria-label={`Minimise ${title}`}
            title="Minimise"
            onClick={onMinimise}
            data-testid="area-min"
          >
            <Icon name="minus" className="size-4" />
          </button>
        )}
        <button
          type="button"
          className="sx-panel-x"
          aria-label={`Close ${title}`}
          title="Close (Esc)"
          onClick={close}
        >
          <Icon name="x" className="size-4" />
        </button>
      </header>
      )}
      <div className="sx-panel-body" ref={bodyRef}>
        {typeof children === 'function' ? children(close) : children}
      </div>
    </section>
  );
}

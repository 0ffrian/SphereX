// The sky's safe rectangle (A21.2; Q-174, built ahead for Area on issue #96's instruction, Q-406):
// the part of the sky pane not covered by the floating header, rail and bars (the `--sx-in-*`
// insets, 0 on a phone), the credit (`--sx-credit-h`) or an open feature card. Labels are clamped
// to it and `skyFlyTo` centres targets in it. Pane-local CSS px, the units of raDecToScreen.
//
// The DOM read is cached; anything that moves the edges calls invalidateSkySafeRect() (the pane's
// and the card's ResizeObservers, a window resize), so a render listener never forces a layout.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SafeRectInput {
  width: number;
  height: number;
  insets: { top: number; right: number; bottom: number; left: number };
  creditH: number;
  /** The open feature card's box, pane-local; null when none is open. */
  card: Rect | null;
}

const finite = (v: number) => (Number.isFinite(v) ? v : 0);

/** Pure part: insets and credit off the pane, then the largest free side of the card. */
export function computeSafeRect(i: SafeRectInput): Rect {
  const left = Math.max(0, finite(i.insets.left));
  const top = Math.max(0, finite(i.insets.top));
  const right = Math.max(left, finite(i.width) - Math.max(0, finite(i.insets.right)));
  const bottom = Math.max(
    top,
    finite(i.height) - Math.max(0, finite(i.insets.bottom)) - Math.max(0, finite(i.creditH)),
  );
  const base: Rect = { x: left, y: top, w: right - left, h: bottom - top };
  const c = i.card;
  if (!c || c.w <= 0 || c.h <= 0) return base;
  // The card overlaps the base rectangle? Then keep the largest of below, left of or right of it.
  const cx0 = c.x;
  const cx1 = c.x + c.w;
  const cy1 = c.y + c.h;
  if (cx1 <= base.x || cx0 >= base.x + base.w || cy1 <= base.y || c.y >= base.y + base.h) {
    return base;
  }
  const below: Rect = { x: base.x, y: cy1, w: base.w, h: base.y + base.h - cy1 };
  const leftOf: Rect = { x: base.x, y: base.y, w: cx0 - base.x, h: base.h };
  const rightOf: Rect = { x: cx1, y: base.y, w: base.x + base.w - cx1, h: base.h };
  let best = below;
  for (const r of [leftOf, rightOf]) if (r.w * r.h > best.w * best.h) best = r;
  return best.w > 0 && best.h > 0 ? best : base;
}

let cache: Rect | null = null;

export function invalidateSkySafeRect(): void {
  cache = null;
}

const px = (style: CSSStyleDeclaration, name: string) => {
  const v = Number.parseFloat(style.getPropertyValue(name));
  return Number.isFinite(v) ? v : 0;
};

/** The safe rectangle of the sky pane (cached until invalidated). */
export function skySafeRect(): Rect {
  if (cache) return cache;
  const pane = document.querySelector<HTMLElement>('[data-testid="sky-pane"]');
  if (!pane) return { x: 0, y: 0, w: 0, h: 0 };
  const box = pane.getBoundingClientRect();
  const style = getComputedStyle(pane);
  const cardEl = pane.querySelector<HTMLElement>('[data-feature-card] .sx-island');
  const cardBox = cardEl?.getBoundingClientRect();
  cache = computeSafeRect({
    width: box.width,
    height: box.height,
    insets: {
      top: px(style, '--sx-in-t'),
      right: px(style, '--sx-in-r'),
      bottom: px(style, '--sx-in-b'),
      left: px(style, '--sx-in-l'),
    },
    creditH: px(style, '--sx-credit-h'),
    card: cardBox
      ? {
          x: cardBox.left - box.left,
          y: cardBox.top - box.top,
          w: cardBox.width,
          h: cardBox.height,
        }
      : null,
  });
  return cache;
}

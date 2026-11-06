// D-20, R8.8: the on-screen pulse indicator, so an audience watching the laptop can see what the
// phone feels. Fed only by the `spherex:haptic` debug event, which fires for events that played.
// A large dot (decorative, aria-hidden) flashes with each event; a visible caption beside it names
// the last event and its provenance badge (D-02, R8.2), plus "Texture" or "Data" when the event
// says which. The caption is not a live region: haptics repeat what is already text or sound (R9).
// For every user (WCAG 2.3.1 margin): at most 3 flashes a second, and a steady glow, not flashes,
// while a pulse train plays. With prefers-reduced-motion a flash only fades (no scaling).
// The event detail is checked before use: anything on the page can dispatch this event.
import { useEffect, useRef, useState } from 'react';
import { TAGS, type HapticEvent } from '@/contract';
import { badgeForTag, type BadgeName } from '@/viewer/honesty';
import { HAPTIC_DEBUG_EVENT } from '../haptics';

export interface PulseIndicatorProps {
  /** Where the debug event is dispatched. Default `window`. */
  target?: EventTarget;
  className?: string;
}

/** At most this many flashes a second, for everyone (WCAG 2.3.1 allows 3). */
export const MAX_FLASHES_PER_S = 3;
/** @deprecated The cap now applies to everyone; use MAX_FLASHES_PER_S. */
export const REDUCED_MOTION_MAX_FLASHES_PER_S = MAX_FLASHES_PER_S;
/** A train's steady glow lasts at least this long after its last window. */
const MIN_GLOW_MS = 400;
const FLASH_MS = 250;
const REST_OPACITY = 0.3;

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * How the dot shows an event: one capped flash for a one-shot, a steady glow for a train (kept
 * until one period after the next expected pulse), nothing for `stop`.
 */
export function flashPlan(e: HapticEvent): { mode: 'flash' | 'glow' | 'none'; glowMs: number } {
  switch (e.kind) {
    case 'tick':
    case 'double':
    case 'heartbeat':
      return { mode: 'flash', glowMs: 0 };
    case 'pulseTrain': {
      const rate = e.rateHz && e.rateHz > 0 ? e.rateHz : 4;
      return { mode: 'glow', glowMs: Math.max(MIN_GLOW_MS, 1000 / rate + 100) };
    }
    case 'stop':
      return { mode: 'none', glowMs: 0 };
  }
}

const KIND_LABEL: Record<HapticEvent['kind'], string> = {
  tick: 'Tick',
  double: 'Double tick',
  heartbeat: 'Heartbeat',
  pulseTrain: 'Pulse train',
  stop: 'Stopped',
};

/** Whether a `spherex:haptic` detail is a well-formed HapticEvent (anything can dispatch one). */
export function isHapticEventDetail(d: unknown): d is HapticEvent {
  if (typeof d !== 'object' || d === null) return false;
  const e = d as Record<string, unknown>;
  return (
    typeof e.kind === 'string' &&
    Object.hasOwn(KIND_LABEL, e.kind) &&
    typeof e.tag === 'string' &&
    (TAGS as readonly string[]).includes(e.tag) &&
    typeof e.strength === 'number' &&
    Number.isFinite(e.strength) &&
    (e.rateHz === undefined || (typeof e.rateHz === 'number' && Number.isFinite(e.rateHz))) &&
    (e.channel === undefined || e.channel === 'texture' || e.channel === 'data')
  );
}

const BADGE_LABEL: Record<BadgeName, string> = {
  Measured: 'Measured',
  Estimated: 'Estimated',
  Default: 'Default (artist’s choice)',
};

const BADGE_STYLE: Record<BadgeName, string> = {
  Measured: 'border-emerald-400 text-emerald-300',
  Estimated: 'border-sky-400 text-sky-300',
  Default: 'border-neutral-400 text-neutral-300',
};

export interface PulseCaption {
  kind: string;
  badge: BadgeName | null;
  channel: 'Texture' | 'Data' | null;
}

/** The caption for an event: kind, provenance badge (none for `stop`) and channel when known. */
export function pulseCaption(e: HapticEvent): PulseCaption {
  return {
    kind: KIND_LABEL[e.kind],
    badge: e.kind === 'stop' ? null : badgeForTag(e.tag),
    channel: e.channel === 'texture' ? 'Texture' : e.channel === 'data' ? 'Data' : null,
  };
}

function sameCaption(a: PulseCaption | null, b: PulseCaption): boolean {
  return a !== null && a.kind === b.kind && a.badge === b.badge && a.channel === b.channel;
}

export function PulseIndicator({ target, className }: PulseIndicatorProps) {
  const dot = useRef<HTMLSpanElement>(null);
  const [caption, setCaption] = useState<PulseCaption | null>(null);

  useEffect(() => {
    const t = target ?? (typeof window !== 'undefined' ? window : undefined);
    if (!t) return;
    let running: Animation | null = null;
    let lastFlash = -Infinity;
    let glowTimer: ReturnType<typeof setTimeout> | null = null;
    const endGlow = () => {
      if (glowTimer !== null) clearTimeout(glowTimer);
      glowTimer = null;
      if (dot.current) dot.current.style.opacity = '';
    };

    const onHaptic = (ev: Event) => {
      const el = dot.current;
      const e: unknown = (ev as CustomEvent<unknown>).detail;
      if (!el || !isHapticEventDetail(e)) return;
      const next = pulseCaption(e);
      // Same caption → keep the old object, so React skips the render (up to 40 events/s).
      setCaption((prev) => (sameCaption(prev, next) ? prev : next));
      const plan = flashPlan(e);
      const peak = 0.5 + 0.5 * Math.min(1, Math.max(0, e.strength));
      if (plan.mode === 'none') {
        running?.cancel();
        running = null;
        endGlow();
        return;
      }
      if (plan.mode === 'glow') {
        running?.cancel();
        running = null;
        el.style.opacity = String(peak);
        if (glowTimer !== null) clearTimeout(glowTimer);
        glowTimer = setTimeout(endGlow, plan.glowMs);
        return;
      }
      const now = performance.now();
      if (now - lastFlash < 1000 / MAX_FLASHES_PER_S) return;
      lastFlash = now;
      endGlow();
      if (typeof el.animate !== 'function') return;
      running?.cancel();
      const keyframes: Keyframe[] = reducedMotion()
        ? [{ opacity: peak }, { opacity: REST_OPACITY }]
        : [
            { opacity: peak, transform: `scale(${1 + 0.3 * peak})` },
            { opacity: REST_OPACITY, transform: 'scale(1)' },
          ];
      running = el.animate(keyframes, { duration: FLASH_MS, iterations: 1, easing: 'ease-out' });
    };
    t.addEventListener(HAPTIC_DEBUG_EVENT, onHaptic);
    return () => {
      t.removeEventListener(HAPTIC_DEBUG_EVENT, onHaptic);
      running?.cancel();
      if (glowTimer !== null) clearTimeout(glowTimer);
    };
  }, [target]);

  return (
    <span className={className ?? 'inline-flex flex-wrap items-center gap-3'}>
      <span
        aria-hidden="true"
        className="inline-flex h-12 w-12 shrink-0 items-center justify-center"
      >
        <span
          ref={dot}
          className="block h-10 w-10 rounded-full border-2 border-sky-200 bg-sky-400 opacity-30"
          data-testid="pulse-dot"
        />
      </span>
      <span className="text-sm" data-testid="pulse-caption">
        {caption ? (
          <>
            {caption.kind}
            {caption.badge && (
              <>
                {' '}
                <span
                  className={`rounded border px-1.5 py-0.5 text-xs font-medium ${BADGE_STYLE[caption.badge]}`}
                >
                  {BADGE_LABEL[caption.badge]}
                </span>
              </>
            )}
            {caption.channel && <> · {caption.channel}</>}
          </>
        ) : (
          'No pulse yet'
        )}
      </span>
    </span>
  );
}

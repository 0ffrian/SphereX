// D-20, R8.8: the on-screen pulse indicator, so an audience watching the laptop can see what the
// phone feels. Fed only by the `spherex:haptic` debug event, which fires for events that played.
// A large dot (decorative, aria-hidden) flashes with each event; a visible caption beside it names
// the last event and its provenance badge (D-02, R8.2), plus "Texture" or "Data" when the event
// says which. The caption is not a live region: haptics repeat what is already text or sound (R9).
// With prefers-reduced-motion the dot only fades, at most 3 flashes a second, and glows steadily
// while a pulse train plays.
import { useEffect, useRef, useState } from 'react';
import type { HapticEvent } from '@/contract';
import { badgeForTag, type BadgeName } from '@/viewer/honesty';
import { HAPTIC_DEBUG_EVENT } from '../haptics';

export interface PulseIndicatorProps {
  /** Where the debug event is dispatched. Default `window`. */
  target?: EventTarget;
  className?: string;
}

/** Reduced motion: at most this many flashes a second. */
export const REDUCED_MOTION_MAX_FLASHES_PER_S = 3;
/** A train's steady glow fades this long after its last window. */
const TRAIN_GLOW_MS = 400;
const REST_OPACITY = 0.3;

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Flashes per event: one for a tick, two for double and heartbeat, the window's pulses for a train. */
export function flashPlan(e: HapticEvent): { count: number; periodMs: number } {
  switch (e.kind) {
    case 'tick':
      return { count: 1, periodMs: 120 };
    case 'double':
      return { count: 2, periodMs: 52 };
    case 'heartbeat':
      return { count: 2, periodMs: 140 };
    case 'pulseTrain': {
      const rate = e.rateHz && e.rateHz > 0 ? e.rateHz : 4;
      return { count: Math.max(1, Math.round(rate / 4)), periodMs: 1000 / rate };
    }
    case 'stop':
      return { count: 0, periodMs: 0 };
  }
}

const KIND_LABEL: Record<HapticEvent['kind'], string> = {
  tick: 'Tick',
  double: 'Double tick',
  heartbeat: 'Heartbeat',
  pulseTrain: 'Pulse train',
  stop: 'Stopped',
};

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
      const e = (ev as CustomEvent<HapticEvent>).detail;
      if (!el || !e) return;
      setCaption(pulseCaption(e));
      const { count, periodMs } = flashPlan(e);
      const peak = 0.5 + 0.5 * Math.min(1, Math.max(0, e.strength));
      if (count === 0) {
        running?.cancel();
        running = null;
        endGlow();
        return;
      }
      if (reducedMotion()) {
        if (e.kind === 'pulseTrain') {
          // A steady glow for the whole train instead of 2–20 flashes a second.
          running?.cancel();
          running = null;
          el.style.opacity = String(peak);
          if (glowTimer !== null) clearTimeout(glowTimer);
          glowTimer = setTimeout(endGlow, TRAIN_GLOW_MS);
          return;
        }
        const now = performance.now();
        if (now - lastFlash < 1000 / REDUCED_MOTION_MAX_FLASHES_PER_S) return;
        lastFlash = now;
        endGlow();
        if (typeof el.animate !== 'function') return;
        running?.cancel();
        running = el.animate([{ opacity: peak }, { opacity: REST_OPACITY }], {
          duration: 250,
          iterations: 1,
          easing: 'ease-out',
        });
        return;
      }
      if (typeof el.animate !== 'function') return;
      running?.cancel();
      running = el.animate(
        [
          { opacity: peak, transform: `scale(${1 + 0.3 * peak})` },
          { opacity: REST_OPACITY, transform: 'scale(1)' },
        ],
        { duration: Math.max(20, periodMs * 0.8), iterations: count, easing: 'ease-out' },
      );
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

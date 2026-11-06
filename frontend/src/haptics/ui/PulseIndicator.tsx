// D-20, R8.8: the on-screen pulse indicator, so an audience watching the laptop can see what the
// phone feels. Fed only by the `spherex:haptic` debug event, which fires for events that played.
// Decorative (aria-hidden): every haptic's information is also available as text or sound (R9).
// With prefers-reduced-motion it only changes opacity; otherwise it also scales.
import { useEffect, useRef } from 'react';
import type { HapticEvent } from '@/contract';
import { HAPTIC_DEBUG_EVENT } from '../haptics';

export interface PulseIndicatorProps {
  /** Where the debug event is dispatched. Default `window`. */
  target?: EventTarget;
  className?: string;
}

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

export function PulseIndicator({ target, className }: PulseIndicatorProps) {
  const dot = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const t = target ?? (typeof window !== 'undefined' ? window : undefined);
    if (!t) return;
    let running: Animation | null = null;
    const onHaptic = (ev: Event) => {
      const el = dot.current;
      const e = (ev as CustomEvent<HapticEvent>).detail;
      if (!el || !e) return;
      running?.cancel();
      running = null;
      const { count, periodMs } = flashPlan(e);
      if (count === 0 || typeof el.animate !== 'function') return;
      const peak = 0.35 + 0.65 * Math.min(1, Math.max(0, e.strength));
      const still = reducedMotion();
      const keyframes: Keyframe[] = still
        ? [{ opacity: peak }, { opacity: 0.15 }]
        : [
            { opacity: peak, transform: `scale(${1 + 0.6 * peak})` },
            { opacity: 0.15, transform: 'scale(1)' },
          ];
      running = el.animate(keyframes, {
        duration: Math.max(20, periodMs * 0.8),
        iterations: count,
        easing: 'ease-out',
      });
    };
    t.addEventListener(HAPTIC_DEBUG_EVENT, onHaptic);
    return () => {
      t.removeEventListener(HAPTIC_DEBUG_EVENT, onHaptic);
      running?.cancel();
    };
  }, [target]);

  return (
    <span
      aria-hidden="true"
      className={className ?? 'inline-flex h-6 w-6 items-center justify-center'}
    >
      <span ref={dot} className="block h-4 w-4 rounded-full bg-sky-400 opacity-15" />
    </span>
  );
}

// The frame-rate menu after the player (Moon, 12 Nov 2026): a square glass button with the current
// speed that opens a short menu of the flipbook's speeds (FPS_OPTIONS). It writes the store's `fps`,
// which the flipbook session and the area demo's player both read. The menu springs open in
// animate-ui's style (motion). Keyboard: Enter, Space or the arrows open it; the arrows move,
// Enter or Space choose, Escape closes and focus goes back to the button.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { FPS_OPTIONS, type Fps } from '@/app/flipbook/playback';
import { COMPOSITE_TRANSPORT_NOTE, effectiveColour, transportLocked } from '@/app/flipbook/colourMode';
import { useAppStore } from '@/state/store';
import { demoPlayerOn, useAreaStore } from './areaStore';
import { EXPLORE_SPRING } from '@/app/build/exploreMotion';

export function FrameRate() {
  const fps = useAppStore((s) => s.sky.fps);
  const setFps = useAppStore((s) => s.skySetFps);
  const colour = useAppStore((s) => s.sky.colour);
  const honesty = useAppStore((s) => s.honesty);
  const demo = useAreaStore((s) => demoPlayerOn(s));
  const locked = !demo && transportLocked(effectiveColour(colour, honesty));
  const reduced = useReducedMotion();
  const [wantOpen, setOpen] = useState(false);
  // A locked player (the colour composite) has no speed to change: the menu closes.
  const open = wantOpen && !locked;
  const [focusAt, setFocusAt] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const show = (at = FPS_OPTIONS.indexOf(fps)) => {
    setFocusAt(Math.max(0, at));
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  };
  const choose = (v: Fps) => {
    setFps(v);
    close(true);
  };

  useEffect(() => {
    if (open) itemRefs.current[focusAt]?.focus();
  }, [open, focusAt]);
  // A click anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) close(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (locked) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      show();
    }
  };
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = FPS_OPTIONS.length;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusAt((i) => (i + 1) % n);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusAt((i) => (i - 1 + n) % n);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setFocusAt(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setFocusAt(n - 1);
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  return (
    <div className="sx-fps" data-testid="frame-rate">
      <button
        ref={btnRef}
        type="button"
        className="sx-fps-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={locked ? `Frame rate, ${fps} frames a second. ${COMPOSITE_TRANSPORT_NOTE}` : `Frame rate, ${fps} frames a second`}
        title={locked ? COMPOSITE_TRANSPORT_NOTE : 'Frame rate'}
        // Focusable while locked, so the reason can be read (it is in the label and the title).
        aria-disabled={locked || undefined}
        onClick={() => {
          if (locked) return;
          if (open) close(false);
          else show();
        }}
        onKeyDown={onButtonKey}
        data-testid="frame-rate-button"
      >
        <b>{fps}</b>
        <span>fps</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label="Frame rate"
            className="sx-fps-menu"
            onKeyDown={onMenuKey}
            initial={reduced ? false : { opacity: 0, y: -6, scale: 0.94, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -4, scale: 0.96, filter: 'blur(4px)', transition: { duration: 0.15 } }}
            transition={EXPLORE_SPRING}
            data-testid="frame-rate-menu"
          >
            {FPS_OPTIONS.map((v, i) => (
              <button
                key={v}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={v === fps}
                tabIndex={i === focusAt ? 0 : -1}
                className="sx-fps-item"
                onClick={() => choose(v)}
                data-testid={`frame-rate-${v}`}
              >
                <span>{v} fps</span>
                {v === fps && (
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="sx-ico size-3.5">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// The Explore button's icon (Moon, 12 Nov 2026, Q-420): a compass whose needle swings on a spring
// when the close-up opens or closes, and wiggles on hover, in the style of animate-ui's animated
// icons. The geometry is lucide's `compass` (ISC). Decorative: the button's text names it.
import { motion, useReducedMotion } from 'motion/react';
import { EXPLORE_SPRING } from './exploreMotion';

export function ExploreIcon({ on, className = 'size-4' }: { on: boolean; className?: string }) {
  const reduced = useReducedMotion();
  // The needle turns half a turn when Explore is on.
  const base = on ? 180 : 0;
  return (
    <motion.svg
      viewBox="0 0 24 24"
      className={`sx-ico ${className}`}
      aria-hidden="true"
      initial={false}
      animate={on ? 'on' : 'off'}
      whileHover={reduced ? undefined : 'hover'}
      data-testid="explore-icon"
      data-on={on || undefined}
    >
      <circle cx="12" cy="12" r="10" />
      <motion.path
        d="M16.24 7.76l-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"
        style={{ originX: '50%', originY: '50%', transformBox: 'fill-box' }}
        variants={{
          off: { rotate: 0, transition: reduced ? { duration: 0 } : EXPLORE_SPRING },
          on: { rotate: 180, transition: reduced ? { duration: 0 } : EXPLORE_SPRING },
          hover: { rotate: [base, base - 25, base + 15, base - 8, base], transition: { duration: 0.6, ease: 'easeInOut' } },
        }}
      />
    </motion.svg>
  );
}

// The island's 3x3 grid loader (mock-up `GridLoader`): green dots with a glow, pulsing in time,
// stepping through a sequence of patterns. Decorative: the island's status line says the words.
// Reduced motion (R9, WCAG 2.3.3): the pattern is drawn lit and still, and does not step.
import { useEffect, useRef, useState } from 'react';
import { IDLE_LOOK, litCells, SPEEDS, type LoaderLook } from './gridLoader';

const GREEN = '#4ade80';
const EASE = 'cubic-bezier(0.645,0.045,0.355,1)';

export function GridLoader({
  look = IDLE_LOOK,
  size = 28,
  animate = true,
}: {
  look?: LoaderLook;
  size?: number;
  animate?: boolean;
}) {
  // The step restarts at 0 when the look changes (derived, not set in an effect).
  const [step, setStep] = useState({ look, idx: 0 });
  const idx = step.look === look ? step.idx : 0;
  const cells = useRef<(HTMLDivElement | null)[]>([]);
  const period = SPEEDS[look.speed];
  const stepping = animate && look.mode === 'sequence';

  useEffect(() => {
    if (!stepping) return;
    const id = setInterval(
      () => setStep((s) => ({ look, idx: (s.look === look ? s.idx : 0) + 1 })),
      period,
    );
    return () => clearInterval(id);
  }, [look, period, stepping]);

  const lit = litCells(look, idx);
  useEffect(() => {
    if (!animate) return;
    // No Web Animations API (jsdom): the dots are drawn lit and still.
    if (typeof cells.current[0]?.animate !== 'function') return;
    const anims = cells.current.flatMap((el, i) =>
      el && lit[i]
        ? [
            el.animate(
              [
                { opacity: 0.4, transform: 'scale(0.95)' },
                { opacity: 1, transform: 'scale(1)' },
                { opacity: 0.4, transform: 'scale(0.95)' },
              ],
              { duration: period, iterations: Infinity, easing: EASE },
            ),
          ]
        : [],
    );
    return () => anims.forEach((a) => a.cancel());
  }, [lit.join(''), period, animate]); // eslint-disable-line react-hooks/exhaustive-deps

  const gap = 1;
  const cell = (size - gap * 2) / 3;
  return (
    <div
      aria-hidden="true"
      className="sx-grid-loader"
      style={{
        width: size,
        height: size,
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap,
        filter: 'blur(1.4px)',
      }}
    >
      {lit.map((on, i) => (
        <div
          key={i}
          ref={(el) => {
            cells.current[i] = el;
          }}
          style={{
            width: cell,
            height: cell,
            ...(on
              ? {
                  background: GREEN,
                  borderRadius: '50%',
                  boxShadow: `0 0 ${cell * 0.24}px ${GREEN}, 0 0 ${cell * 0.48}px ${GREEN}40, 0 0 ${cell * 0.96}px ${GREEN}20`,
                }
              : null),
          }}
        />
      ))}
    </div>
  );
}

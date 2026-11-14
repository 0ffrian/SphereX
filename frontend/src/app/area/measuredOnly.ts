// Measured only (D-21, R5.3): the honesty toggle at its strictest. The scan surfaces (issue #170)
// then show what was measured only: track positions from the dots, never a verdict, a rate
// (derived), a known name or a predicted path (from the Horizons match, model_dependent).
import { useAppStore } from '@/state/store';
import { effectiveHonesty } from '@/viewer/honesty';

/** True while the honesty toggle is at Measured only. */
export function useMeasuredOnly(): boolean {
  return useAppStore((s) => effectiveHonesty(s.honesty) === 'measured');
}

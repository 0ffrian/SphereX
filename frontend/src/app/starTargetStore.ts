// Issue #71 stream X: where the left close-up looks on a star. The globe in the build pane sets it
// (click or arrow keys), the close-up reads it. null = the strongest spot group (the artifact's `m.best`).
import { create } from 'zustand';
import type { LatLon } from '@/engine/stars/starPick';

interface State {
  target: LatLon | null;
  pick(t: LatLon): void;
  home(): void;
  reset(): void;
}
export const useStarTarget = create<State>((set) => ({
  target: null,
  pick: (target) => set({ target }),
  home: () => set({ target: null }),
  reset: () => set({ target: null }),
}));

export const degrees = (r: number): string => `${Math.abs(Math.round((r * 180) / Math.PI))}°`;
export function placeText(p: LatLon | null): string {
  if (!p) return 'the strongest spot group';
  return `${degrees(p.lat)} ${p.lat >= 0 ? 'north' : 'south'}, ${degrees(p.lon)} ${p.lon >= 0 ? 'east' : 'west'}`;
}

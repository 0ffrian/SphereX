// Issue #71, D-37 (stream V3): the rock engine's view, shared between the build pane's globe stage
// (RockStage owns it) and the close-up pane (which draws the same body on its own canvas).
import { create } from 'zustand';
import type { RockView } from '@/engine/rocks/RockView';

interface RockState {
  view: RockView | null;
  set(view: RockView | null): void;
}

export const useRockStore = create<RockState>((set) => ({
  view: null,
  set: (view) => set({ view }),
}));

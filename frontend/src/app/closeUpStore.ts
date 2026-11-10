// Issue #71 stream H (Q-275): what the close-up pane (left half of the app, over the sky) needs from
// the 3D viewer in the build pane on the right. ViewerPanel publishes into it; the pane reads it.
import { create } from 'zustand';
import type { CloseUpInfo, ViewerApp } from '@/viewer/ViewerApp';
import type { RenderPlan } from '@/viewer/planTypes';

interface CloseUpState {
  viewer: ViewerApp | null;
  plan: RenderPlan | null;
  /** The object's type (`gas_giant`, `star`, ...), for the kind of close-up. */
  type: string | null;
  fixture: boolean;
  reducedMotion: boolean;
  info: CloseUpInfo | null;
  /** The user hid the pane with the toggle next to Feel (the mock-up has none: default shown). */
  hidden: boolean;
  publish(p: Partial<Pick<CloseUpState, 'viewer' | 'plan' | 'type' | 'fixture' | 'reducedMotion'>>): void;
  setInfo(info: CloseUpInfo | null): void;
  setHidden(hidden: boolean): void;
  reset(): void;
}

export const useCloseUpStore = create<CloseUpState>((set) => ({
  viewer: null,
  plan: null,
  type: null,
  fixture: false,
  reducedMotion: false,
  info: null,
  hidden: false,
  publish: (p) => set(p),
  setInfo: (info) => set({ info }),
  setHidden: (hidden) => set({ hidden }),
  reset: () => set({ viewer: null, plan: null, type: null, info: null }),
}));

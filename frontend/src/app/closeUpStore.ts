// Issue #71 stream H (Q-275): what the close-up pane (left half of the app, over the sky) needs from
// the 3D viewer in the build pane on the right. ViewerPanel publishes into it; the pane reads it.
import { create } from 'zustand';
import type { CloseUpInfo, ViewerApp } from '@/viewer/ViewerApp';
import type { RenderPlan } from '@/viewer/planTypes';
import type { StarFromCard } from '@/engine/stars/cardToStar';
import type { CardToWorldOk } from '@/engine/worlds/cardToWorld';

interface CloseUpState {
  viewer: ViewerApp | null;
  plan: RenderPlan | null;
  /** The object's type (`gas_giant`, `star`, ...), for the kind of close-up. */
  type: string | null;
  fixture: boolean;
  /** Issue #71 stream X (D-37): the star the prototype's engine draws, or null (the TSL path). */
  engineStar: StarFromCard | null;
  /** Issue #71 stream Y (D-37): the planet the prototype's world engine draws, or null (the old orbit view). */
  engineWorld: CardToWorldOk | null;
  reducedMotion: boolean;
  info: CloseUpInfo | null;
  /** The user hid the pane with the toggle next to Feel (the mock-up has none: default shown). */
  hidden: boolean;
  /**
   * Issue #71 stream U: the build is still running, so the close-up waits (the mock-up opens it when
   * the pane shifts to the right half, `setShifted`). Not the user's choice: `hidden` stays theirs.
   */
  held: boolean;
  publish(
    p: Partial<
      Pick<
        CloseUpState,
        'viewer' | 'plan' | 'type' | 'fixture' | 'reducedMotion' | 'engineStar' | 'engineWorld'
      >
    >,
  ): void;
  setInfo(info: CloseUpInfo | null): void;
  setHidden(hidden: boolean): void;
  setHeld(held: boolean): void;
  reset(): void;
}

export const useCloseUpStore = create<CloseUpState>((set) => ({
  viewer: null,
  plan: null,
  type: null,
  fixture: false,
  engineStar: null,
  engineWorld: null,
  reducedMotion: false,
  info: null,
  hidden: false,
  held: false,
  publish: (p) => set(p),
  setInfo: (info) => set({ info }),
  setHidden: (hidden) => set({ hidden }),
  setHeld: (held) => set({ held }),
  reset: () =>
    set({
      viewer: null,
      plan: null,
      type: null,
      engineStar: null,
      engineWorld: null,
      info: null,
      held: false,
    }),
}));

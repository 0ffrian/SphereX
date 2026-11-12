// The build pane's live moulding signals for the MouldAnimation: the per-step progress the strip
// shows (written every frame by ViewerPanel, read by the animation's own frame loop, never by a
// React render) and whether a world engine is still forming its body (WorldEngineStage).
import { create } from 'zustand';

export interface MouldLiveState {
  /** Step progress 0..1 per step, as the strip shows it. */
  progress: readonly number[];
  /** A world engine is in its spin-up: its canvas is covered until it has settled. */
  forming: boolean;
  /** Set while the animation drives the strip itself (a ready body's short show or the finish). */
  override: readonly number[] | null;
  /** The build now running (bumped by useMould at each start); a show remembers the one it covered. */
  buildSeq: number;
  startBuild(): number;
  /**
   * The build whose mould show has played its last step (Colour) and started to fade (Q-451). The
   * show is the one clock for the strip: that build ends on it instead of staging on afterwards
   * (which sent the strip back from Colour to Spots). Never a later build.
   */
  shownFor: number;
  markShown(build: number): void;
  setOverride(p: readonly number[] | null): void;
  setProgress(p: readonly number[]): void;
  setForming(f: boolean): void;
}

export const useMouldLive = create<MouldLiveState>((set) => ({
  progress: [],
  forming: false,
  override: null,
  buildSeq: 0,
  startBuild: () => {
    let n = 0;
    set((s) => {
      n = s.buildSeq + 1;
      return { buildSeq: n };
    });
    return n;
  },
  shownFor: -1,
  markShown: (build) => set({ shownFor: build }),
  setOverride: (override) => set({ override }),
  setProgress: (progress) => set({ progress }),
  setForming: (forming) => set((s) => (s.forming === forming ? s : { forming })),
}));

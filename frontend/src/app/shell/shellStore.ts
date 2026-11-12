// Shell UI state: which tool of the left rail is open, the selected body's card (issue #60) and
// the build pane (issue #60). 'sky' is the sky view alone (no panel); 'flipbook' and 'spectrum'
// open the object panel at that section; 'area' is the Discovery tool (draw an area on the sky); 'viewer' is the build pane opened from the rail.
import { create } from 'zustand';

export type ToolId = 'sky' | 'flipbook' | 'spectrum' | 'viewer' | 'area';

/** The 3D body of the selected object, loaded from `/card` and `/render-params` (D-16). */
export type BodyLoad =
  | { status: 'idle' }
  | { status: 'loading'; id: string }
  /** `prebuilt`: the backend answered with a saved asset (a pre-built or earlier build). */
  | { status: 'ready'; id: string; prebuilt?: boolean }
  /**
   * No 3D model: the backend has no card or render params for this object (nothing invented).
   * `transient` is true for a timeout or a network or server error (asking again may work), false
   * for a real "not found" or an unusable reply.
   */
  | { status: 'none'; id: string; reason: string; transient: boolean };

export interface BuildState {
  open: boolean;
  /** Mould the body step by step (Build it), or show it built at once (the rail's 3D viewer). */
  animate: boolean;
  /** Bumped by each open, Replay and New seed: the pane starts the build again. */
  seq: number;
  /** Seed offset chosen with "New seed" (0 = the seed in the render params). */
  seedOffset: number;
}

export interface ShellState {
  tool: ToolId;
  /** Bumped when a tool is chosen again, so the panel can scroll to its section once more. */
  focusSeq: number;
  body: BodyLoad;
  build: BuildState;
  /**
   * The user asked for the card (right-click or long press on a marker or the brackets, issue #64).
   * Nothing has a card unless asked: a left click picks or opens the object in the flipbook, and
   * opening the object panel drops the request, so closing the panel shows the sky, not the card.
   */
  cardRequested: boolean;
  /**
   * The object panel (the Flipbook card) is minimised into the island's pill (Moon, 12 Nov 2026):
   * a click on the pill opens it again. Any other way of opening or leaving a panel clears it.
   */
  minimised: boolean;
  setMinimised(on: boolean): void;
  setTool(tool: ToolId): void;
  closePanel(): void;
  setBody(body: BodyLoad): void;
  /** Show the selected object's or position's card (leaves the object panel for the sky). */
  requestCard(): void;
  cancelCard(): void;
  openBuild(animate: boolean): void;
  replayBuild(): void;
  newSeed(): void;
  closeBuild(): void;
}

export const useShellStore = create<ShellState>()((set) => ({
  tool: 'sky',
  focusSeq: 0,
  body: { status: 'idle' },
  build: { open: false, animate: false, seq: 0, seedOffset: 0 },
  cardRequested: false,
  minimised: false,
  setMinimised: (minimised) => set((s) => (s.minimised === minimised ? s : { minimised })),
  setTool: (tool) =>
    set((s) => ({
      tool,
      minimised: false,
      focusSeq: s.focusSeq + 1,
      cardRequested: tool === 'flipbook' || tool === 'spectrum' ? false : s.cardRequested,
      // The rail's 3D viewer is the build pane, with the body already built (no animation).
      build:
        tool === 'viewer'
          ? // The rail shows the normal render of the card's own seed, not a "New seed" one.
            { ...s.build, open: true, animate: false, seq: s.build.seq + 1, seedOffset: 0 }
          : s.build.open
            ? { ...s.build, open: false, seedOffset: 0 }
            : s.build,
    })),
  closePanel: () => set({ tool: 'sky', minimised: false }),
  setBody: (body) => set({ body }),
  requestCard: () =>
    set((s) => ({
      cardRequested: true,
      minimised: false,
      // The object panel steps aside so the card shows; an open build pane keeps the view.
      tool: s.build.open ? s.tool : 'sky',
    })),
  cancelCard: () => set({ cardRequested: false }),
  openBuild: (animate) =>
    set((s) => ({
      // The object panel steps aside: the sky takes the left half and the pane the right.
      tool: animate ? 'sky' : 'viewer',
      minimised: false,
      build: { open: true, animate, seq: s.build.seq + 1, seedOffset: 0 },
    })),
  replayBuild: () => set((s) => ({ build: { ...s.build, animate: true, seq: s.build.seq + 1 } })),
  newSeed: () =>
    set((s) => ({
      build: {
        ...s.build,
        animate: true,
        seq: s.build.seq + 1,
        seedOffset: s.build.seedOffset + 1,
      },
    })),
  closeBuild: () =>
    set((s) => ({
      tool: s.tool === 'viewer' ? 'sky' : s.tool,
      build: { ...s.build, open: false, seedOffset: 0 },
    })),
}));

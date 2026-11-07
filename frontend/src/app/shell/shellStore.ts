// Shell UI state: which tool of the left rail is open. 'sky' is the sky view alone (no panel);
// 'flipbook' and 'spectrum' open the object panel at that section; 'viewer' opens the 3D viewer.
import { create } from 'zustand';

export type ToolId = 'sky' | 'flipbook' | 'spectrum' | 'viewer';

export interface ShellState {
  tool: ToolId;
  /** Bumped when a tool is chosen again, so the panel can scroll to its section once more. */
  focusSeq: number;
  setTool(tool: ToolId): void;
  closePanel(): void;
}

export const useShellStore = create<ShellState>()((set) => ({
  tool: 'sky',
  focusSeq: 0,
  setTool: (tool) => set((s) => ({ tool, focusSeq: s.focusSeq + 1 })),
  closePanel: () => set({ tool: 'sky' }),
}));

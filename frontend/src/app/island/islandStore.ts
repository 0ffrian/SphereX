// Where the object panel is, for the island that grows into it (#66). The panel reports its box
// (in the bezel's coordinates) while it is mounted; the island moves there, and when it has
// arrived the panel's content fades in over it. No panel: no box, and the island goes back up.
import { create } from 'zustand';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface IslandState {
  panelBox: Box | null;
  /** The island has reached the panel's box: the panel shows. */
  arrived: boolean;
  /**
   * The island was thinking before this panel opened (data was pulled), so it travels there. A
   * panel opened from the rail with nothing loading shows at once and the island stays up.
   */
  travels: boolean;
  setPanelBox(box: Box | null): void;
  setArrived(arrived: boolean): void;
  setTravels(travels: boolean): void;
}

export const useIslandStore = create<IslandState>()((set) => ({
  panelBox: null,
  arrived: false,
  travels: false,
  setPanelBox: (panelBox) =>
    set((s) => {
      // `travels` is not touched here: React's StrictMode unmounts and remounts the panel once in
      // development, and the flag must outlive that. The island resets it (see Island.tsx).
      if (panelBox === null)
        return s.panelBox === null && !s.arrived ? s : { panelBox, arrived: false };
      const o = s.panelBox;
      const same =
        o !== null &&
        o.left === panelBox.left &&
        o.top === panelBox.top &&
        o.width === panelBox.width &&
        o.height === panelBox.height;
      return same ? s : { panelBox };
    }),
  setArrived: (arrived) => set({ arrived }),
  setTravels: (travels) => set((s) => (s.travels === travels ? s : { travels })),
}));

/** The box of `el` in the coordinates of its bezel, or null when it is not in one. */
export function boxInBezel(el: HTMLElement): Box | null {
  const bezel = el.closest<HTMLElement>('.sx-bezel');
  if (!bezel) return null;
  const a = el.getBoundingClientRect();
  const b = bezel.getBoundingClientRect();
  return {
    // Minus the bezel's border: absolute children are placed from its padding edge.
    left: a.left - b.left - bezel.clientLeft,
    top: a.top - b.top - bezel.clientTop,
    width: a.width,
    height: a.height,
  };
}

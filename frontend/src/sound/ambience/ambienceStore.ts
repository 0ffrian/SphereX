// R13.10: the ambience UI model for the Sound chip and the "What you hear" panel. Written by the loop only on a state
// change or a caption change (at most every CAPTION_MIN_S), never per tick.
import { create } from 'zustand';
import { IDLE_UI, type AmbienceUi } from './ambienceLoop';

interface AmbienceStoreState {
  ui: AmbienceUi;
  setUi(ui: AmbienceUi): void;
}

export const useAmbienceStore = create<AmbienceStoreState>((set) => ({
  ui: IDLE_UI,
  setUi: (ui) => set({ ui }),
}));

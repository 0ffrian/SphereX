// Area search as a rail tool (A18.1, A21.13; issue #96). One place for the kill switch and for the
// rules of entering the tool, so ToolRail, the hash and the cards agree.
import { useShellStore, type ShellState } from '@/app/shell/shellStore';
import { useAppStore } from '@/state/store';

/**
 * Kill switch (Q-205, closed by Moon on 11 Nov 2026): Area search is shown at the event with
 * precomputed results. False hides the rail button, ignores `area=` in links and mounts no Area
 * card or layer. It is a compile-time constant: switching it off needs a rebuild.
 */
export const AREA_TOOL_ENABLED = true;

/**
 * Choose the tool (A18.1; Q-406 (5)): the Area card opens; the pointer mode is `draw` unless an
 * area is already open, whose box and card come back in `pan`.
 */
export function enterAreaTool(): void {
  if (!AREA_TOOL_ENABLED) return;
  const shell = useShellStore.getState();
  const store = useAppStore.getState();
  shell.setTool('area');
  store.areaShowCard();
  useShellStore.getState().setPointerMode(store.area.areaId ? 'pan' : 'draw');
  void store.areaLoadIndex();
}

/** Leave the tool from its card's ×: the sky alone, the slice kept (A18.4). */
export function leaveAreaTool(): void {
  useAppStore.getState().areaCloseCard();
  useShellStore.getState().setTool('sky');
}

/**
 * A split pane is open (blink stops, A18.3). Today that is the build pane; #81's pane kinds swap in
 * here.
 */
export function paneOpen(shell: Pick<ShellState, 'build'>): boolean {
  return shell.build.open;
}
